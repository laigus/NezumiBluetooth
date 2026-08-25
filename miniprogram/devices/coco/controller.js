const { hexToArrayBuffer } = require('../../utils/codec')

function normalizeUuid(uuid) {
  return String(uuid || '').replace(/-/g, '').toUpperCase()
}

class CocoController {
  constructor(options) {
    const config = options || {}
    this.ble = config.ble
    this.profile = config.profile
    this.stopHex = this.profile.control.stopHex
  }

  isCompatible(snapshot) {
    const state = snapshot || this.ble.getSnapshot()
    const active = state.active || {}
    return Boolean(
      state.connected &&
      state.profileId === this.profile.id &&
      normalizeUuid(active.writeServiceId) === normalizeUuid(this.profile.gatt.writeServiceUUID) &&
      normalizeUuid(active.writeCharacteristicId) === normalizeUuid(this.profile.gatt.writeCharacteristicUUID)
    )
  }

  async initialize(snapshot) {
    if (!this.isCompatible(snapshot)) throw new Error('设备缺少已配置的写入通道')
  }

  async sendFrequencyFrame(hex) {
    return this.ble.write(hexToArrayBuffer(hex))
  }

  async emergencyStop() {
    return this.sendFrequencyFrame(this.stopHex)
  }

  async dispose() {}
}

module.exports = CocoController
