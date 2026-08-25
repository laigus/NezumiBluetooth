# COCO 模块内部结构

## 源码归属

| 内容 | 路径 |
| --- | --- |
| 模块定义与广播识别 | `miniprogram/devices/coco/definition.js` |
| GATT 与传输画像 | `miniprogram/devices/coco/profile.js` |
| 协议控制器 | `miniprogram/devices/coco/controller.js` |
| 内置频率 | `miniprogram/devices/coco/frequencies/` |
| 控制页 | `miniprogram/pages/control/` |
| 频率详情页 | `miniprogram/pages/frequency/` |
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

1. `frequency-runtime` 按当前设备画像取得内置频率和手机本机导入条目。
2. `frequency-schema` 校验设备归属、时序、最终停止数据和日程摘要。
3. 用户点击列表项“开始”后，`ProgramRunner` 以启动时刻为零点，按每帧 `atMs` 调度。
4. 每一帧交给 COCO 控制器，再由控制器调用 BLE 核心写入。
5. 运行会话按墙钟更新已用时间，列表和详情页共享同一状态。
6. 完整运行发送全部帧；提前停止会清除剩余调度、等待在途写入并发送停止数据。

同一时刻只运行一个频率。运行或停止尚未完成时，其他条目的开始按钮保持禁用。

## 进度与详情

- 进度使用 `elapsedMs / durationMs` 计算，不使用已发送帧数代替时间。
- 波形从发送顺序中的控制值采样，只用于观察相对变化，不改变原始帧或调度。
- 控制页在对应列表卡片内显示进度。
- 详情页共享同一运行会话，并提供开始、停止、统计、波形和单项导出。
- 页面转入后台或连接断开时会取消剩余调度并执行停止处理。

## 本机数据

- 内置频率随小程序源码上传。
- 导入频率保存在微信本地存储中，不依赖云端。
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
