const assert = require('assert')

const values = new Map([
  ['training_profile', { participantId: 'P001', startDate: '2026-08-01' }],
  ['selected_training_day:P001', 2]
])

global.wx = {
  getStorageSync(key) {
    return values.get(key)
  },
  setStorageSync(key, value) {
    values.set(key, value)
  }
}

let homePage
global.Page = definition => {
  homePage = definition
}

require('../miniprogram/pages/home/home.js')

homePage.data = JSON.parse(JSON.stringify(homePage.data))
homePage.setData = update => Object.assign(homePage.data, update)

homePage.refresh()
assert.strictEqual(homePage.data.day, 2)
assert.strictEqual(homePage.data.tasks.length, 3)
assert.strictEqual(homePage.data.tasks[1].id, 'attention-practice')

homePage.onDayChange({ detail: { value: '13' } })
assert.strictEqual(homePage.data.day, 14)
assert.strictEqual(homePage.data.dayIndex, 13)
assert.strictEqual(homePage.data.tasks.length, 1)
assert.strictEqual(homePage.data.tasks[0].id, 'sst-measure')
assert.strictEqual(values.get('selected_training_day:P001'), 14)

homePage.onDayChange({ detail: { value: '0' } })
assert.strictEqual(homePage.data.day, 1)
assert.strictEqual(homePage.data.tasks.length, 2)
assert.strictEqual(homePage.data.tasks[0].id, 'sst-practice')

console.log('home day selection tests: PASS')
