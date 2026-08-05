const RETRY_DELAYS_MS = [500, 1200]

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry(operation, delays = RETRY_DELAYS_MS) {
  let lastError
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === delays.length) break
      await wait(delays[attempt])
    }
  }
  throw lastError
}

function downloadFile(url) {
  return withRetry(() => new Promise((resolve, reject) => {
    wx.downloadFile({ url, success: resolve, fail: reject })
  }))
}

function getImageInfo(url) {
  return withRetry(() => new Promise((resolve, reject) => {
    wx.getImageInfo({ src: url, success: resolve, fail: reject })
  }))
}

module.exports = { withRetry, downloadFile, getImageInfo }
