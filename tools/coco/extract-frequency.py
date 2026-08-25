#!/usr/bin/env python3
"""从 COCO 的 PacketLogger/sysdiagnose/TSV 生成可导入频率文件。"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable

sys.dont_write_bytecode = True

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parents[2]
LOCAL_TSHARK = ROOT / ".tools" / "wireshark" / "app" / "Wireshark" / "tshark.exe"

COCO_PROFILE_ID = "captured-ff60-device"
COCO_ATT_OPCODE = "0x52"
COCO_ATT_HANDLE = "0x000e"
COCO_STOP_HEX = "C3 7E 25 62 63"


@dataclass(frozen=True)
class Event:
    source_frame: int
    epoch: Decimal
    hex_value: str


def spaced_hex(value: str) -> str:
    compact = re.sub(r"[^0-9A-Fa-f]", "", value or "").upper()
    if not compact or len(compact) % 2:
        raise ValueError(f"无效 HEX：{value!r}")
    return " ".join(compact[index:index + 2] for index in range(0, len(compact), 2))


def read_events_tsv(path: Path) -> list[Event]:
    text = path.read_text(encoding="utf-8-sig")
    first_line = text.splitlines()[0] if text.splitlines() else ""
    delimiter = "|" if "|" in first_line else "\t"
    rows = csv.DictReader(text.splitlines(), delimiter=delimiter)
    events: list[Event] = []
    for row in rows:
        opcode = (row.get("btatt.opcode") or COCO_ATT_OPCODE).lower()
        handle = (row.get("btatt.handle") or COCO_ATT_HANDLE).lower()
        raw_value = row.get("btatt.value") or ""
        if opcode != COCO_ATT_OPCODE or handle != COCO_ATT_HANDLE or not raw_value:
            continue
        events.append(Event(
            source_frame=int(row["frame.number"]),
            epoch=Decimal(row["frame.time_epoch"]),
            hex_value=spaced_hex(raw_value),
        ))
    return events


def find_tshark(explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if path.is_file():
            return path
    if LOCAL_TSHARK.is_file():
        return LOCAL_TSHARK
    discovered = shutil.which("tshark")
    if discovered:
        return Path(discovered)
    raise FileNotFoundError("请安装 Wireshark，或用 --tshark 指定 tshark.exe")


def extract_packetlogger(archive: Path, destination: Path) -> Path:
    with tarfile.open(archive, mode="r:*") as bundle:
        members = [
            member for member in bundle.getmembers()
            if member.isfile() and member.name.replace("\\", "/").endswith(
                "/logs/Bluetooth/bluetoothd-hci-latest.pklg"
            )
        ]
        if not members:
            raise FileNotFoundError("归档中未找到 logs/Bluetooth/bluetoothd-hci-latest.pklg")
        member = members[-1]
        source = bundle.extractfile(member)
        if source is None:
            raise FileNotFoundError("PacketLogger 数据读取失败")
        output = destination / "bluetoothd-hci-latest.pklg"
        with source, output.open("wb") as target:
            shutil.copyfileobj(source, target)
        return output


def tshark_to_tsv(packetlogger: Path, tshark: Path, destination: Path) -> Path:
    command = [
        str(tshark), "-r", str(packetlogger),
        "-Y", (
            "packetlogger.type == 0x02 && "
            f"btatt.opcode == {COCO_ATT_OPCODE} && btatt.handle == {COCO_ATT_HANDLE}"
        ),
        "-T", "fields", "-E", "header=y", "-E", "separator=|", "-E", "occurrence=f",
        "-e", "frame.number", "-e", "frame.time_epoch", "-e", "packetlogger.type",
        "-e", "btatt.opcode", "-e", "btatt.handle", "-e", "btatt.value",
    ]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode:
        raise RuntimeError(f"tshark 退出码 {completed.returncode}：{completed.stderr.strip()}")
    destination.write_text(completed.stdout, encoding="utf-8", newline="\n")
    return destination


def find_candidates(
    events: list[Event],
    internal_stop_gap_ms: int = 1000,
) -> list[list[Event]]:
    candidates: list[list[Event]] = []
    current: list[Event] = []
    for index, event in enumerate(events):
        if not current:
            if event.hex_value == COCO_STOP_HEX:
                continue
            current = [event]
        else:
            current.append(event)
        if event.hex_value != COCO_STOP_HEX:
            continue

        next_active = next((item for item in events[index + 1:] if item.hex_value != COCO_STOP_HEX), None)
        gap_ms = None if next_active is None else int(
            ((next_active.epoch - event.epoch) * 1000).to_integral_value(rounding=ROUND_HALF_UP)
        )
        if gap_ms is not None and 0 <= gap_ms <= internal_stop_gap_ms:
            continue
        if len(current) >= 2:
            candidates.append(current)
        current = []
    return candidates


def select_frame_range(events: Iterable[Event], start_frame: int, stop_frame: int) -> list[Event]:
    selected = [event for event in events if start_frame <= event.source_frame <= stop_frame]
    if not selected or selected[0].source_frame != start_frame or selected[-1].source_frame != stop_frame:
        raise ValueError("指定的起止帧在目标写入事件中不完整")
    return selected


def schedule_frames(events: list[Event]) -> list[dict]:
    if not events:
        raise ValueError("所选区间没有写入事件")
    if events[-1].hex_value != COCO_STOP_HEX:
        raise ValueError(f"所选区间最后一帧应为停止指令 {COCO_STOP_HEX}")
    origin = events[0].epoch
    frames = []
    for event in events:
        at_ms = int(((event.epoch - origin) * 1000).to_integral_value(rounding=ROUND_HALF_UP))
        frames.append({
            "atMs": at_ms,
            "hex": event.hex_value,
        })
    return frames


def schedule_hash(frames: list[dict]) -> str:
    canonical = "".join(
        f"{frame['atMs']}|{frame['hex'].replace(' ', '')}\n" for frame in frames
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest().upper()


def make_package(
    identifier: str,
    name: str,
    description: str,
    events: list[Event],
) -> dict:
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", identifier):
        raise ValueError("--id 只使用小写字母、数字、点、短横线或下划线，最长 64 字符")
    frames = schedule_frames(events)
    return {
        "id": identifier,
        "name": name.strip(),
        "description": description.strip(),
        "deviceProfileId": COCO_PROFILE_ID,
        "durationMs": frames[-1]["atMs"],
        "frames": frames,
        "integrity": {"scheduleSha256": schedule_hash(frames)},
    }


def describe_candidates(candidates: list[list[Event]]) -> None:
    print("候选  起始帧  结束帧  写入数  时长(ms)  首帧")
    for index, candidate in enumerate(candidates, start=1):
        duration = int(((candidate[-1].epoch - candidate[0].epoch) * 1000).to_integral_value(
            rounding=ROUND_HALF_UP
        ))
        print(
            f"{index:>4}  {candidate[0].source_frame:>6}  {candidate[-1].source_frame:>6}"
            f"  {len(candidate):>6}  {duration:>8}  {candidate[0].hex_value}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="sysdiagnose 归档、.pklg 或已导出的 TSV")
    parser.add_argument("--tshark", help="tshark.exe 路径")
    parser.add_argument("--list", action="store_true", help="只列出检测到的候选区间")
    parser.add_argument("--candidate", type=int, help="选择第几个候选区间（从 1 开始）")
    parser.add_argument("--start-frame", type=int, help="手工指定起始源帧")
    parser.add_argument("--stop-frame", type=int, help="手工指定最终停止源帧")
    parser.add_argument("--internal-stop-gap-ms", type=int, default=1000,
                        help="停止后在此毫秒数内又运行时，将停止视为区间内部帧")
    parser.add_argument("--id", default="imported-frequency", help="频率 ID")
    parser.add_argument("--name", default="新频率", help="手机中显示的名称")
    parser.add_argument("--description", default="由本地 PacketLogger 解析生成。")
    parser.add_argument("--output", help="输出 .haohao-frequency.json 路径")
    args = parser.parse_args(argv)

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        raise FileNotFoundError(f"输入文件不存在：{input_path}")

    with tempfile.TemporaryDirectory(prefix="haohao-coco-frequency-") as temporary:
        temp = Path(temporary)
        packetlogger: Path | None = None
        if input_path.suffix.lower() in {".tsv", ".txt"}:
            tsv = input_path
        else:
            packetlogger = input_path if input_path.suffix.lower() == ".pklg" else extract_packetlogger(input_path, temp)
            tsv = tshark_to_tsv(
                packetlogger,
                find_tshark(args.tshark),
                temp / "device-writes.tsv",
            )

        events = read_events_tsv(tsv)
        if not events:
            raise ValueError(
                f"没有找到 opcode {COCO_ATT_OPCODE}、handle {COCO_ATT_HANDLE} 的 COCO 写入"
            )
        candidates = find_candidates(events, args.internal_stop_gap_ms)

        if args.list or (args.candidate is None and args.start_frame is None):
            describe_candidates(candidates)
            if args.list:
                return 0
            print("请追加 --candidate N，或同时提供 --start-frame 与 --stop-frame。")
            return 2

        if args.start_frame is not None or args.stop_frame is not None:
            if args.start_frame is None or args.stop_frame is None:
                raise ValueError("--start-frame 与 --stop-frame 需同时提供")
            selected = select_frame_range(events, args.start_frame, args.stop_frame)
        else:
            if args.candidate < 1 or args.candidate > len(candidates):
                raise ValueError(f"候选编号范围为 1..{len(candidates)}")
            selected = candidates[args.candidate - 1]

        package = make_package(args.id, args.name, args.description, selected)
        output = Path(args.output or f"{args.id}.haohao-frequency.json").expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(
            f"FREQUENCY_OK path={output} frames={len(package['frames'])} "
            f"durationMs={package['durationMs']} scheduleSha256={package['integrity']['scheduleSha256']}"
        )
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # CLI 边界统一返回简洁错误。
        print(f"ERROR {error}", file=sys.stderr)
        raise SystemExit(1)
