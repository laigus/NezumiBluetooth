/** COCO 的设备识别、GATT 与传输约定。 */
module.exports = {
  id: 'captured-ff60-device',
  displayName: '耗耗蓝牙设备',

  match: {
    namePrefixes: ['COCO'],
    advertisedServiceUUIDs: ['0000FF60-0000-1000-8000-00805F9B34FB']
  },

  gatt: {
    writeServiceUUID: '0000FF60-0000-1000-8000-00805F9B34FB',
    writeCharacteristicUUID: '0000FF61-0000-1000-8000-00805F9B34FB',
    notifyServiceUUID: '0000FF60-0000-1000-8000-00805F9B34FB',
    notifyCharacteristicUUID: '0000FF62-0000-1000-8000-00805F9B34FB',
    readServiceUUID: '',
    readCharacteristicUUID: ''
  },

  transport: {
    requestedMtu: 23,
    chunkSize: 20,
    interChunkDelayMs: 30,
    writeType: 'writeNoResponse'
  },

  control: {
    stopHex: 'C3 7E 25 62 63'
  },

  commands: []
}
