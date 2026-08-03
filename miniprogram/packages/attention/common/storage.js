function appendRecord(participantId, record) {
  const key = `trial_records:${participantId}:${record.day}:${record.task}:${record.paradigm || 'event'}:${record.blockNo || 0}`
  const records = wx.getStorageSync(key) || []
  records.push(record)
  wx.setStorageSync(key, records)
}

function getBlockRecords(participantId, day, task, paradigm, blockNo) {
  return wx.getStorageSync(`trial_records:${participantId}:${day}:${task}:${paradigm}:${blockNo}`) || []
}

function getTaskRecords(participantId, day, task, paradigm) {
  const prefix = `trial_records:${participantId}:${day}:${task}:${paradigm}:`
  return wx.getStorageInfoSync().keys
    .filter(key => key.startsWith(prefix))
    .sort()
    .flatMap(key => wx.getStorageSync(key) || [])
}

function appendSummary(participantId, summary) {
  const key = `summary_records:${participantId}`
  const records = wx.getStorageSync(key) || []
  records.push(summary)
  wx.setStorageSync(key, records)
}

function completeTask(participantId, day, taskId) {
  const key = `day_progress:${participantId}:${day}`
  const progress = wx.getStorageSync(key) || { completed: [] }
  if (!progress.completed.includes(taskId)) progress.completed.push(taskId)
  wx.setStorageSync(key, progress)
  wx.removeStorageSync(`checkpoint:${participantId}:${day}:${taskId}`)
}

function saveCheckpoint(participantId, day, taskId, value) {
  wx.setStorageSync(`checkpoint:${participantId}:${day}:${taskId}`, value)
}

function loadCheckpoint(participantId, day, taskId) {
  return wx.getStorageSync(`checkpoint:${participantId}:${day}:${taskId}`)
}

module.exports = { appendRecord, appendSummary, completeTask, saveCheckpoint, loadCheckpoint, getBlockRecords, getTaskRecords }
