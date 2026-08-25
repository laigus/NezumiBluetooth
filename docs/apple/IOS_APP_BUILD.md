# 将微信小程序构建为 iOS App

本文记录如何使用微信官方“小程序多端框架”把同一套原生小程序代码构建为独立 iOS App。构建结果是可安装的 IPA，而不是 Swift 或 Xcode 源码；原有微信小程序仍可继续编译和发布。

## 1. 适用范围

原生微信小程序以及兼容的第三方小程序项目都可以升级为多端项目。对于 BLE 控制项目，扫描、连接、发现 GATT、订阅通知、读写特征和设置 MTU 等接口由官方 Bluetooth SDK 提供。

升级前先检查项目使用的全部 `wx.*` API。多端框架 API 总览中标记为“否”的接口需要用多端新增 API 或条件编译替换。例如：

- 小程序侧文件选择可继续使用 `wx.chooseMessageFile`；App 侧使用 `wx.miniapp.chooseFile`。
- 小程序侧文件分享可继续使用 `wx.shareFileMessage`；App 侧使用 `wx.miniapp.shareFile`。

平台差异应收敛在设备无关的适配层中，设备模块不直接判断 iOS 或微信运行环境。

## 2. 准备工作

- 安装最新版微信开发者工具并登录。
- 准备可用的微信小程序 AppID，由小程序管理员或开发者完成扫码绑定。
- 在 Windows 上连接 iPhone 时，安装 iTunes 与 iCloud，并准备可靠的 USB 数据线。
- 在 iPhone 中开启“开发者模式”。
- 仅在自己的 iPhone 上临时测试时可使用普通 Apple Account；提交 App Store 时使用加入 Apple Developer Program 的账号。

## 3. 升级为多端项目

1. 用微信开发者工具打开项目。
2. 在顶部模式选择中切换到“多端应用模式”，或使用“工具 → 升级为多端项目”。
3. 小程序尚未绑定多端应用时，用管理员或开发者微信扫描页面二维码，按手机提示创建并绑定。
4. 返回开发者工具，确认绑定完成，再执行升级。
5. 检查工具生成的项目变动：
   - `project.config.json` 增加 `"projectArchitecture": "multiPlatform"`；
   - 项目根目录增加 `project.miniapp.json`。

本项目公开仓库继续只提交脱敏示例配置。真实 AppID、Apple Connect 信息、P8、P12、密码、证书和 `.mobileprovision` 文件都保存在 Git 忽略的本机路径中。

## 4. 配置 iOS 与蓝牙能力

在多端应用模式的项目配置中完成：

1. 为 iOS 启用基础 SDK。
2. 按需启用扩展 SDK 中的 **Bluetooth SDK**。
3. 填写真实、具体的蓝牙权限用途描述；正式发布时不要沿用工具自动生成的默认描述。
4. 配置 App 名称、iOS 图标和启动资源。
5. 需要正式移动应用身份时，在多端应用控制台配置 Bundle ID 与 Universal Link。

多端框架文档提示，蓝牙扫描还需要手机开启相应的系统权限。首次真机运行时逐项检查蓝牙及框架要求的定位授权。

## 5. 处理平台差异

使用多端框架条件编译保持一套源码：

```js
// #if MP
// 微信小程序实现
// #elif IOS
// iOS App 实现
// #endif
```

优先把差异封装成统一函数，例如“选择导入文件”“导出文件”“分享文件”，业务页面只调用统一接口。完成适配后同时验证：

- 微信小程序原有页面与 BLE 行为；
- iOS App 的文件导入和导出；
- iOS App 的扫描、连接、通知、写入、停止与主动断开；
- App 进入后台、恢复前台及蓝牙意外断开后的状态。

## 6. 在 Windows 上运行到 iPhone

1. 使用 USB 将 iPhone 连接到电脑，并在两端确认信任。
2. 在微信开发者工具刷新设备列表，选择对应的 iOS 真机。
3. 点击“运行”。
4. 首次测试选择“临时签名”，输入该 iPhone 使用的 Apple Account 与密码。
5. 等待构建与安装完成。
6. 首次打开若出现“不受信任的开发者”，进入：

   ```text
   设置 → 通用 → VPN 与设备管理 → 开发者 App
   ```

   选择对应账号并完成信任。

临时签名适合本机验证。它使用平台分配的测试 Bundle ID，产物不作为 App Store 发布包。

## 7. 构建 IPA

在多端应用模式中选择“构建 → 打包生成 IPA”：

- **临时签名**：使用普通 Apple Account 和已连接的 iPhone，适合个人真机测试。
- **证书签名**：使用 P12 证书、证书密码和 Provisioning Profile；开发证书或 Ad Hoc 证书用于测试，分发证书用于 App Store。

App Store 发布还需要正式 Bundle ID、已审核的移动应用配置和正式资源包。Apple 要求 IPA 具有应用版本与构建号；这两个字段只作为平台打包元数据维护，不进入页面文案或项目版本体系。

## 8. 提交 App Store

1. 使用付费 Apple Developer 账号准备正式 Bundle ID、分发证书和发布用 `.mobileprovision`。
2. 在开发者工具中使用证书签名构建正式 IPA。
3. 在 Mac 上使用 Transporter 上传 IPA 到 App Store Connect。
4. 在 App Store Connect 补充应用资料、隐私信息和测试说明并提交审核。

## 9. 官方文档

- [微信开放文档：小程序多端框架概述](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/intro/)
- [微信开放文档：快速构建多端应用](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/quickstart/first_app.html)
- [微信开放文档：升级为多端项目](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/devtools/miniproject.html)
- [微信开放文档：API 总览](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/api/total.html)
- [微信开放文档：运行于真机](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/test/device.html)
- [微信开放文档：打包生成 IPA](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/build-ipa.html)
- [微信开放文档：IPA 上架 App Store](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/ios-publish.html)
