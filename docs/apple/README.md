# Apple 与 iPhone 文档

本目录集中记录项目中可被所有设备模块复用的 Apple 平台流程，不包含具体设备名称、协议、指令、频率或本地分析结论。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [将微信小程序构建为 iOS App](IOS_APP_BUILD.md) | 使用微信小程序多端框架生成独立 IPA，并在 iPhone 上调试或准备发布 |
| [iPhone 蓝牙数据采集](IPHONE_BLUETOOTH_CAPTURE.md) | 安装 Apple 蓝牙日志描述文件、触发 `sysdiagnose` 并导出诊断归档 |

## 两种“描述文件”

Apple 流程中会遇到两种用途完全不同的文件：

- `.mobileconfig`：安装到 iPhone，用于开启 Bluetooth 等专项诊断日志；对应蓝牙数据采集流程。
- `.mobileprovision`：配合签名证书构建 IPA，用于 iOS App 真机调试、内测或发布；对应 iOS App 构建流程。

设备模块需要分析诊断归档时，只在自己的 `docs/<device>/` 和 `tools/<device>/` 中描述协议筛选与产物生成；本目录只负责 Apple 平台上的通用采集与构建步骤。
