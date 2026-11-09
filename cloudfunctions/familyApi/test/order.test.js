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

  console.log('7. 同菜同餐次合并')
  db = createMockDb(seed())
  const first = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_aaaa0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  const joined = await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_aaaa0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('不新建第二条记录', db._store.OrderList.length === 1, 'orders=' + db._store.OrderList.length)
  assert('返回合并标记', joined.merged === true && joined.orderId === first.orderId)
  assert('点菜人追加为 2 人', joined.ordererCount === 2, 'count=' + joined.ordererCount)
  assert('记录内保存两人', db._store.OrderList[0].orderers.length === 2)
  assert('首位点菜人字段保留', db._store.OrderList[0].ordererOpenid === 'u2')
  assert('点菜人昵称可取', joined.ordererNames.join(',') === '孩子,妈妈', joined.ordererNames.join(','))
  assert('购物项不随人数翻倍', db._store.ShoppingItem.filter(s => s.orderId === first.orderId).length === 3)

  console.log('8. 同一人重复点')
  const repeat = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_aaaa0003', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('幂等返回且不追加', repeat.alreadyJoined === true && repeat.ordererCount === 2)
  assert('记录仍是两人', db._store.OrderList[0].orderers.length === 2)
  assert('未新增购物项', db._store.ShoppingItem.filter(s => s.orderId === first.orderId).length === 3)

  console.log('9. 不同餐次与不同日期不合并')
  db = createMockDb(seed())
  await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_bbbb0001', mealDate: '2026-11-09', mealType: '午餐' })
  await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_bbbb0002', mealDate: '2026-11-09', mealType: '晚餐' })
  await ACTIONS.placeOrder.run(db, member, { dishId: 'd1', requestId: 'req_bbbb0003', mealDate: '2026-11-10', mealType: '晚餐' })
  assert('三条独立记录', db._store.OrderList.length === 3, 'orders=' + db._store.OrderList.length)

  console.log('10. 终态不占位')
  db = createMockDb(seed())
  const cancelledOne = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_cccc0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  await ACTIONS.cancelOrder.run(db, owner, { orderId: cancelledOne.orderId })
  const afterCancel = await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_cccc0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('取消后重新点生成新记录', afterCancel.orderId !== cancelledOne.orderId && db._store.OrderList.length === 2)

  db = createMockDb(seed())
  const doneOne = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_dddd0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  await ACTIONS.completeOrder.run(db, owner, { orderId: doneOne.orderId })
  const afterDone = await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_dddd0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('完成后重新点生成新记录', afterDone.orderId !== doneOne.orderId && db._store.OrderList.length === 2)

  console.log('11. 合并时补齐购物项')
  db = createMockDb(seed())
  const allPrepared = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_eeee0001', mealDate: '2026-11-09', mealType: '晚餐',
    preparedKeys: ['i1', 'i2', 'i3']
  })
  assert('全部已准备时无购物项', allPrepared.shoppingCount === 0)
  const filled = await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_eeee0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('第二人未准备时补建购物项', filled.addedShopping === 3, 'added=' + filled.addedShopping)
  assert('订单 shoppingCount 累加', db._store.OrderList[0].shoppingCount === 3)

  const third = await ACTIONS.placeOrder.run(db, { openid: 'u3', familyId: 'f1', role: 'member', membership: { nickname: '爷爷' } }, {
    dishId: 'd1', requestId: 'req_eeee0003', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('已有购物项不重复生成', third.addedShopping === 0)
  assert('购物项总数仍为 3', db._store.ShoppingItem.filter(s => s.orderId === allPrepared.orderId).length === 3)

  console.log('12. 合并记录的完成与取消权限')
  db = createMockDb(seed())
  const joint = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_ffff0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_ffff0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  const doneByJoiner = await ACTIONS.completeOrder.run(db, owner, { orderId: joint.orderId })
  assert('后合并者可完成整条记录', doneByJoiner.status === 'completed')

  db = createMockDb(seed())
  const joint2 = await ACTIONS.placeOrder.run(db, member, {
    dishId: 'd1', requestId: 'req_gggg0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_gggg0002', mealDate: '2026-11-09', mealType: '晚餐'
  })
  await expectCode('未参与者不能取消', () => ACTIONS.cancelOrder.run(
    db, { openid: 'u9', familyId: 'f1', role: 'member' }, { orderId: joint2.orderId }
  ), 'FORBIDDEN')

  console.log('13. 旧记录兼容')
  db = createMockDb(seed())
  db._store.OrderList.push({
    _id: 'old1',
    orderId: 'old1',
    familyId: 'f1',
    dishId: 'd1',
    dishSnapshot: { name: '番茄炒蛋' },
    ordererOpenid: 'u2',
    ordererNickname: '孩子',
    mealDate: '2026-11-09',
    mealType: '晚餐',
    status: 'pending',
    statusTimes: { createdAt: new Date(), completedAt: null, cancelledAt: null },
    shoppingCount: 0,
    requestId: 'req_old00001',
    createTime: new Date()
  })
  const mergeOld = await ACTIONS.placeOrder.run(db, owner, {
    dishId: 'd1', requestId: 'req_hhhh0001', mealDate: '2026-11-09', mealType: '晚餐'
  })
  assert('无 orderers 的旧记录也能合并', mergeOld.merged === true && mergeOld.ordererCount === 2, 'count=' + mergeOld.ordererCount)
  const oldOrder = db._store.OrderList.find(o => o._id === 'old1')
  assert('旧记录被补上 orderers', Array.isArray(oldOrder.orderers) && oldOrder.orderers.length === 2)

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
