function monoNow() {
  if (typeof wx !== 'undefined' && wx.getPerformance) return wx.getPerformance().now()
  if (typeof performance !== 'undefined' && performance.now) return performance.now()
  throw new Error('当前基础库不支持高精度计时，请升级微信')
}

function wallTime() {
  return new Date().getTime()
}

module.exports = { monoNow, wallTime }

