const devices = require('../devices/index')
const { normalizeFrequency, parseFrequencyJson } = require('./frequency-schema')

const STORAGE_KEY = 'haohao.bluetooth.frequencyLibrary'
const MAX_LOCAL_FREQUENCIES = 100

function defaultStorage() {
  return {
    get(key) {
      if (typeof wx === 'undefined') return []
      return wx.getStorageSync(key)
    },
    set(key, value) {
      if (typeof wx !== 'undefined') wx.setStorageSync(key, value)
    }
  }
}

function profileFor(frequency) {
  return devices.getProfile(frequency.deviceProfileId)
}

function validateForKnownProfile(frequency) {
  const profile = profileFor(frequency)
  if (!profile) throw new Error(`未知设备类型：${frequency.deviceProfileId}`)
  return normalizeFrequency(frequency, { profile })
}

function publicItem(frequency, origin) {
  return Object.assign({}, frequency, {
    origin
  })
}

function contentKey(frequency) {
  return `${frequency.deviceProfileId}:${frequency.integrity.scheduleSha256}`
}

function exportShape(frequency) {
  return {
    id: frequency.id,
    name: frequency.name,
    description: frequency.description,
    deviceProfileId: frequency.deviceProfileId,
    durationMs: frequency.durationMs,
    frames: frequency.frames,
    integrity: frequency.integrity
  }
}

class FrequencyStore {
  constructor(options) {
    const config = options || {}
    this.storage = config.storage || defaultStorage()
    this.builtIns = (config.builtIns || devices.getBuiltInFrequencies()).map(validateForKnownProfile)
    this.locals = []
    this.reload()
  }

  reload() {
    let raw = []
    try {
      const value = this.storage.get(STORAGE_KEY)
      raw = Array.isArray(value) ? value : []
    } catch (error) {
      raw = []
    }
    const seen = new Set(this.builtIns.map(contentKey))
    this.locals = []
    raw.forEach((item) => {
      try {
        const checked = validateForKnownProfile(item)
        const key = contentKey(checked)
        if (seen.has(key)) return
        seen.add(key)
        this.locals.push(checked)
      } catch (error) {
        // 损坏的本地条目会在下一次保存时清理。
      }
    })
    return this.list()
  }

  _save() {
    this.storage.set(STORAGE_KEY, this.locals.map(exportShape))
  }

  list(deviceProfileId) {
    return this.builtIns.map((item) => publicItem(item, 'built-in'))
      .concat(this.locals.map((item) => publicItem(item, 'local')))
      .filter((item) => !deviceProfileId || item.deviceProfileId === deviceProfileId)
  }

  get(id, deviceProfileId) {
    return this.list(deviceProfileId).find((item) => item.id === id) || null
  }

  importJson(text, expectedProfileId) {
    return this.importFrequency(parseFrequencyJson(text), expectedProfileId)
  }

  importFrequency(input, expectedProfileId) {
    const checked = validateForKnownProfile(input)
    if (expectedProfileId && checked.deviceProfileId !== expectedProfileId) {
      throw new Error('频率与当前设备类型不匹配')
    }
    const localCount = this.locals.filter(
      (item) => item.deviceProfileId === checked.deviceProfileId
    ).length
    if (localCount >= MAX_LOCAL_FREQUENCIES) {
      throw new Error(`本机最多保存 ${MAX_LOCAL_FREQUENCIES} 个导入频率`)
    }
    const duplicate = this.list(checked.deviceProfileId).find(
      (item) => item.integrity.scheduleSha256 === checked.integrity.scheduleSha256
    )
    if (duplicate) throw new Error(`相同频率已存在：${duplicate.name}`)

    const usedIds = new Set(this.list(checked.deviceProfileId).map((item) => item.id))
    const originalId = checked.id
    let suffix = 2
    while (usedIds.has(checked.id)) {
      checked.id = `${originalId.slice(0, 60)}-${suffix}`
      suffix += 1
    }
    this.locals.push(checked)
    this._save()
    return publicItem(checked, 'local')
  }

  exportJson(id, deviceProfileId) {
    const item = this.get(id, deviceProfileId)
    if (!item) throw new Error('没有找到所选频率')
    return `${JSON.stringify(exportShape(item), null, 2)}\n`
  }
}

module.exports = {
  STORAGE_KEY,
  FrequencyStore
}
