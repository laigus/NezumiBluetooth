const ble = require('../../core/bluetooth')
const frequencyRuntime = require('../../utils/frequency-runtime')
const { compatibleConnection } = require('../../utils/frequency-runtime')
const { waveformBars, frequencyStats, runtimeProgress } = require('../../utils/frequency-view')
const { shareFrequencyFile } = require('../../utils/frequency-file')

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '')
  } catch (error) {
    return value || ''
  }
}

function stateText(state, id) {
  if (state.programId !== id) return '准备就绪'
  const labels = {
    running: state.loop
      ? `循环第 ${Number(state.cycle || 0) + 1} 轮 · ${state.sentFrames} / ${state.totalFrames} 帧`
      : `正在运行 · ${state.sentFrames} / ${state.totalFrames} 帧`,
    stopping: '正在发送停止指令',
    completed: '已完成',
    stopped: '已停止',
    cancelled: '运行已结束',
    error: '运行出错'
  }
  return labels[state.status] || '准备就绪'
}

Page({
  data: {
    frequencyId: '',
    name: '',
    description: '',
    originText: '',
    local: false,
    waveform: [],
    durationText: '--',
    durationClock: '0:00',
    frameText: '--',
    averageIntervalText: '--',
    valueRangeText: '--',
    connected: false,
    runtimeBusy: false,
    active: false,
    running: false,
    stopping: false,
    loopEnabled: false,
    statusText: '准备就绪',
    progressVisible: false,
    progressWidth: '0%',
    progressTimeText: '0:00 / 0:00',
    progressPercentText: '0%',
    exporting: false,
    managing: false,
    errorText: ''
  },

  onLoad(options) {
    this._visible = false
    const id = safeDecode(options && options.id)
    this.setData({ frequencyId: id })
    this.loadFrequency()
  },

  onShow() {
    this._visible = true
    this.bindEvents()
    this.refreshRuntime()
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
      frequencyRuntime.on(() => this.refreshRuntime()),
      ble.on('connection', () => this.refreshRuntime())
    ]
  },

  unbindEvents() {
    ;(this._unsubscribe || []).forEach((unsubscribe) => unsubscribe())
    this._unsubscribe = []
  },

  loadFrequency() {
    const frequency = frequencyRuntime.get(this.data.frequencyId)
    if (!frequency) {
      this.showError(new Error('没有找到这个频率'))
      return
    }
    const stats = frequencyStats(frequency)
    this.setData({
      name: frequency.name,
      description: frequency.description,
      originText: frequency.origin === 'built-in' ? '内置频率' : '本机频率',
      local: frequency.origin === 'local',
      waveform: waveformBars(frequency, 64),
      durationText: stats.durationText,
      durationClock: stats.durationClock,
      frameText: stats.frameText,
      averageIntervalText: stats.averageIntervalText,
      valueRangeText: stats.valueRangeText
    })
    wx.setNavigationBarTitle({ title: frequency.name })
  },

  refreshRuntime() {
    const state = frequencyRuntime.getSnapshot()
    const active = state.programId === this.data.frequencyId
    const runtimeBusy = state.status === 'running' || state.status === 'stopping'
    const progress = runtimeProgress(state, this.data.frequencyId)
    this.setData({
      connected: compatibleConnection(),
      runtimeBusy,
      active,
      running: active && state.status === 'running',
      stopping: active && state.status === 'stopping',
      loopEnabled: active && state.status !== 'idle'
        ? Boolean(state.loop)
        : this.data.loopEnabled,
      statusText: stateText(state, this.data.frequencyId),
      progressVisible: progress.visible,
      progressWidth: progress.width,
      progressTimeText: progress.timeText,
      progressPercentText: progress.percentText
    })
  },

  async startFrequency() {
    if (frequencyRuntime.isRunning()) return
    this.setData({ errorText: '' })
    try {
      const result = await frequencyRuntime.start(this.data.frequencyId, {
        loop: this.data.loopEnabled
      })
      if (result.status === 'completed' && this._visible) {
        wx.showToast({ title: '频率已完成', icon: 'success' })
      }
    } catch (error) {
      this.showError(error)
    }
  },

  toggleLoop() {
    if (this.data.runtimeBusy) return
    this.setData({ loopEnabled: !this.data.loopEnabled })
  },

  async stopFrequency() {
    if (this.data.stopping) return
    try {
      await frequencyRuntime.stop()
      if (this._visible) wx.showToast({ title: '已停止', icon: 'success' })
    } catch (error) {
      this.showError(error)
    }
  },

  async exportFrequency() {
    if (this.data.exporting) return
    this.setData({ exporting: true, errorText: '' })
    try {
      const result = await shareFrequencyFile(
        this.data.frequencyId,
        frequencyRuntime.exportJson(this.data.frequencyId)
      )
      if (result.mode === 'clipboard') {
        wx.showToast({ title: '频率 JSON 已复制', icon: 'success' })
      }
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ exporting: false })
    }
  },

  async renameFrequency() {
    if (!this.data.local || this.data.runtimeBusy || this.data.managing) return
    this.setData({ managing: true, errorText: '' })
    try {
      const result = await new Promise((resolve, reject) => {
        wx.showModal({
          title: '修改频率名称',
          content: `当前名称：${this.data.name}`,
          editable: true,
          placeholderText: '输入新名称',
          confirmText: '保存',
          success: resolve,
          fail: reject
        })
      })
      if (!result.confirm) return
      const name = String(result.content || '').trim()
      if (!name) throw new Error('频率名称不能为空')
      frequencyRuntime.renameFrequency(this.data.frequencyId, name)
      this.loadFrequency()
      wx.showToast({ title: '名称已保存', icon: 'success' })
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ managing: false })
    }
  },

  async deleteFrequency() {
    if (!this.data.local || this.data.runtimeBusy || this.data.managing) return
    this.setData({ managing: true, errorText: '' })
    try {
      const result = await new Promise((resolve, reject) => {
        wx.showModal({
          title: '删除本机频率',
          content: `删除“${this.data.name}”后，本机将不再保留这项频率。`,
          confirmText: '删除',
          confirmColor: '#C64052',
          success: resolve,
          fail: reject
        })
      })
      if (!result.confirm) return
      frequencyRuntime.deleteFrequency(this.data.frequencyId)
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 350)
    } catch (error) {
      this.showError(error)
    } finally {
      this.setData({ managing: false })
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
