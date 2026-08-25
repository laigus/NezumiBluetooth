const ble = require('../core/bluetooth')
const deviceSession = require('../core/device-session')
const { FrequencyStore } = require('./frequency-store')
const { makeRunnableFrequency } = require('./frequency-schema')
const { ProgramRunner } = require('./program-runner')

function frequencyContext() {
  const definition = deviceSession.getActiveDefinition()
  const controller = deviceSession.getActiveController()
  if (!definition || !definition.features || !definition.features.frequencies) return null
  if (!controller || typeof controller.sendFrequencyFrame !== 'function') return null
  return {
    definition,
    profile: definition.profile,
    controller
  }
}

function compatibleConnection(snapshot) {
  const context = frequencyContext()
  return Boolean(context && deviceSession.isManagedConnection(snapshot, context.definition.id))
}

function idleState() {
  return {
    status: 'idle',
    deviceProfileId: '',
    programId: '',
    label: '',
    sentFrames: 0,
    totalSentFrames: 0,
    totalFrames: 0,
    elapsedMs: 0,
    durationMs: 0,
    loop: false,
    cycle: 0,
    error: null
  }
}

class FrequencyRuntime {
  constructor() {
    this.store = new FrequencyStore()
    this.listeners = []
    this._progressStartedAt = 0
    this._progressCycle = 0
    this._progressTimer = null
    this.state = idleState()
    this._definitionId = ''
    this.runner = new ProgramRunner({
      send: (hex) => {
        const context = frequencyContext()
        if (!context) throw new Error('当前设备未提供频率控制能力')
        return context.controller.sendFrequencyFrame(hex)
      },
      onState: (state) => this.onRunnerState(state)
    })
    ble.on('connection', (state) => {
      if (!state.connected && this.runner.isRunning()) this.cancel()
    })
    deviceSession.on((state) => this.onDeviceSession(state))
  }

  list(options) {
    const context = frequencyContext()
    if (!context) return []
    const reload = !options || options.reload !== false
    const items = reload ? this.store.reload() : this.store.list()
    return items.filter((item) => item.deviceProfileId === context.profile.id)
  }

  get(id) {
    const context = frequencyContext()
    return context ? this.store.get(id, context.profile.id) : null
  }

  importJson(text) {
    const context = frequencyContext()
    if (!context) throw new Error('当前设备未提供频率导入能力')
    return this.store.importJson(text, context.profile.id)
  }

  saveFrequency(input) {
    const context = frequencyContext()
    if (!context) throw new Error('当前设备未提供频率保存能力')
    const saved = this.store.importFrequency(Object.assign({}, input, {
      deviceProfileId: context.profile.id
    }), context.profile.id)
    this.emit()
    return saved
  }

  renameFrequency(id, name) {
    if (this.runner.isRunning()) throw new Error('请先停止正在运行的频率')
    const context = frequencyContext()
    if (!context) throw new Error('当前设备未提供频率管理能力')
    const renamed = this.store.renameFrequency(id, name, context.profile.id)
    this.emit()
    return renamed
  }

  deleteFrequency(id) {
    if (this.runner.isRunning()) throw new Error('请先停止正在运行的频率')
    const context = frequencyContext()
    if (!context) throw new Error('当前设备未提供频率管理能力')
    const deleted = this.store.deleteFrequency(id, context.profile.id)
    if (this.state.programId === id) this.state = idleState()
    this.emit()
    return deleted
  }

  exportJson(id) {
    const context = frequencyContext()
    if (!context) throw new Error('当前设备未提供频率导出能力')
    return this.store.exportJson(id, context.profile.id)
  }

  getSnapshot() {
    return Object.assign({}, this.state, { error: this.state.error || null })
  }

  on(listener) {
    this.listeners.push(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener)
    }
  }

  emit() {
    const snapshot = this.getSnapshot()
    this.listeners.slice().forEach((listener) => listener(snapshot))
  }

  onDeviceSession(state) {
    if (!state.managed) {
      this._definitionId = ''
      if (this.runner.isRunning()) this.cancel()
      return
    }
    if (state.definitionId === this._definitionId) return
    if (this.runner.isRunning()) this.cancel()
    this._definitionId = state.definitionId
    this.state = idleState()
    this.emit()
  }

  onRunnerState(state) {
    const durationMs = Number(state.durationMs || 0)
    const cycle = Number(state.cycle || 0)
    if (state.status === 'running' && cycle !== this._progressCycle) {
      this._progressCycle = cycle
      this._progressStartedAt = Date.now()
    }
    const clockElapsedMs = this._progressStartedAt
      ? Math.max(0, Date.now() - this._progressStartedAt)
      : 0
    const elapsedMs = durationMs
      ? Math.min(durationMs, Math.max(Number(state.elapsedMs || 0), clockElapsedMs))
      : Number(state.elapsedMs || 0)
    this.state = Object.assign({}, state, {
      status: state.status || 'idle',
      deviceProfileId: this.state.deviceProfileId || this._definitionId,
      programId: state.programId || this.state.programId || '',
      elapsedMs,
      error: state.error || null
    })
    if (!['running', 'stopping'].includes(this.state.status)) this.stopProgressClock()
    this.emit()
  }

  startProgressClock() {
    this.stopProgressClock()
    this._progressCycle = 0
    this._progressStartedAt = Date.now()
    this._progressTimer = setInterval(() => {
      if (!['running', 'stopping'].includes(this.state.status)) return
      const durationMs = Number(this.state.durationMs || 0)
      if (!durationMs) return
      const elapsedMs = Math.min(
        durationMs,
        Math.max(Number(this.state.elapsedMs || 0), Math.max(0, Date.now() - this._progressStartedAt))
      )
      if (elapsedMs === this.state.elapsedMs) return
      this.state = Object.assign({}, this.state, { elapsedMs })
      this.emit()
    }, 250)
  }

  stopProgressClock() {
    if (this._progressTimer !== null) clearInterval(this._progressTimer)
    this._progressTimer = null
    this._progressStartedAt = 0
    this._progressCycle = 0
  }

  isRunning() {
    return this.runner.isRunning()
  }

  async start(id, options) {
    if (!compatibleConnection()) throw new Error('设备连接已断开')
    const context = frequencyContext()
    if (typeof context.controller.isManualControlActive === 'function' &&
        context.controller.isManualControlActive()) {
      throw new Error('请先停止手动模式')
    }
    const frequency = this.get(id)
    if (!frequency) throw new Error('没有找到所选频率')
    this.state = Object.assign({}, this.state, { deviceProfileId: context.profile.id })
    this.setKeepScreenOn(true)
    this.startProgressClock()
    try {
      return await this.runner.start(makeRunnableFrequency(frequency, context.profile), options)
    } finally {
      this.stopProgressClock()
      this.setKeepScreenOn(false)
    }
  }

  async stop() {
    if (!compatibleConnection()) throw new Error('设备连接已断开')
    const context = frequencyContext()
    try {
      return await this.runner.stop(context.controller.stopHex)
    } finally {
      this.setKeepScreenOn(false)
    }
  }

  cancel() {
    const result = this.runner.cancel()
    this.stopProgressClock()
    this.setKeepScreenOn(false)
    return result
  }

  async stopForBackground() {
    if (!this.runner.isRunning()) return
    if (compatibleConnection()) {
      try {
        await this.stop()
      } catch (error) {
        this.cancel()
      }
    } else {
      this.cancel()
    }
  }

  setKeepScreenOn(keepScreenOn) {
    if (typeof wx !== 'undefined' && typeof wx.setKeepScreenOn === 'function') {
      wx.setKeepScreenOn({ keepScreenOn: Boolean(keepScreenOn) })
    }
  }
}

const runtime = new FrequencyRuntime()

module.exports = runtime
module.exports.FrequencyRuntime = FrequencyRuntime
module.exports.compatibleConnection = compatibleConnection
