const ble = require('./bluetooth')
const registry = require('../devices/index')

let autoConnectPaused = false
let active = emptyActiveSession()
let listeners = []

function emptyActiveSession() {
  return {
    mode: 'idle',
    definitionId: '',
    deviceId: '',
    controller: null
  }
}

function publicSnapshot() {
  return {
    mode: active.mode,
    definitionId: active.definitionId,
    deviceId: active.deviceId,
    managed: active.mode === 'managed',
    debug: active.mode === 'debug'
  }
}

function emit() {
  const snapshot = publicSnapshot()
  listeners.slice().forEach((listener) => listener(snapshot))
}

function replaceActive(next) {
  active = next || emptyActiveSession()
  emit()
}

async function disposeController(controller) {
  if (!controller || typeof controller.dispose !== 'function') return
  await controller.dispose()
}

function createController(definition) {
  const controller = definition.createController({ ble, definition })
  if (!controller || typeof controller.initialize !== 'function') {
    throw new Error(`设备模块 ${definition.id} 的控制器缺少初始化方法`)
  }
  if (typeof controller.isCompatible !== 'function') {
    throw new Error(`设备模块 ${definition.id} 的控制器缺少连接确认方法`)
  }
  return controller
}

async function connectManaged(device, definitionOrId) {
  const definition = typeof definitionOrId === 'string'
    ? registry.getDeviceDefinition(definitionOrId)
    : definitionOrId
  if (!definition) throw new Error('没有找到匹配的设备模块')

  await disposeController(active.controller)
  replaceActive(emptyActiveSession())
  let controller = null
  try {
    const snapshot = await ble.connect(device, { profile: definition.profile })
    controller = createController(definition)
    await controller.initialize(snapshot)
    replaceActive({
      mode: 'managed',
      definitionId: definition.id,
      deviceId: snapshot.connectedDevice && snapshot.connectedDevice.deviceId || '',
      controller
    })
    return snapshot
  } catch (error) {
    try {
      await disposeController(controller)
    } catch (disposeError) {
      // 连接清理继续以关闭底层连接为准。
    }
    await ble.disconnect()
    replaceActive(emptyActiveSession())
    throw error
  }
}

async function connectDebug(device, definitionOrId) {
  const definition = typeof definitionOrId === 'string'
    ? registry.getDeviceDefinition(definitionOrId)
    : definitionOrId
  await disposeController(active.controller)
  replaceActive(emptyActiveSession())
  const snapshot = await ble.connect(device, definition ? { profile: definition.profile } : undefined)
  replaceActive({
    mode: 'debug',
    definitionId: definition ? definition.id : '',
    deviceId: snapshot.connectedDevice && snapshot.connectedDevice.deviceId || '',
    controller: null
  })
  return snapshot
}

async function disconnect() {
  const controller = active.controller
  replaceActive(emptyActiveSession())
  try {
    await disposeController(controller)
  } finally {
    await ble.disconnect()
  }
}

function getActiveDefinition() {
  if (active.mode !== 'managed') return null
  return registry.getDeviceDefinition(active.definitionId)
}

function getActiveController() {
  return active.mode === 'managed' ? active.controller : null
}

function isManagedConnection(snapshot, definitionId) {
  const state = snapshot || ble.getSnapshot()
  if (active.mode !== 'managed' || !active.controller) return false
  if (definitionId && active.definitionId !== definitionId) return false
  if (!state.connected || !state.connectedDevice || state.connectedDevice.deviceId !== active.deviceId) return false
  return typeof active.controller.isCompatible !== 'function' || active.controller.isCompatible(state)
}

function pauseAutoConnect() {
  autoConnectPaused = true
}

function resumeAutoConnect() {
  autoConnectPaused = false
}

function isAutoConnectPaused() {
  return autoConnectPaused
}

function on(listener) {
  listeners.push(listener)
  listener(publicSnapshot())
  return () => {
    listeners = listeners.filter((item) => item !== listener)
  }
}

ble.on('connection', (state) => {
  if (state.connected || active.mode === 'idle') return
  const controller = active.controller
  replaceActive(emptyActiveSession())
  disposeController(controller).catch(() => {})
})

module.exports = {
  connectManaged,
  connectDebug,
  disconnect,
  getSnapshot: publicSnapshot,
  getActiveDefinition,
  getActiveController,
  isManagedConnection,
  pauseAutoConnect,
  resumeAutoConnect,
  isAutoConnectPaused,
  on
}
