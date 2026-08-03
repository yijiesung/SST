const DAY_MS = 24 * 60 * 60 * 1000

function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dayNumber(startDate) {
  const start = new Date(`${startDate}T00:00:00`)
  const today = new Date()
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(1, Math.min(14, Math.floor((localToday.getTime() - start.getTime()) / DAY_MS) + 1))
}

function taskPlan(day) {
  if (day === 1) {
    return [
      { id: 'sst-practice', name: '控制力训练 · 操作指导', note: '32 个练习试次', path: '/packages/sst/pages/task/task?mode=practice' },
      { id: 'sst-measure', name: '控制力训练 · 正式测量', note: '3 组，共 216 个试次', path: '/packages/sst/pages/task/task?mode=measure' }
    ]
  }
  if (day === 14) {
    return [{ id: 'sst-measure', name: '控制力训练 · 正式测量', note: '3 组，共 216 个试次', path: '/packages/sst/pages/task/task?mode=measure' }]
  }
  const tasks = [
    { id: 'sst-intervention', name: '控制力训练', note: '3 组，共 180 个试次', path: '/packages/sst/pages/task/task?mode=intervention' }
  ]
  if (day === 2) {
    tasks.push({ id: 'attention-practice', name: '注意力训练 · 操作指导', note: '20 个练习试次', path: '/packages/attention/pages/task/task?mode=practice' })
  }
  tasks.push({ id: 'attention-training', name: '注意力训练', note: '6 组，共 300 个试次', path: '/packages/attention/pages/task/task?mode=training' })
  return tasks
}

Page({
  data: {
    enrolled: false,
    participantInput: '',
    participantId: '',
    day: 1,
    title: '欢迎来到大脑训练营，第 1 天！',
    tasks: [],
    completedCount: 0,
    nextIndex: 0,
    dayComplete: false
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const profile = wx.getStorageSync('training_profile')
    if (!profile || !profile.participantId || !profile.startDate) {
      this.setData({ enrolled: false })
      return
    }
    const day = dayNumber(profile.startDate)
    const key = `day_progress:${profile.participantId}:${day}`
    const progress = wx.getStorageSync(key) || { completed: [] }
    const tasks = taskPlan(day).map(item => ({ ...item, done: progress.completed.includes(item.id) }))
    const nextIndex = tasks.findIndex(item => !item.done)
    const completedCount = tasks.filter(item => item.done).length
    this.setData({
      enrolled: true,
      participantId: profile.participantId,
      day,
      title: day === 14 ? '大脑训练营，第 14 天！' : `欢迎来到大脑训练营，第 ${day} 天！`,
      tasks,
      completedCount,
      nextIndex: nextIndex < 0 ? tasks.length : nextIndex,
      dayComplete: nextIndex < 0
    })
  },

  onParticipantInput(event) {
    this.setData({ participantInput: event.detail.value.trim() })
  },

  startEnrollment() {
    const participantId = this.data.participantInput.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!participantId) {
      wx.showToast({ title: '请填写有效编号', icon: 'none' })
      return
    }
    wx.setStorageSync('training_profile', { participantId, startDate: localDateKey(new Date()) })
    this.refresh()
  },

  startNextTask() {
    const task = this.data.tasks[this.data.nextIndex]
    if (!task) return
    wx.navigateTo({ url: `${task.path}&day=${this.data.day}&participant=${encodeURIComponent(this.data.participantId)}&taskId=${task.id}` })
  },

  openExport() {
    wx.navigateTo({ url: `/packages/data/pages/export/export?participant=${encodeURIComponent(this.data.participantId)}` })
  }
})

