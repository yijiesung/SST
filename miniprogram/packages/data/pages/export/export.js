function csvCell(value) {
  if (value == null) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function unionColumns(records) {
  const columns = []
  const seen = new Set()
  records.forEach(record => Object.keys(record).forEach(key => {
    if (!seen.has(key)) {
      seen.add(key)
      columns.push(key)
    }
  }))
  return columns
}

Page({
  data: { participantId: '', trialCount: 0, summaryCount: 0 },

  onLoad(options) {
    this.participantId = decodeURIComponent(options.participant || 'anonymous')
    this.refresh()
  },

  refresh() {
    const prefix = `trial_records:${this.participantId}:`
    this.trials = wx.getStorageInfoSync().keys
      .filter(key => key.startsWith(prefix))
      .sort()
      .flatMap(key => wx.getStorageSync(key) || [])
    this.summaries = wx.getStorageSync(`summary_records:${this.participantId}`) || []
    this.setData({ participantId: this.participantId, trialCount: this.trials.length, summaryCount: this.summaries.length })
  },

  exportJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      participantId: this.participantId,
      trialRecords: this.trials,
      summaries: this.summaries
    }
    this.writeAndShare(`training-${this.participantId}.json`, JSON.stringify(payload, null, 2), 'utf8')
  },

  exportCsv() {
    const records = this.trials
    if (!records.length) {
      wx.showToast({ title: '暂无试次数据', icon: 'none' })
      return
    }
    const columns = unionColumns(records)
    const rows = [columns.map(csvCell).join(',')]
    records.forEach(record => rows.push(columns.map(column => csvCell(record[column])).join(',')))
    this.writeAndShare(`trials-${this.participantId}.csv`, `\uFEFF${rows.join('\r\n')}`, 'utf8')
  },

  writeAndShare(fileName, data, encoding) {
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      encoding,
      success: () => {
        if (wx.shareFileMessage) wx.shareFileMessage({ filePath, fileName })
        else wx.showModal({ title: '文件已生成', content: filePath, showCancel: false })
      },
      fail: error => wx.showModal({ title: '导出失败', content: error.errMsg || String(error), showCancel: false })
    })
  }
})
