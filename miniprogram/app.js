const ble = require('./core/bluetooth')
const deviceSession = require('./core/device-session')
const frequencyRuntime = require('./utils/frequency-runtime')

App({
  globalData: {
    ble,
    deviceSession,
    frequencyRuntime
  },

  onHide() {
    frequencyRuntime.stopForBackground()
  },

  onError(error) {
    console.error('[AppError]', error)
  },

  onUnhandledRejection(event) {
    console.error('[UnhandledRejection]', event.reason)
  }
})
