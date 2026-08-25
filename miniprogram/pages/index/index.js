const ble = require('../../core/bluetooth')
const session = require('../../core/device-session')
const devices = require('../../devices/index')

function displayName(device, definition) {
  return (device && (device.name || device.localName)) || (definition && definition.displayName) || '蓝牙设备'
}

function deviceCard(snapshot) {
  const device = snapshot.connectedDevice || {}
  const definition = session.getActiveDefinition()
  return {
    deviceId: device.deviceId || '',
    definitionId: definition ? definition.id : '',
    name: displayName(device, definition),
    rssiText: typeof device.RSSI === 'number' ? `${device.RSSI} dBm` : '信号已建立',
    serviceText: definition && definition.card
      ? (definition.card.serviceText || definition.card.protocolText)
      : '设备控制通道',
    mtuText: `MTU ${snapshot.mtu || 23}`,
    compatible: session.isManagedConnection(snapshot)
  }
}

function getFirstSupportedDevice(foundDevices) {
  return devices.getSupportedDevices(foundDevices)[0] || null
}

Page({
  data: {
    connectedDevices: [],
    scanning: false,
    connecting: false,
    statusTitle: '当前没有已连接设备',
    statusDetail: '点“开始扫描”寻找已支持的设备',
    errorText: ''
  },

  onShow() {
    this._visible = true
    this.bindManagerEvents()
    this.restoreConnectionState()
  },

  onHide() {
    this._visible = false
    this.clearAutoConnectTimer()
    this.unbindManagerEvents()
    if (ble.getSnapshot().scanning) ble.stopScan().catch(() => {})
  },

  onUnload() {
    this.onHide()
  },

  async onPullDownRefresh() {
    try {
      await this.stopDeviceScan({ silent: true })
      await this.startDeviceScan()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  bindManagerEvents() {
    this.unbindManagerEvents()
    this._unsubscribe = [
      ble.on('adapter', (state) => {
        if (!this._visible) return
        this.setData({ scanning: Boolean(state.discovering) })
      }),
      ble.on('devices', (foundDevices) => {
        if (!this._visible || this.data.connecting || ble.getSnapshot().connected) return
        const target = getFirstSupportedDevice(foundDevices)
        if (!target) return
        this.setData({
          statusTitle: `发现 ${displayName(target.device, target.definition)}`,
          statusDetail: '正在建立连接并确认控制通道'
        })
        this.scheduleAutoConnect()
      }),
      ble.on('connection', (state) => {
        if (!this._visible) return
        if (state.connected) {
          const snapshot = ble.getSnapshot()
          if (session.isManagedConnection(snapshot)) this.showConnected(snapshot)
        } else {
          this.setData({
            connectedDevices: [],
            connecting: false,
            statusTitle: '设备连接已断开',
            statusDetail: '点“开始扫描”重新寻找设备'
          })
        }
      })
    ]
  },

  unbindManagerEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  restoreConnectionState() {
    const snapshot = ble.getSnapshot()
    if (snapshot.connected) {
      if (session.isManagedConnection(snapshot)) {
        this.showConnected(snapshot)
      } else {
        this.setData({
          connectedDevices: [],
          scanning: false,
          connecting: false,
          statusTitle: '设备正在高级调试中',
          statusDetail: '断开调试连接后再手动开始扫描'
        })
      }
      return
    }
    this.clearAutoConnectTimer()
    if (snapshot.scanning) ble.stopScan().catch(() => {})
    this.setData({
      connectedDevices: [],
      scanning: false,
      connecting: false,
      statusTitle: '当前没有已连接设备',
      statusDetail: '点“开始扫描”寻找已支持的设备'
    })
  },

  async startDeviceScan() {
    if (this._initializing || this.data.connecting || ble.getSnapshot().connected) return

    this._initializing = true
    session.resumeAutoConnect()
    this.setData({
      errorText: '',
      statusTitle: '正在寻找设备',
      statusDetail: '请打开设备，并让它处于可连接状态'
    })
    try {
      await ble.startScan(devices.getScanOptions())
      this.setData({ scanning: true })
      if (getFirstSupportedDevice(ble.getDevices())) this.scheduleAutoConnect()
    } catch (error) {
      this.showError(error)
    } finally {
      this._initializing = false
    }
  },

  async stopDeviceScan(options) {
    this.clearAutoConnectTimer()
    try {
      await ble.stopScan()
    } finally {
      if (!ble.getSnapshot().connected) {
        this.setData({
          scanning: false,
          connecting: false,
          statusTitle: options && options.silent ? this.data.statusTitle : '扫描已停止',
          statusDetail: options && options.silent
            ? this.data.statusDetail
            : '点“开始扫描”可以继续寻找设备'
        })
      }
    }
  },

  async toggleScan() {
    if (this.data.connecting) return
    if (this.data.scanning || ble.getSnapshot().scanning) {
      await this.stopDeviceScan()
      return
    }
    await this.startDeviceScan()
  },

  scheduleAutoConnect() {
    if (this._autoConnectTimer || this.data.connecting || ble.getSnapshot().connected) return
    this._autoConnectTimer = setTimeout(() => {
      this._autoConnectTimer = null
      const target = getFirstSupportedDevice(ble.getDevices())
      if (target) this.connectTarget(target)
    }, 650)
  },

  clearAutoConnectTimer() {
    if (this._autoConnectTimer) clearTimeout(this._autoConnectTimer)
    this._autoConnectTimer = null
  },

  async connectTarget(target) {
    if (!this._visible || this.data.connecting || ble.getSnapshot().connected) return
    const device = target.device
    const definition = target.definition
    this.setData({
      connecting: true,
      statusTitle: `正在连接 ${displayName(device, definition)}`,
      statusDetail: '正在发现服务与特征',
      errorText: ''
    })
    try {
      const snapshot = await session.connectManaged(device, definition)
      session.resumeAutoConnect()
      this.showConnected(snapshot)
    } catch (error) {
      this.setData({ connecting: false, connectedDevices: [] })
      this.showError(error)
    }
  },

  showConnected(snapshot) {
    const card = deviceCard(snapshot)
    this.setData({
      connectedDevices: [card],
      scanning: false,
      connecting: false,
      statusTitle: '已连接 1 台设备',
      statusDetail: '点击设备进入设备控制',
      errorText: ''
    })
  },

  openDevice(event) {
    const deviceId = event.currentTarget.dataset.id
    const item = this.data.connectedDevices.find((device) => device.deviceId === deviceId)
    if (!item) return
    if (!item.compatible) {
      this.showError(new Error('当前设备需要先在高级调试中配置控制通道'))
      return
    }
    const definition = devices.getDeviceDefinition(item.definitionId)
    if (!definition || !definition.pages || !definition.pages.control) {
      this.showError(new Error('设备模块没有配置控制页面'))
      return
    }
    wx.navigateTo({ url: definition.pages.control })
  },

  showError(error) {
    const message = error && (error.message || error.errMsg)
      ? (error.message || error.errMsg)
      : String(error || '蓝牙操作失败')
    this.setData({
      errorText: message,
      statusTitle: '连接遇到问题',
      statusDetail: message
    })
    wx.showToast({ title: message, icon: 'none', duration: 2600 })
  }
})
