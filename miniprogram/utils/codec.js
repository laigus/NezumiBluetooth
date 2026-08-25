function cleanHex(input) {
  return String(input || '')
    .replace(/0x/gi, '')
    .replace(/[\s,;:_-]/g, '')
    .toUpperCase()
}

function validateHex(input) {
  const hex = cleanHex(input)
  if (!hex) {
    throw new Error('请输入十六进制数据')
  }
  if (!/^[0-9A-F]+$/.test(hex)) {
    throw new Error('十六进制数据包含无效字符')
  }
  if (hex.length % 2 !== 0) {
    throw new Error('十六进制数据必须由完整字节组成')
  }
  return hex
}

function hexToArrayBuffer(input) {
  const hex = validateHex(input)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes.buffer
}

function arrayBufferToHex(buffer, separator = ' ') {
  if (!buffer) return ''
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(separator)
}

function textToArrayBuffer(text) {
  const source = String(text || '')
  const bytes = []
  for (let i = 0; i < source.length; i += 1) {
    let codePoint = source.codePointAt(i)
    if (codePoint > 0xffff) i += 1

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6))
      bytes.push(0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12))
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
      bytes.push(0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(0xf0 | (codePoint >> 18))
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f))
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
      bytes.push(0x80 | (codePoint & 0x3f))
    }
  }
  return new Uint8Array(bytes).buffer
}

function arrayBufferToText(buffer) {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let output = ''
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i]
    let codePoint
    let size
    if (first < 0x80) {
      codePoint = first
      size = 1
    } else if ((first & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      codePoint = ((first & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
      size = 2
    } else if ((first & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      codePoint = ((first & 0x0f) << 12) |
        ((bytes[i + 1] & 0x3f) << 6) |
        (bytes[i + 2] & 0x3f)
      size = 3
    } else if ((first & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      codePoint = ((first & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f)
      size = 4
    } else {
      codePoint = 0xfffd
      size = 1
    }
    output += String.fromCodePoint(codePoint)
    i += size
  }
  return output
}

function sliceBuffer(buffer, start, end) {
  const bytes = new Uint8Array(buffer)
  return bytes.slice(start, end).buffer
}

module.exports = {
  cleanHex,
  validateHex,
  hexToArrayBuffer,
  arrayBufferToHex,
  textToArrayBuffer,
  arrayBufferToText,
  sliceBuffer
}
