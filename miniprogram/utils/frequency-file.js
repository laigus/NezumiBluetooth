function readFileText(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: (result) => resolve(result.data),
      fail: reject
    })
  })
}

function writeFileText(filePath, data) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      encoding: 'utf8',
      success: resolve,
      fail: reject
    })
  })
}

function chooseFrequencyFile() {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (result) => resolve(result.tempFiles && result.tempFiles[0] || null),
      fail: (error) => {
        if (String(error && error.errMsg).includes('cancel')) resolve(null)
        else reject(error)
      }
    })
  })
}

function copyFrequencyText(text) {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: () => resolve({ mode: 'clipboard' }),
      fail: reject
    })
  })
}

async function shareFrequencyFile(id, text) {
  const fileName = `${id}.haohao-frequency.json`
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
  await writeFileText(filePath, text)

  if (typeof wx.shareFileMessage !== 'function') return copyFrequencyText(text)
  return new Promise((resolve, reject) => {
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => resolve({ mode: 'share', filePath }),
      fail: (error) => {
        if (String(error && error.errMsg).includes('cancel')) {
          resolve({ mode: 'cancelled', filePath })
          return
        }
        copyFrequencyText(text).then(resolve, reject)
      }
    })
  })
}

module.exports = {
  readFileText,
  chooseFrequencyFile,
  shareFrequencyFile
}
