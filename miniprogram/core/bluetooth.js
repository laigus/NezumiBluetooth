const {
  arrayBufferToHex,
  arrayBufferToText,
  sliceBuffer
} = require('../utils/codec')

const ERROR_MESSAGES = {
  10000: '蓝牙适配器尚未初始化',
  10001: '当前设备蓝牙未开启',
  10002: '没有找到指定蓝牙设备',
  10003: '蓝牙连接失败',
  10004: '没有找到指定服务',
  10005: '没有找到指定特征',
  10006: '当前连接已断开',
  10007: '当前特征不支持此操作',
  10008: '系统报告异常',
  10009: '系统版本不支持 BLE',
  10012: '连接超时',
  10013: '设备标识无效'
}

function emptyTransportTarget() {
  return {
    writeServiceId: '',
    writeCharacteristicId: '',
    notifyServiceId: '',
    notifyCharacteristicId: '',
    readServiceId: '',
    readCharacteristicId: ''
  }
}

function normalizeConnectionConfig(options) {
  const config = options || {}
  const profile = config.profile || null
  return {
    profileId: String(config.profileId || (profile && profile.id) || ''),
    gatt: Object.assign({}, (profile && profile.gatt) || {}, config.gatt || {}),
    transport: Object.assign({
      requestedMtu: 23,
      chunkSize: 20,
      interChunkDelayMs: 0,
      writeType: 'auto'
    }, (profile && profile.transport) || {}, config.transport || {})
  }
}

function invoke(apiName, options) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx[apiName] !== 'function') {
      reject(new Error(`当前环境缺少 wx.${apiName}`))
      return
    }
    wx[apiName](Object.assign({}, options || {}, {
      success: resolve,
      fail: reject
    }))
  })
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeUuid(uuid) {
  return String(uuid || '').replace(/-/g, '').toUpperCase()
}

function shortUuid(uuid) {
  const value = String(uuid || '').toUpperCase()
  const match = value.match(/^0000([0-9A-F]{4})-0000-1000-8000-00805F9B34FB$/)
  return match ? `0x${match[1]}` : value
}

function friendlyError(error) {
  const raw = error || {}
  const code = Number(raw.errCode)
  const message = ERROR_MESSAGES[code] || raw.errMsg || raw.message || '未知蓝牙错误'
  const result = new Error(message)
  result.code = Number.isNaN(code) ? undefined : code
  result.raw = raw
  return result
}

function adapterAlreadyOpened(error) {
  const raw = error || {}
  const message = String(raw.errMsg || raw.message || '')
  return /already\s+open(?:ed)?|已经打开|已打开/i.test(message)
}

function characteristicCapabilities(characteristic) {
  const properties = characteristic.properties || {}
  const labels = []
  if (properties.read) labels.push('读')
  if (properties.write) labels.push('写')
  if (properties.writeNoResponse) labels.push('无响应写')
  if (properties.notify) labels.push('通知')
  if (properties.indicate) labels.push('指示')
  return labels
}

class BleManager {
  constructor() {
    this.adapterOpened = false
    this.adapterAvailable = false
    this.scanning = false
    this.scanAllDevices = false
    this.connected = false
    this.connectedDevice = null
    this.services = []
    this.active = emptyTransportTarget()
    this.connectionProfileId = ''
    this.connectionConfig = normalizeConnectionConfig()
    this.negotiatedMtu = 23
    this._deviceMap = Object.create(null)
    this._listeners = Object.create(null)
    this._platformListenersBound = false
    this._logs = []
  }

  on(eventName, listener) {
    if (!this._listeners[eventName]) this._listeners[eventName] = []
    this._listeners[eventName].push(listener)
    return () => {
      const listeners = this._listeners[eventName] || []
      this._listeners[eventName] = listeners.filter((item) => item !== listener)
    }
  }

  _emit(eventName, payload) {
    const listeners = this._listeners[eventName] || []
    listeners.slice().forEach((listener) => {
      try {
        listener(payload)
      } catch (error) {
        console.error(`[BLE event:${eventName}]`, error)
      }
    })
  }

  _log(level, message, details) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      details: details || null
    }
    this._logs.unshift(entry)
    this._logs = this._logs.slice(0, 200)
    this._emit('log', entry)
  }

  _bindPlatformListeners() {
    if (this._platformListenersBound || typeof wx === 'undefined') return
    this._platformListenersBound = true

    wx.onBluetoothAdapterStateChange((state) => {
      this.adapterAvailable = Boolean(state.available)
      this.scanning = Boolean(state.discovering)
      this._emit('adapter', {
        available: this.adapterAvailable,
        discovering: this.scanning
      })
    })

    wx.onBluetoothDeviceFound((result) => {
      const devices = result.devices || []
      devices.forEach((device) => {
        const previous = this._deviceMap[device.deviceId] || {}
        this._deviceMap[device.deviceId] = Object.assign({}, previous, device, {
          lastSeenAt: Date.now()
        })
      })
      this._emit('devices', this.getDevices({ allDevices: this.scanAllDevices }))
    })

    wx.onBLEConnectionStateChange((state) => {
      if (!this.connectedDevice || state.deviceId !== this.connectedDevice.deviceId) return
      this.connected = Boolean(state.connected)
      if (!this.connected) {
        this._log('warn', '设备连接已断开', { deviceId: state.deviceId })
      }
      this._emit('connection', {
        connected: this.connected,
        deviceId: state.deviceId
      })
    })

    wx.onBLECharacteristicValueChange((event) => {
      const packet = {
        deviceId: event.deviceId,
        serviceId: event.serviceId,
        characteristicId: event.characteristicId,
        value: event.value,
        hex: arrayBufferToHex(event.value),
        text: arrayBufferToText(event.value),
        timestamp: Date.now()
      }
      this._log('rx', `收到 ${packet.hex || '(空数据)'}`, {
        serviceId: event.serviceId,
        characteristicId: event.characteristicId
      })
      this._emit('value', packet)
    })
  }

  async openAdapter() {
    this._bindPlatformListeners()
    if (!this.adapterOpened) {
      try {
        await invoke('openBluetoothAdapter')
        this.adapterOpened = true
      } catch (error) {
        if (adapterAlreadyOpened(error)) {
          this.adapterOpened = true
        } else {
          throw friendlyError(error)
        }
      }
    }

    try {
      const state = await invoke('getBluetoothAdapterState')
      this.adapterAvailable = Boolean(state.available)
      this.scanning = Boolean(state.discovering)
      this._emit('adapter', state)
      if (!this.adapterAvailable) throw friendlyError({ errCode: 10001 })
      this._log('info', '蓝牙适配器已就绪')
      return state
    } catch (error) {
      throw friendlyError(error)
    }
  }

  async startScan(scanOptions) {
    const allDevices = Boolean(scanOptions && scanOptions.allDevices)
    const services = scanOptions && Array.isArray(scanOptions.services)
      ? scanOptions.services.filter(Boolean)
      : []
    await this.openAdapter()
    if (this.scanning && this.scanAllDevices === allDevices) {
      return this.getDevices({ allDevices })
    }
    if (this.scanning) await this.stopScan()

    this._deviceMap = Object.create(null)
    this.scanAllDevices = allDevices
    const discoveryOptions = {
      allowDuplicatesKey: true,
      powerLevel: 'high'
    }
    if (!allDevices && services.length) {
      discoveryOptions.services = services
    }

    try {
      await invoke('startBluetoothDevicesDiscovery', discoveryOptions)
      this.scanning = true
      this._log('info', allDevices ? '开始扫描全部附近 BLE 设备' : '开始扫描专用 BLE 设备')
      this._emit('adapter', { available: true, discovering: true })
      return []
    } catch (error) {
      throw friendlyError(error)
    }
  }

  async stopScan() {
    if (!this.scanning) return
    try {
      await invoke('stopBluetoothDevicesDiscovery')
    } catch (error) {
      this._log('warn', '停止扫描时系统返回异常', error)
    } finally {
      this.scanning = false
      this._emit('adapter', { available: this.adapterAvailable, discovering: false })
    }
  }

  getDevices(options) {
    return Object.keys(this._deviceMap)
      .map((key) => this._deviceMap[key])
      .sort((left, right) => Number(right.RSSI || -999) - Number(left.RSSI || -999))
  }

  async connect(device, connectionOptions) {
    const target = typeof device === 'string'
      ? (this._deviceMap[device] || { deviceId: device })
      : device
    if (!target || !target.deviceId) throw new Error('缺少设备标识')

    const nextConfig = normalizeConnectionConfig(connectionOptions)

    await this.openAdapter()
    await this.stopScan()

    if (this.connected && this.connectedDevice && this.connectedDevice.deviceId === target.deviceId) {
      this.connectionProfileId = nextConfig.profileId
      this.connectionConfig = nextConfig
      if (!this.services.length) await this.discoverGatt()
      else this._selectDefaultTransport()
      return this.getSnapshot()
    }

    if (this.connectedDevice && this.connectedDevice.deviceId !== target.deviceId) {
      await this.disconnect()
    }

    this.connectionProfileId = nextConfig.profileId
    this.connectionConfig = nextConfig

    try {
      this._log('info', '正在连接设备', { deviceId: target.deviceId })
      await invoke('createBLEConnection', {
        deviceId: target.deviceId,
        timeout: 15000
      })
      this.connected = true
      this.connectedDevice = target
      this.services = []
      this._emit('connection', { connected: true, deviceId: target.deviceId })

      await this._negotiateMtu()
      await this.discoverGatt()

      if (this.active.notifyCharacteristicId) {
        try {
          await this.subscribe(
            this.active.notifyServiceId,
            this.active.notifyCharacteristicId,
            true
          )
        } catch (error) {
          this._log('warn', '自动开启通知失败，可在特征列表中手动重试', { message: error.message })
        }
      }

      this._log('info', '设备连接与 GATT 发现完成', {
        serviceCount: this.services.length,
        active: this.active
      })
      return this.getSnapshot()
    } catch (error) {
      this.connected = false
      this.connectionProfileId = ''
      this.connectionConfig = normalizeConnectionConfig()
      throw friendlyError(error)
    }
  }

  async _negotiateMtu() {
    const requested = Number(this.connectionConfig.transport.requestedMtu || 23)
    this.negotiatedMtu = 23
    if (requested <= 23 || typeof wx.setBLEMTU !== 'function') return

    try {
      const result = await invoke('setBLEMTU', {
        deviceId: this.connectedDevice.deviceId,
        mtu: requested
      })
      this.negotiatedMtu = Number(result.mtu || requested)
      this._log('info', `协商 MTU=${this.negotiatedMtu}`)
    } catch (error) {
      this._log('info', '设备沿用默认 MTU=23')
    }
  }

  async discoverGatt() {
    if (!this.connectedDevice) throw new Error('尚未连接设备')
    let serviceResult
    try {
      serviceResult = await invoke('getBLEDeviceServices', {
        deviceId: this.connectedDevice.deviceId
      })
    } catch (error) {
      throw friendlyError(error)
    }

    const discovered = []
    const rawServices = serviceResult.services || []
    for (let i = 0; i < rawServices.length; i += 1) {
      const service = rawServices[i]
      try {
        const result = await invoke('getBLEDeviceCharacteristics', {
          deviceId: this.connectedDevice.deviceId,
          serviceId: service.uuid
        })
        discovered.push({
          uuid: service.uuid,
          isPrimary: Boolean(service.isPrimary),
          characteristics: (result.characteristics || []).map((characteristic) => ({
            uuid: characteristic.uuid,
            properties: Object.assign({}, characteristic.properties || {}),
            capabilities: characteristicCapabilities(characteristic)
          }))
        })
      } catch (error) {
        discovered.push({
          uuid: service.uuid,
          isPrimary: Boolean(service.isPrimary),
          characteristics: [],
          discoveryError: friendlyError(error).message
        })
      }
    }

    this.services = discovered
    this._selectDefaultTransport()
    this._emit('gatt', this.services)
    return this.services
  }

  _selectDefaultTransport() {
    if (!this.services.length) {
      this.active = emptyTransportTarget()
      return
    }

    const findService = (configuredUuid, predicate) => {
      const normalized = normalizeUuid(configuredUuid)
      const exact = this.services.find((item) => normalizeUuid(item.uuid) === normalized)
      if (exact) return exact
      return this.services
        .filter((item) => item.characteristics.some((characteristic) => predicate(characteristic.properties || {})))
        .sort((left, right) => this._serviceScore(right) - this._serviceScore(left))[0]
    }

    const findPreferred = (service, configuredUuid, predicate) => {
      if (!service) return null
      const normalized = normalizeUuid(configuredUuid)
      const exact = service.characteristics.find((item) => normalizeUuid(item.uuid) === normalized)
      if (exact && predicate(exact.properties || {})) return exact
      return service.characteristics.find((item) => predicate(item.properties || {}))
    }

    const canWrite = (properties) => properties.write || properties.writeNoResponse
    const canNotify = (properties) => properties.notify || properties.indicate
    const canRead = (properties) => properties.read
    const gatt = this.connectionConfig.gatt
    const writeService = findService(gatt.writeServiceUUID, canWrite)
    const notifyService = findService(gatt.notifyServiceUUID, canNotify)
    const readService = findService(gatt.readServiceUUID, canRead)

    const write = findPreferred(
      writeService,
      gatt.writeCharacteristicUUID,
      canWrite
    )
    const notify = findPreferred(
      notifyService,
      gatt.notifyCharacteristicUUID,
      canNotify
    )
    const read = findPreferred(
      readService,
      gatt.readCharacteristicUUID,
      canRead
    )

    this.active = {
      writeServiceId: write ? writeService.uuid : '',
      writeCharacteristicId: write ? write.uuid : '',
      notifyServiceId: notify ? notifyService.uuid : '',
      notifyCharacteristicId: notify ? notify.uuid : '',
      readServiceId: read ? readService.uuid : '',
      readCharacteristicId: read ? read.uuid : ''
    }
  }

  _serviceScore(service) {
    return (service.characteristics || []).reduce((score, characteristic) => {
      const properties = characteristic.properties || {}
      if (properties.write || properties.writeNoResponse) score += 4
      if (properties.notify || properties.indicate) score += 3
      if (properties.read) score += 1
      return score
    }, 0)
  }

  _findCharacteristic(serviceId, characteristicId) {
    const service = this.services.find((item) => item.uuid === serviceId)
    if (!service) return null
    return service.characteristics.find((item) => item.uuid === characteristicId) || null
  }

  setWriteTarget(serviceId, characteristicId) {
    const characteristic = this._findCharacteristic(serviceId, characteristicId)
    const properties = characteristic && characteristic.properties
    if (!properties || (!properties.write && !properties.writeNoResponse)) {
      throw new Error('所选特征不支持写入')
    }
    this.active.writeServiceId = serviceId
    this.active.writeCharacteristicId = characteristicId
    this._emit('transport', Object.assign({}, this.active))
  }

  async subscribe(serviceId, characteristicId, enabled) {
    if (!this.connectedDevice) throw new Error('尚未连接设备')
    const characteristic = this._findCharacteristic(serviceId, characteristicId)
    const properties = characteristic && characteristic.properties
    if (!properties || (!properties.notify && !properties.indicate)) {
      throw new Error('所选特征不支持通知或指示')
    }

    try {
      await invoke('notifyBLECharacteristicValueChange', {
        deviceId: this.connectedDevice.deviceId,
        serviceId,
        characteristicId,
        state: Boolean(enabled)
      })
      if (enabled) {
        this.active.notifyServiceId = serviceId
        this.active.notifyCharacteristicId = characteristicId
      }
      this._log('info', enabled ? '已开启特征通知' : '已关闭特征通知', {
        serviceId,
        characteristicId
      })
      this._emit('transport', Object.assign({}, this.active))
    } catch (error) {
      throw friendlyError(error)
    }
  }

  async read(serviceId, characteristicId) {
    if (!this.connectedDevice) throw new Error('尚未连接设备')
    try {
      await invoke('readBLECharacteristicValue', {
        deviceId: this.connectedDevice.deviceId,
        serviceId,
        characteristicId
      })
      this.active.readServiceId = serviceId
      this.active.readCharacteristicId = characteristicId
      this._log('info', '已发起特征读取', { serviceId, characteristicId })
    } catch (error) {
      throw friendlyError(error)
    }
  }

  async write(buffer, writeOptions) {
    if (!this.connectedDevice || !this.connected) throw new Error('设备未连接')
    const serviceId = this.active.writeServiceId
    const characteristicId = this.active.writeCharacteristicId
    if (!serviceId || !characteristicId) throw new Error('尚未选择可写特征')
    return this.writeTo(serviceId, characteristicId, buffer, writeOptions)
  }

  async writeTo(serviceId, characteristicId, buffer, writeOptions) {
    if (!this.connectedDevice || !this.connected) throw new Error('设备未连接')
    if (!serviceId || !characteristicId) throw new Error('缺少写入服务或特征')
    if (!(buffer instanceof ArrayBuffer)) throw new Error('写入数据必须是 ArrayBuffer')

    const characteristic = this._findCharacteristic(serviceId, characteristicId)
    if (!characteristic) throw new Error('写入特征已失效，请重新发现服务')

    const transport = Object.assign({}, this.connectionConfig.transport, writeOptions || {})
    const configuredChunkSize = Number(transport.chunkSize || 20)
    const chunkSize = Math.max(1, Math.min(configuredChunkSize, Math.max(20, this.negotiatedMtu - 3)))
    const delay = Math.max(0, Number(transport.interChunkDelayMs || 0))
    const properties = characteristic.properties || {}
    let writeType = transport.writeType
    if (writeType === 'auto') {
      writeType = properties.write ? 'write' : 'writeNoResponse'
    }

    for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
      const chunk = sliceBuffer(buffer, offset, Math.min(offset + chunkSize, buffer.byteLength))
      const options = {
        deviceId: this.connectedDevice.deviceId,
        serviceId,
        characteristicId,
        value: chunk
      }
      if (writeType) options.writeType = writeType
      try {
        await invoke('writeBLECharacteristicValue', options)
      } catch (error) {
        throw friendlyError(error)
      }
      if (delay && offset + chunkSize < buffer.byteLength) await sleep(delay)
    }

    this._log('tx', `发送 ${arrayBufferToHex(buffer)}`, {
      serviceId,
      characteristicId,
      bytes: buffer.byteLength,
      chunkSize,
      writeType
    })
  }

  async disconnect() {
    if (!this.connectedDevice) return
    const deviceId = this.connectedDevice.deviceId
    try {
      await invoke('closeBLEConnection', { deviceId })
    } catch (error) {
      this._log('warn', '关闭连接时系统返回异常', error)
    } finally {
      this.connected = false
      this.connectedDevice = null
      this.services = []
      this.active = emptyTransportTarget()
      this.connectionProfileId = ''
      this.connectionConfig = normalizeConnectionConfig()
      this._emit('connection', { connected: false, deviceId })
    }
  }

  async closeAdapter() {
    await this.stopScan()
    await this.disconnect()
    if (!this.adapterOpened) return
    try {
      await invoke('closeBluetoothAdapter')
    } finally {
      this.adapterOpened = false
      this.adapterAvailable = false
    }
  }

  getSnapshot() {
    return {
      adapterOpened: this.adapterOpened,
      adapterAvailable: this.adapterAvailable,
      scanning: this.scanning,
      scanAllDevices: this.scanAllDevices,
      connected: this.connected,
      connectedDevice: this.connectedDevice,
      profileId: this.connectionProfileId,
      services: this.services,
      active: Object.assign({}, this.active),
      mtu: this.negotiatedMtu,
      logs: this._logs.slice()
    }
  }

  exportDeviceProfile() {
    const device = this.connectedDevice || {}
    return {
      capturedAt: new Date().toISOString(),
      profileId: this.connectionProfileId,
      device: {
        name: device.name || device.localName || '',
        deviceId: device.deviceId || '',
        RSSI: device.RSSI,
        advertisServiceUUIDs: device.advertisServiceUUIDs || [],
        advertisDataHex: arrayBufferToHex(device.advertisData)
      },
      mtu: this.negotiatedMtu,
      selectedTransport: Object.assign({}, this.active),
      services: this.services.map((service) => ({
        uuid: service.uuid,
        shortUuid: shortUuid(service.uuid),
        isPrimary: service.isPrimary,
        discoveryError: service.discoveryError || '',
        characteristics: service.characteristics.map((characteristic) => ({
          uuid: characteristic.uuid,
          shortUuid: shortUuid(characteristic.uuid),
          capabilities: characteristic.capabilities
        }))
      }))
    }
  }
}

const manager = new BleManager()

manager.BleManager = BleManager
manager.normalizeUuid = normalizeUuid
manager.shortUuid = shortUuid
manager.friendlyError = friendlyError
manager.normalizeConnectionConfig = normalizeConnectionConfig

module.exports = manager
