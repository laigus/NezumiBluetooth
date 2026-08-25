const ble = require('../../core/bluetooth')
const session = require('../../core/device-session')
const frequencyRuntime = require('../../utils/frequency-runtime')
const { compatibleConnection } = require('../../utils/frequency-runtime')
const { durationText, runtimeProgress } = require('../../utils/frequency-view')
const { readFileText, chooseFrequencyFile } = require('../../utils/frequency-file')

function deviceName(device, definition) {
  return (device && (device.name || device.localName)) ||
    (definition && definition.displayName) || '蓝牙设备'
}

function activeStatus(state, frequencyId) {
  if (state.programId !== frequencyId) return ''
  const labels = {
    running: `正在运行 · ${state.sentFrames} / ${state.totalFrames} 帧`,
    stopping: '正在停止',
    completed: '已完成',
    stopped: '已停止',
    cancelled: '运行已结束',
    error: '运行出错'
  }
  return labels[state.status] || ''
}

Page({
  data: {
    connected: false,
    deviceName: '蓝牙设备',
    protocolText: '',
    connectionText: '设备已断开',
    rssiText: '',
    mtuText: 'MTU 23',
    frequencies: [],
    importing: false,
    disconnecting: false,
    runtimeStatus: 'idle',
    runningId: '',
    errorText: ''
  },

  onLoad() {
    this._visible = false
  },

  onShow() {
    this._visible = true
    frequencyRuntime.list()
    this.bindEvents()
    this.refreshConnection()
    this.refreshFrequencies()
  },

  onHide() {
    this._visible = false
    this.unbindEvents()
  },

  onUnload() {
    this.onHide()
  },

  bindEvents() {
    this.unbindEvents()
    this._unsubscribe = [
      ble.on('connection', () => this.refreshConnection()),
      ble.on('gatt', () => this.refreshConnection()),
      frequencyRuntime.on(() => this.refreshFrequencies())
    ]
  },

  unbindEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  refreshConnection() {
    const snapshot = ble.getSnapshot()
    const device = snapshot.connectedDevice || {}
    const definition = session.getActiveDefinition()
    const connected = compatibleConnection(snapshot)
    const name = deviceName(device, definition)
    this.setData({
      connected,
      deviceName: name,
      protocolText: definition && definition.card ? definition.card.protocolText : '',
      connectionText: connected ? '专用控制通道已就绪' : '设备连接已断开',
      rssiText: typeof device.RSSI === 'number' ? `${device.RSSI} dBm` : '',
      mtuText: `MTU ${snapshot.mtu || 23}`
    })
    wx.setNavigationBarTitle({ title: name })
    this.refreshFrequencies()
  },

  refreshFrequencies() {
    const state = frequencyRuntime.getSnapshot()
    const runtimeActive = state.status === 'running' || state.status === 'stopping'
    const frequencies = frequencyRuntime.list({ reload: false }).map((item) => {
      const active = state.programId === item.id
      const progress = runtimeProgress(state, item.id)
      return {
        id: item.id,
        name: item.name,
        description: item.description,
        durationText: durationText(item.durationMs),
        frameText: `${item.frames.length} 帧`,
        originText: item.origin === 'built-in' ? '内置' : '本机导入',
        statusText: activeStatus(state, item.id),
        progressVisible: progress.visible,
        progressWidth: progress.width,
        progressTimeText: progress.timeText,
        progressPercentText: progress.percentText,
        active,
        startDisabled: !this.data.connected || runtimeActive,
        stopDisabled: !this.data.connected || !active || !runtimeActive
      }
    })
    this.setData({
      frequencies,
      runtimeStatus: state.status,
      runningId: runtimeActive ? state.programId : ''
    })
  },

  async importFrequency() {
    if (this.data.importing) return
    this.setData({ importing: true, errorText: '' })
    try {
      const file = await chooseFrequencyFile()
      if (!file) return
      const imported = frequencyRuntime.importJson(await readFileText(file.path))
      this.refreshFrequencies()
      wx.showToast({ title: `已导入：${imported.name}`, icon: 'success', duration: 2200 })
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ importing: false })
    }
  },

  openFrequency(event) {
    const id = event.currentTarget.dataset.id
    if (!frequencyRuntime.get(id)) return
    const definition = session.getActiveDefinition()
    const page = definition && definition.pages && definition.pages.frequency
    if (!page) {
      this.showError(new Error('设备模块没有配置频率详情页面'))
      return
    }
    wx.navigateTo({ url: `${page}?id=${encodeURIComponent(id)}` })
  },

  async startFrequency(event) {
    const id = event.currentTarget.dataset.id
    if (!id || frequencyRuntime.isRunning()) return
    this.setData({ errorText: '' })
    try {
      const result = await frequencyRuntime.start(id)
      if (result.status === 'completed' && this._visible) {
        wx.showToast({ title: '频率已完成', icon: 'success' })
      }
    } catch (error) {
      this.showError(error)
    }
  },

  async stopFrequency() {
    if (this.data.runtimeStatus === 'stopping') return
    try {
      await frequencyRuntime.stop()
      if (this._visible) wx.showToast({ title: '已停止', icon: 'success' })
    } catch (error) {
      this.showError(error)
    }
  },

  async disconnectDevice() {
    if (this.data.disconnecting) return
    this.setData({ disconnecting: true, errorText: '' })
    try {
      if (frequencyRuntime.isRunning() && compatibleConnection()) await frequencyRuntime.stop()
      session.pauseAutoConnect()
      await session.disconnect()
      wx.showToast({ title: '蓝牙已断开', icon: 'success' })
      wx.switchTab({ url: '/pages/index/index' })
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ disconnecting: false })
    }
  },

  showError(error) {
    const message = error && (error.message || error.errMsg)
      ? (error.message || error.errMsg)
      : String(error || '操作失败')
    this.setData({ errorText: message })
    wx.showToast({ title: message, icon: 'none', duration: 2800 })
  }
})
