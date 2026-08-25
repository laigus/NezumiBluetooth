# COCO 协议与真机验证流程

COCO 的服务、特征、写入方式、停止指令和内置频率内容以源码为准，本文只记录可重复执行的真机验证流程。

## 配置来源

| 内容 | 唯一来源 |
| --- | --- |
| 设备模块注册 | `miniprogram/devices/index.js` |
| 设备画像 | `miniprogram/devices/coco/profile.js` |
| 协议控制器 | `miniprogram/devices/coco/controller.js` |
| 内置频率数据 | `miniprogram/devices/coco/frequencies/` |
| 频率格式校验 | `miniprogram/utils/frequency-schema.js` |
| 调度与停止 | `miniprogram/utils/program-runner.js` |

频率通过 `deviceProfileId` 绑定设备画像。运行前会校验设备类型、帧时间、完整性摘要，以及最后一帧是否与设备画像中的停止指令一致。

## 真机确认顺序

1. 退出其他控制端，把目标设备置于可连接状态。
2. 打开“设备管理”，等待当前连接设备出现。
3. 点击设备进入控制页。
4. 选择任意频率，开始运行数秒后点击同一卡片的“停止”。
5. 再次开始并完整运行，保持小程序在前台，确认时间进度持续更新并最终完成。
6. 点击频率卡片进入详情，检查运行状态、波形、时长和帧数。
7. 对照原控制动作确认变化趋势、总时长与结束状态。
8. 需要查看底层数据时进入“高级调试”，手动开始扫描并复制会话记录。

## 通过条件

- 设备管理只连接符合当前设备画像的目标，并展示当前连接设备。
- 连接后选择设备画像配置的写入与通知通道。
- 完整运行按原顺序发送全部频率帧，最后一帧是设备画像配置的停止指令。
- 提前停止会清除剩余调度，并额外发送停止指令。
- 重复完整运行时，动作趋势与总时长保持一致。
- 页面转入后台或主动断开后，设备处于停止状态。
- 导入文件后，新频率直接出现在当前设备的频率列表中。
- 详情页导出的频率能够再次通过完整性校验。
- 列表和详情的进度都按已运行时间与总时长计算。
- 高级调试仅在用户点击“开始扫描”后扫描，停止或切页后保持停止。

## 新频率流程

1. 按 [IPHONE_BLUETOOTH_CAPTURE.md](IPHONE_BLUETOOTH_CAPTURE.md) 采集清晰、单一的原控制动作。
2. 在电脑列出候选：

   ```powershell
   python tools\coco\extract-frequency.py captures\sysdiagnose_文件.gz --list
   ```

3. 用 COCO 专属工具选中候选并生成 `.haohao-frequency.json`，检查输出的帧数、时长和 SHA-256。
4. 把文件发到微信聊天。
5. 手机进入“设备管理 → 当前连接设备”，点击“导入频率”并选择文件。
6. 先做数秒运行加停止，再完整运行。
7. 结果稳定后可继续作为本机导入项使用，也可加入 `miniprogram/devices/coco/frequencies/`。

频率字段说明见 [FREQUENCY_PACKAGE.md](FREQUENCY_PACKAGE.md)。
