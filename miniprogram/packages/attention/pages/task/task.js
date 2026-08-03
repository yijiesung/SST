const { monoNow, wallTime } = require('../../common/clock')
const { buildBlock, createTracker, updateTracker, summary } = require('../../common/engine')
const cdn = require('../../common/cdn')
const storage = require('../../common/storage')

const FORMAL_BLOCKS = 6
const PROBE_LIMIT_MS = 1000
const FEEDBACK_MS = 300
const BLANK_MS = 500

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src: url, success: info => resolve([url, info.path]), fail: reject })
  })
}

Page({
  data: {
    mode: 'practice',
    phase: 'loading',
    loadingText: '正在预加载本组刺激材料…',
    leftImage: '',
    rightImage: '',
    probeSide: 'left',
    result: '',
    interrupted: false,
    errorMessage: ''
  },

  onLoad(options) {
    this.mode = options.mode === 'training' ? 'training' : 'practice'
    this.day = Number(options.day || 2)
    this.participantId = decodeURIComponent(options.participant || 'anonymous')
    this.taskId = options.taskId || `attention-${this.mode}`
    this.blockNo = 1
    this.trialIndex = 0
    this.timers = []
    this.localImages = {}
    this.currentBlockRecords = []
    this.tracker = createTracker()
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.windowWidth = windowInfo.windowWidth
    this.windowHeight = windowInfo.windowHeight
    this.visualProbeRadiusPx = (44 / 750 * this.windowWidth) / 2
    this.hitRadiusPx = this.visualProbeRadiusPx * 1.15
    this.setData({ mode: this.mode })

    if (!cdn.configured) {
      this.setData({
        phase: 'error',
        errorMessage: '请先运行 scripts/upload_cdn.py 上传素材，并将生成的 CDN_BASE_URL 写入分包内 common/cdn.js。'
      })
      return
    }
    this.restoreOrStart()
  },

  onHide() {
    if (['fixation', 'pair', 'probe', 'feedback', 'blank'].includes(this.data.phase)) this.pauseForInterruption('app_hidden')
  },

  onUnload() { this.clearTimers() },
  blockMove() {},
  noop() {},

  later(fn, delay) {
    const id = setTimeout(fn, delay)
    this.timers.push(id)
    return id
  },

  clearTimers() {
    this.timers.forEach(id => clearTimeout(id))
    this.timers = []
  },

  restoreOrStart() {
    const checkpoint = storage.loadCheckpoint(this.participantId, this.day, this.taskId)
    if (checkpoint && checkpoint.mode === this.mode && !checkpoint.completed) {
      this.blockNo = checkpoint.blockNo
      this.trialIndex = checkpoint.trialIndex
      this.tracker = createTracker(checkpoint.tracker)
    }
    this.loadBlock()
  },

  loadBlock() {
    const built = buildBlock({
      mode: this.mode,
      blockNo: this.blockNo,
      participantId: this.participantId,
      day: this.day,
      gameCount: cdn.gameImages.length,
      neutralCount: cdn.neutralImages.length
    })
    this.blockSeed = built.seed
    this.trials = built.trials
    this.currentBlockRecords = storage.getBlockRecords(this.participantId, this.day, 'attention', this.mode, this.blockNo)
    this.blockStartedWall = wallTime()
    const urls = [...new Set(this.trials.flatMap(trial => [cdn.gameImages[trial.gameIndex], cdn.neutralImages[trial.neutralIndex]]))]
    this.setData({ phase: 'loading', loadingText: `正在预加载第 ${this.blockNo} 组刺激材料…` })
    this.preloadInBatches(urls, 8).then(() => {
      if (this.trialIndex >= this.trials.length) {
        this.finishBlock()
        return
      }
      this.setData({ phase: 'ready', interrupted: false })
    }).catch(error => {
      const message = error && error.errMsg ? error.errMsg : String(error)
      this.setData({ phase: 'error', errorMessage: `图片预加载失败：${message}` })
    })
  },

  async preloadInBatches(urls, batchSize) {
    for (let i = 0; i < urls.length; i += batchSize) {
      const entries = await Promise.all(urls.slice(i, i + batchSize).map(preloadImage))
      entries.forEach(([url, path]) => { this.localImages[url] = path })
    }
  },

  startTask() {
    if (this.data.phase !== 'ready') return
    this.startTrial()
  },

  startNextBlock() {
    if (this.data.phase !== 'break') return
    this.blockNo += 1
    this.trialIndex = 0
    this.loadBlock()
  },

  startTrial() {
    const trial = this.trials[this.trialIndex]
    if (!trial) return
    this.clearTimers()
    this.runtime = {
      trial,
      events: [],
      pairDuration: this.mode === 'practice' ? 500 : this.tracker.duration,
      fixationAt: monoNow(),
      firstClickAt: null,
      firstClick: null
    }
    this.logEvent('fixation_onset', { plannedMs: trial.prepMs })
    this.setData({ phase: 'fixation', leftImage: '', rightImage: '', result: '', interrupted: false })
    this.later(() => this.showPair(), trial.prepMs)
  },

  showPair() {
    const runtime = this.runtime
    const trial = runtime.trial
    const game = this.localImages[cdn.gameImages[trial.gameIndex]]
    const neutral = this.localImages[cdn.neutralImages[trial.neutralIndex]]
    runtime.pairAt = monoNow()
    this.logEvent('pair_onset', { duration: runtime.pairDuration, neutralSide: trial.neutralSide })
    this.setData({
      phase: 'pair',
      leftImage: trial.neutralSide === 'left' ? neutral : game,
      rightImage: trial.neutralSide === 'right' ? neutral : game
    })
    this.later(() => this.showProbe(), runtime.pairDuration)
  },

  showProbe() {
    this.runtime.probeAt = monoNow()
    this.logEvent('probe_onset', { side: this.runtime.trial.probeSide })
    this.setData({ phase: 'probe', leftImage: '', rightImage: '', probeSide: this.runtime.trial.probeSide })
    this.later(() => this.finishTrial('timeout'), PROBE_LIMIT_MS)
  },

  onStageTouchStart(event) {
    if (this.data.phase !== 'probe' || !this.runtime || this.runtime.firstClickAt != null) return
    const touch = event.touches && event.touches[0]
    if (!touch) return
    const at = monoNow()
    const targetX = this.runtime.trial.probeSide === 'left' ? this.windowWidth * 0.25 : this.windowWidth * 0.75
    const targetY = this.windowHeight * 0.45
    const distance = Math.hypot(touch.clientX - targetX, touch.clientY - targetY)
    this.runtime.firstClickAt = at
    this.runtime.firstClick = { x: touch.clientX, y: touch.clientY, distance }
    this.logEvent('stage_touchstart', { rt: at - this.runtime.probeAt, coordinate: this.runtime.firstClick })
    this.finishTrial(distance <= this.hitRadiusPx ? 'correct' : 'error')
  },

  logEvent(type, details) {
    if (!this.runtime) return
    this.runtime.events.push({ type, mono: monoNow(), details: details || {} })
  },

  finishTrial(result) {
    if (!this.runtime || this.runtime.finished) return
    this.clearTimers()
    const runtime = this.runtime
    runtime.finished = true
    const trial = runtime.trial
    const record = {
      schemaVersion: 1,
      task: 'attention',
      participantId: this.participantId,
      date: new Date().toISOString(),
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      blockSeed: this.blockSeed,
      trialNo: trial.index,
      plannedFixationMs: trial.prepMs,
      actualFixationMs: runtime.pairAt - runtime.fixationAt,
      pairDuration: runtime.pairDuration,
      neutralSide: trial.neutralSide,
      gameSide: trial.gameSide,
      probeSide: trial.probeSide,
      probeGameRelation: 'opposite',
      neutralImageIndex: trial.neutralIndex,
      gameImageIndex: trial.gameIndex,
      reactionTime: runtime.firstClickAt ? runtime.firstClickAt - runtime.probeAt : null,
      clickCoordinate: runtime.firstClick,
      toleranceRadiusPx: this.hitRadiusPx,
      result,
      invalidTrial: false,
      events: runtime.events
    }
    storage.appendRecord(this.participantId, record)
    this.currentBlockRecords.push(record)
    if (this.mode === 'training') this.tracker = updateTracker(this.tracker, result === 'correct')
    this.trialIndex += 1
    storage.saveCheckpoint(this.participantId, this.day, this.taskId, {
      mode: this.mode,
      blockNo: this.blockNo,
      trialIndex: this.trialIndex,
      tracker: this.tracker,
      completed: false
    })
    this.pendingBlockEnd = this.trialIndex >= this.trials.length
    this.setData({ phase: 'feedback', result, probeSide: trial.probeSide })
    this.later(() => {
      this.setData({ phase: 'blank', result: '' })
      this.later(() => this.afterBlank(), BLANK_MS)
    }, FEEDBACK_MS)
  },

  afterBlank() {
    if (this.pendingBlockEnd) {
      this.finishBlock()
      return
    }
    this.startTrial()
  },

  finishBlock() {
    storage.appendSummary(this.participantId, summary(this.currentBlockRecords, {
      schemaVersion: 1,
      task: 'attention',
      participantId: this.participantId,
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      blockStartTime: new Date(this.blockStartedWall).toISOString(),
      blockEndTime: new Date().toISOString(),
      startDuration: this.currentBlockRecords.length ? this.currentBlockRecords[0].pairDuration : null,
      endDuration: this.mode === 'training' ? this.tracker.duration : 500,
      currentStep: this.mode === 'training' ? this.tracker.step : null,
      reversalCount: this.mode === 'training' ? this.tracker.reversals : 0
    }))
    const totalBlocks = this.mode === 'practice' ? 1 : FORMAL_BLOCKS
    if (this.blockNo >= totalBlocks) {
      if (this.mode === 'training') {
        const dailyRecords = storage.getTaskRecords(this.participantId, this.day, 'attention', this.mode)
        storage.appendSummary(this.participantId, summary(dailyRecords, {
          schemaVersion: 1,
          task: 'attention_daily',
          participantId: this.participantId,
          day: this.day,
          paradigm: this.mode,
          blockNo: 'daily',
          completed: dailyRecords.length === 300,
          taskStartTime: dailyRecords.length ? dailyRecords[0].date : null,
          taskEndTime: new Date().toISOString(),
          startDuration: dailyRecords.length ? dailyRecords[0].pairDuration : null,
          endDuration: this.tracker.duration,
          currentStep: this.tracker.step,
          reversalCount: this.tracker.reversals
        }))
      }
      storage.completeTask(this.participantId, this.day, this.taskId)
      this.setData({ phase: 'complete' })
    } else {
      storage.saveCheckpoint(this.participantId, this.day, this.taskId, {
        mode: this.mode,
        blockNo: this.blockNo + 1,
        trialIndex: 0,
        tracker: this.tracker,
        completed: false
      })
      this.setData({ phase: 'break' })
    }
  },

  pauseForInterruption(reason) {
    this.clearTimers()
    storage.appendRecord(this.participantId, {
      schemaVersion: 1,
      task: 'attention_event',
      participantId: this.participantId,
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      trialNo: this.runtime && this.runtime.trial ? this.runtime.trial.index : null,
      event: 'interruption',
      reason,
      wallTime: wallTime()
    })
    this.runtime = null
    this.setData({ phase: 'ready', leftImage: '', rightImage: '', result: '', interrupted: true })
  },

  returnHome() { wx.navigateBack({ delta: 1 }) }
})
