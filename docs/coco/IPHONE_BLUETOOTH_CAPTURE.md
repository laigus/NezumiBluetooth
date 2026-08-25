# COCO iPhone 蓝牙操作数据采集说明

这份说明记录如何用 iPhone `sysdiagnose` 保存原控制程序与 COCO 之间的操作数据，并生成可导入的频率文件。具体动作名称和采集结果仍记录在本机。

## 1. 采集前准备

1. 记下准备开始操作的准确时间，精确到分钟。
2. 退出“耗耗蓝牙”，确认它已经与设备断开。
3. 打开原控制程序并连接设备。
4. 一次采集只做一种明确动作，方便后续按时间定位和比较。
5. 需要采集完整动作时，先运行到自然结束，再立刻触发系统诊断。

建议同时写一条简短记录，例如：

```text
<触发时间>：<动作摘要>，结束后立即触发诊断
```

## 2. 执行要记录的操作

以一次“停止 → 运行 → 停止”为例：

1. 在原控制程序中点“停止”。
2. 启动准备采集的模式。
3. 让它运行预定时长或自然结束。
4. 模式结束后立刻进行下一节的按键操作。

操作完成与触发诊断之间的间隔越短，后续越容易定位对应数据。

## 3. 触发 sysdiagnose

1. 同时按住 **音量加、音量减、侧边键**。
2. 大约 `1～1.5 秒` 后一起松开。
3. iPhone 出现短暂震动时，通常表示已经触发。
4. 如果先出现关机与 SOS 页面，马上松开按键并取消该页面；不要继续长按。部分系统版本即使显示过这个页面，也可能已经开始生成诊断文件。
5. 等待约 `5 分钟`；归档较大时可再多等几分钟。

按键的重点是“三个键同时按、短时间后一起松开”，而不是持续长按。

## 4. 找到并导出文件

在 iPhone 中依次进入：

```text
设置 → 隐私与安全性 → 分析与改进 → 分析数据
```

然后：

1. 找到时间最新、名称以 `sysdiagnose_` 开头的条目。
2. 点开条目，点击分享按钮。
3. 选择“存储到文件”或隔空投送到电脑。
4. 等待分享进度完成；文件通常很大。

常见文件名类似：

```text
sysdiagnose_YYYY.MM.DD_HH-MM-SS+0800_iPhone-OS_....tar.gz
```

有时“文件”或电脑只显示 `.gz` 后缀，其中仍可能是 **gzip 压缩的 tar 归档**。直接交给分析脚本识别，不要只凭后缀手工改名。

## 5. 分析数据中暂时没有新文件

按下面顺序处理：

1. 继续等待 `5～10 分钟`。
2. 退出“分析数据”页面后重新进入。
3. 按 `sysdiagnose_` 名称和刚才记下的触发时间查找。
4. 如果仍未出现，再执行一次“三键短按后一起松开”；手机壳影响按键同步时可先取下手机壳。
5. 感到震动后保持手机正常开机，并留在可操作状态等待生成。

如果触发时出现了关机页面，先返回系统，等待几分钟并检查列表；列表中已有新文件时无需重复触发。

## 6. 是否需要描述文件

通用 `sysdiagnose` 归档可能直接包含：

```text
logs/Bluetooth/bluetoothd-hci-latest.pklg
```

优先直接采集通用 `sysdiagnose`。若归档里缺少 Bluetooth PacketLogger，再到 Apple 官方“Profiles and Logs”页面查看 iOS/iPadOS 的 Bluetooth 或 Sysdiagnose 最新说明；部分专项描述文件下载会要求登录开发者账号。

## 7. 放入本项目

把原始归档放到项目的本地采集目录：

```text
captures/
```

同时在本机记录每个文件对应的触发时间与操作摘要。进入项目根目录后列出 COCO 候选区间：

```powershell
python tools\coco\extract-frequency.py captures\sysdiagnose_文件.gz --list
```

确认候选后生成手机可导入文件：

```powershell
python tools\coco\extract-frequency.py captures\sysdiagnose_文件.gz `
  --candidate 1 `
  --id new-frequency `
  --name "新频率" `
  --output "$HOME\Downloads\new-frequency.haohao-frequency.json"
```

该工具内置 COCO 的协议筛选与区间规则，候选列表会在本机显示源帧范围，但生成的分享文件只包含运行字段与规范化日程摘要。需要保全输入摘要和采用帧范围时，按 [采集验证记录](CAPTURE_EVIDENCE.md) 单独写入本机记录。把输出文件发到微信聊天，再进入“设备管理 → 当前连接设备”点击“导入频率”。原始诊断归档与中间分析文件只保存在本机，微信开发者工具只上传 `miniprogram/` 中的运行代码。

## 8. 文件内容与隐私

`sysdiagnose` 不只包含蓝牙数据，也包含系统日志、设备状态和其他诊断信息。保留原件时应放在本地受控目录；对外发送前先确认接收对象和用途。发布小程序时只带运行代码和内置频率数据，不带手机诊断归档。

## 官方参考

- [Apple Developer：Profiles and Logs](https://developer.apple.com/feedback-assistant/profiles-and-logs/)
- [Apple Developer：Sysdiagnose for iOS/iPadOS instructions](https://developer.apple.com/services-account/download?path=/iOS/iOS_Logs/sysdiagnose_Logging_Instructions.pdf)
- [Apple WWDC22：触发、查找和分享 sysdiagnose 的演示](https://developer.apple.com/videos/play/wwdc2022/10119/)
- [Apple iPhone 使用手册：分析与改进设置](https://support.apple.com/guide/iphone/iph3dd5fc7e/ios)
