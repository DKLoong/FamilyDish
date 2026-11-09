// 本地单元测试：菜品结构校验与示例菜导入
// 运行：node cloudfunctions/familyApi/test/dish.test.js
const path = require('path')
const validators = require(path.join(__dirname, '..', 'lib', 'validators.js'))
const { ACTIONS } = require(path.join(__dirname, '..', 'lib', 'actions', 'dish.js'))
const SAMPLE_DISHES = require(path.join(__dirname, '..', 'lib', 'sampleDishes.js'))

function match(row, query) {
  if (!query) return true
  for (const key of Object.keys(query)) {
    if (row[key] !== query[key]) return false
  }
  return true
}

function createMockDb() {
  const store = { DishList: [] }
  let seq = 0
  const command = { addToSet: v => ({ $addToSet: v }), pull: v => ({ $pull: v }) }

  function collection(name) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const st = { query: null, limit: 100 }

    const api = {
      where(q) { st.query = q; return api },
      field() { return api },
      orderBy() { return api },
      skip() { return api },
      limit(n) { st.limit = n; return api },
      async count() { return { total: rows.filter(r => match(r, st.query)).length } },
      async get() { return { data: rows.filter(r => match(r, st.query)).slice(0, st.limit) } },
      doc(id) {
        return {
          async get() {
            const row = rows.find(r => r._id === id)
            if (!row) {
              const err = new Error('document not exists')
              err.errMsg = 'document.get:fail document not exists'
              throw err
            }
            return { data: row }
          }
        }
      },
      async add({ data }) {
        const id = data._id || 'id_' + (++seq)
        rows.push(Object.assign({}, data, { _id: id }))
        return { _id: id }
      }
    }
    return api
  }

  return { collection, command, _store: store }
}

let pass = 0
let failCount = 0

async function expectCode(label, fn, code) {
  try {
    const result = await fn()
    console.log('  FAIL  ' + label + ' → 期望 ' + code + '，实际通过: ' + JSON.stringify(result))
    failCount++
  } catch (e) {
    if (e.code === code) { console.log('  OK    ' + label + ' → ' + e.code); pass++ }
    else { console.log('  FAIL  ' + label + ' → 期望 ' + code + '，实际 ' + e.code + ' (' + e.message + ')'); failCount++ }
  }
}

function assert(label, condition, detail) {
  if (condition) { console.log('  OK    ' + label + (detail ? ' → ' + detail : '')); pass++ }
  else { console.log('  FAIL  ' + label); failCount++ }
}

const validDish = {
  name: '番茄炒蛋',
  category: '家常菜',
  difficulty: '简单',
  time: 15,
  ingredients: [
    { key: 'i1', name: '番茄', quantity: 300, unit: 'g', note: '' },
    { key: 'i2', name: '盐', quantity: null, unit: '', note: '适量' }
  ],
  steps: [{ text: '切块', minutes: 3, image: '' }]
}

;(async function run() {
  console.log('1. 必填与结构性约束')
  await expectCode('缺菜品名称', () => validators.DishList({ category: '家常菜', ingredients: validDish.ingredients, steps: validDish.steps }, false), 'INVALID_PAYLOAD')
  await expectCode('缺食材', () => validators.DishList({ name: 'x', steps: validDish.steps }, false), 'INVALID_PAYLOAD')
  await expectCode('食材为空数组', () => validators.DishList({ name: 'x', ingredients: [], steps: validDish.steps }, false), 'INVALID_PAYLOAD')
  await expectCode('缺步骤', () => validators.DishList({ name: 'x', ingredients: validDish.ingredients }, false), 'INVALID_PAYLOAD')
  await expectCode('步骤为空数组', () => validators.DishList({ name: 'x', ingredients: validDish.ingredients, steps: [] }, false), 'INVALID_PAYLOAD')

  console.log('2. 字段内容校验')
  await expectCode('食材用量为负', () => validators.DishList(Object.assign({}, validDish, { ingredients: [{ name: '盐', quantity: -1 }] }), false), 'INVALID_PAYLOAD')
  await expectCode('食材用量为非数字', () => validators.DishList(Object.assign({}, validDish, { ingredients: [{ name: '盐', quantity: '一把' }] }), false), 'INVALID_PAYLOAD')
  await expectCode('难度不合法', () => validators.DishList(Object.assign({}, validDish, { difficulty: '超难' }), false), 'INVALID_PAYLOAD')
  await expectCode('耗时为 0', () => validators.DishList(Object.assign({}, validDish, { time: 0 }), false), 'INVALID_PAYLOAD')
  await expectCode('耗时超过 600', () => validators.DishList(Object.assign({}, validDish, { time: 601 }), false), 'INVALID_PAYLOAD')
  await expectCode('步骤时长为负', () => validators.DishList(Object.assign({}, validDish, { steps: [{ text: 'x', minutes: -5 }] }), false), 'INVALID_PAYLOAD')

  console.log('3. 归一化行为')
  const withNull = validators.DishList(Object.assign({}, validDish, { ingredients: [{ name: '盐', quantity: null }] }), false)
  assert('无数量自动补「适量」', withNull.ingredients[0].note === '适量' && withNull.ingredients[0].quantity === null)
  const noKey = validators.DishList(Object.assign({}, validDish, { ingredients: [{ name: '番茄', quantity: 300, unit: 'g' }] }), false)
  assert('缺 key 时自动生成', /^i\d+$/.test(noKey.ingredients[0].key))
  const trimmed = validators.DishList(Object.assign({}, validDish, { name: '  番茄炒蛋  ' }), false)
  assert('名称去首尾空格', trimmed.name === '番茄炒蛋')
  const updateOnly = validators.DishList({ time: 20 }, true)
  assert('更新时可只传部分字段', updateOnly.time === 20 && updateOnly.name === undefined)

  console.log('4. 示例菜数据')
  assert('示例菜 5 道', SAMPLE_DISHES.length === 5)
  assert('全部通过校验', SAMPLE_DISHES.every(function (d) {
    try { validators.DishList(d, false); return true } catch (e) { return false }
  }))
  const cats = new Set(SAMPLE_DISHES.map(function (d) { return d.category }))
  assert('覆盖多个分类', cats.size >= 4, Array.from(cats).join('/'))
  const times = SAMPLE_DISHES.map(function (d) { return d.time })
  assert('耗时跨度 10–60 分钟', Math.min.apply(null, times) === 10 && Math.max.apply(null, times) === 60)
  const hasNullQuantity = SAMPLE_DISHES.some(function (d) {
    return d.ingredients.some(function (i) { return i.quantity === null && i.note })
  })
  assert('含「适量」食材', hasNullQuantity)
  const hasNoStepImage = SAMPLE_DISHES.every(function (d) {
    return d.steps.every(function (s) { return !s.image })
  })
  assert('步骤均无图片', hasNoStepImage)
  const oilCount = SAMPLE_DISHES.reduce(function (acc, d) {
    return acc + d.ingredients.filter(function (i) { return i.name === '食用油' && i.unit === 'ml' && typeof i.quantity === 'number' }).length
  }, 0)
  assert('存在可合并的同名同单位食材', oilCount >= 2, '食用油 ' + oilCount + ' 次')

  console.log('5. 导入幂等')
  const db = createMockDb()
  const ctx = { openid: 'u1', familyId: 'f1', role: 'owner' }
  const first = await ACTIONS.seedSampleDishes.run(db, ctx, {})
  assert('首次导入 5 道', first.created === 5 && db._store.DishList.length === 5, 'created=' + first.created)
  const second = await ACTIONS.seedSampleDishes.run(db, ctx, {})
  assert('重复导入全部跳过', second.created === 0 && db._store.DishList.length === 5, 'skipped=' + second.skipped)
  const row = db._store.DishList[0]
  assert('写入归属与服务端字段', row.familyId === 'f1' && row.createdBy === 'u1' && row.archived === false && row.version === 1)
  assert('仅创建者可导入', JSON.stringify(ACTIONS.seedSampleDishes.auth.roles) === '["owner"]')

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
