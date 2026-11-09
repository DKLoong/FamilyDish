// 本地单元测试：购物清单勾选、取消、清空
// 运行：node cloudfunctions/familyApi/test/shopping.test.js
const path = require('path')
const { ACTIONS } = require(path.join(__dirname, '..', 'lib', 'actions', 'shopping.js'))

function setPath(target, key, value) {
  const parts = key.split('.')
  let cur = target
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

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
    const st = { query: null, limit: 100 }

    const api = {
      where(q) { st.query = q; return api },
      limit(n) { st.limit = n; return api },
      orderBy() { return api },
      skip() { return api },
      async get() { return { data: rows.filter(r => match(r, st.query)).slice(0, st.limit) } },
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
            Object.keys(data).forEach(k => setPath(row, k, data[k]))
            return { stats: { updated: 1 } }
          }
        }
      },
      async update({ data }) {
        const targets = rows.filter(r => match(r, st.query))
        targets.forEach(r => Object.keys(data).forEach(k => setPath(r, k, data[k])))
        return { stats: { updated: targets.length } }
      },
      async remove() {
        const targets = rows.filter(r => match(r, st.query))
        targets.forEach(t => { const i = rows.indexOf(t); if (i >= 0) rows.splice(i, 1) })
        return { stats: { removed: targets.length } }
      }
    }
    return api
  }

  return { collection, _store: store }
}

function item(id, name, quantity, unit, extra) {
  return Object.assign({
    _id: id,
    familyId: 'f1',
    sourceType: 'order',
    orderId: 'o1',
    createdBy: 'u2',
    ingredient: { name: name, quantity: quantity, unit: unit, note: '' },
    purchased: false,
    purchasedBy: '',
    purchasedAt: null,
    purchaseGroupId: ''
  }, extra || {})
}

function seed() {
  return {
    ShoppingItem: [
      item('s1', '排骨', 500, 'g'),
      item('s2', '排骨', 300, 'g'),
      item('s3', '番茄', 300, 'g'),
      item('m1', '纸巾', null, '', { sourceType: 'manual', orderId: null }),
      item('other', '别人的排骨', 500, 'g', { familyId: 'f2' }),
      item('bought', '已买的葱', 100, 'g', { purchased: true, purchasedBy: 'u1', purchaseGroupId: 'g_old' })
    ]
  }
}

const member = { openid: 'u2', familyId: 'f1', role: 'member', membership: { nickname: '孩子' } }
const owner = { openid: 'u1', familyId: 'f1', role: 'owner', membership: { nickname: '妈妈' } }

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

function byId(db, id) {
  return db._store.ShoppingItem.find(s => s._id === id)
}

;(async function run() {
  console.log('1. 参数校验')
  let db = createMockDb(seed())
  await expectCode('缺少 ids', () => ACTIONS.setPurchase.run(db, member, {}), 'INVALID_PAYLOAD')
  await expectCode('ids 不是数组', () => ACTIONS.setPurchase.run(db, member, { ids: 's1' }), 'INVALID_PAYLOAD')
  await expectCode('ids 为空数组', () => ACTIONS.setPurchase.run(db, member, { ids: [] }), 'INVALID_PAYLOAD')
  await expectCode('元素格式错误', () => ACTIONS.setPurchase.run(db, member, { ids: [{ id: 's1' }] }), 'INVALID_PAYLOAD')
  await expectCode('超量', () => ACTIONS.setPurchase.run(db, member, {
    ids: Array.from({ length: 101 }, (_, i) => 'x' + i)
  }), 'INVALID_PAYLOAD')

  console.log('2. 勾选一个合并组')
  db = createMockDb(seed())
  const bought = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2'] })
  assert('两条都被标记', byId(db, 's1').purchased === true && byId(db, 's2').purchased === true)
  assert('共享同一个 purchaseGroupId', !!bought.purchaseGroupId && byId(db, 's1').purchaseGroupId === byId(db, 's2').purchaseGroupId)
  assert('记录购买人与时间', byId(db, 's1').purchasedBy === 'u2' && !!byId(db, 's1').purchasedAt)
  assert('未传入的项目不受影响', byId(db, 's3').purchased === false)
  assert('返回变更条数', bought.changed === 2, 'changed=' + bought.changed)

  console.log('3. 重复勾选幂等')
  const again = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2'] })
  assert('不重复变更', again.changed === 0 && again.unchanged === 2)
  assert('组标识未被覆盖', byId(db, 's1').purchaseGroupId === bought.purchaseGroupId)

  console.log('4. 部分状态不一致时只处理应处理的')
  db = createMockDb(seed())
  db._store.ShoppingItem.find(s => s._id === 's2').purchased = true
  const partial = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2'] })
  assert('只更新未购的那条', partial.changed === 1 && partial.unchanged === 1)
  assert('已购项保留原组标识', byId(db, 's2').purchaseGroupId !== byId(db, 's1').purchaseGroupId)

  console.log('5. 取消勾选')
  db = createMockDb(seed())
  const group = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2'] })
  const undo = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2'], purchased: false })
  assert('回到未购状态', byId(db, 's1').purchased === false && byId(db, 's2').purchased === false)
  assert('清空购买痕迹', byId(db, 's1').purchaseGroupId === '' && byId(db, 's1').purchasedBy === '' && byId(db, 's1').purchasedAt === null)
  assert('取消后不再持有组标识', undo.purchaseGroupId === '' && group.purchaseGroupId !== '')
  assert('取消条数正确', undo.changed === 2)

  console.log('6. 归属与存在性')
  await expectCode('跨家庭项目', () => ACTIONS.setPurchase.run(db, member, { ids: ['other'] }), 'FORBIDDEN')
  await expectCode('不存在的项目', () => ACTIONS.setPurchase.run(db, member, { ids: ['nope'] }), 'NOT_FOUND')

  console.log('7. 清空已购')
  db = createMockDb(seed())
  await expectCode('普通成员无权清空', () => ACTIONS.clearPurchased.run(db, member), 'FORBIDDEN')
  const before = db._store.ShoppingItem.length
  const cleared = await ACTIONS.clearPurchased.run(db, owner)
  assert('只删除已购项', cleared.removed === 1, 'removed=' + cleared.removed)
  assert('未购项全部保留', db._store.ShoppingItem.length === before - 1)
  assert('保留的都不是已购', db._store.ShoppingItem.every(s => !s.purchased))

  db = createMockDb(seed())
  const group2 = await ACTIONS.setPurchase.run(db, member, { ids: ['s1', 's2', 's3'] })
  const cleared2 = await ACTIONS.clearPurchased.run(db, owner)
  assert('连同一组合并清空', cleared2.removed === 4, 'removed=' + cleared2.removed)
  assert('手工未购项不受影响', !!db._store.ShoppingItem.find(s => s._id === 'm1'))
  assert('组标识确实写入过', !!group2.purchaseGroupId)

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
