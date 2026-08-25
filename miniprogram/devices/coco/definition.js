const profile = require('./profile')
const frequencies = require('./frequencies/index')
const CocoController = require('./controller')

function normalizeUuid(uuid) {
  return String(uuid || '').replace(/-/g, '').toUpperCase()
}

function matchAdvertisement(device) {
  const advertised = (device && device.advertisServiceUUIDs || []).map(normalizeUuid)
  const serviceMatch = profile.match.advertisedServiceUUIDs.some(
    (uuid) => advertised.includes(normalizeUuid(uuid))
  )
  if (serviceMatch) return 100

  const name = String(device && (device.name || device.localName) || '').toUpperCase()
  const nameMatch = profile.match.namePrefixes.some(
    (prefix) => name.startsWith(String(prefix).toUpperCase())
  )
  return nameMatch ? 50 : 0
}

module.exports = {
  id: 'coco',
  displayName: profile.displayName,
  profile,
  scan: {
    serviceUUIDs: profile.match.advertisedServiceUUIDs.slice(),
    unfiltered: false
  },
  pages: {
    control: '/pages/control/control',
    frequency: '/pages/frequency/frequency',
    manual: '/pages/manual/manual'
  },
  card: {
    protocolText: 'FF60 / FF61 / FF62',
    serviceText: 'FF60 · FF61 写入 · FF62 通知'
  },
  storage: {
    savedCommandsKey: 'haohao.bluetooth.savedCommands'
  },
  features: {
    frequencies: true,
    manualControl: true
  },
  frequencies,
  matchAdvertisement,
  createController(context) {
    return new CocoController({
      ble: context.ble,
      profile
    })
  }
}
