# iPhone 蓝牙数据采集

本文记录如何在 iPhone 上采集某个控制端与 BLE 设备交互时的系统诊断数据。流程只负责取得 Apple 诊断归档，不包含任何具体设备的协议、指令解析或业务产物生成。

## 1. 选择采集方式

通用 `sysdiagnose` 有时已经包含 Bluetooth PacketLogger。需要稳定采集蓝牙数据，或已有归档中缺少蓝牙包记录时，先安装 Apple 官方的 Bluetooth 日志描述文件，再执行操作并触发 `sysdiagnose`。

Apple 蓝牙日志描述文件的扩展名是 `.mobileconfig`，它与构建 IPA 使用的 `.mobileprovision` 不是同一种文件。

## 2. 登录 Apple 网站并下载蓝牙日志描述文件

1. 在 iPhone 的 Safari 中打开 [Apple Developer：Profiles and Logs](https://developer.apple.com/feedback-assistant/profiles-and-logs/)。
2. 使用 Apple Account 登录 Apple Developer。当前 Bluetooth Profile 下载链接会先进入 Apple 登录页；登录本身不等于加入付费开发者计划。
3. 页面筛选平台 `iOS/iPadOS`，搜索 `Bluetooth for iOS/iPadOS`。
4. 点击该条目下的 **Profile**。下载文件名通常为：

   ```text
   iOSBluetoothLogging.mobileconfig
   ```

5. 同一条目下的 **Instructions** 是 Apple 当前配套说明；采集前以页面上的最新要求为准。

也可以直接使用以下官方入口；未登录时会先跳转到 Apple 登录页：

- [Bluetooth for iOS/iPadOS：Profile](https://developer.apple.com/services-account/download?path=/iOS/iOS_Logs/iOSBluetoothLogging.mobileconfig)
- [Bluetooth for iOS/iPadOS：Instructions](https://developer.apple.com/services-account/download?path=/iOS/iOS_Logs/Bluetooth_Logging_Instructions.pdf)

## 3. 在 iPhone 安装描述文件

下载完成后：

1. 在系统“设置”顶部点击“已下载描述文件”；没有该入口时进入：

   ```text
   设置 → 通用 → VPN 与设备管理
   ```

2. 选择刚下载的 Apple Bluetooth 日志描述文件。
3. 点击“安装”，输入锁屏密码并确认。
4. 按描述文件或 Apple Instructions 的提示完成重启等准备工作。
5. 再次进入“VPN 与设备管理”，确认该描述文件已经列出。

如果页面里只有 VPN 和“登录工作或学校账户”，表示系统当前没有收到待安装的描述文件。返回 Safari，再次点击 Bluetooth 条目下的 **Profile**，在下载提示中选择允许，然后立即回到“设置”检查“已下载描述文件”。也可在 Safari 下载列表核对是否取得了 `.mobileconfig`，不要把配套 PDF 当成描述文件安装。

## 4. 采集前准备

1. 记下准备开始操作的准确时间，精确到分钟。
2. 退出可能占用目标设备连接的其他控制端。
3. 打开准备观察的控制端并连接 BLE 设备。
4. 一次采集只执行一种明确动作，方便后续按时间定位和比较。
5. 需要采集完整动作时，先运行到自然结束，再立刻触发系统诊断。

建议在本机写一条简短记录：

```text
<触发时间>：<动作摘要>，结束后立即触发诊断
```

## 5. 执行要记录的操作

以一次“停止 → 运行 → 停止”为例：

1. 在控制端中点“停止”。
2. 启动准备采集的模式。
3. 让它运行预定时长或自然结束。
4. 模式结束后立刻触发 `sysdiagnose`。

操作完成与触发诊断之间的间隔越短，后续越容易定位对应数据。

## 6. 触发 sysdiagnose

1. 同时按住 **音量加、音量减、侧边键**。
2. 大约 `1～1.5 秒` 后一起松开。
3. iPhone 出现短暂震动时，通常表示已经触发。
4. 如果先出现关机与 SOS 页面，马上松开按键并取消该页面；部分系统版本即使显示过这个页面，也可能已经开始生成诊断文件。
5. 等待约 `5～10 分钟`，归档较大时继续等待。

按键的重点是“三个键同时按、短时间后一起松开”，而不是持续长按。

## 7. 找到并导出文件

在 iPhone 中依次进入：

```text
设置 → 隐私与安全性 → 分析与改进 → 分析数据
```

然后：

1. 找到时间最新、名称以 `sysdiagnose_` 开头的条目。
2. 点开条目并点击分享按钮。
3. 选择“存储到文件”或隔空投送到电脑。
4. 等待分享进度完成；文件通常较大。

常见文件名类似：

```text
sysdiagnose_YYYY.MM.DD_HH-MM-SS+0800_iPhone-OS_....tar.gz
```

有时系统只显示 `.gz` 后缀，其中仍可能是 gzip 压缩的 tar 归档。后续工具应按实际文件格式识别，不要只凭后缀手工改名。

## 8. 分析数据中暂时没有新文件

按下面顺序处理：

1. 继续等待 `5～10 分钟`。
2. 退出“分析数据”页面后重新进入。
3. 按 `sysdiagnose_` 名称和刚才记下的触发时间查找。
4. 列表仍未更新时，再执行一次“三键短按后一起松开”；手机壳影响按键同步时可先取下手机壳。
5. 感到震动后保持手机正常开机并等待生成。

如果触发时出现了关机页面，先返回系统并等待几分钟；列表中已有新文件时无需重复触发。

## 9. 确认蓝牙日志并交给设备模块

诊断归档中常见的 PacketLogger 路径为：

```text
logs/Bluetooth/bluetoothd-hci-latest.pklg
```

不同 iOS 版本的目录可能变化，应在归档中搜索 `.pklg`、`Bluetooth` 或 `PacketLogger`。通用归档仍没有蓝牙包记录时，确认 Bluetooth 日志描述文件已安装，再重新采集。

原始归档统一放在被 Git 忽略的本机目录：

```text
captures/
```

后续解析命令、协议筛选和产物格式由对应的 `docs/<device>/` 与 `tools/<device>/` 定义。

## 10. 采集后移除描述文件

完成采集并确认归档可用后进入：

```text
设置 → 通用 → VPN 与设备管理 → <Bluetooth 日志描述文件> → 移除描述文件
```

输入锁屏密码并确认。专项日志描述文件只在采集期间保留，避免长期产生额外诊断数据。

## 11. 文件内容与隐私

`sysdiagnose` 不只包含蓝牙数据，也包含系统日志、设备状态和其他诊断信息。原件与提取结果只保存在本机受控目录；分享前检查接收对象和文件内容。应用构建、微信上传和 Git 提交都不包含诊断归档。

## 官方参考

- [Apple Developer：Profiles and Logs](https://developer.apple.com/feedback-assistant/profiles-and-logs/)
- [Apple Developer：Bluetooth](https://developer.apple.com/bluetooth/)
- [Apple Developer：Sysdiagnose for iOS/iPadOS instructions](https://developer.apple.com/services-account/download?path=/iOS/iOS_Logs/sysdiagnose_Logging_Instructions.pdf)
- [Apple WWDC22：触发、查找和分享 sysdiagnose 的演示](https://developer.apple.com/videos/play/wwdc2022/10119/)
- [Apple iPhone 使用手册：分析与改进设置](https://support.apple.com/guide/iphone/iph3dd5fc7e/ios)
