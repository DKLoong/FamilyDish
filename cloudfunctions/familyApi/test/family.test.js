// 本地单元测试：家庭领域动作的业务规则（角色拦截由 ACTIONS.auth + authenticate 负责，此处校验规则本身）
// 运行：node cloudfunctions/familyApi/test/family.test.js
const path = require('path')
const { ACTIONS } = require(path.join(__dirname, '..', 'lib', 'actions', 'family.js'))

function match(row, query) {
  if (!query) return true
  for (const key of Object.keys(query)) {
    const actual = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row)
    if (actual !== query[key]) return false
  }
  return true
}

function createMockDb(seed) {
  const store = seed
  let seq = 0
  const command = {
    addToSet: v => ({ $addToSet: v }),
    pull: v => ({ $pull: v }),
    gt: v => ({ $gt: v })
  }

  function collection(name) {
    if (!store[name]) store[name] = []
    const rows = store[name]
    const st = { query: null, orderBy: null, skip: 0, limit: 100 }

    const api = {
      where(q) { st.query = q; return api },
      orderBy(f, d) { st.orderBy = { f, d }; return api },
      skip(n) { st.skip = n; return api },
      limit(n) { st.limit = n; return api },
      async count() { return { total: rows.filter(r => match(r, st.query)).length } },
      async get() { return { data: rows.filter(r => match(r, st.query)).slice(st.skip, st.skip + st.limit) } },
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

function futureDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
}

function seed() {
  return {
    Family: [{
      _id: 'f1',
      name: '林家',
      createdBy: 'u1',
      maxMembers: 10,
      status: 'active',
      memberOpenids: ['u1', 'u2', 'u3'],
      invite: { code: 'ABC234', expiresAt: futureDate(), generatedBy: 'u1', generatedAt: new Date() },
      createTime: new Date(),
      updateTime: new Date()
    }],
    UserFamily: [
      { _id: 'u1', openid: 'u1', familyId: 'f1', role: 'owner', nickname: '妈妈', status: 'active', joinedAt: new Date('2026-01-01') },
      { _id: 'u2', openid: 'u2', familyId: 'f1', role: 'admin', nickname: '爸爸', status: 'active', joinedAt: new Date('2026-01-02') },
      { _id: 'u3', openid: 'u3', familyId: 'f1', role: 'member', nickname: '孩子', status: 'active', joinedAt: new Date('2026-01-03') }
    ]
  }
}

function ctxOf(db, openid) {
  // 与 authenticate 保持一致：只有 active 记录才构成有效成员关系
  const uf = db._store.UserFamily.find(u => u.openid === openid && u.status === 'active') || null
  const fam = uf ? db._store.Family.find(f => f._id === uf.familyId) : null
  return {
    openid: openid,
    membership: uf,
    familyId: uf ? uf.familyId : null,
    family: fam || null,
    role: uf ? uf.role : null
  }
}

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
  console.log('1. 动作注册与角色边界（静态声明）')
  assert('setRole 仅创建者', JSON.stringify(ACTIONS.setRole.auth.roles) === '["owner"]')
  assert('dissolveFamily 仅创建者', JSON.stringify(ACTIONS.dissolveFamily.auth.roles) === '["owner"]')
  assert('regenerateInvite 创建者或管理员', ACTIONS.regenerateInvite.auth.roles.length === 2)
  assert('leaveFamily 不限角色（内部再拦创建者）', !ACTIONS.leaveFamily.auth.roles)

  console.log('2. 角色变更 setRole')
  let db = createMockDb(seed())
  let owner = ctxOf(db, 'u1')
  await expectCode('改自己的角色', () => ACTIONS.setRole.run(db, owner, { memberId: 'u1', role: 'admin' }), 'CANNOT_MODIFY_SELF')
  await expectCode('改创建者角色', () => ACTIONS.setRole.run(db, ctxOf(db, 'u2'), { memberId: 'u1', role: 'member' }), 'FORBIDDEN')
  await expectCode('非法角色值', () => ACTIONS.setRole.run(db, owner, { memberId: 'u3', role: 'owner' }), 'INVALID_ROLE')
  await expectCode('目标不在本家庭', () => ACTIONS.setRole.run(db, owner, { memberId: 'zzz', role: 'admin' }), 'TARGET_NOT_FOUND')
  const promoted = await ACTIONS.setRole.run(db, owner, { memberId: 'u3', role: 'admin' })
  assert('授予管理员成功', promoted.role === 'admin' && db._store.UserFamily.find(u => u.openid === 'u3').role === 'admin')

  console.log('3. 移除成员 removeMember')
  db = createMockDb(seed())
  await expectCode('移除自己', () => ACTIONS.removeMember.run(db, ctxOf(db, 'u1'), { memberId: 'u1' }), 'CANNOT_MODIFY_SELF')
  await expectCode('移除创建者', () => ACTIONS.removeMember.run(db, ctxOf(db, 'u2'), { memberId: 'u1' }), 'FORBIDDEN')
  await ACTIONS.setRole.run(db, ctxOf(db, 'u1'), { memberId: 'u3', role: 'admin' })
  await expectCode('管理员移除管理员', () => ACTIONS.removeMember.run(db, ctxOf(db, 'u2'), { memberId: 'u3' }), 'FORBIDDEN')
  await ACTIONS.setRole.run(db, ctxOf(db, 'u1'), { memberId: 'u3', role: 'member' })
  const removed = await ACTIONS.removeMember.run(db, ctxOf(db, 'u2'), { memberId: 'u3' })
  assert('管理员移除普通成员成功', removed.removed === true)
  assert('被移除者状态为 removed', db._store.UserFamily.find(u => u.openid === 'u3').status === 'removed')
  assert('历史数据未被删除', db._store.UserFamily.length === 3)

  console.log('4. 退出家庭 leaveFamily')
  db = createMockDb(seed())
  await expectCode('创建者退出', () => ACTIONS.leaveFamily.run(db, ctxOf(db, 'u1'), {}), 'OWNER_CANNOT_LEAVE')
  const left = await ACTIONS.leaveFamily.run(db, ctxOf(db, 'u3'), {})
  assert('普通成员退出成功', left.left === true && db._store.UserFamily.find(u => u.openid === 'u3').status === 'left')

  console.log('5. 人数上限 updateCapacity')
  db = createMockDb(seed())
  const owner2 = ctxOf(db, 'u1')
  await expectCode('低于当前成员数', () => ACTIONS.updateCapacity.run(db, owner2, { maxMembers: 2 }), 'INVALID_PAYLOAD')
  await expectCode('超过硬上限', () => ACTIONS.updateCapacity.run(db, owner2, { maxMembers: 51 }), 'INVALID_PAYLOAD')
  await expectCode('非整数', () => ACTIONS.updateCapacity.run(db, owner2, { maxMembers: 12.5 }), 'INVALID_PAYLOAD')
  const cap = await ACTIONS.updateCapacity.run(db, owner2, { maxMembers: 20 })
  assert('调整到 20 成功', cap.maxMembers === 20 && db._store.Family[0].maxMembers === 20)
  const capEqual = await ACTIONS.updateCapacity.run(db, owner2, { maxMembers: 3 })
  assert('等于当前成员数允许', capEqual.maxMembers === 3)

  console.log('6. 邀请码重新生成 regenerateInvite')
  db = createMockDb(seed())
  const before = db._store.Family[0].invite.code
  const regen = await ACTIONS.regenerateInvite.run(db, ctxOf(db, 'u2'), {})
  assert('旧码被覆盖', regen.inviteCode !== before, before + ' → ' + regen.inviteCode)
  assert('新码写入库', db._store.Family[0].invite.code === regen.inviteCode)
  assert('新码 6 位字符集合法', /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(regen.inviteCode), regen.inviteCode)

  console.log('7. 解散家庭 dissolveFamily')
  db = createMockDb(seed())
  await expectCode('缺少二次确认', () => ACTIONS.dissolveFamily.run(db, ctxOf(db, 'u1'), {}), 'CONFIRM_REQUIRED')
  const dissolved = await ACTIONS.dissolveFamily.run(db, ctxOf(db, 'u1'), { confirm: true })
  assert('家庭标记已解散', db._store.Family[0].status === 'dissolved')
  assert('邀请码保留（唯一索引需要）', !!db._store.Family[0].invite.code)
  assert('成员全部释放', db._store.UserFamily.every(u => u.status === 'left'), 'released=' + dissolved.releasedMembers)
  assert('家庭文档未被物理删除', db._store.Family.length === 1)

  console.log('8. 退出后重新加入（复用成员记录）')
  db = createMockDb(seed())
  await ACTIONS.leaveFamily.run(db, ctxOf(db, 'u3'), {})
  const rejoin = await ACTIONS.joinFamily.run(db, ctxOf(db, 'u3'), { inviteCode: 'abc234', nickname: '孩子' })
  const u3 = db._store.UserFamily.find(u => u.openid === 'u3')
  assert('小写邀请码可加入', rejoin.role === 'member' && rejoin.familyId === 'f1')
  assert('复用同一条记录', db._store.UserFamily.filter(u => u.openid === 'u3').length === 1)
  assert('状态恢复为 active', u3.status === 'active' && u3.nickname === '孩子')

  console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
  if (failCount) process.exit(1)
})()
