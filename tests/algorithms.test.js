const assert = require('node:assert/strict')
const sst = require('../miniprogram/packages/sst/common/engine')
const attention = require('../miniprogram/packages/attention/common/engine')

function maxRun(values, target) {
  let run = 0
  let max = 0
  values.forEach(value => {
    run = value === target ? run + 1 : 0
    max = Math.max(max, run)
  })
  return max
}

for (const mode of ['practice', 'measure', 'intervention']) {
  for (let blockNo = 1; blockNo <= sst.LIMITS[mode].blocks; blockNo += 1) {
    const built = sst.buildBlock({ mode, blockNo, participantId: 'P001', day: 3, gameCount: 163, neutralCount: 149 })
    const types = built.trials.map(item => item.type)
    assert.equal(types.filter(type => type === 'go').length, sst.LIMITS[mode].go)
    assert.equal(types.filter(type => type === 'stop').length, sst.LIMITS[mode].stop)
    assert.ok(maxRun(types, 'go') <= sst.LIMITS[mode].maxGoRun)
    assert.ok(maxRun(types, 'stop') <= sst.LIMITS[mode].maxStopRun)
    if (mode === 'intervention') {
      assert.notDeepEqual(types.slice(0, 3), ['stop', 'stop', 'stop'])
      assert.notDeepEqual(types.slice(-3), ['stop', 'stop', 'stop'])
      for (let segment = 0; segment < 3; segment += 1) {
        const part = types.slice(segment * 20, (segment + 1) * 20)
        assert.equal(part.filter(type => type === 'go').length, 12)
        assert.equal(part.filter(type => type === 'stop').length, 8)
      }
    }
    const repeated = sst.buildBlock({ mode, blockNo, participantId: 'P001', day: 3, gameCount: 163, neutralCount: 149 })
    assert.deepEqual(repeated, built)
  }
}

let measure = sst.createTracker('measure')
measure = sst.updateTracker(measure, true)
assert.equal(measure.ssd, 300)
measure = sst.updateTracker(measure, false)
assert.equal(measure.ssd, 250)

let intervention = sst.createTracker('intervention')
intervention = sst.updateTracker(intervention, true)
assert.equal(intervention.ssd, 280)
intervention = sst.updateTracker(intervention, false)
assert.equal(intervention.step, 20)
assert.equal(intervention.ssd, 260)
intervention = sst.updateTracker(intervention, true)
assert.equal(intervention.step, 10)

for (let blockNo = 1; blockNo <= 6; blockNo += 1) {
  const built = attention.buildBlock({ mode: 'training', blockNo, participantId: 'P001', day: 5, gameCount: 163, neutralCount: 149 })
  const sides = built.trials.map(item => item.neutralSide)
  assert.equal(sides.filter(side => side === 'left').length, 25)
  assert.equal(sides.filter(side => side === 'right').length, 25)
  assert.ok(maxRun(sides, 'left') <= 4)
  assert.ok(maxRun(sides, 'right') <= 4)
  assert.ok(built.trials.every(item => item.probeSide === item.neutralSide && item.gameSide !== item.probeSide))
}

let duration = attention.createTracker()
duration = attention.updateTracker(duration, true)
assert.equal(duration.duration, 210)
duration = attention.updateTracker(duration, false)
assert.equal(duration.step, 20)
assert.equal(duration.duration, 230)
duration = attention.updateTracker(duration, true)
assert.equal(duration.step, 10)

console.log('algorithm tests: PASS')
