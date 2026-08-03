const { hashSeed, createRng, integer, shuffle } = require('./random')

const LIMITS = {
  practice: { blocks: 1, go: 24, stop: 8, maxGoRun: 4, maxStopRun: 3 },
  measure: { blocks: 3, go: 54, stop: 18, maxGoRun: 4, maxStopRun: 3 },
  intervention: { blocks: 3, go: 36, stop: 24, maxGoRun: 5, maxStopRun: 3 }
}

function isValidPlacement(sequence, candidate, config, remainingAfter) {
  const run = sequence.slice(-Math.max(config.maxGoRun, config.maxStopRun))
  const limit = candidate === 'go' ? config.maxGoRun : config.maxStopRun
  if (run.length >= limit && run.slice(-limit).every(value => value === candidate)) return false
  if (config.mode === 'intervention' && sequence.length < 2 && candidate === 'stop' && sequence.every(value => value === 'stop')) return false
  if (config.mode === 'intervention' && remainingAfter === 0) {
    const ending = sequence.concat(candidate).slice(-3)
    if (ending.length === 3 && ending.every(value => value === 'stop')) return false
  }
  return true
}

function constrainedTypes(mode, random) {
  const config = { ...LIMITS[mode], mode }
  if (mode === 'intervention') {
    const segment = Array(12).fill('go').concat(Array(8).fill('stop'))
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const sequence = shuffle(segment, random).concat(shuffle(segment, random), shuffle(segment, random))
      let maxStop = 0
      let maxGo = 0
      let stopRun = 0
      let goRun = 0
      sequence.forEach(type => {
        stopRun = type === 'stop' ? stopRun + 1 : 0
        goRun = type === 'go' ? goRun + 1 : 0
        maxStop = Math.max(maxStop, stopRun)
        maxGo = Math.max(maxGo, goRun)
      })
      const startsWithThreeStop = sequence.slice(0, 3).every(type => type === 'stop')
      const endsWithThreeStop = sequence.slice(-3).every(type => type === 'stop')
      if (maxStop <= 3 && maxGo <= config.maxGoRun && !startsWithThreeStop && !endsWithThreeStop) return sequence
    }
    throw new Error('无法生成满足分段约束的 intervention 序列')
  }
  const total = config.go + config.stop
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let go = config.go
    let stop = config.stop
    const sequence = []
    while (sequence.length < total) {
      const choices = []
      const remainingAfter = total - sequence.length - 1
      if (go > 0 && isValidPlacement(sequence, 'go', config, remainingAfter)) choices.push('go')
      if (stop > 0 && isValidPlacement(sequence, 'stop', config, remainingAfter)) choices.push('stop')
      if (!choices.length) break
      const weighted = choices.length === 1 ? choices[0] : (random() < go / (go + stop) ? 'go' : 'stop')
      sequence.push(weighted)
      if (weighted === 'go') go -= 1
      else stop -= 1
    }
    if (sequence.length === total) return sequence
  }
  throw new Error(`无法生成满足约束的 ${mode} 序列`)
}

function buildBlock({ mode, blockNo, participantId, day, gameCount, neutralCount }) {
  const seedText = `${participantId}:${day}:sst:${mode}:${blockNo}`
  const seed = hashSeed(seedText)
  const random = createRng(seed)
  const types = constrainedTypes(mode, random)
  const gameOrder = shuffle(Array.from({ length: gameCount }, (_, i) => i), random)
  const neutralOrder = shuffle(Array.from({ length: neutralCount }, (_, i) => i), random)
  let gi = 0
  let ni = 0
  return {
    seed,
    trials: types.map((type, index) => ({
      index: index + 1,
      type,
      prepMs: integer(random, 500, 1000),
      imageIndex: type === 'go' ? neutralOrder[ni++ % neutralOrder.length] : gameOrder[gi++ % gameOrder.length]
    }))
  }
}

function createTracker(mode, inherited) {
  if (inherited) return { ...inherited }
  return { mode, ssd: 250, step: mode === 'measure' ? 50 : 30, reversals: 0, lastDirection: 0, samples: [] }
}

function updateTracker(tracker, success) {
  const direction = success ? 1 : -1
  const next = { ...tracker, samples: tracker.samples.slice() }
  if (tracker.mode === 'intervention' && tracker.lastDirection && direction !== tracker.lastDirection) {
    next.reversals += 1
    next.step = next.reversals === 1 ? 20 : 10
  }
  next.samples.push({ ssd: tracker.ssd, success })
  next.ssd = Math.max(50, Math.min(500, tracker.ssd + direction * next.step))
  next.lastDirection = direction
  return next
}

function estimatePse(samples) {
  if (!samples.length) return { value: null, stopSuccessRate: null, converged: false }
  const buckets = {}
  samples.forEach(sample => {
    if (!buckets[sample.ssd]) buckets[sample.ssd] = { total: 0, success: 0 }
    buckets[sample.ssd].total += 1
    if (sample.success) buckets[sample.ssd].success += 1
  })
  const ranked = Object.keys(buckets).map(Number).sort((a, b) => {
    const da = Math.abs(buckets[a].success / buckets[a].total - 0.5)
    const db = Math.abs(buckets[b].success / buckets[b].total - 0.5)
    return da - db || buckets[b].total - buckets[a].total
  })
  const recent = samples.slice(-8).map(item => item.ssd)
  const successes = samples.filter(item => item.success).length
  return {
    value: ranked[0],
    stopSuccessRate: successes / samples.length,
    converged: recent.length === 8 && Math.max(...recent) - Math.min(...recent) <= 50
  }
}

function summarizeBlock(trials, meta) {
  const validTrials = trials.filter(item => !item.invalidTrial)
  const go = validTrials.filter(item => item.trialType === 'go')
  const stop = validTrials.filter(item => item.trialType === 'stop')
  const correctGo = go.filter(item => item.result === 'correct_go')
  const successfulStop = stop.filter(item => item.result === 'successful_inhibition')
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  return {
    ...meta,
    invalidTrialCount: trials.length - validTrials.length,
    goCount: go.length,
    stopCount: stop.length,
    goAccuracy: go.length ? correctGo.length / go.length : null,
    stopSuccessRate: stop.length ? successfulStop.length / stop.length : null,
    meanGoReleaseRt: mean(correctGo.map(item => item.releaseRt).filter(Number.isFinite))
  }
}

module.exports = { LIMITS, buildBlock, createTracker, updateTracker, estimatePse, summarizeBlock }
