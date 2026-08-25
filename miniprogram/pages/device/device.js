const ble = require('../../core/bluetooth')
const session = require('../../core/device-session')
const devices = require('../../devices/index')
const { makeRunnableFrequency } = require('../../utils/frequency-schema')
const { ProgramRunner } = require('../../utils/program-runner')
const {
  validateHex,
  hexToArrayBuffer,
  arrayBufferToHex,
  textToArrayBuffer,
  arrayBufferToText
} = require('../../utils/codec')

const SAVED_COMMANDS_PREFIX = 'haohao.bluetooth.savedCommands'

function debugPrograms(definition) {
  if (!definition || !definition.features || !definition.features.frequencies) return []
  return (definition.frequencies || []).map(
    (frequency) => makeRunnableFrequency(frequency, definition.profile)
  )
}

function programCards(programs) {
  return programs.map((program) => ({
    id: program.id,
    label: program.label,
    description: program.description,
    durationText: `${(program.durationMs / 1000).toFixed(1)} 秒`,
    frameCount: program.frames.length
  }))
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '')
  } catch (error) {
    return value || ''
  }
}

function shortUuid(uuid) {
  return ble.shortUuid(uuid)
}

function clockTime(timestamp) {
  const date = new Date(timestamp || Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  const millis = String(date.getMilliseconds()).padStart(3, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${millis}`
}

function readableText(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '·')
    .slice(0, 240)
}

function durationText(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatServices(services, active) {
  return (services || []).map((service) => ({
    uuid: service.uuid,
    shortUuid: shortUuid(service.uuid),
    isPrimary: service.isPrimary,
    discoveryError: service.discoveryError || '',
    characteristics: (service.characteristics || []).map((characteristic) => {
      const properties = characteristic.properties || {}
      return {
        uuid: characteristic.uuid,
        shortUuid: shortUuid(characteristic.uuid),
        capabilityText: (characteristic.capabilities || []).join(' · ') || '无可用操作',
        canRead: Boolean(properties.read),
        canWrite: Boolean(properties.write || properties.writeNoResponse),
        canNotify: Boolean(properties.notify || properties.indicate),
        isWriteTarget: service.uuid === active.writeServiceId &&
          characteristic.uuid === active.writeCharacteristicId,
        isNotifyTarget: service.uuid === active.notifyServiceId &&
          characteristic.uuid === active.notifyCharacteristicId
      }
    })
  }))
}

Page({
  data: {
    deviceId: '',
    deviceName: '',
    connected: false,
    busy: false,
    mtu: 23,
    services: [],
    serviceCount: 0,
    activeWrite: '',
    activeNotify: '',
    inputMode: 'hex',
    inputValue: '',
    sending: false,
    packets: [],
    logs: [],
    builtInCommands: [],
    programs: [],
    runningProgramId: '',
    programRunning: false,
    programStopping: false,
    programProgress: 0,
    programStatusText: '准备就绪',
    programElapsedText: '0:00',
    programFrameText: '0 / 0 帧',
    savedCommands: [],
    newCommandName: '',
    newCommandHex: '',
    gattExpanded: true,
    errorText: ''
  },

  onLoad(options) {
    this._closing = false
    this._definition = devices.getDeviceDefinition(safeDecode(options.definitionId))
    this._profile = this._definition ? this._definition.profile : null
    this._debugPrograms = debugPrograms(this._definition)
    this._savedCommandsKey = this._definition && this._definition.storage &&
      this._definition.storage.savedCommandsKey
      ? this._definition.storage.savedCommandsKey
      : (this._definition ? `${SAVED_COMMANDS_PREFIX}.${this._definition.id}` : SAVED_COMMANDS_PREFIX)
    const cards = programCards(this._debugPrograms)
    this._programRunner = new ProgramRunner({
      send: (hex, context) => this.sendProgramHex(hex, context),
      onState: (state) => this.onProgramState(state)
    })
    this.setData({
      deviceId: safeDecode(options.deviceId),
      deviceName: safeDecode(options.name) ||
        (this._definition ? this._definition.displayName : '通用 BLE 设备'),
      builtInCommands: this._profile && this._profile.commands || [],
      programs: cards,
      programFrameText: `0 / ${cards.length ? cards[0].frameCount : 0} 帧`
    })
    this.bindManagerEvents()
    this.loadSavedCommands()
    this.ensureConnection()
  },

  onUnload() {
    this._closing = true
    if (this._programRunner) this._programRunner.cancel()
    this.unbindManagerEvents()
    session.disconnect().catch(() => {})
  },

  bindManagerEvents() {
    this._unsubscribe = [
      ble.on('connection', (state) => {
        if (this._closing) return
        if (!state.connected && this._programRunner) this._programRunner.cancel()
        this.setData({ connected: Boolean(state.connected) })
      }),
      ble.on('gatt', () => this.hydrate()),
      ble.on('transport', () => this.hydrate()),
      ble.on('value', (packet) => this.pushPacket('RX', packet.value, {
        serviceId: packet.serviceId,
        characteristicId: packet.characteristicId
      })),
      ble.on('log', () => this.hydrateLogs())
    ]
  },

  unbindManagerEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  async ensureConnection() {
    const snapshot = ble.getSnapshot()
    if (snapshot.connected && snapshot.connectedDevice &&
      snapshot.connectedDevice.deviceId === this.data.deviceId &&
      session.getSnapshot().debug) {
      this.hydrate()
      return
    }

    this.setData({ busy: true, errorText: '' })
    wx.showLoading({ title: '正在连接', mask: true })
    try {
      await session.connectDebug({
        deviceId: this.data.deviceId,
        name: this.data.deviceName
      }, this._definition)
      this.hydrate()
    } catch (error) {
      this.showError(error)
    } finally {
      wx.hideLoading()
      this.setData({ busy: false })
    }
  },

  hydrate() {
    if (this._closing) return
    const snapshot = ble.getSnapshot()
    const active = snapshot.active || {}
    const device = snapshot.connectedDevice || {}
    this.setData({
      connected: snapshot.connected,
      deviceName: device.name || device.localName || this.data.deviceName,
      mtu: snapshot.mtu || 23,
      services: formatServices(snapshot.services, active),
      serviceCount: snapshot.services.length,
      activeWrite: active.writeCharacteristicId
        ? `${shortUuid(active.writeServiceId)} / ${shortUuid(active.writeCharacteristicId)}`
        : '未找到可写特征',
      activeNotify: active.notifyCharacteristicId
        ? `${shortUuid(active.notifyServiceId)} / ${shortUuid(active.notifyCharacteristicId)}`
        : '未选择通知特征',
      logs: (snapshot.logs || []).slice(0, 40).map((entry, index) => ({
        id: `${entry.time}-${index}`,
        time: clockTime(Date.parse(entry.time)),
        level: entry.level,
        message: entry.message
      }))
    })
  },

  hydrateLogs() {
    if (this._closing) return
    const logs = ble.getSnapshot().logs || []
    this.setData({
      logs: logs.slice(0, 40).map((entry, index) => ({
        id: `${entry.time}-${index}`,
        time: clockTime(Date.parse(entry.time)),
        level: entry.level,
        message: entry.message
      }))
    })
  },

  setInputMode(event) {
    this.setData({ inputMode: event.currentTarget.dataset.mode })
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value })
  },

  async sendInput() {
    let buffer
    try {
      this.ensureProgramIdle()
      buffer = this.data.inputMode === 'hex'
        ? hexToArrayBuffer(this.data.inputValue)
        : textToArrayBuffer(this.data.inputValue)
      if (!buffer.byteLength) throw new Error('请输入要发送的数据')
      await this.sendBuffer(buffer)
    } catch (error) {
      this.showError(error)
    }
  },

  async sendBuiltInCommand(event) {
    try {
      this.ensureProgramIdle()
      const hex = event.currentTarget.dataset.hex
      await this.sendBuffer(hexToArrayBuffer(hex))
    } catch (error) {
      this.showError(error)
    }
  },

  async sendSavedCommand(event) {
    const index = Number(event.currentTarget.dataset.index)
    const command = this.data.savedCommands[index]
    if (!command) return
    try {
      this.ensureProgramIdle()
      await this.sendBuffer(hexToArrayBuffer(command.hex))
    } catch (error) {
      this.showError(error)
    }
  },

  async sendBuffer(buffer) {
    if (this.data.sending) return
    this.setData({ sending: true, errorText: '' })
    try {
      await ble.write(buffer)
      this.pushPacket('TX', buffer, ble.getSnapshot().active)
      wx.showToast({ title: '已发送', icon: 'success' })
    } finally {
      this.setData({ sending: false })
    }
  },

  ensureProgramIdle() {
    if (this._programRunner && this._programRunner.isRunning()) {
      throw new Error('频率运行中，请先点“立即停止”')
    }
  },

  async sendProgramHex(hex) {
    const buffer = hexToArrayBuffer(hex)
    await ble.write(buffer)
    this.pushPacket('TX', buffer, ble.getSnapshot().active)
  },

  onProgramState(state) {
    if (this._closing) return
    const statusText = {
      running: `正在运行${state.label ? `：${state.label}` : ''}`,
      stopping: '正在发送停止指令',
      completed: '频率已完成并停止',
      stopped: '已停止',
      cancelled: '连接已结束，模式已取消',
      error: '模式执行出错'
    }[state.status] || '准备就绪'
    const elapsedMs = state.status === 'completed' ? state.durationMs : state.elapsedMs
    const progress = state.durationMs
      ? Math.min(100, Math.round((elapsedMs / state.durationMs) * 100))
      : 0
    this.setData({
      runningProgramId: state.status === 'running' || state.status === 'stopping'
        ? state.programId
        : '',
      programRunning: state.status === 'running',
      programStopping: state.status === 'stopping',
      programProgress: progress,
      programStatusText: statusText,
      programElapsedText: state.durationMs
        ? `${durationText(elapsedMs)} / ${durationText(state.durationMs)}`
        : '0:00',
      programFrameText: `${state.sentFrames} / ${state.totalFrames} 帧`
    })
  },

  async startProgram(event) {
    try {
      if (!this.data.connected) throw new Error('请先连接设备')
      const id = event.currentTarget.dataset.id
      const program = this._debugPrograms.find((item) => item.id === id)
      if (!program) throw new Error('没有找到所选模式')
      this.setData({ errorText: '', programProgress: 0 })
      const result = await this._programRunner.start(program)
      if (result.status === 'completed') {
        wx.showToast({ title: '频率已完成', icon: 'success' })
      }
    } catch (error) {
      this.showError(error)
    }
  },

  async stopProgram() {
    try {
      if (!this.data.connected) throw new Error('设备已经断开')
      if (!this._profile || !this._profile.control || !this._profile.control.stopHex) {
        throw new Error('当前设备模块没有配置停止指令')
      }
      await this._programRunner.stop(this._profile.control.stopHex)
      wx.showToast({ title: '已停止', icon: 'success' })
    } catch (error) {
      this.showError(error)
    }
  },

  pushPacket(direction, buffer, metadata) {
    if (this._closing) return
    const packet = {
      id: `${Date.now()}-${Math.random()}`,
      direction,
      time: clockTime(Date.now()),
      hex: arrayBufferToHex(buffer),
      text: readableText(arrayBufferToText(buffer)),
      characteristic: shortUuid(metadata && (metadata.characteristicId || metadata.writeCharacteristicId))
    }
    this.setData({ packets: [packet].concat(this.data.packets).slice(0, 80) })
  },

  async chooseWriteCharacteristic(event) {
    try {
      this.ensureProgramIdle()
      ble.setWriteTarget(
        event.currentTarget.dataset.service,
        event.currentTarget.dataset.characteristic
      )
      this.hydrate()
      wx.showToast({ title: '已设为写入通道', icon: 'none' })
    } catch (error) {
      this.showError(error)
    }
  },

  async enableNotification(event) {
    try {
      await ble.subscribe(
        event.currentTarget.dataset.service,
        event.currentTarget.dataset.characteristic,
        true
      )
      this.hydrate()
      wx.showToast({ title: '通知已开启', icon: 'success' })
    } catch (error) {
      this.showError(error)
    }
  },

  async readCharacteristic(event) {
    try {
      await ble.read(
        event.currentTarget.dataset.service,
        event.currentTarget.dataset.characteristic
      )
      wx.showToast({ title: '读取请求已发送', icon: 'none' })
    } catch (error) {
      this.showError(error)
    }
  },

  async refreshGatt() {
    try {
      this.ensureProgramIdle()
    } catch (error) {
      this.showError(error)
      return
    }
    this.setData({ busy: true })
    try {
      await ble.discoverGatt()
      this.hydrate()
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ busy: false })
    }
  },

  toggleGatt() {
    this.setData({ gattExpanded: !this.data.gattExpanded })
  },

  onCommandNameInput(event) {
    this.setData({ newCommandName: event.detail.value })
  },

  onCommandHexInput(event) {
    this.setData({ newCommandHex: event.detail.value })
  },

  addSavedCommand() {
    try {
      const name = String(this.data.newCommandName || '').trim()
      if (!name) throw new Error('请填写命令名称')
      const hex = validateHex(this.data.newCommandHex).match(/.{2}/g).join(' ')
      const savedCommands = this.data.savedCommands.concat({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        hex
      })
      wx.setStorageSync(this._savedCommandsKey, savedCommands)
      this.setData({ savedCommands, newCommandName: '', newCommandHex: '' })
      wx.showToast({ title: '命令已保存', icon: 'success' })
    } catch (error) {
      this.showError(error)
    }
  },

  deleteSavedCommand(event) {
    const index = Number(event.currentTarget.dataset.index)
    const savedCommands = this.data.savedCommands.filter((item, itemIndex) => itemIndex !== index)
    wx.setStorageSync(this._savedCommandsKey, savedCommands)
    this.setData({ savedCommands })
  },

  loadSavedCommands() {
    try {
      const value = wx.getStorageSync(this._savedCommandsKey)
      const savedCommands = Array.isArray(value)
        ? value.map((command, index) => Object.assign({ id: `legacy-${index}` }, command))
        : []
      this.setData({ savedCommands })
    } catch (error) {
      this.setData({ savedCommands: [] })
    }
  },

  copyDeviceProfile() {
    const content = JSON.stringify(ble.exportDeviceProfile(), null, 2)
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '设备画像已复制', icon: 'success' })
    })
  },

  copySessionLog() {
    const content = JSON.stringify({
      deviceProfile: ble.exportDeviceProfile(),
      packets: this.data.packets,
      logs: ble.getSnapshot().logs
    }, null, 2)
    wx.setClipboardData({
      data: content,
      success: () => wx.showToast({ title: '会话记录已复制', icon: 'success' })
    })
  },

  clearPackets() {
    this.setData({ packets: [] })
  },

  async disconnectAndBack() {
    this.setData({ busy: true })
    try {
      if (this._programRunner && this._programRunner.isRunning() && this.data.connected) {
        if (this._profile && this._profile.control && this._profile.control.stopHex) {
          await this._programRunner.stop(this._profile.control.stopHex)
        } else {
          this._programRunner.cancel()
        }
      }
      await session.disconnect()
      wx.navigateBack()
    } finally {
      this.setData({ busy: false })
    }
  },

  showError(error) {
    const message = error && error.message ? error.message : String(error || '操作失败')
    this.setData({ errorText: message })
    wx.showToast({ title: message, icon: 'none', duration: 2500 })
  }
})
