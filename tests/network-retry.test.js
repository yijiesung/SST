const assert = require('assert')

async function verifyModule(modulePath) {
  const network = require(modulePath)
  let attempts = 0
  const result = await network.withRetry(() => {
    attempts += 1
    if (attempts < 3) return Promise.reject(new Error('connect EADDRNOTAVAIL'))
    return Promise.resolve('connected')
  }, [0, 0])

  assert.strictEqual(result, 'connected')
  assert.strictEqual(attempts, 3)

  let downloadOptions
  global.wx = {
    downloadFile(options) {
      downloadOptions = options
      options.success({ statusCode: 200, tempFilePath: '/tmp/resource' })
    },
    getImageInfo(options) {
      options.success({ path: '/tmp/image' })
    }
  }

  const response = await network.downloadFile('https://cdn.example.com/audio.wav')
  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(downloadOptions.url, 'https://cdn.example.com/audio.wav')
  assert.strictEqual(Object.prototype.hasOwnProperty.call(downloadOptions, 'localAddress'), false)
}

Promise.resolve()
  .then(() => verifyModule('../miniprogram/packages/sst/common/network.js'))
  .then(() => verifyModule('../miniprogram/packages/attention/common/network.js'))
  .then(() => console.log('network retry tests: PASS'))
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
