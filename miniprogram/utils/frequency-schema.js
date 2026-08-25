const sha256 = require('./sha256')
const { normalizeHex } = require('./program-runner')

const MAX_FRAMES = 5000
const MAX_DURATION_MS = 60 * 60 * 1000
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function canonicalSchedule(frames) {
  return frames.map((frame) => `${frame.atMs}|${frame.hex.replace(/\s/g, '')}\n`).join('')
}

function scheduleSha256(frames) {
  return sha256(canonicalSchedule(frames))
}

function cleanText(value, label, maximum, required) {
  const text = String(value || '').trim()
  if (required && !text) throw new Error(`${label}为空`)
  if (text.length > maximum) throw new Error(`${label}超过 ${maximum} 个字符`)
  return text
}

function normalizeFrequency(input, options) {
  const source = input && typeof input === 'object' ? input : null
  if (!source || Array.isArray(source)) throw new Error('频率文件根节点应为对象')

  const id = cleanText(source.id, '频率 ID', 64, true)
  if (!ID_PATTERN.test(id)) throw new Error('频率 ID 只使用小写字母、数字、点、短横线或下划线')
  const name = cleanText(source.name, '频率名称', 40, true)
  const description = cleanText(source.description, '频率说明', 200, false)
  const deviceProfileId = cleanText(source.deviceProfileId, '设备类型', 64, true)
  const config = options || {}
  const profile = config.profile || null
  if (profile && profile.id !== deviceProfileId) throw new Error('频率与当前设备类型不匹配')

  if (!Array.isArray(source.frames) || source.frames.length < 1) {
    throw new Error('频率至少需要一帧数据')
  }
  if (source.frames.length > MAX_FRAMES) throw new Error(`频率最多包含 ${MAX_FRAMES} 帧`)

  let previousAt = -1
  const frames = source.frames.map((rawFrame, index) => {
    const atMs = Number(rawFrame && rawFrame.atMs)
    if (!Number.isInteger(atMs) || atMs < 0 || atMs < previousAt) {
      throw new Error(`第 ${index + 1} 帧时间无效`)
    }
    previousAt = atMs
    return {
      atMs,
      hex: normalizeHex(rawFrame && rawFrame.hex)
    }
  })

  const durationMs = Number(source.durationMs)
  if (!Number.isInteger(durationMs) || durationMs !== frames[frames.length - 1].atMs) {
    throw new Error('频率时长应等于最后一帧时间')
  }
  if (durationMs > MAX_DURATION_MS) throw new Error('单个频率最长为 60 分钟')
  if (profile && profile.control && profile.control.stopHex) {
    const expectedStop = normalizeHex(profile.control.stopHex)
    if (frames[frames.length - 1].hex !== expectedStop) {
      throw new Error(`频率最后一帧应为停止指令 ${expectedStop}`)
    }
  }

  const calculatedHash = scheduleSha256(frames)
  const suppliedHash = source.integrity && source.integrity.scheduleSha256
    ? String(source.integrity.scheduleSha256).toUpperCase()
    : ''
  if (suppliedHash && suppliedHash !== calculatedHash) throw new Error('频率完整性校验失败')

  return {
    id,
    name,
    description,
    deviceProfileId,
    durationMs,
    frames,
    integrity: { scheduleSha256: calculatedHash }
  }
}

function parseFrequencyJson(text, options) {
  const source = String(text || '')
  if (!source.trim()) throw new Error('频率文件为空')
  if (source.length > 2 * 1024 * 1024) throw new Error('频率文件超过 2 MB')
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error('频率文件不是有效 JSON')
  }
  return normalizeFrequency(parsed, options)
}

function makeRunnableFrequency(frequency, profile) {
  const checked = normalizeFrequency(frequency, { profile })
  return {
    id: checked.id,
    label: checked.name,
    description: checked.description,
    durationMs: checked.durationMs,
    frames: checked.frames,
    stopHex: profile.control.stopHex,
    evidence: {
      scheduleSha256: checked.integrity.scheduleSha256
    }
  }
}

module.exports = {
  canonicalSchedule,
  scheduleSha256,
  normalizeFrequency,
  parseFrequencyJson,
  makeRunnableFrequency
}
