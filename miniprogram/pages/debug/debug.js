const ble = require('../../core/bluetooth')
const session = require('../../core/device-session')
const devices = require('../../devices/index')
const { arrayBufferToHex } = require('../../utils/codec')

function displayName(device) {
  return device.name || device.localName || '未命名 BLE 设备'
}

function signalLevel(rssi) {
  const value = Number(rssi || -100)
  if (value >= -55) return 4
  if (value >= -67) return 3
  if (value >= -78) return 2
  return 1
}

function formatDevice(device) {
  return {
    deviceId: device.deviceId,
    name: displayName(device),
    hasName: Boolean(device.name || device.localName),
    RSSI: typeof device.RSSI === 'number' ? device.RSSI : '--',
    signalLevel: signalLevel(device.RSSI),
    connectable: device.connectable !== false,
    serviceSummary: (device.advertisServiceUUIDs || []).join(', '),
    advertisDataHex: arrayBufferToHex(device.advertisData),
    lastSeenAt: device.lastSeenAt || Date.now()
  }
}

Page({
  data: {
    adapterReady: false,
    scanning: false,
    devices: [],
    visibleDevices: [],
    onlyNamed: false,
    connectingId: '',
    statusText: '正在初始化蓝牙…',
    errorText: ''
  },

  onLoad() {
    this._hasScanned = false
  },

  onShow() {
    this.bindManagerEvents()
    this.initialize()
  },

  onHide() {
    this.setData({
      scanning: false,
      statusText: this.data.adapterReady ? '扫描已停止，点击开始扫描' : '请开启手机蓝牙'
    })
    this.unbindManagerEvents()
    if (ble.getSnapshot().scanning) ble.stopScan().catch(() => {})
  },

  onUnload() {
    this.onHide()
  },

  bindManagerEvents() {
    this.unbindManagerEvents()
    this._unsubscribe = [
      ble.on('adapter', (state) => {
        const scanning = Boolean(state.discovering)
        this.setData({
          adapterReady: Boolean(state.available),
          scanning,
          statusText: state.available
            ? (scanning
                ? '正在扫描附近设备'
                : (this._hasScanned ? '扫描已停止，点击开始扫描' : '蓝牙已就绪，点击开始扫描'))
            : '请开启手机蓝牙'
        })
      }),
      ble.on('devices', (devices) => this.updateDevices(devices))
    ]
  },

  unbindManagerEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  async initialize() {
    this.setData({ errorText: '', statusText: '正在初始化蓝牙…' })
    try {
      await ble.openAdapter()
      if (ble.getSnapshot().scanning) await ble.stopScan()
      this.setData({
        adapterReady: true,
        scanning: false,
        statusText: this._hasScanned ? '扫描已停止，点击开始扫描' : '蓝牙已就绪，点击开始扫描'
      })
    } catch (error) {
      this.showError(error)
    }
  },

  updateDevices(devices) {
    const formatted = (devices || []).map(formatDevice)
    const visibleDevices = this.data.onlyNamed
      ? formatted.filter((device) => device.hasName)
      : formatted
    this.setData({ devices: formatted, visibleDevices })
  },

  onOnlyNamedChange(event) {
    const onlyNamed = Boolean(event.detail.value)
    this.setData({ onlyNamed })
    this.updateDevices(ble.getDevices({ allDevices: true }))
  },

  async toggleScan() {
    this.setData({ errorText: '' })
    try {
      if (this.data.scanning) {
        await ble.stopScan()
      } else {
        this._hasScanned = true
        this.setData({
          devices: [],
          visibleDevices: [],
          statusText: '正在启动扫描…'
        })
        await ble.startScan({ allDevices: true })
      }
    } catch (error) {
      this.showError(error)
    }
  },

  async connectDevice(event) {
    const deviceId = event.currentTarget.dataset.id
    const target = ble.getDevices({ allDevices: true }).find((device) => device.deviceId === deviceId)
    if (!target || this.data.connectingId) return

    this.setData({ connectingId: deviceId, errorText: '' })
    wx.showLoading({ title: '连接并发现服务', mask: true })
    try {
      const definition = devices.matchDevice(target)
      await session.connectDebug(target, definition)
      wx.hideLoading()
      wx.navigateTo({
        url: `/pages/device/device?deviceId=${encodeURIComponent(deviceId)}` +
          `&name=${encodeURIComponent(displayName(target))}` +
          `&definitionId=${encodeURIComponent(definition ? definition.id : '')}`
      })
    } catch (error) {
      wx.hideLoading()
      this.showError(error)
    } finally {
      this.setData({ connectingId: '' })
    }
  },

  showError(error) {
    const message = error && error.message ? error.message : String(error || '蓝牙操作失败')
    this.setData({ errorText: message, statusText: message })
    wx.showToast({ title: message, icon: 'none', duration: 2500 })
  }
})
