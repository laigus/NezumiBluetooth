# COCO `.haohao-frequency.json` 本地频率格式

## 目标

频率文件是一个体积较小、可校验、可通过微信聊天分享的 JSON 文件。手机导入后直接写入微信本地存储；增加本机频率不涉及小程序上传与体验版发布。

## 完整结构

```json
{
  "id": "my-frequency",
  "name": "我的频率",
  "description": "可选的频率说明。",
  "deviceProfileId": "device-profile-id",
  "durationMs": 1200,
  "frames": [
    { "atMs": 0, "hex": "AA BB" },
    { "atMs": 1200, "hex": "CC DD" }
  ],
  "integrity": {
    "scheduleSha256": "由工具计算的 64 位十六进制摘要"
  }
}
```

## 字段规则

| 字段 | 规则 |
| --- | --- |
| `id` | 1–64 字符；小写字母或数字开头，可含点、短横线、下划线 |
| `name` | 手机显示名称，1–40 字符 |
| `description` | 可选说明，最多 200 字符；没有需要展示的内容时使用空字符串 |
| `deviceProfileId` | 必须匹配目标设备画像的 ID |
| `durationMs` | 非负整数，并且等于最后一帧的 `atMs` |
| `frames` | 1–5000 帧；`atMs` 单调递增或相等；HEX 为完整字节 |
| 最后一帧 | 必须匹配目标设备画像中配置的停止指令 |
| `integrity.scheduleSha256` | 规范化日程 SHA-256；导入时手机复算 |

单个频率最长 60 分钟，单个 JSON 最多 2 MB，本机最多保存 100 个导入频率。

## SHA-256 规范化

每帧写一行：

```text
atMs|HEX去掉空格并转大写\n
```

例如：

```text
0|AABB
1200|CCDD
```

对完整 ASCII 文本计算 SHA-256，结果用大写十六进制。`tools/coco/extract-frequency.py` 会为 COCO 频率自动生成该字段；手工编辑帧或时间后需重新生成摘要。

## 手机导入

1. 把文件发送到微信聊天。
2. 打开“设备管理”，点击当前连接设备。
3. 点击“导入频率”。
4. 选择收到的 `.haohao-frequency.json` 文件。
5. 导入成功后，新条目出现在频率列表中，并带“本机导入”标签。

同一日程哈希只保留一份。ID 与已有条目同名但内容不同，导入器会自动追加 `-2`、`-3` 等后缀。

## 手机导出与分享

1. 点击频率卡片进入详情页。
2. 点击“导出 / 分享频率”。
3. 分享成功时生成同格式 JSON 文件；系统接口未显示分享面板时，完整 JSON 会复制到剪贴板。

导出的文件只包含正式频率字段，不包含运行按钮、连接状态、波形采样、原始文件名、采集摘要、采集时间或源帧号。

## 本地生成

```powershell
python tools\coco\extract-frequency.py INPUT --list
python tools\coco\extract-frequency.py INPUT `
  --candidate 1 `
  --id my-frequency `
  --name "我的频率" `
  --output "$HOME\Downloads\my-frequency.haohao-frequency.json"
```

`INPUT` 可为 iPhone sysdiagnose 的 `.tar.gz`/`.gz`、`bluetoothd-hci-latest.pklg` 或包含 COCO 目标写入字段的 TSV，也可用 `--start-frame` 与 `--stop-frame` 精确指定区间。

本地工具只把运行所需字段和日程摘要写入可分享文件。原始输入、文件摘要、源帧范围和分析记录保存在被 Git 排除的 `captures/` 或 `analysis/` 中。
