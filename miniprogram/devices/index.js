const coco = require('./coco/definition')

function validateDefinition(definition) {
  if (!definition || !definition.id) throw new Error('设备模块缺少 ID')
  if (!definition.profile || !definition.profile.id) throw new Error(`设备模块 ${definition.id} 缺少设备画像`)
  if (typeof definition.matchAdvertisement !== 'function') {
    throw new Error(`设备模块 ${definition.id} 缺少广播识别函数`)
  }
  if (typeof definition.createController !== 'function') {
    throw new Error(`设备模块 ${definition.id} 缺少协议控制器工厂`)
  }
  if (!definition.pages || !definition.pages.control) {
    throw new Error(`设备模块 ${definition.id} 缺少控制页面`)
  }
  if (definition.features && definition.features.frequencies) {
    if (!definition.pages.frequency) throw new Error(`设备模块 ${definition.id} 缺少频率详情页面`)
    ;(definition.frequencies || []).forEach((frequency) => {
      if (frequency.deviceProfileId !== definition.profile.id) {
        throw new Error(`设备模块 ${definition.id} 包含归属错误的频率`)
      }
    })
  }
  return definition
}

const definitions = [coco].map(validateDefinition)
const definitionIds = new Set(definitions.map((definition) => definition.id))
if (definitionIds.size !== definitions.length) throw new Error('设备模块 ID 重复')
const profileIds = new Set(definitions.map((definition) => definition.profile.id))
if (profileIds.size !== definitions.length) throw new Error('设备画像 ID 重复')

function getDeviceDefinition(definitionId) {
  return definitions.find((definition) => definition.id === definitionId) || null
}

function matchDevice(device) {
  const candidate = definitions
    .map((definition) => ({
      definition,
      score: Number(definition.matchAdvertisement(device) || 0)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]
  return candidate ? candidate.definition : null
}

function getSupportedDevices(devices) {
  return (devices || [])
    .map((device) => ({ device, definition: matchDevice(device) }))
    .filter((candidate) => candidate.definition)
    .sort((left, right) => Number(right.device.RSSI || -999) - Number(left.device.RSSI || -999))
}

function getScanOptions() {
  if (definitions.some((definition) => definition.scan && definition.scan.unfiltered)) {
    return { allDevices: true }
  }
  const services = []
  definitions.forEach((definition) => {
    ;(definition.scan && definition.scan.serviceUUIDs || []).forEach((uuid) => {
      if (!services.includes(uuid)) services.push(uuid)
    })
  })
  return services.length ? { services } : { allDevices: true }
}

function getProfile(profileId) {
  const definition = definitions.find((item) => item.profile.id === profileId)
  return definition ? definition.profile : null
}

function getBuiltInFrequencies() {
  return definitions.reduce(
    (items, definition) => items.concat(definition.frequencies || []),
    []
  )
}

module.exports = {
  definitions,
  validateDefinition,
  getDeviceDefinition,
  matchDevice,
  getSupportedDevices,
  getScanOptions,
  getProfile,
  getBuiltInFrequencies
}
