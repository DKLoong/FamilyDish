// 本地单元测试：点菜、完成、取消
// 运行：node cloudfunctions/familyApi/test/order.test.js
const path = require('path')
const { ACTIONS } = require(path.join(__dirname, '..', 'lib', 'actions', 'order.js'))

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
      field() { return api },
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
          async remove() {
            const i = rows.findIndex(r => r._id === id)
            if (i < 0) return { stats: { removed: 0 } }
            rows.splice(i, 1)
            return { stats: { removed: 1 } }
          },
          async update({ data }) {
            const row = rows.find(r => r._id === id)
            if (!row) return { stats: { updated: 0 } }
            Object.keys(data).forEach(k => setPath(row, k, data[k]))
            return { stats: { updated: 1 } }
          }
        }
      },
      async add({ data }) {
        const id = data._id || 'id_' + (++seq)
        if (data._id && rows.some(r => r._id === data._id)) {
          const err = new Error('duplicate key')
          err.errMsg = 'collection.add:fail duplicate key'
          throw err
        }
        rows.push(Object.assign({}, data, { _id: id }))
        return { _id: id }
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

function seed() {
  return {
    DishList: [
      {
        _id: 'd1', familyId: 'f1', name: '番茄炒蛋', archived: false, image: '', difficulty: '简单', time: 15, tips: '趁热吃',
        ingredients: [
          { key: 'i1', name: '番茄', quantity: 300, unit: 'g', note: '' },
          { key: 'i2', name: '鸡蛋', quantity: 150, unit: 'g', note: '' },
          { key: 'i3', name: '盐', quantity: null, unit: '', note: '适量' }
        ],
        steps: [{ text: '切块', minutes: 3, image: '' }]
      },
      { _id: 'd2', familyId: 'f1', name: '已归档菜', archived: true, ingredients: [], steps: [] },
      { _id: 'x1', familyId: 'f2', name: '别人的菜', archived: false, ingredients: [], steps: [] }
    ],
    OrderList: [],
    ShoppingItem: [
      { _id: 'other1', familyId: 'f1', orderId: 'o_other', sourceType: 'order', ingredient: { name: '排骨', quantity: 500, unit: 'g', note: '' }, purchased: false }
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

;(async function run() {
  console.log('1. 点菜前置校验')
  let db = createMockDb(seed())
  await expectCode('缺菜品', () => ACTIONS.placeOrder.run(db, member, { requestId: 'req_00000001' }), 'INVALID_PAYLOAD')
  await expectCode('缺请求标识', () => ACTIONS.placeOrder.run(db, member, { dishId: 'd1' }), 'INVALID_PAYLOAD')
  await expectCode('归档菜品', () => ACTIONS.placeOrder.run(db, member, { dishId: 'd2', requestId: 'req_00000002' }), 'INVALID_PAYLOAD')
  await expectCode('跨家庭菜品', () => ACTIONS.placeOrder.run(db, member, { dishId: 'x1', requestId: 'req_00000003' }), 'FORBIDDEN')
  await expectCode('非法餐次', () => ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_00000004', mealType: '夜宵' }), 'INVALID_PAYLOAD')

  console.log('2. 正常点菜')
  db = createMockDb(seed())
  const place = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1',
    requestId: 'req_12345678',
    preparedKeys: ['i1'],
    mealDate: '2026-11-09',
    mealType: '晚餐',
    remark: '少辣'
  })
  const order = db._store.OrderList[0]
  assert('生成订单', !!order && order.status === 'pending')
  assert('保存菜品快照', order.dishSnapshot.name === '番茄炒蛋' && order.dishSnapshot.ingredients.length === 3)
  assert('保存点菜人昵称', order.ordererNickname === '孩子' && order.ordererOpenid === 'u2')
  assert('已准备食材不进购物清单', place.shoppingCount === 2, 'shoppingCount=' + place.shoppingCount)
  const created = db._store.ShoppingItem.filter(s => s.orderId === place.orderId)
  assert('购物项关联 orderId', created.length === 2 && created.every(s => s.sourceType === 'order'))
  assert('已准备项被排除', created.every(s => s.ingredient.key !== 'i1'))
  assert('保留选填项', order.mealDate === '2026-11-09' && order.mealType === '晚餐' && order.remark === '少辣')
  assert('记录购物项数量供取消提示', order.shoppingCount === 2, 'shoppingCount=' + order.shoppingCount)

  console.log('3. 幂等')
  const again = await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_12345678' })
  assert('同 requestId 返回原单', again.duplicated === true && again.orderId === place.orderId)
  assert('未重复写入订单', db._store.OrderList.length === 1)
  assert('未重复写入购物项', db._store.ShoppingItem.filter(s => s.orderId === place.orderId).length === 2)

  console.log('4. 完成')
  await expectCode('他人不能完成', () => ACTIONS.completeOrder.run(db, { openid: 'u3', familyId: 'f1', role: 'member' }, { orderId: place.orderId }), 'FORBIDDEN')
  const done = await ACTIONS.completeOrder.run(db, member, { orderId: place.orderId })
  const doneOrder = db._store.OrderList[0]
  assert('状态变为已完成', done.status === 'completed' && doneOrder.status === 'completed')
  assert('记录完成时间', !!doneOrder.statusTimes.completedAt)
  assert('完成不影响购物清单', db._store.ShoppingItem.filter(s => s.orderId === place.orderId).length === 2)
  await expectCode('已完成不能再完成', () => ACTIONS.completeOrder.run(db, owner, { orderId: place.orderId }), 'CONFLICT')
  await expectCode('已完成不能取消', () => ACTIONS.cancelOrder.run(db, owner, { orderId: place.orderId }), 'CONFLICT')

  console.log('5. 取消')
  db = createMockDb(seed())
  const second = await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_87654321' })
  const beforeOthers = db._store.ShoppingItem.filter(s => s.orderId === 'o_other').length
  const cancelled = await ACTIONS.cancelOrder.run(db, owner, { orderId: second.orderId })
  const afterOrderItems = db._store.ShoppingItem.filter(s => s.orderId === second.orderId).length
  assert('状态变为已取消', cancelled.status === 'cancelled')
  assert('移除该单带入的购物项', afterOrderItems === 0, 'removed=' + cancelled.removedShopping)
  assert('保留其他订单的购物项', db._store.ShoppingItem.filter(s => s.orderId === 'o_other').length === beforeOthers)
  assert('订单记录仍保留', db._store.OrderList.length === 1 && !!db._store.OrderList[0].statusTimes.cancelledAt)

  console.log('6. 权限边界')
  db = createMockDb(seed())
  const mine = await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_11112222' })
  const adminDone = await ACTIONS.completeOrder.run(db, owner, { orderId: mine.orderId })
  assert('管理员可完成他人记录', adminDone.status === 'completed')

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
