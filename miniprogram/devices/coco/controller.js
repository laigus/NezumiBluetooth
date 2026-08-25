const { hexToArrayBuffer } = require('../../utils/codec')
const manualProtocol = require('./manual-protocol')

function normalizeUuid(uuid) {
  return String(uuid || '').replace(/-/g, '').toUpperCase()
}

class CocoController {
  constructor(options) {
    const config = options || {}
    this.ble = config.ble
    this.profile = config.profile
    this.stopHex = this.profile.control.stopHex
    this.manualControlActive = false
    this.manualChannelState = Object.create(null)
    this.manualValues = null
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

  getManualConfig() {
    return manualProtocol.config
  }

  beginManualControl() {
    if (this.manualControlActive) throw new Error('手动模式已经在运行')
    this.manualControlActive = true
    this.manualChannelState = Object.create(null)
    this.manualValues = null
  }

  endManualControl() {
    this.manualControlActive = false
    this.manualChannelState = Object.create(null)
    this.manualValues = null
  }

  isManualControlActive() {
    return this.manualControlActive
  }

  buildManualFrames(values) {
    return manualProtocol.buildFrames(values)
  }

  async sendManualState(values, options) {
    const normalized = manualProtocol.normalizeValues(values)
    const frames = this.buildManualFrames(normalized)
    const force = Boolean(options && options.force)
    const channels = ['frequency', 'suction']
    const hasZero = channels.some((channel) => normalized[channel] === 0)
    const zeroTransition = channels.some(
      (channel) => normalized[channel] === 0 &&
        (!this.manualValues || this.manualValues[channel] !== 0)
    )
    const resetForZero = hasZero && (force || zeroTransition)
    const selected = resetForZero
      ? [{ channel: 'stop', value: 0, hex: this.stopHex }].concat(frames)
      : (force
          ? frames
          : frames.filter((frame) => this.manualChannelState[frame.channel] !== frame.hex))
    const repeatCount = force ? manualProtocol.config.finalRepeatCount : 1
    const sent = []
    for (let pass = 0; pass < repeatCount; pass += 1) {
      for (const frame of selected) {
        await this.sendFrequencyFrame(frame.hex)
        if (frame.channel === 'stop') {
          this.manualChannelState = Object.create(null)
        } else {
          this.manualChannelState[frame.channel] = frame.hex
        }
        sent.push(frame)
      }
      if (pass + 1 < repeatCount) {
        await new Promise((resolve) => setTimeout(resolve, manualProtocol.config.finalRepeatDelayMs))
      }
    }
    this.manualValues = normalized
    return sent
  }

  async emergencyStop() {
    this.manualChannelState = Object.create(null)
    this.manualValues = null
    return this.sendFrequencyFrame(this.stopHex)
  }

  async dispose() {
    this.manualControlActive = false
    this.manualChannelState = Object.create(null)
    this.manualValues = null
  }
}

module.exports = CocoController
