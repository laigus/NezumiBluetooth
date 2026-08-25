function durationText(milliseconds) {
  const totalSeconds = Math.round(Number(milliseconds || 0) / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
}

function clockText(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000))
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${Math.floor(totalSeconds / 60)}:${seconds}`
}

function runtimeProgress(state, frequencyId) {
  const snapshot = state || {}
  const durationMs = Math.max(0, Number(snapshot.durationMs || 0))
  const belongsToFrequency = snapshot.programId === frequencyId
  const visible = Boolean(belongsToFrequency && durationMs > 0 && snapshot.status !== 'idle')
  let elapsedMs = Math.max(0, Math.min(durationMs, Number(snapshot.elapsedMs || 0)))
  if (snapshot.status === 'completed') elapsedMs = durationMs
  const percent = durationMs
    ? Math.max(0, Math.min(100, Math.round((elapsedMs / durationMs) * 1000) / 10))
    : 0
  return {
    visible,
    elapsedMs,
    durationMs,
    width: `${percent}%`,
    percentText: `${Math.round(percent)}%`,
    timeText: `${clockText(elapsedMs)} / ${clockText(durationMs)}`
  }
}

function frameBytes(frame) {
  return String(frame && frame.hex || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => parseInt(value, 16))
}

function waveformValues(frequency) {
  const frames = frequency && Array.isArray(frequency.frames) ? frequency.frames : []
  return frames
    .slice(0, Math.max(1, frames.length - 1))
    .map((frame) => {
      const bytes = frameBytes(frame)
      return Number.isFinite(bytes[3]) ? bytes[3] : 0
    })
}

function waveformBars(frequency, maximumBars) {
  const values = waveformValues(frequency)
  if (!values.length) return []
  const count = Math.max(1, Math.min(Number(maximumBars || 64), values.length))
  const minimum = Math.min.apply(null, values)
  const maximum = Math.max.apply(null, values)
  const span = Math.max(1, maximum - minimum)
  const bars = []

  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * values.length) / count)
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / count))
    const bucket = values.slice(start, end)
    const average = bucket.reduce((sum, value) => sum + value, 0) / bucket.length
    bars.push({
      id: `wave-${index}`,
      height: 22 + Math.round(((average - minimum) / span) * 74),
      value: Math.round(average)
    })
  }
  return bars
}

function frequencyStats(frequency) {
  const frames = frequency && Array.isArray(frequency.frames) ? frequency.frames : []
  const values = waveformValues(frequency)
  const minimum = values.length ? Math.min.apply(null, values) : 0
  const maximum = values.length ? Math.max.apply(null, values) : 0
  const intervals = frames.slice(1).map((frame, index) => frame.atMs - frames[index].atMs)
  const averageInterval = intervals.length
    ? Math.round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
    : 0
  return {
    durationText: durationText(frequency && frequency.durationMs),
    durationClock: clockText(frequency && frequency.durationMs),
    frameText: `${frames.length} 帧`,
    averageIntervalText: `${averageInterval} ms`,
    valueRangeText: `0x${minimum.toString(16).padStart(2, '0').toUpperCase()}–0x${maximum.toString(16).padStart(2, '0').toUpperCase()}`
  }
}

module.exports = {
  durationText,
  clockText,
  runtimeProgress,
  waveformBars,
  frequencyStats
}
