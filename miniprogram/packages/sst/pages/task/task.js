const { monoNow, wallTime } = require('../../common/clock')
const { LIMITS, buildBlock, createTracker, updateTracker, estimatePse, summarizeBlock } = require('../../common/engine')
const cdn = require('../../common/cdn')
const storage = require('../../common/storage')

const STIMULUS_MS = 1000
const ITI_MS = 1500

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
    currentImage: '',
    stopSignal: false,
    isHolding: false,
    instruction: '请用手指按住下方的“起始键”。在上方出现图片前，请保持按住。',
    feedbackKind: '',
    feedbackText: '',
    interrupted: false,
    errorMessage: ''
  },

  onLoad(options) {
    this.mode = ['practice', 'measure', 'intervention'].includes(options.mode) ? options.mode : 'practice'
    this.day = Number(options.day || 1)
    this.participantId = decodeURIComponent(options.participant || 'anonymous')
    this.taskId = options.taskId || `sst-${this.mode}`
    this.timers = []
    this.localImages = {}
    this.blockNo = 1
    this.trialIndex = 0
    this.currentBlockRecords = []
    this.tracker = createTracker(this.mode)
    this.sessionStartWall = wallTime()
    this.setData({ mode: this.mode })

    if (!cdn.configured) {
      this.setData({
        phase: 'error',
        errorMessage: '请先运行 scripts/upload_cdn.py 上传素材，并将生成的 CDN_BASE_URL 写入分包内 common/cdn.js。'
      })
      return
    }
    this.initializeAudio().then(() => this.restoreOrStart()).catch(error => this.fail(error))
  },

  onHide() {
    if (['preparation', 'stimulus', 'iti'].includes(this.data.phase)) this.pauseForInterruption('app_hidden')
  },

  onUnload() {
    this.clearTimers()
    if (this.audioContext && this.audioContext.close) this.audioContext.close()
  },

  blockMove() {},

  clearTimers() {
    this.timers.forEach(id => clearTimeout(id))
    this.timers = []
  },

  later(fn, delay) {
    const id = setTimeout(fn, delay)
    this.timers.push(id)
    return id
  },

  fail(error) {
    const message = error && error.errMsg ? error.errMsg : String(error || '未知错误')
    this.setData({ phase: 'error', errorMessage: `资源预加载失败：${message}` })
  },

  initializeAudio() {
    return new Promise((resolve, reject) => {
      if (!wx.createWebAudioContext) {
        reject(new Error('当前微信基础库不支持 Web Audio API'))
        return
      }
      this.audioContext = wx.createWebAudioContext()
      wx.downloadFile({
        url: cdn.stopSound,
        success: response => {
          if (response.statusCode !== 200) {
            reject(new Error(`提示音下载失败：HTTP ${response.statusCode}`))
            return
          }
          wx.getFileSystemManager().readFile({
            filePath: response.tempFilePath,
            success: file => {
              this.audioContext.decodeAudioData(file.data, buffer => {
                this.stopBuffer = buffer
                resolve()
              }, reject)
            },
            fail: reject
          })
        },
        fail: reject
      })
    })
  },

  playStopSignal() {
    if (!this.audioContext || !this.stopBuffer) return
    const source = this.audioContext.createBufferSource()
    source.buffer = this.stopBuffer
    source.connect(this.audioContext.destination)
    source.start(0)
  },

  restoreOrStart() {
    const checkpoint = storage.loadCheckpoint(this.participantId, this.day, this.taskId)
    if (checkpoint && checkpoint.mode === this.mode && !checkpoint.completed) {
      this.blockNo = checkpoint.blockNo
      this.trialIndex = checkpoint.trialIndex
      this.tracker = checkpoint.tracker || createTracker(this.mode)
    }
    return this.loadBlock()
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
    this.currentBlockRecords = storage.getBlockRecords(this.participantId, this.day, 'sst', this.mode, this.blockNo)
    this.blockStartedWall = wallTime()
    const urls = [...new Set(this.trials.map(trial => trial.type === 'go' ? cdn.neutralImages[trial.imageIndex] : cdn.gameImages[trial.imageIndex]))]
    this.setData({ phase: 'loading', loadingText: `正在预加载第 ${this.blockNo} 组刺激材料…` })
    return this.preloadInBatches(urls, 8).then(() => {
      if (this.trialIndex >= this.trials.length) {
        this.finishBlock()
        return
      }
      this.setData({
        phase: 'ready',
        interrupted: false,
        instruction: '请用手指按住下方的“起始键”。在上方出现图片前，请保持按住。'
      })
    }).catch(error => this.fail(error))
  },

  async preloadInBatches(urls, batchSize) {
    for (let i = 0; i < urls.length; i += batchSize) {
      const entries = await Promise.all(urls.slice(i, i + batchSize).map(preloadImage))
      entries.forEach(([url, path]) => { this.localImages[url] = path })
    }
  },

  onStartTouchStart() {
    if (this.data.phase === 'break') {
      this.blockNo += 1
      this.trialIndex = 0
      this.loadBlock()
      return
    }
    if (this.audioContext && this.audioContext.resume) this.audioContext.resume()
    this.setData({ isHolding: true })
    if (this.data.phase === 'ready') this.startPreparation()
  },

  onStartTouchEnd() {
    const phase = this.data.phase
    this.setData({ isHolding: false })
    if (phase === 'preparation') {
      this.logEvent('start_release', { early: true })
      this.finishTrial('preparation_violation')
    } else if (phase === 'stimulus' && this.trialRuntime && this.trialRuntime.releaseAt == null) {
      const at = monoNow()
      this.trialRuntime.releaseAt = at
      this.logEvent('start_release', { rt: at - this.trialRuntime.stimulusAt })
    }
  },

  onStartTouchCancel() {
    this.onStartTouchEnd()
  },

  startPreparation() {
    const trial = this.trials[this.trialIndex]
    if (!trial) return
    this.clearTimers()
    this.trialRuntime = {
      trial,
      events: [],
      prepStartedAt: monoNow(),
      releaseAt: null,
      clickAt: null,
      click: null,
      stopSignalAt: null
    }
    this.logEvent('preparation_start', { plannedMs: trial.prepMs })
    this.setData({
      phase: 'preparation',
      stopSignal: false,
      currentImage: '',
      interrupted: false,
      instruction: '注视十字，并持续按住“起始键”。'
    })
    this.later(() => {
      if (!this.data.isHolding) {
        this.finishTrial('preparation_violation')
        return
      }
      this.showStimulus()
    }, trial.prepMs)
  },

  showStimulus() {
    const runtime = this.trialRuntime
    const trial = runtime.trial
    runtime.stimulusAt = monoNow()
    runtime.ssd = trial.type === 'stop' ? this.tracker.ssd : null
    const remoteUrl = trial.type === 'go' ? cdn.neutralImages[trial.imageIndex] : cdn.gameImages[trial.imageIndex]
    this.logEvent('stimulus_onset', { type: trial.type, ssd: runtime.ssd })
    this.setData({
      phase: 'stimulus',
      currentImage: this.localImages[remoteUrl],
      instruction: trial.type === 'go'
        ? '常规图片出现后，请以最快速度松开起始键并点击图片。'
        : '如果出现红框和提示音，请继续按住起始键，不要点击。'
    })
    if (trial.type === 'stop') {
      this.later(() => {
        runtime.stopSignalAt = monoNow()
        this.logEvent('stop_signal', { actualDelay: runtime.stopSignalAt - runtime.stimulusAt })
        this.setData({ stopSignal: true })
        this.playStopSignal()
      }, runtime.ssd)
    }
    this.later(() => this.evaluateTrial(), STIMULUS_MS)
  },

  onImageTouchStart(event) {
    if (this.data.phase !== 'stimulus' || !this.trialRuntime || this.trialRuntime.clickAt != null) return
    const touch = event.touches && event.touches[0]
    const at = monoNow()
    this.trialRuntime.clickAt = at
    this.trialRuntime.click = touch ? { x: touch.clientX, y: touch.clientY } : null
    this.logEvent('image_touchstart', { rt: at - this.trialRuntime.stimulusAt, coordinate: this.trialRuntime.click })
  },

  logEvent(type, details) {
    if (!this.trialRuntime) return
    this.trialRuntime.events.push({ type, mono: monoNow(), details: details || {} })
  },

  evaluateTrial() {
    const runtime = this.trialRuntime
    if (!runtime) return
    let result
    if (runtime.trial.type === 'go') {
      if (runtime.releaseAt == null) result = 'omission'
      else if (runtime.clickAt == null) result = 'release_only'
      else if (runtime.clickAt < runtime.releaseAt) result = 'invalid_click'
      else result = 'correct_go'
    } else if ((runtime.releaseAt != null && runtime.releaseAt - runtime.stimulusAt < runtime.ssd)
      || (runtime.clickAt != null && runtime.clickAt - runtime.stimulusAt < runtime.ssd)) {
      result = 'stop_before_signal'
    } else if (runtime.clickAt != null) {
      result = 'click_failure'
    } else if (runtime.releaseAt != null) {
      result = 'inhibition_failure'
    } else {
      result = 'successful_inhibition'
    }
    this.finishTrial(result)
  },

  finishTrial(result) {
    if (!this.trialRuntime || this.trialRuntime.finished) return
    this.clearTimers()
    const runtime = this.trialRuntime
    runtime.finished = true
    const endedAt = monoNow()
    const record = {
      schemaVersion: 1,
      task: 'sst',
      participantId: this.participantId,
      date: new Date().toISOString(),
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      blockSeed: this.blockSeed,
      trialNo: runtime.trial.index,
      attemptNo: this.currentBlockRecords.filter(item => item.trialNo === runtime.trial.index).length + 1,
      trialType: runtime.trial.type,
      imageCategory: runtime.trial.type === 'go' ? 'neutral' : 'game',
      imageIndex: runtime.trial.imageIndex,
      plannedPreparationMs: runtime.trial.prepMs,
      actualPreparationMs: runtime.stimulusAt ? runtime.stimulusAt - runtime.prepStartedAt : endedAt - runtime.prepStartedAt,
      ssd: runtime.ssd == null ? null : runtime.ssd,
      releaseRt: runtime.releaseAt && runtime.stimulusAt ? runtime.releaseAt - runtime.stimulusAt : null,
      clickRt: runtime.clickAt && runtime.stimulusAt ? runtime.clickAt - runtime.stimulusAt : null,
      clickCoordinate: runtime.click,
      result,
      invalidTrial: result === 'preparation_violation',
      events: runtime.events
    }
    storage.appendRecord(this.participantId, record)
    this.currentBlockRecords.push(record)
    const advanceTrial = result !== 'preparation_violation'
    if (runtime.trial.type === 'stop' && this.mode !== 'practice' && advanceTrial) {
      this.tracker = updateTracker(this.tracker, result === 'successful_inhibition')
    }
    if (advanceTrial) this.trialIndex += 1
    storage.saveCheckpoint(this.participantId, this.day, this.taskId, {
      mode: this.mode,
      blockNo: this.blockNo,
      trialIndex: this.trialIndex,
      tracker: this.tracker,
      completed: false
    })
    const isBlockEnd = this.trialIndex >= this.trials.length
    this.pendingBlockEnd = isBlockEnd
    this.setData({ stopSignal: false, currentImage: '', isHolding: false })
    if (this.mode === 'practice' || result === 'preparation_violation') {
      const feedback = this.feedbackFor(result)
      this.setData({ phase: 'feedback', feedbackKind: feedback.good ? 'good' : 'bad', feedbackText: feedback.text })
      this.later(() => this.startIti(), 500)
    } else {
      this.startIti()
    }
  },

  feedbackFor(result) {
    const messages = {
      correct_go: { good: true, text: '正确' },
      successful_inhibition: { good: true, text: '正确' },
      preparation_violation: { good: false, text: '图片出现前不要松开' },
      omission: { good: false, text: '请更快松开并点击图片' },
      release_only: { good: false, text: '松开后还需要点击图片' },
      invalid_click: { good: false, text: '请点击图片区域' },
      stop_before_signal: { good: false, text: '出现红框时请不要松手' },
      inhibition_failure: { good: false, text: '出现红框时请不要松手' },
      click_failure: { good: false, text: '出现红框时请不要点击' }
    }
    return messages[result] || { good: false, text: '请按指导完成操作' }
  },

  startIti() {
    this.setData({ phase: 'iti', instruction: '请在下一试次开始前重新按住“起始键”。' })
    this.later(() => this.afterIti(), ITI_MS)
  },

  afterIti() {
    if (this.pendingBlockEnd) {
      this.finishBlock()
      return
    }
    if (this.data.isHolding) this.startPreparation()
    else this.recordUnheldPreparationViolation()
  },

  recordUnheldPreparationViolation() {
    const trial = this.trials[this.trialIndex]
    if (!trial) return
    this.trialRuntime = {
      trial,
      events: [],
      prepStartedAt: monoNow(),
      releaseAt: null,
      clickAt: null,
      click: null,
      stopSignalAt: null
    }
    this.logEvent('preparation_start', { plannedMs: trial.prepMs, heldAtStart: false })
    this.finishTrial('preparation_violation')
  },

  finishBlock() {
    const pse = estimatePse(this.tracker.samples)
    const firstStopRecord = this.currentBlockRecords.find(item => item.ssd != null)
    storage.appendSummary(this.participantId, summarizeBlock(this.currentBlockRecords, {
      schemaVersion: 1,
      task: 'sst',
      participantId: this.participantId,
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      blockStartTime: new Date(this.blockStartedWall).toISOString(),
      blockEndTime: new Date().toISOString(),
      blockStartSsd: firstStopRecord ? firstStopRecord.ssd : null,
      blockEndSsd: this.tracker.ssd,
      currentStep: this.tracker.step,
      reversalCount: this.tracker.reversals,
      pse: pse.value,
      pseConverged: pse.converged
    }))
    if (this.blockNo >= LIMITS[this.mode].blocks) {
      storage.completeTask(this.participantId, this.day, this.taskId)
      this.setData({ phase: 'complete', isHolding: false })
    } else {
      storage.saveCheckpoint(this.participantId, this.day, this.taskId, {
        mode: this.mode,
        blockNo: this.blockNo + 1,
        trialIndex: 0,
        tracker: this.tracker,
        completed: false
      })
      this.setData({ phase: 'break', isHolding: false })
    }
  },

  pauseForInterruption(reason) {
    this.clearTimers()
    if (this.trialRuntime) this.logEvent('interruption', { reason })
    storage.appendRecord(this.participantId, {
      schemaVersion: 1,
      task: 'sst_event',
      participantId: this.participantId,
      day: this.day,
      paradigm: this.mode,
      blockNo: this.blockNo,
      trialNo: this.trialRuntime && this.trialRuntime.trial ? this.trialRuntime.trial.index : null,
      event: 'interruption',
      reason,
      wallTime: wallTime()
    })
    this.trialRuntime = null
    this.setData({ phase: 'ready', currentImage: '', stopSignal: false, isHolding: false, interrupted: true })
  },

  returnHome() {
    wx.navigateBack({ delta: 1 })
  }
})
