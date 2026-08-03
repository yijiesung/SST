const { hashSeed, createRng, shuffle, integer } = require('./random')

function balancedSides(count, random, maxRun) {
  const leftCount = Math.floor(count / 2)
  const source = Array.from({ length: count }, (_, index) => index < leftCount ? 'left' : 'right')
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const sides = shuffle(source, random)
    let valid = true
    for (let i = maxRun; i < sides.length; i += 1) {
      if (sides.slice(i - maxRun, i + 1).every(side => side === sides[i])) {
        valid = false
        break
      }
    }
    if (valid) return sides
  }
  throw new Error('无法生成满足左右位置约束的序列')
}

function buildBlock({ mode, blockNo, participantId, day, gameCount, neutralCount }) {
  const count = mode === 'practice' ? 20 : 50
  const seed = hashSeed(`${participantId}:${day}:attention:${mode}:${blockNo}`)
  const random = createRng(seed)
  const neutralSides = balancedSides(count, random, 4)
  const gameOrder = shuffle(Array.from({ length: gameCount }, (_, i) => i), random)
  const neutralOrder = shuffle(Array.from({ length: neutralCount }, (_, i) => i), random)
  return {
    seed,
    trials: neutralSides.map((neutralSide, index) => ({
      index: index + 1,
      prepMs: integer(random, 500, 1000),
      neutralSide,
      gameSide: neutralSide === 'left' ? 'right' : 'left',
      probeSide: neutralSide,
      neutralIndex: neutralOrder[index % neutralOrder.length],
      gameIndex: gameOrder[index % gameOrder.length]
    }))
  }
}

function createTracker(saved) {
  if (saved) return { ...saved }
  return { duration: 250, step: 40, reversals: 0, lastDirection: 0, samples: [] }
}

function updateTracker(tracker, correct) {
  const direction = correct ? -1 : 1
  const next = { ...tracker, samples: tracker.samples.slice() }
  if (tracker.lastDirection && direction !== tracker.lastDirection) {
    next.reversals += 1
    next.step = next.reversals === 1 ? 20 : 10
  }
  next.samples.push({ duration: tracker.duration, correct })
  next.duration = Math.max(50, Math.min(500, tracker.duration + direction * next.step))
  next.lastDirection = direction
  return next
}

function summary(records, meta) {
  const correct = records.filter(item => item.result === 'correct')
  const errors = records.filter(item => item.result === 'error')
  const timeout = records.filter(item => item.result === 'timeout')
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const median = values => {
    if (!values.length) return null
    const sorted = values.slice().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const rts = correct.map(item => item.reactionTime)
  const bySide = side => records.filter(item => item.probeSide === side)
  const accuracy = list => list.length ? list.filter(item => item.result === 'correct').length / list.length : null
  const durations = records.map(item => item.pairDuration)
  const actualTrainingDurationMs = records.reduce((total, item) => {
    const responseWindow = Number.isFinite(item.reactionTime) ? item.reactionTime : 1000
    return total + (item.actualFixationMs || 0) + (item.pairDuration || 0) + responseWindow + 300 + 500
  }, 0)
  return {
    ...meta,
    trialCount: records.length,
    accuracy: records.length ? correct.length / records.length : null,
    errorRate: records.length ? errors.length / records.length : null,
    timeoutRate: records.length ? timeout.length / records.length : null,
    meanCorrectRt: mean(rts),
    medianCorrectRt: median(rts),
    leftProbeAccuracy: accuracy(bySide('left')),
    rightProbeAccuracy: accuracy(bySide('right')),
    meanDuration: mean(durations),
    minDuration: durations.length ? Math.min(...durations) : null,
    maxDuration: durations.length ? Math.max(...durations) : null,
    lowerBoundaryCount: durations.filter(value => value === 50).length,
    upperBoundaryCount: durations.filter(value => value === 500).length,
    actualTrainingDurationMs,
    sameSideGameRt: null,
    oppositeSideGameRt: mean(rts),
    attentionBiasScore: null,
    attentionBiasNote: '探测点按方案始终位于中性图片原位置，因此与游戏图片始终异侧，无法计算同侧RT。'
  }
}

module.exports = { buildBlock, createTracker, updateTracker, summary }
