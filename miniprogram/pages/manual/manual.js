const ble = require('../../core/bluetooth')
const session = require('../../core/device-session')
const frequencyRuntime = require('../../utils/frequency-runtime')

function clockText(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds || 0)) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function activeManualContext() {
  const definition = session.getActiveDefinition()
  const controller = session.getActiveController()
  if (!definition || !definition.features || !definition.features.manualControl) return null
  if (!controller || typeof controller.sendManualState !== 'function') return null
  if (typeof controller.getManualConfig !== 'function') return null
  return { definition, controller }
}

function askFrequencyName() {
  return new Promise((resolve, reject) => {
    wx.showModal({
      title: '保存频率',
      content: '输入名称后保存到本机频率列表',
      editable: true,
      placeholderText: '手动频率',
      confirmText: '保存',
      success: resolve,
      fail: reject
    })
  })
}

function defaultFrequencyName() {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `手动频率 ${month}-${day} ${hour}:${minute}`
}

function localFrequencyId() {
  const random = Math.floor(Math.random() * 0x100000).toString(36).padStart(4, '0')
  return `manual-${Date.now().toString(36)}-${random}`
}

Page({
  data: {
    connected: false,
    frequencyMin: 0,
    frequencyMax: 100,
    frequencyValue: 0,
    suctionMin: 0,
    suctionMax: 100,
    suctionValue: 0,
    running: false,
    recording: false,
    stopping: false,
    elapsedText: '0:00',
    statusText: '调整参数后点击播放',
    errorText: ''
  },

  onLoad() {
    this._visible = false
    this._recordedFrames = []
    this._pendingManualRequest = null
    this._sendPromise = null
    this._sendDelayTimer = null
    this._lastManualSendAt = 0
    this._elapsedTimer = null
    this._stoppingPromise = null
    this._manualController = null
    this._sliderRects = Object.create(null)
  },

  onShow() {
    this._visible = true
    this.bindEvents()
    this.refreshConnection()
    if (typeof wx.nextTick === 'function') wx.nextTick(() => this.measureSliderRects())
  },

  onReady() {
    this.measureSliderRects()
  },

  onResize() {
    this._sliderRects = Object.create(null)
    this.measureSliderRects()
  },

  onHide() {
    this._visible = false
    this.unbindEvents()
    if (this.data.running || this.data.stopping) {
      this.stopManual({ saveRecording: false, silent: true }).catch(() => {})
    }
  },

  onUnload() {
    this.onHide()
  },

  bindEvents() {
    this.unbindEvents()
    this._unsubscribe = [
      ble.on('connection', () => this.refreshConnection()),
      ble.on('gatt', () => this.refreshConnection())
    ]
  },

  unbindEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  refreshConnection() {
    const context = activeManualContext()
    const connected = Boolean(context && session.isManagedConnection())
    const updates = { connected }
    if (context) {
      const config = context.controller.getManualConfig()
      updates.frequencyMin = config.frequency.min
      updates.frequencyMax = config.frequency.max
      updates.suctionMin = config.suction.min
      updates.suctionMax = config.suction.max
      if (!this._configLoaded) {
        updates.frequencyValue = config.frequency.defaultValue
        updates.suctionValue = config.suction.defaultValue
        this._updateIntervalMs = config.updateIntervalMs
        this._configLoaded = true
      }
    }
    if (!connected && this.data.running) {
      this.clearSendDelay()
      this.stopElapsedClock()
      this._pendingManualRequest = null
      this._lastManualSendAt = 0
      this._recordingStartedAt = 0
      this._recordedFrames = []
      if (this._manualController) this._manualController.endManualControl()
      this._manualController = null
      if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false })
      Object.assign(updates, {
        running: false,
        recording: false,
        stopping: false,
        statusText: '设备连接已断开'
      })
    }
    this.setData(updates)
  },

  valuesWith(update) {
    return {
      frequency: update && update.frequency !== undefined
        ? update.frequency
        : this.data.frequencyValue,
      suction: update && update.suction !== undefined
        ? update.suction
        : this.data.suctionValue
    }
  },

  updateParameter(field, value, finalChange) {
    const numeric = Math.round(Number(value))
    const update = {}
    update[field] = numeric
    this.setData(update)
    if (!this.data.running) return
    const values = field === 'frequencyValue'
      ? this.valuesWith({ frequency: numeric })
      : this.valuesWith({ suction: numeric })
    this.queueManualSend(values, Boolean(finalChange))
  },

  readSliderRect(kind) {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this)
      query.select(`#${kind}-slider-rail`).boundingClientRect((rect) => {
        if (rect && rect.width > 0) this._sliderRects[kind] = rect
        resolve(rect)
      }).exec()
    })
  },

  measureSliderRects() {
    if (typeof wx.createSelectorQuery !== 'function') return
    this.readSliderRect('frequency')
    this.readSliderRect('suction')
  },

  sliderTouchPoint(event) {
    const active = event && event.touches && event.touches[0]
    const changed = event && event.changedTouches && event.changedTouches[0]
    return active || changed || null
  },

  applySliderTouch(kind, event, finalChange) {
    if (this.data.stopping) return
    const field = kind === 'frequency' ? 'frequencyValue' : 'suctionValue'
    const point = this.sliderTouchPoint(event)
    if (!point) {
      if (finalChange) this.updateParameter(field, this.data[field], true)
      return
    }
    const apply = (rect) => {
      if (!rect || !rect.width) return
      const clientX = Number(point.clientX !== undefined ? point.clientX : point.pageX)
      if (!Number.isFinite(clientX)) return
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const minimum = kind === 'frequency' ? this.data.frequencyMin : this.data.suctionMin
      const maximum = kind === 'frequency' ? this.data.frequencyMax : this.data.suctionMax
      const value = minimum + Math.round(ratio * (maximum - minimum))
      this.updateParameter(field, value, finalChange)
    }
    const rect = this._sliderRects[kind]
    if (rect) {
      apply(rect)
      return
    }
    this.readSliderRect(kind).then(apply)
  },

  onFrequencyTouchStart(event) {
    this.applySliderTouch('frequency', event, false)
  },

  onFrequencyTouchMove(event) {
    this.applySliderTouch('frequency', event, false)
  },

  onFrequencyTouchEnd(event) {
    this.applySliderTouch('frequency', event, true)
  },

  onSuctionTouchStart(event) {
    this.applySliderTouch('suction', event, false)
  },

  onSuctionTouchMove(event) {
    this.applySliderTouch('suction', event, false)
  },

  onSuctionTouchEnd(event) {
    this.applySliderTouch('suction', event, true)
  },

  clearSendDelay() {
    if (this._sendDelayTimer !== null) clearTimeout(this._sendDelayTimer)
    this._sendDelayTimer = null
  },

  queueManualSend(values, finalChange) {
    const previous = this._pendingManualRequest
    this._pendingManualRequest = {
      values,
      force: Boolean(finalChange || (previous && previous.force))
    }
    if (finalChange) {
      this.clearSendDelay()
      this.drainManualSends().catch((error) => this.handleSendFailure(error))
      return
    }
    this.schedulePendingSend()
  },

  schedulePendingSend() {
    if (!this._pendingManualRequest || !this.data.running || this._sendPromise) return
    if (this._pendingManualRequest.force) {
      this.clearSendDelay()
      this.drainManualSends().catch((error) => this.handleSendFailure(error))
      return
    }
    if (this._sendDelayTimer !== null) return
    const interval = this._updateIntervalMs || 60
    const elapsed = Date.now() - this._lastManualSendAt
    const delay = Math.max(0, interval - elapsed)
    if (delay === 0) {
      this.drainManualSends().catch((error) => this.handleSendFailure(error))
      return
    }
    this._sendDelayTimer = setTimeout(() => {
      this._sendDelayTimer = null
      this.drainManualSends().catch((error) => this.handleSendFailure(error))
    }, delay)
  },

  drainManualSends() {
    if (this._sendPromise) return this._sendPromise
    if (!this._pendingManualRequest || !this.data.running) return Promise.resolve()
    const request = this._pendingManualRequest
    this._pendingManualRequest = null
    const promise = (async () => {
      const context = activeManualContext()
      if (!context || !session.isManagedConnection()) throw new Error('设备连接已断开')
      const frames = await context.controller.sendManualState(request.values, { force: request.force })
      this._lastManualSendAt = Date.now()
      this.recordFrames(frames)
    })()
    this._sendPromise = promise
    const finish = () => {
      if (this._sendPromise === promise) this._sendPromise = null
    }
    promise.then(() => {
      finish()
      this.schedulePendingSend()
    }, finish)
    return promise
  },

  recordFrames(frames) {
    if (!this.data.recording || !this._recordingStartedAt) return
    const atMs = Math.max(0, Date.now() - this._recordingStartedAt)
    ;(frames || []).forEach((frame) => {
      this._recordedFrames.push({ atMs, hex: frame.hex })
    })
  },

  startElapsedClock() {
    this.stopElapsedClock()
    this._runStartedAt = Date.now()
    this._elapsedTimer = setInterval(() => {
      this.setData({ elapsedText: clockText(Date.now() - this._runStartedAt) })
    }, 250)
  },

  stopElapsedClock() {
    if (this._elapsedTimer !== null) clearInterval(this._elapsedTimer)
    this._elapsedTimer = null
  },

  async startManual(recording) {
    if (this.data.running || this.data.stopping) return
    if (!this.data.connected) {
      this.showError(new Error('设备连接已断开'))
      return
    }
    if (frequencyRuntime.isRunning()) {
      this.showError(new Error('请先停止正在运行的频率'))
      return
    }
    const context = activeManualContext()
    if (!context || !session.isManagedConnection()) {
      this.showError(new Error('设备连接已断开'))
      return
    }
    try {
      context.controller.beginManualControl()
      this._manualController = context.controller
    } catch (error) {
      this.showError(error)
      return
    }

    this.clearSendDelay()
    this._pendingManualRequest = null
    this._lastManualSendAt = 0
    this._recordedFrames = []
    this._recordingStartedAt = recording ? Date.now() : 0
    this.setData({
      running: true,
      recording: Boolean(recording),
      stopping: false,
      elapsedText: '0:00',
      statusText: recording ? '正在录制，滑动参数会写入频率' : '正在发送，滑动参数会实时生效',
      errorText: ''
    })
    this.startElapsedClock()
    if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: true })

    this._pendingManualRequest = { values: this.valuesWith(), force: true }
    try {
      await this.drainManualSends()
    } catch (error) {
      this.handleSendFailure(error)
    }
  },

  togglePlayback() {
    if (!this.data.connected || this.data.stopping) return
    if (this.data.running) {
      return this.stopManual({ saveRecording: true })
    }
    return this.startManual(false)
  },

  toggleRecording() {
    if (this.data.recording) return this.stopManual({ saveRecording: true })
    if (this.data.running || this.data.stopping) return
    return this.startManual(true)
  },

  stopManual(options) {
    if (this._stoppingPromise) return this._stoppingPromise
    const settings = options || {}
    const shouldSave = Boolean(this.data.recording && settings.saveRecording !== false)
    const wasRecording = this.data.recording
    const promise = (async () => {
      this.setData({ running: false, stopping: true, statusText: '正在停止' })
      this.clearSendDelay()
      this._pendingManualRequest = null
      this._lastManualSendAt = 0
      this.stopElapsedClock()
      if (this._sendPromise) {
        try {
          await this._sendPromise
        } catch (error) {
          // 停止指令仍继续发送。
        }
      }

      const context = activeManualContext()
      if (context && session.isManagedConnection()) {
        await context.controller.emergencyStop()
      }

      let recorded = null
      if (wasRecording && this._recordingStartedAt) {
        const previousAt = this._recordedFrames.length
          ? this._recordedFrames[this._recordedFrames.length - 1].atMs
          : 0
        const durationMs = Math.max(1, previousAt, Date.now() - this._recordingStartedAt)
        const stopHex = context && context.controller.stopHex
        if (stopHex) {
          this._recordedFrames.push({ atMs: durationMs, hex: stopHex })
          recorded = {
            durationMs,
            frames: this._recordedFrames.slice()
          }
        }
      }

      this._recordingStartedAt = 0
      this._recordedFrames = []
      if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false })
      this.setData({
        running: false,
        recording: false,
        stopping: false,
        statusText: '已停止',
        elapsedText: '0:00'
      })

      if (shouldSave && recorded && this._visible) await this.promptAndSave(recorded)
      if (!settings.silent && this._visible && !shouldSave) {
        wx.showToast({ title: '已停止', icon: 'success' })
      }
    })()
    this._stoppingPromise = promise
    promise.catch((error) => this.showError(error)).finally(() => {
      if (this._stoppingPromise === promise) this._stoppingPromise = null
      this._recordingStartedAt = 0
      this._recordedFrames = []
      if (this._manualController) this._manualController.endManualControl()
      this._manualController = null
      if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false })
      this.setData({ running: false, recording: false, stopping: false })
    })
    return promise
  },

  async promptAndSave(recorded) {
    const result = await askFrequencyName()
    if (!result.confirm) {
      wx.showToast({ title: '已取消保存', icon: 'none' })
      return
    }
    const name = String(result.content || '').trim() || defaultFrequencyName()
    const saved = frequencyRuntime.saveFrequency({
      id: localFrequencyId(),
      name,
      description: '',
      durationMs: recorded.durationMs,
      frames: recorded.frames
    })
    wx.showToast({ title: `已保存：${saved.name}`, icon: 'success', duration: 2300 })
  },

  handleSendFailure(error) {
    this.clearSendDelay()
    this._pendingManualRequest = null
    this._lastManualSendAt = 0
    this.stopElapsedClock()
    this._recordingStartedAt = 0
    this._recordedFrames = []
    if (this._manualController) this._manualController.endManualControl()
    this._manualController = null
    if (typeof wx.setKeepScreenOn === 'function') wx.setKeepScreenOn({ keepScreenOn: false })
    const context = activeManualContext()
    if (context && session.isManagedConnection()) context.controller.emergencyStop().catch(() => {})
    this.setData({
      running: false,
      recording: false,
      stopping: false,
      statusText: '发送出错'
    })
    this.showError(error)
  },

  showError(error) {
    const message = error && (error.message || error.errMsg)
      ? (error.message || error.errMsg)
      : String(error || '操作失败')
    this.setData({ errorText: message })
    if (this._visible) wx.showToast({ title: message, icon: 'none', duration: 2800 })
  }
})
