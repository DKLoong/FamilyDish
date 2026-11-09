// 本地单元测试：分类同步、保存（含重命名同步菜品）、排序
// 运行：node cloudfunctions/familyApi/test/category.test.js
const path = require('path')
const { ACTIONS } = require(path.join(__dirname, '..', 'lib', 'actions', 'category.js'))

function match(row, query) {
  if (!query) return true
  for (const key of Object.keys(query)) {
    if (row[key] !== query[key]) return false
  }
  return true
}

function createMockDb(seed) {
  const store = seed || {}
  let seq = 0

  function collection(name) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const st = { query: null, limit: 100, orderBy: null }

    const api = {
      where(q) { st.query = q; return api },
      orderBy(f, d) { st.orderBy = { f: f, d: d }; return api },
      limit(n) { st.limit = n; return api },
      skip() { return api },
      async get() {
        let data = rows.filter(r => match(r, st.query))
        if (st.orderBy) {
          const f = st.orderBy.f
          const desc = st.orderBy.d === 'desc'
          data = data.slice().sort(function (a, b) {
            const av = a[f]
            const bv = b[f]
            if (av === bv) return 0
            const cmp = av > bv ? 1 : -1
            return desc ? -cmp : cmp
          })
        }
        return { data: data.slice(0, st.limit) }
      },
      async count() { return { total: rows.filter(r => match(r, st.query)).length } },
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
          },
          async update({ data }) {
            const row = rows.find(r => r._id === id)
            if (!row) return { stats: { updated: 0 } }
            Object.assign(row, data)
            return { stats: { updated: 1 } }
          }
        }
      },
      async add({ data }) {
        const id = data._id || 'c' + (++seq)
        rows.push(Object.assign({}, data, { _id: id }))
        return { _id: id }
      },
      async update({ data }) {
        const targets = rows.filter(r => match(r, st.query))
        targets.forEach(r => Object.assign(r, data))
        return { stats: { updated: targets.length } }
      }
    }
    return api
  }

  return { collection, _store: store }
}

function dish(id, category, archived) {
  return {
    _id: id,
    familyId: 'f1',
    name: '菜' + id,
    category: category,
    archived: !!archived,
    version: 2,
    ingredients: [],
    steps: []
  }
}

function seed() {
  return {
    Category: [],
    DishList: [
      dish('d1', '家常菜'),
      dish('d2', '荤菜'),
      dish('d3', '素菜'),
      dish('d4', '荤菜'),
      dish('d5', '旧分类', true),
      { _id: 'x1', familyId: 'f2', name: '别人家', category: '外部分类', archived: false, version: 1, ingredients: [], steps: [] }
    ]
  }
}

const owner = { openid: 'u1', familyId: 'f1', role: 'owner' }

let pass = 0
let failCount = 0

async function expectCode(label, fn, code) {
  try {
    await fn()
    console.log('  FAIL  ' + label + ' → 期望 ' + code + '，实际成功')
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

;(async function run() {
  console.log('1. 从菜品同步分类')
  let db = createMockDb(seed())
  const synced = await ACTIONS.syncCategories.run(db, owner)
  assert('补建 3 个分类', synced.created === 3, 'created=' + synced.created)
  const names = db._store.Category.map(c => c.name)
  assert('只取未归档菜品的分类', names.indexOf('旧分类') < 0, names.join(','))
  assert('不串家庭', names.indexOf('外部分类') < 0)
  assert('分类有递增排序', db._store.Category.map(c => c.sort).join(',') === '1,2,3',
    db._store.Category.map(c => c.sort).join(','))

  const again = await ACTIONS.syncCategories.run(db, owner)
  assert('同步幂等', again.created === 0 && db._store.Category.length === 3)

  console.log('2. 新建分类')
  db = createMockDb(seed())
  await ACTIONS.syncCategories.run(db, owner)
  await expectCode('名称为空', () => ACTIONS.saveCategory.run(db, owner, { name: '  ' }), 'INVALID_PAYLOAD')
  await expectCode('名称超长', () => ACTIONS.saveCategory.run(db, owner, { name: '一二三四五六七八九十一二三' }), 'INVALID_PAYLOAD')
  await expectCode('重名', () => ACTIONS.saveCategory.run(db, owner, { name: '荤菜' }), 'CONFLICT')

  const created = await ACTIONS.saveCategory.run(db, owner, { name: '汤品' })
  assert('新建成功', created.created === true && !!created.id)
  const soup = db._store.Category.find(c => c.name === '汤品')
  assert('排序接在末尾', soup.sort === 4, 'sort=' + soup.sort)

  console.log('3. 重命名并同步菜品')
  db = createMockDb(seed())
  await ACTIONS.syncCategories.run(db, owner)
  const meat = db._store.Category.find(c => c.name === '荤菜')
  const renamed = await ACTIONS.saveCategory.run(db, owner, { id: meat._id, name: '肉类' })
  assert('分类名已更新', db._store.Category.find(c => c._id === meat._id).name === '肉类')
  assert('同步了 2 道菜', renamed.renamedDishes === 2, 'renamed=' + renamed.renamedDishes)
  assert('菜品分类文本已改', db._store.DishList.filter(d => d.category === '肉类').length === 2)
  assert('其他分类未受影响', db._store.DishList.filter(d => d.category === '家常菜').length === 1)
  assert('未改动菜品版本号', db._store.DishList.filter(d => d.familyId === 'f1').every(d => d.version === 2))

  const noChange = await ACTIONS.saveCategory.run(db, owner, { id: meat._id, name: '肉类' })
  assert('同名保存不算重命名', noChange.renamedDishes === 0)

  await expectCode('改成已有名称', () => ACTIONS.saveCategory.run(db, owner, { id: meat._id, name: '家常菜' }), 'CONFLICT')

  console.log('4. 归属校验')
  db = createMockDb(seed())
  db._store.Category.push({ _id: 'other', familyId: 'f2', name: '别人的', sort: 1 })
  await expectCode('跨家庭分类', () => ACTIONS.saveCategory.run(db, owner, { id: 'other', name: '改名' }), 'FORBIDDEN')
  await expectCode('不存在的分类', () => ACTIONS.saveCategory.run(db, owner, { id: 'nope', name: '改名' }), 'NOT_FOUND')

  console.log('5. 排序')
  db = createMockDb(seed())
  await ACTIONS.syncCategories.run(db, owner)
  const ids = db._store.Category.slice().sort((a, b) => a.sort - b.sort).map(c => c._id)
  const reversed = ids.slice().reverse()
  const ordered = await ACTIONS.reorderCategories.run(db, owner, { ids: reversed })
  assert('按传入顺序重排', ordered.updated === 3)
  const after = db._store.Category.slice().sort((a, b) => a.sort - b.sort).map(c => c._id)
  assert('顺序与传入一致', after.join(',') === reversed.join(','), after.join(','))

  await expectCode('空数组', () => ACTIONS.reorderCategories.run(db, owner, { ids: [] }), 'INVALID_PAYLOAD')

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
