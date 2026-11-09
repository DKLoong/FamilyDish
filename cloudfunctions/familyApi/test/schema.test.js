// 本地单元测试：白名单、字段校验、角色边界、归属隔离。
// 运行：node cloudfunctions/familyApi/test/schema.test.js
// 不连接云端，用内存 mock 代替云数据库。
const path = require('path')
const crud = require(path.join(__dirname, '..', 'lib', 'crud.js'))

function match(row, query) {
  if (!query) return true
  for (const key of Object.keys(query)) {
    const expect = query[key]
    const actual = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row)
    if (expect && typeof expect === 'object' && '$gt' in expect) {
      if (!(actual > expect.$gt)) return false
    } else if (actual !== expect) {
      return false
    }
  }
  return true
}

function createMockDb(seed) {
  const store = seed || {}
  let seq = 0
  const command = {
    addToSet: v => ({ $addToSet: v }),
    gt: v => ({ $gt: v }),
    inc: v => ({ $inc: v })
  }

  function collection(name) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const st = { query: null, orderBy: null, skip: 0, limit: 100 }

    const api = {
      where(q) { st.query = q; return api },
      orderBy(field, dir) { st.orderBy = { field, dir }; return api },
      skip(n) { st.skip = n; return api },
      limit(n) { st.limit = n; return api },
      async count() { return { total: rows.filter(r => match(r, st.query)).length } },
      async get() {
        let data = rows.filter(r => match(r, st.query))
        if (st.orderBy) {
          const { field, dir } = st.orderBy
          data = data.slice().sort((a, b) => {
            if (a[field] === b[field]) return 0
            return (a[field] > b[field] ? 1 : -1) * (dir === 'desc' ? -1 : 1)
          })
        }
        return { data: data.slice(st.skip, st.skip + st.limit) }
      },
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
          },
          async remove() {
            const i = rows.findIndex(r => r._id === id)
            if (i < 0) return { stats: { removed: 0 } }
            rows.splice(i, 1)
            return { stats: { removed: 1 } }
          }
        }
      },
      async add({ data }) {
        if (data._id && rows.some(r => r._id === data._id)) {
          const err = new Error('duplicate key')
          err.errMsg = 'collection.add:fail duplicate key'
          throw err
        }
        const id = data._id || 'id_' + (++seq)
        rows.push(Object.assign({}, data, { _id: id }))
        return { _id: id }
      },
      async update({ data }) {
        const targets = rows.filter(r => match(r, st.query))
        targets.forEach(r => Object.assign(r, data))
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

  return { collection, command, _store: store }
}

const db = createMockDb({
  DishList: [
    { _id: 'd1', familyId: 'f1', name: '番茄炒蛋', archived: false, createTime: new Date('2026-01-01') },
    { _id: 'd2', familyId: 'f1', name: '旧菜', archived: true, createTime: new Date('2026-01-02') },
    { _id: 'x1', familyId: 'f2', name: '别人家的菜', archived: false, createTime: new Date('2026-01-03') }
  ],
  ShoppingItem: [
    { _id: 's1', familyId: 'f1', createdBy: 'u1', sourceType: 'manual', purchased: false },
    { _id: 's2', familyId: 'f1', createdBy: 'u2', sourceType: 'manual', purchased: false }
  ],
  Category: []
})

const owner = { openid: 'u1', familyId: 'f1', role: 'owner' }
const member = { openid: 'u2', familyId: 'f1', role: 'member' }

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
  console.log('1. 非白名单集合')
  await expectCode('User 集合', () => crud.run(db, owner, { collection: 'User', op: 'list' }), 'COLLECTION_NOT_ALLOWED')
  await expectCode('Family 集合', () => crud.run(db, owner, { collection: 'Family', op: 'list' }), 'COLLECTION_NOT_ALLOWED')
  await expectCode('伪造集合名', () => crud.run(db, owner, { collection: 'Evil', op: 'list' }), 'COLLECTION_NOT_ALLOWED')
  await expectCode('缺少集合名', () => crud.run(db, owner, { op: 'list' }), 'BAD_REQUEST')

  console.log('2. 受保护字段与未授权字段')
  await expectCode('add 传 familyId', () => crud.run(db, owner, { collection: 'DishList', op: 'add', data: { name: 'x', familyId: 'f2' } }), 'FIELD_PROTECTED')
  await expectCode('add 传 createdBy', () => crud.run(db, owner, { collection: 'DishList', op: 'add', data: { name: 'x', createdBy: 'u2' } }), 'FIELD_PROTECTED')
  await expectCode('add 传未白名单字段', () => crud.run(db, owner, { collection: 'DishList', op: 'add', data: { name: 'x', createdAt: 1 } }), 'FIELD_NOT_ALLOWED')
  await expectCode('update 传 status', () => crud.run(db, owner, { collection: 'DishList', op: 'update', id: 'd1', data: { status: 'x' } }), 'FIELD_PROTECTED')
  await expectCode('空 data', () => crud.run(db, owner, { collection: 'DishList', op: 'update', id: 'd1', data: {} }), 'EMPTY_PAYLOAD')

  console.log('3. 角色与操作边界')
  await expectCode('普通成员新增菜品', () => crud.run(db, member, { collection: 'DishList', op: 'add', data: { name: 'x' } }), 'FORBIDDEN')
  await expectCode('OrderList 直接 add', () => crud.run(db, owner, { collection: 'OrderList', op: 'add', data: {} }), 'OP_NOT_ALLOWED')
  await expectCode('DishList 物理删除', () => crud.run(db, owner, { collection: 'DishList', op: 'remove', id: 'd1' }), 'OP_NOT_ALLOWED')
  await expectCode('普通成员删他人手工项', () => crud.run(db, member, { collection: 'ShoppingItem', op: 'remove', id: 's1' }), 'FORBIDDEN')

  console.log('4. 归属隔离')
  await expectCode('读其他家庭文档', () => crud.run(db, owner, { collection: 'DishList', op: 'get', id: 'x1' }), 'FORBIDDEN')
  await expectCode('更新不存在文档', () => crud.run(db, owner, { collection: 'DishList', op: 'update', id: 'nope', data: { name: 'y' } }), 'NOT_FOUND')

  console.log('5. 正常路径与默认行为')
  const listed = await crud.run(db, owner, { collection: 'DishList', op: 'list' })
  assert('列表默认排除已归档', listed.items.length === 1 && listed.items[0]._id === 'd1', 'total=' + listed.total)
  assert('列表不串家庭', listed.items.every(i => i.familyId === 'f1'), 'items=' + listed.items.length)

  const created = await crud.run(db, owner, { collection: 'Category', op: 'add', data: { name: '家常菜', sort: 1 } })
  const savedCat = db._store.Category.find(c => c._id === created.id)
  assert('add 注入 familyId', !!savedCat && savedCat.familyId === 'f1')
  assert('add 注入 createdBy', !!savedCat && savedCat.createdBy === 'u1')
  assert('add 注入 createTime', !!savedCat && !!savedCat.createTime)

  const removed = await crud.run(db, member, { collection: 'ShoppingItem', op: 'remove', id: 's2' })
  assert('普通成员可删自己手工项', removed.removed === 1)

  const archived = await crud.run(db, owner, { collection: 'DishList', op: 'archive', id: 'd1' })
  const afterArchive = db._store.DishList.find(d => d._id === 'd1')
  assert('归档只置标记不删文档', archived.archived === true && afterArchive.archived === true && !!afterArchive.name)

  const paged = await crud.run(db, owner, { collection: 'DishList', op: 'list', limit: 500 })
  assert('limit 上限被裁剪到 100', paged.limit === 100, 'limit=' + paged.limit)

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
