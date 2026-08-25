const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '..')
const codec = require(path.join(root, 'miniprogram/utils/codec'))
const devices = require(path.join(root, 'miniprogram/devices/index'))
const definition = devices.getDeviceDefinition('coco')
const profile = definition.profile
const builtIn = definition.frequencies[0]
const schema = require(path.join(root, 'miniprogram/utils/frequency-schema'))
const view = require(path.join(root, 'miniprogram/utils/frequency-view'))
const sha256 = require(path.join(root, 'miniprogram/utils/sha256'))
const { FrequencyStore, STORAGE_KEY } = require(path.join(root, 'miniprogram/utils/frequency-store'))
const { ProgramRunner, validateProgram } = require(path.join(root, 'miniprogram/utils/program-runner'))

const tests = []

function test(name, run) {
  tests.push({ name, run })
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function walkFiles(directory, extension) {
  const pending = [directory]
  const files = []
  while (pending.length) {
    const current = pending.pop()
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(target)
      if (entry.isFile() && (!extension || entry.name.endsWith(extension))) files.push(target)
    })
  }
  return files
}

function assertWxmlBalanced(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const stack = []
  const tagPattern = /<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*?)?\s*\/?>/g
  let match
  while ((match = tagPattern.exec(source))) {
    const token = match[0]
    const tag = match[1]
    if (token.startsWith('</')) {
      assert.strictEqual(stack.pop(), tag, `${filePath}: closing ${tag}`)
    } else if (!token.endsWith('/>')) {
      stack.push(tag)
    }
  }
  assert.deepStrictEqual(stack, [], `${filePath}: unclosed tags ${stack.join(', ')}`)
}

test('codec handles HEX and UTF-8', () => {
  const buffer = codec.hexToArrayBuffer('0xAA, 01-ff')
  assert.strictEqual(codec.arrayBufferToHex(buffer), 'AA 01 FF')
  assert.throws(() => codec.hexToArrayBuffer('ABC'), /完整字节/)
  const text = '蓝牙 BLE'
  assert.strictEqual(codec.arrayBufferToText(codec.textToArrayBuffer(text)), text)
})

test('mini program files, bindings, imports, and local mode are valid', () => {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.example.json'), 'utf8'))
  const runtimeRoot = path.join(root, project.miniprogramRoot)
  const app = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'app.json'), 'utf8'))
  assert.strictEqual(project.compileType, 'miniprogram')
  assert.strictEqual(project.appid, 'touristappid')
  assert.ok(app.pages.length > 0)
  devices.definitions.forEach((deviceDefinition) => {
    Object.keys(deviceDefinition.pages || {}).forEach((pageKey) => {
      const pagePath = String(deviceDefinition.pages[pageKey] || '').replace(/^\//, '')
      assert.ok(app.pages.includes(pagePath), `unregistered device page ${pagePath}`)
    })
  })

  walkFiles(runtimeRoot, '.json').forEach((filePath) => {
    JSON.parse(fs.readFileSync(filePath, 'utf8'))
  })

  app.pages.forEach((pagePath) => {
    const pageName = path.basename(pagePath)
    const directory = path.join(runtimeRoot, path.dirname(pagePath))
    const basePath = path.join(runtimeRoot, pagePath)
    ;['.js', '.json', '.wxml', '.wxss'].forEach((extension) => {
      assert.ok(fs.existsSync(basePath + extension), `missing ${pagePath}${extension}`)
    })
    const wxmlPath = path.join(directory, `${pageName}.wxml`)
    const jsPath = path.join(directory, `${pageName}.js`)
    const wxml = fs.readFileSync(wxmlPath, 'utf8')
    const js = fs.readFileSync(jsPath, 'utf8')
    assertWxmlBalanced(wxmlPath)
    Array.from(wxml.matchAll(/(?:bind|catch)(?:tap|input|change)="([A-Za-z_$][\w$]*)"/g))
      .map((match) => match[1])
      .forEach((handler) => {
        assert.ok(new RegExp(`\\b${handler}\\s*\\(`).test(js), `${pagePath}: missing ${handler}`)
      })
  })

  ;(app.tabBar && app.tabBar.list ? app.tabBar.list : []).forEach((item) => {
    ;['iconPath', 'selectedIconPath'].forEach((field) => {
      assert.ok(fs.existsSync(path.join(runtimeRoot, item[field])), `missing ${item[field]}`)
    })
  })

  const runtimeFiles = walkFiles(runtimeRoot, '.js')
  runtimeFiles.forEach((filePath) => {
    childProcess.execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' })
    const source = fs.readFileSync(filePath, 'utf8')
    Array.from(source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)).forEach((match) => {
      const request = match[1]
      if (!request.startsWith('.')) return
      const unresolved = path.resolve(path.dirname(filePath), request)
      const candidates = path.extname(unresolved)
        ? [unresolved]
        : [`${unresolved}.js`, `${unresolved}.json`]
      assert.ok(candidates.some((candidate) => fs.existsSync(candidate)), `unresolved ${request}`)
    })
  })
  const runtimeText = runtimeFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n')
  assert.doesNotMatch(runtimeText, /wx\.cloud|cloudfunctions|wx\.request\s*\(/)
})

test('device module registry and profile preserve the BLE contract', () => {
  assert.strictEqual(definition.id, 'coco')
  assert.strictEqual(profile.id, 'captured-ff60-device')
  assert.strictEqual(definition.pages.control, '/pages/control/control')
  assert.strictEqual(
    devices.matchDevice({ name: 'COCO', advertisServiceUUIDs: profile.match.advertisedServiceUUIDs }),
    definition
  )
  assert.deepStrictEqual(devices.getScanOptions().services, profile.match.advertisedServiceUUIDs)
  assert.strictEqual(profile.gatt.writeCharacteristicUUID, '0000FF61-0000-1000-8000-00805F9B34FB')
  assert.strictEqual(profile.gatt.notifyCharacteristicUUID, '0000FF62-0000-1000-8000-00805F9B34FB')
  assert.strictEqual(profile.transport.requestedMtu, 23)
  assert.strictEqual(profile.transport.writeType, 'writeNoResponse')
  assert.strictEqual(profile.control.stopHex, 'C3 7E 25 62 63')
})

test('BLE manager scans, connects, subscribes, chunks, and disconnects', async () => {
  const calls = { writes: [], notifications: [], discoveries: [], listeners: {} }
  const succeed = (result) => (options) => options.success(result || {})
  global.wx = {
    onBluetoothAdapterStateChange(listener) { calls.listeners.adapter = listener },
    onBluetoothDeviceFound(listener) { calls.listeners.device = listener },
    onBLEConnectionStateChange(listener) { calls.listeners.connection = listener },
    onBLECharacteristicValueChange(listener) { calls.listeners.value = listener },
    openBluetoothAdapter(options) {
      options.fail({ errMsg: 'openBluetoothAdapter:fail already opened' })
    },
    getBluetoothAdapterState: succeed({ available: true, discovering: false }),
    startBluetoothDevicesDiscovery(options) {
      calls.discoveries.push(Object.assign({}, options))
      options.success({})
    },
    stopBluetoothDevicesDiscovery: succeed({}),
    createBLEConnection: succeed({}),
    closeBLEConnection: succeed({}),
    setBLEMTU: succeed({ mtu: 64 }),
    getBLEDeviceServices(options) {
      options.success({
        services: [
          { uuid: profile.gatt.writeServiceUUID, isPrimary: true }
        ]
      })
    },
    getBLEDeviceCharacteristics(options) {
      if (options.serviceId === profile.gatt.writeServiceUUID) {
        options.success({ characteristics: [
          {
            uuid: profile.gatt.writeCharacteristicUUID,
            properties: { writeNoResponse: true }
          },
          {
            uuid: profile.gatt.notifyCharacteristicUUID,
            properties: { notify: true }
          }
        ] })
        return
      }
      options.success({ characteristics: [] })
    },
    notifyBLECharacteristicValueChange(options) {
      calls.notifications.push(options)
      options.success({})
    },
    writeBLECharacteristicValue(options) {
      calls.writes.push({
        serviceId: options.serviceId,
        characteristicId: options.characteristicId,
        writeType: options.writeType,
        length: options.value.byteLength
      })
      options.success({})
    }
  }

  try {
    const { BleManager } = require(path.join(root, 'miniprogram/core/bluetooth'))
    const manager = new BleManager()
    await manager.startScan(devices.getScanOptions())
    assert.deepStrictEqual(calls.discoveries[0].services, profile.match.advertisedServiceUUIDs)
    await manager.stopScan()
    await manager.startScan({ allDevices: true })
    assert.strictEqual(Object.prototype.hasOwnProperty.call(calls.discoveries[1], 'services'), false)
    const snapshot = await manager.connect(
      { deviceId: 'SYNTHETIC-DEVICE', name: 'Synthetic' },
      { profile }
    )
    assert.strictEqual(snapshot.profileId, profile.id)
    const controller = definition.createController({ ble: manager, definition })
    await controller.initialize(snapshot)
    assert.strictEqual(controller.isCompatible(snapshot), true)
    assert.strictEqual(manager.active.writeServiceId, profile.gatt.writeServiceUUID)
    assert.strictEqual(manager.active.notifyServiceId, profile.gatt.notifyServiceUUID)
    assert.strictEqual(calls.notifications.length, 1)
    await manager.write(new Uint8Array(45).buffer)
    assert.deepStrictEqual(calls.writes.map((write) => write.length), [20, 20, 5])
    assert.ok(calls.writes.every((write) => write.writeType === 'writeNoResponse'))
    await manager.disconnect()
    assert.strictEqual(manager.connected, false)
  } finally {
    delete global.wx
  }
})

test('built-in frequency replays completely and stops immediately', async () => {
  const program = validateProgram(schema.makeRunnableFrequency(builtIn, profile))
  assert.strictEqual(program.frames.length, 196)
  assert.strictEqual(program.durationMs, 59503)
  assert.strictEqual(program.frames[program.frames.length - 1].hex, profile.control.stopHex)
  assert.strictEqual(schema.scheduleSha256(program.frames), builtIn.integrity.scheduleSha256)

  let now = 0
  let nextTimerId = 0
  const liveTimers = new Set()
  const writes = []
  const runner = new ProgramRunner({
    now: () => now,
    setTimer(callback, delay) {
      const id = ++nextTimerId
      liveTimers.add(id)
      Promise.resolve().then(() => {
        if (!liveTimers.has(id)) return
        liveTimers.delete(id)
        now += delay
        callback()
      })
      return id
    },
    clearTimer(id) { liveTimers.delete(id) },
    send(hex) { writes.push(hex) }
  })
  const result = await runner.start(program)
  assert.strictEqual(result.status, 'completed')
  assert.strictEqual(now, program.durationMs)
  assert.deepStrictEqual(writes, program.frames.map((frame) => frame.hex))

  let pendingTimer = null
  const stoppedWrites = []
  const stopRunner = new ProgramRunner({
    now: () => 0,
    setTimer(callback) {
      pendingTimer = callback
      return 1
    },
    clearTimer() {},
    send(hex) { stoppedWrites.push(hex) }
  })
  const stopPromise = stopRunner.start({
    id: 'synthetic-stop',
    label: 'Synthetic stop',
    durationMs: 1000,
    stopHex: profile.control.stopHex,
    frames: [
      { atMs: 0, hex: 'C3 7C 25 63 6E' },
      { atMs: 1000, hex: 'C3 7C 25 60 6F' }
    ]
  })
  await new Promise((resolve) => setImmediate(resolve))
  await stopRunner.stop(profile.control.stopHex)
  assert.strictEqual((await stopPromise).status, 'stopped')
  pendingTimer()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepStrictEqual(stoppedWrites, ['C3 7C 25 63 6E', profile.control.stopHex])
})

test('frequency schema and local store reject corruption and preserve exports', () => {
  assert.strictEqual(
    sha256('abc'),
    'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'
  )
  const checked = schema.normalizeFrequency(builtIn, { profile })
  const tampered = clone(builtIn)
  tampered.frames[0].hex = 'C3 7C 25 63 6F'
  assert.throws(() => schema.normalizeFrequency(tampered, { profile }), /完整性校验失败/)

  const memory = {}
  const store = new FrequencyStore({
    storage: {
      get(key) { return memory[key] },
      set(key, value) { memory[key] = clone(value) }
    }
  })
  assert.strictEqual(store.list().length, 1)
  const imported = clone(checked)
  imported.id = 'synthetic-import'
  imported.name = 'Synthetic import'
  imported.frames[0].hex = 'C3 7C 25 63 60'
  delete imported.integrity
  store.importFrequency(imported, profile.id)
  assert.strictEqual(memory[STORAGE_KEY].length, 1)
  const exported = JSON.parse(store.exportJson(imported.id, profile.id))
  assert.strictEqual(schema.scheduleSha256(exported.frames), exported.integrity.scheduleSha256)
  assert.throws(() => store.importJson(JSON.stringify(exported)), /相同频率已存在/)
})

test('frequency view produces bounded waveform and time progress', () => {
  const bars = view.waveformBars(builtIn, 32)
  const progress = view.runtimeProgress({
    status: 'running',
    programId: builtIn.id,
    elapsedMs: builtIn.durationMs / 2,
    durationMs: builtIn.durationMs
  }, builtIn.id)
  assert.strictEqual(bars.length, 32)
  assert.ok(bars.every((bar) => bar.height >= 22 && bar.height <= 96))
  assert.strictEqual(progress.width, '50%')
})

test('COCO local tool accepts a synthetic TSV without persistent output', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'haohao-synthetic-test-'))
  const inputPath = path.join(temporary, 'synthetic.tsv')
  const outputPath = path.join(temporary, 'synthetic.haohao-frequency.json')
  const input = [
    'frame.number|frame.time_epoch|packetlogger.type|btatt.opcode|btatt.handle|btatt.value',
    '10|1000.000|0x02|0x52|0x000e|c37c25636e',
    '11|1000.100|0x02|0x52|0x000e|c37d25636d',
    '12|1000.200|0x02|0x52|0x000e|c37e256263'
  ].join('\n') + '\n'
  try {
    fs.writeFileSync(inputPath, input, 'utf8')
    childProcess.execFileSync('python', [
      path.join(root, 'tools/coco/extract-frequency.py'),
      inputPath,
      '--start-frame', '10',
      '--stop-frame', '12',
      '--id', 'synthetic-frequency',
      '--name', 'Synthetic frequency',
      '--output', outputPath
    ], { encoding: 'utf8' })
    const generated = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    const normalized = schema.normalizeFrequency(generated, { profile })
    assert.ok(!Object.prototype.hasOwnProperty.call(generated, 'source'))
    assert.ok(generated.frames.every((frame) => !Object.prototype.hasOwnProperty.call(frame, 'sourceFrame')))
    assert.strictEqual(normalized.frames.length, 3)
    assert.strictEqual(normalized.durationMs, 200)
    assert.strictEqual(normalized.frames[normalized.frames.length - 1].hex, profile.control.stopHex)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

async function main() {
  let passed = 0
  for (const current of tests) {
    try {
      await current.run()
      passed += 1
      process.stdout.write(`PASS ${current.name}\n`)
    } catch (error) {
      process.stderr.write(`FAIL ${current.name}\n${error.stack}\n`)
      process.exit(1)
    }
  }
  process.stdout.write(`RESULT ${passed} core tests passed\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exit(1)
})
