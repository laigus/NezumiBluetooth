const FREQUENCY_FRAMES = [
  'C3 7C 25 60 6F',
  'C3 7C 25 61 6C',
  'C3 7C 25 63 6E',
  'C3 7C 25 64 6B',
  'C3 7C 25 65 68',
  'C3 7C 25 66 6D',
  'C3 7C 25 67 6A',
  'C3 7C 25 68 57',
  'C3 7C 25 69 54',
  'C3 7C 25 6A 69',
  'C3 7C 25 6B 56',
  'C3 7C 25 6C 53',
  'C3 7C 25 6D 50',
  'C3 7C 25 6E 55',
  'C3 7C 25 6F 52',
  'C3 7C 25 70 5F',
  'C3 7C 25 71 5C',
  'C3 7C 25 72 51',
  'C3 7C 25 73 5E',
  'C3 7C 25 76 5D'
]

// 界面使用 0–100 连续值；非零值映射到抓取数据中已出现的有效控制码。
// 真机已确认缺失的 0x62 档仍会产生最低频率，因此 0 不再伪造通道数据，
// 而由控制器发送已确认的全局停止数据，再恢复仍大于 0 的通道。

const config = {
  updateIntervalMs: 60,
  finalRepeatCount: 2,
  finalRepeatDelayMs: 35,
  frequency: {
    min: 0,
    max: 100,
    defaultValue: 0
  },
  suction: {
    min: 0,
    max: 100,
    defaultValue: 0
  }
}

function clampValue(value, range) {
  const numeric = Math.round(Number(value))
  if (!Number.isFinite(numeric)) return range.defaultValue
  return Math.max(range.min, Math.min(range.max, numeric))
}

function sourceHex(value, range) {
  const checked = clampValue(value, range)
  if (checked === 0) throw new Error('数值 0 需要通过停止数据处理')
  const position = (checked - 1) / Math.max(1, range.max - 1)
  const index = Math.round(position * (FREQUENCY_FRAMES.length - 1))
  return FREQUENCY_FRAMES[index]
}

function channelHex(opcode, value, range) {
  const source = sourceHex(value, range).split(' ')
  const channel = Number(opcode)
  const channelDelta = channel - 0x7C
  source[1] = channel.toString(16).padStart(2, '0').toUpperCase()
  source[4] = ((parseInt(source[4], 16) - channelDelta) & 0xFF)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return source.join(' ')
}

function frequencyHex(value) {
  return channelHex(0x7C, value, config.frequency)
}

function suctionHex(value) {
  return channelHex(0x7D, value, config.suction)
}

function normalizeValues(values) {
  const input = values || {}
  return {
    frequency: clampValue(input.frequency, config.frequency),
    suction: clampValue(input.suction, config.suction)
  }
}

function buildFrames(values) {
  const normalized = normalizeValues(values)
  const frames = []
  if (normalized.frequency > 0) {
    frames.push({
      channel: 'frequency',
      value: normalized.frequency,
      hex: frequencyHex(normalized.frequency)
    })
  }
  if (normalized.suction > 0) {
    frames.push({
      channel: 'suction',
      value: normalized.suction,
      hex: suctionHex(normalized.suction)
    })
  }
  return frames
}

module.exports = {
  config,
  clampValue,
  normalizeValues,
  frequencyHex,
  suctionHex,
  buildFrames
}
