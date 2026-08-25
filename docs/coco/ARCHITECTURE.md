# COCO 模块内部结构

## 源码归属

| 内容 | 路径 |
| --- | --- |
| 模块定义与广播识别 | `miniprogram/devices/coco/definition.js` |
| GATT 与传输画像 | `miniprogram/devices/coco/profile.js` |
| 协议控制器 | `miniprogram/devices/coco/controller.js` |
| 手动模式协议表 | `miniprogram/devices/coco/manual-protocol.js` |
| 内置频率 | `miniprogram/devices/coco/frequencies/` |
| 控制页 | `miniprogram/pages/control/` |
| 频率详情页 | `miniprogram/pages/frequency/` |
| 手动模式页 | `miniprogram/pages/manual/` |
| 频率格式与完整性 | `miniprogram/utils/frequency-schema.js` |
| 本地频率库 | `miniprogram/utils/frequency-store.js` |
| 共享运行会话 | `miniprogram/utils/frequency-runtime.js` |
| 文件导入与分享 | `miniprogram/utils/frequency-file.js` |
| 进度、统计与波形 | `miniprogram/utils/frequency-view.js` |
| 定时调度与取消 | `miniprogram/utils/program-runner.js` |
| 本地抓包转换工具 | `tools/coco/extract-frequency.py` |

COCO 的协议常量以设备画像和控制器为运行来源。本地转换所需的抓包筛选规则保存在 COCO 工具目录；通用架构文档不重复这些具体值。

## 连接与页面入口

1. 设备注册表调用 COCO 的广播匹配函数。
2. 匹配成功后，设备会话把 COCO 画像注入 BLE 核心。
3. BLE 核心完成连接、MTU、服务与特征发现及通知订阅。
4. COCO 控制器确认目标传输通道可用。
5. 设备管理显示当前连接，点击后进入 COCO 控制页。

## 频率列表与运行

1. `frequency-runtime` 按当前设备画像取得内置频率和手机本机条目。
2. `frequency-schema` 校验设备归属、时序、最终停止数据和日程摘要。
3. 用户点击列表项“开始”后，`ProgramRunner` 以启动时刻为零点，按每帧 `atMs` 调度。
4. 每一帧交给 COCO 控制器，再由控制器调用 BLE 核心写入。
5. 运行会话按墙钟更新已用时间，列表和详情页共享同一状态。
6. 完整运行发送全部帧；提前停止会清除剩余调度、等待在途写入并发送停止数据。
7. 打开循环后，末帧发送完成即从首帧开始下一轮；运行状态记录轮次，每轮时间进度独立归零。

同一时刻只运行一个频率。运行或停止尚未完成时，其他条目的开始按钮保持禁用；循环运行直到用户停止、断线或小程序进入后台。

## 手动控制与录制

1. `manual-protocol` 接收两个 0–100 连续值；非零值归一化为 COCO 的有效控制码，0 不再映射到会产生最低档动作的推导数据。
2. 页面使用大面积自定义触控轨道把横向位置换算为连续值；运行中按固定短间隔发送当时最新组合，不等待停止拖动，也不积压旧值。
3. 控制器在普通拖动中只发送发生变化的通道；开始和松手时强制发送完整双通道状态，并短间隔重复最终状态，降低 `writeNoResponse` 丢帧导致的快转慢滞后。
4. 任一项到 0 时，控制器先发送设备画像中已确认的全局停止数据；另一项仍大于 0 时再重新发送其有效数据。两项都为 0 时只保持停止。
5. 创建频率时，页面记录每次成功写入的帧及其相对时间。
6. 停止后追加最终停止帧，通过 `frequency-runtime` 写入同一个本机频率库。

手动协议表属于 COCO 模块，不进入 BLE 核心或共享频率格式。手动控制与计划运行互斥，避免两个运行源同时写入同一设备。

## 进度与详情

- 进度使用 `elapsedMs / durationMs` 计算，不使用已发送帧数代替时间。
- 波形从发送顺序中的控制值采样，只作为固定高度的中等尺寸预览，不改变原始帧或调度，也不自动占满详情页剩余空间。
- 控制页在对应列表卡片内显示进度。
- 详情页共享同一运行会话，并提供开始、停止、统计、波形和单项导出。
- 页面转入后台或连接断开时会取消剩余调度并执行停止处理。

## 本机数据

- 内置频率随小程序源码上传。
- 导入频率和手动录制频率都保存在微信本地存储中，不依赖云端。
- 本机频率可在详情页底部改名或删除；两个操作与导出按钮同级并保持完整触控尺寸，列表和频率信息区不放管理入口，内置频率不进入可修改集合。
- 同一规范化日程摘要只保留一份。
- ID 冲突但内容不同时，本地频率库生成新的本机 ID。
- 导出文件只包含频率正式字段，不包含页面运行状态。

## 完整性

频率日程按 `atMs|HEX无空格` 逐行规范化并计算 SHA-256。手机导入和开始运行前都会复算摘要，因此时间、字节或顺序变化会被识别。格式细节见 [FREQUENCY_PACKAGE.md](FREQUENCY_PACKAGE.md)。

## 本地转换工具

`tools/coco/extract-frequency.py` 只处理 COCO：

- 从 sysdiagnose 归档提取 PacketLogger；
- 使用 COCO 的写入条件筛选事件；
- 根据 COCO 的停止规则划分候选区间；
- 按源时间生成可导入频率文件；
- 输出运行所需字段和规范化日程摘要，不嵌入输入文件名、采集摘要、时间或源帧。

该工具没有设备选择参数，也不作为其他设备的解析入口。
