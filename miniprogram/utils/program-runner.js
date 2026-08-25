function normalizeHex(value) {
  const compact = String(value || '')
    .replace(/0x/gi, '')
    .replace(/[\s,;:_-]/g, '')
    .toUpperCase()
  if (!compact || compact.length % 2 || !/^[0-9A-F]+$/.test(compact)) {
    throw new Error('模式中包含无效 HEX 帧')
  }
  return compact.match(/.{2}/g).join(' ')
}

function validateProgram(program) {
  if (!program || !program.id) throw new Error('模式缺少标识')
  if (!Array.isArray(program.frames) || !program.frames.length) {
    throw new Error('模式没有可发送的数据帧')
  }

  let previousAt = -1
  const frames = program.frames.map((frame, index) => {
    const atMs = Number(frame && frame.atMs)
    if (!Number.isInteger(atMs) || atMs < 0 || atMs < previousAt) {
      throw new Error(`模式第 ${index + 1} 帧的时间无效`)
    }
    previousAt = atMs
    return Object.assign({}, frame, {
      atMs,
      hex: normalizeHex(frame.hex)
    })
  })

  const durationMs = Number(program.durationMs)
  if (!Number.isInteger(durationMs) || durationMs < frames[frames.length - 1].atMs) {
    throw new Error('模式时长小于最后一帧时间')
  }

  return Object.assign({}, program, {
    durationMs,
    stopHex: normalizeHex(program.stopHex),
    frames
  })
}

class ProgramRunner {
  constructor(options) {
    const config = options || {}
    if (typeof config.send !== 'function') throw new Error('模式执行器缺少发送函数')
    this._send = config.send
    this._now = config.now || Date.now
    this._setTimer = config.setTimer || setTimeout
    this._clearTimer = config.clearTimer || clearTimeout
    this._onState = config.onState || function () {}
    this._active = null
  }

  isRunning() {
    return Boolean(this._active)
  }

  start(program) {
    if (this._active) return Promise.reject(new Error('已有模式正在运行'))
    let checked
    try {
      checked = validateProgram(program)
    } catch (error) {
      return Promise.reject(error)
    }

    let resolveRun
    let rejectRun
    const promise = new Promise((resolve, reject) => {
      resolveRun = resolve
      rejectRun = reject
    })
    const active = {
      program: checked,
      index: 0,
      origin: this._now(),
      timer: null,
      inFlight: null,
      stopping: false,
      resolve: resolveRun,
      reject: rejectRun,
      promise
    }
    this._active = active
    this._emit('running', active)
    this._schedule(active)
    return promise
  }

  _schedule(active) {
    if (this._active !== active || active.stopping) return
    if (active.index >= active.program.frames.length) {
      this._settle(active, 'completed')
      return
    }

    const frame = active.program.frames[active.index]
    const elapsed = Math.max(0, this._now() - active.origin)
    const wait = Math.max(0, frame.atMs - elapsed)
    if (wait > 0) {
      active.timer = this._setTimer(() => {
        active.timer = null
        this._sendNext(active)
      }, wait)
      return
    }
    Promise.resolve().then(() => this._sendNext(active))
  }

  async _sendNext(active) {
    if (this._active !== active || active.stopping) return
    const frame = active.program.frames[active.index]
    try {
      active.inFlight = Promise.resolve(this._send(frame.hex, {
        programId: active.program.id,
        frameIndex: active.index,
        atMs: frame.atMs
      }))
      await active.inFlight
    } catch (error) {
      if (this._active === active && !active.stopping) this._settle(active, 'error', error)
      return
    } finally {
      active.inFlight = null
    }

    if (this._active !== active || active.stopping) return
    active.index += 1
    this._emit('running', active)
    this._schedule(active)
  }

  async stop(fallbackStopHex) {
    const active = this._active
    const stopHex = normalizeHex(active ? active.program.stopHex : fallbackStopHex)

    if (!active) {
      await this._send(stopHex, { manualStop: true })
      const result = { status: 'stopped', sentFrames: 0, totalFrames: 0, elapsedMs: 0, durationMs: 0 }
      this._onState(result)
      return result
    }
    if (active.stopping) return active.stopPromise

    active.stopping = true
    if (active.timer !== null) {
      this._clearTimer(active.timer)
      active.timer = null
    }
    this._emit('stopping', active)

    active.stopPromise = (async () => {
      if (active.inFlight) {
        try {
          await active.inFlight
        } catch (error) {
          // The explicit stop frame below is still attempted after an interrupted write.
        }
      }
      try {
        await this._send(stopHex, { programId: active.program.id, manualStop: true })
      } catch (error) {
        if (this._active === active) this._settle(active, 'error', error)
        throw error
      }
      return this._settle(active, 'stopped')
    })()
    return active.stopPromise
  }

  cancel() {
    const active = this._active
    if (!active) return { status: 'idle' }
    active.stopping = true
    if (active.timer !== null) {
      this._clearTimer(active.timer)
      active.timer = null
    }
    return this._settle(active, 'cancelled')
  }

  _settle(active, status, error) {
    if (this._active !== active) {
      return this._snapshot(status, active, error)
    }
    if (active.timer !== null) this._clearTimer(active.timer)
    active.timer = null
    this._active = null
    const result = this._snapshot(status, active, error)
    this._onState(result)
    if (error) active.reject(error)
    else active.resolve(result)
    return result
  }

  _emit(status, active) {
    this._onState(this._snapshot(status, active))
  }

  _snapshot(status, active, error) {
    const program = active && active.program
    const frames = program ? program.frames : []
    const sentFrames = active ? active.index : 0
    const lastSent = sentFrames ? frames[sentFrames - 1] : null
    return {
      status,
      programId: program ? program.id : '',
      label: program ? program.label : '',
      sentFrames,
      totalFrames: frames.length,
      elapsedMs: lastSent ? lastSent.atMs : 0,
      durationMs: program ? program.durationMs : 0,
      error: error || null
    }
  }
}

module.exports = {
  ProgramRunner,
  normalizeHex,
  validateProgram
}
