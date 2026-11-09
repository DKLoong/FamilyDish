// 家庭领域动作。首版一个 openid 只有一个有效家庭，UserFamily._id 直接使用 openid。
// 退出 / 被移除 / 家庭解散后复用同一条记录（update 而非新增），因此可以重新加入别的家庭。
const {
  COL, ROLE, LIMITS, INVITE_ALPHABET,
  FAMILY_STATUS, MEMBERSHIP_STATUS
} = require('../constants')
const { ApiError, E } = require('../errors')

const ACTIVE = MEMBERSHIP_STATUS.ACTIVE

function assertText(value, min, max, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < min || text.length > max) {
    throw new ApiError(E.INVALID_PAYLOAD, label + '需为 ' + min + '–' + max + ' 个字符')
  }
  return text
}

function isNotFound(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)
}

function randomInviteCode() {
  let code = ''
  for (let i = 0; i < LIMITS.INVITE_LEN; i++) {
    code += INVITE_ALPHABET.charAt(Math.floor(Math.random() * INVITE_ALPHABET.length))
  }
  return code
}

async function generateUniqueCode(db) {
  for (let i = 0; i < LIMITS.INVITE_MAX_TRIES; i++) {
    const code = randomInviteCode()
    const res = await db.collection(COL.FAMILY).where({ 'invite.code': code }).count()
    if (!res.total) return code
  }
  throw new ApiError(E.CONFLICT, '邀请码生成失败，请重试')
}

function buildInvite(code, openid, now) {
  return {
    code: code,
    // 解散家庭时不清空邀请码：唯一索引下多个缺失值会互相冲突
    expiresAt: new Date(now.getTime() + LIMITS.INVITE_TTL_MS),
    generatedBy: openid,
    generatedAt: now
  }
}

// 读取任意状态的成员记录（含已退出、被移除）
async function getRawMembership(db, openid) {
  if (!openid) return null
  try {
    const res = await db.collection(COL.USER_FAMILY).doc(openid).get()
    return res && res.data ? res.data : null
  } catch (err) {
    if (isNotFound(err)) return null
    console.error('[familyApi] read membership failed', { openid: openid, err: err })
    throw new ApiError(E.INTERNAL_ERROR, '读取成员关系失败')
  }
}

// 落库成员关系：没有记录则新增，有非 active 记录则复用
async function upsertMembership(db, openid, fields) {
  const raw = await getRawMembership(db, openid)
  if (raw && raw.status === ACTIVE) {
    throw new ApiError(E.ALREADY_IN_FAMILY, '你已在一个家庭中')
  }
  if (raw) {
    await db.collection(COL.USER_FAMILY).doc(openid).update({ data: fields })
    return 'updated'
  }
  await db.collection(COL.USER_FAMILY).add({
    data: Object.assign({ _id: openid, openid: openid }, fields)
  })
  return 'created'
}

async function pullMemberOpenid(db, familyId, openid) {
  try {
    await db.collection(COL.FAMILY).doc(familyId).update({
      data: { memberOpenids: db.command.pull(openid), updateTime: new Date() }
    })
  } catch (err) {
    // memberOpenids 仅用于展示，同步失败不影响主流程
    console.error('[familyApi] sync memberOpenids failed', { familyId: familyId, err: err })
  }
}

async function createFamily(db, ctx, payload) {
  if (ctx.membership && ctx.membership.status === ACTIVE) {
    throw new ApiError(E.ALREADY_IN_FAMILY, '你已在一个家庭中')
  }

  const name = assertText(payload.familyName, LIMITS.FAMILY_NAME_MIN, LIMITS.FAMILY_NAME_MAX, '家庭名称')
  const nickname = assertText(payload.nickname, LIMITS.NICKNAME_MIN, LIMITS.NICKNAME_MAX, '家庭内昵称')
  const code = await generateUniqueCode(db)
  const now = new Date()

  const familyRes = await db.collection(COL.FAMILY).add({
    data: {
      name: name,
      createdBy: ctx.openid,
      maxMembers: LIMITS.MEMBER_DEFAULT,
      status: FAMILY_STATUS.ACTIVE,
      memberOpenids: [ctx.openid],
      invite: buildInvite(code, ctx.openid, now),
      createTime: now,
      updateTime: now
    }
  })
  const familyId = familyRes._id

  try {
    await upsertMembership(db, ctx.openid, {
      familyId: familyId,
      role: ROLE.OWNER,
      nickname: nickname,
      status: ACTIVE,
      joinedAt: now,
      updateTime: now
    })
  } catch (err) {
    // 成员关系写入失败不能留下孤儿家庭
    console.error('[familyApi] createFamily membership failed', { openid: ctx.openid, familyId: familyId, err: err })
    try {
      await db.collection(COL.FAMILY).doc(familyId).remove()
    } catch (rollbackErr) {
      console.error('[familyApi] createFamily rollback failed', { familyId: familyId, err: rollbackErr })
    }
    if (err instanceof ApiError) throw err
    throw new ApiError(E.CONFLICT, '创建家庭失败，请重试')
  }

  return {
    familyId: familyId,
    familyName: name,
    role: ROLE.OWNER,
    nickname: nickname,
    inviteCode: code
  }
}

// 人数校验为「先查后写」，并发下存在极小越界窗口，M2 出口前用计数字段收紧
async function joinFamily(db, ctx, payload) {
  if (ctx.membership && ctx.membership.status === ACTIVE) {
    throw new ApiError(E.ALREADY_IN_FAMILY, '你已在一个家庭中')
  }

  const rawCode = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim().toUpperCase() : ''
  if (rawCode.length !== LIMITS.INVITE_LEN) {
    throw new ApiError(E.INVITE_INVALID, '邀请码应为 ' + LIMITS.INVITE_LEN + ' 位字母或数字')
  }
  const nickname = assertText(payload.nickname, LIMITS.NICKNAME_MIN, LIMITS.NICKNAME_MAX, '家庭内昵称')

  const found = await db.collection(COL.FAMILY)
    .where({ 'invite.code': rawCode, status: FAMILY_STATUS.ACTIVE })
    .limit(1)
    .get()
  const family = found.data && found.data[0]
  if (!family) throw new ApiError(E.INVITE_INVALID, '邀请码无效或家庭已解散')

  const expiresAt = family.invite && family.invite.expiresAt
  const expireTime = expiresAt ? new Date(expiresAt).getTime() : 0
  if (!expireTime || expireTime < Date.now()) {
    throw new ApiError(E.INVITE_EXPIRED, '邀请码已过期，请联系家庭管理员重新生成')
  }

  const maxMembers = Number(family.maxMembers) || LIMITS.MEMBER_DEFAULT
  const activeRes = await db.collection(COL.USER_FAMILY)
    .where({ familyId: family._id, status: ACTIVE })
    .count()
  if (activeRes.total >= maxMembers) {
    throw new ApiError(E.FAMILY_FULL, '家庭人数已达上限，请联系家庭管理员调整')
  }

  const now = new Date()
  try {
    await upsertMembership(db, ctx.openid, {
      familyId: family._id,
      role: ROLE.MEMBER,
      nickname: nickname,
      status: ACTIVE,
      joinedAt: now,
      updateTime: now
    })
  } catch (err) {
    console.error('[familyApi] joinFamily insert failed', { openid: ctx.openid, familyId: family._id, err: err })
    if (err instanceof ApiError) throw err
    throw new ApiError(E.CONFLICT, '加入家庭失败，请重试')
  }

  try {
    await db.collection(COL.FAMILY).doc(family._id).update({
      data: { memberOpenids: db.command.addToSet(ctx.openid), updateTime: now }
    })
  } catch (err) {
    console.error('[familyApi] joinFamily memberOpenids sync failed', { familyId: family._id, err: err })
  }

  return {
    familyId: family._id,
    familyName: family.name,
    role: ROLE.MEMBER,
    nickname: nickname
  }
}

// 重新生成邀请码，旧码立即失效
async function regenerateInvite(db, ctx) {
  const code = await generateUniqueCode(db)
  const now = new Date()
  const invite = buildInvite(code, ctx.openid, now)

  const res = await db.collection(COL.FAMILY)
    .where({ _id: ctx.familyId, status: FAMILY_STATUS.ACTIVE })
    .update({ data: { invite: invite, updateTime: now } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '邀请码更新失败，请重试')
  }
  return { inviteCode: code, expiresAt: invite.expiresAt }
}

// 调整人数上限，范围 = 当前有效成员数 ~ 50
async function updateCapacity(db, ctx, payload) {
  const target = Number(payload.maxMembers)
  if (!Number.isInteger(target) || target < 1) {
    throw new ApiError(E.INVALID_PAYLOAD, '人数上限需为大于 0 的整数')
  }
  if (target > LIMITS.MEMBER_HARD_MAX) {
    throw new ApiError(E.INVALID_PAYLOAD, '人数上限不能超过 ' + LIMITS.MEMBER_HARD_MAX)
  }

  const countRes = await db.collection(COL.USER_FAMILY)
    .where({ familyId: ctx.familyId, status: ACTIVE })
    .count()
  const current = countRes.total || 0
  if (target < current) {
    throw new ApiError(E.INVALID_PAYLOAD, '人数上限不能小于当前成员数 ' + current)
  }

  const res = await db.collection(COL.FAMILY)
    .where({ _id: ctx.familyId, status: FAMILY_STATUS.ACTIVE })
    .update({ data: { maxMembers: target, updateTime: new Date() } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '人数上限更新失败，请重试')
  }
  return { maxMembers: target, memberCount: current }
}

async function renameFamily(db, ctx, payload) {
  const name = assertText(payload.name, LIMITS.FAMILY_NAME_MIN, LIMITS.FAMILY_NAME_MAX, '家庭名称')
  const res = await db.collection(COL.FAMILY)
    .where({ _id: ctx.familyId, status: FAMILY_STATUS.ACTIVE })
    .update({ data: { name: name, updateTime: new Date() } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '家庭名称更新失败，请重试')
  }
  return { familyName: name }
}

// 授予或撤销管理员。创建者不能改自己的角色，也不能通过此动作转移创建者身份
async function setRole(db, ctx, payload) {
  const targetId = typeof payload.memberId === 'string' ? payload.memberId.trim() : ''
  const role = payload.role
  if (!targetId) throw new ApiError(E.INVALID_PAYLOAD, '缺少目标成员')
  if (targetId === ctx.openid) throw new ApiError(E.CANNOT_MODIFY_SELF, '不能修改自己的角色')
  if (role !== ROLE.ADMIN && role !== ROLE.MEMBER) {
    throw new ApiError(E.INVALID_ROLE, '角色只能是管理员或普通成员')
  }

  const target = await getRawMembership(db, targetId)
  if (!target || target.familyId !== ctx.familyId || target.status !== ACTIVE) {
    throw new ApiError(E.TARGET_NOT_FOUND, '目标成员不存在')
  }
  if (target.role === ROLE.OWNER) {
    throw new ApiError(E.FORBIDDEN, '不能修改创建者的角色')
  }
  if (target.role === role) return { memberId: targetId, role: role }

  const res = await db.collection(COL.USER_FAMILY)
    .where({ _id: targetId, familyId: ctx.familyId, status: ACTIVE })
    .update({ data: { role: role, updateTime: new Date() } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '角色更新失败，请重试')
  }
  return { memberId: targetId, role: role }
}

// 移除成员。管理员只能移除普通成员；创建者可移除管理员与普通成员
async function removeMember(db, ctx, payload) {
  const targetId = typeof payload.memberId === 'string' ? payload.memberId.trim() : ''
  if (!targetId) throw new ApiError(E.INVALID_PAYLOAD, '缺少目标成员')
  if (targetId === ctx.openid) {
    throw new ApiError(E.CANNOT_MODIFY_SELF, '不能移除自己，请使用退出家庭')
  }

  const target = await getRawMembership(db, targetId)
  if (!target || target.familyId !== ctx.familyId || target.status !== ACTIVE) {
    throw new ApiError(E.TARGET_NOT_FOUND, '目标成员不存在')
  }
  if (target.role === ROLE.OWNER) throw new ApiError(E.FORBIDDEN, '不能移除创建者')
  if (ctx.role === ROLE.ADMIN && target.role === ROLE.ADMIN) {
    throw new ApiError(E.FORBIDDEN, '管理员不能移除其他管理员')
  }

  const res = await db.collection(COL.USER_FAMILY)
    .where({ _id: targetId, familyId: ctx.familyId, status: ACTIVE })
    .update({ data: { status: MEMBERSHIP_STATUS.REMOVED, updateTime: new Date() } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '移除失败，请重试')
  }

  await pullMemberOpenid(db, ctx.familyId, targetId)
  // 历史点菜记录保留，不做任何删除
  return { memberId: targetId, removed: true }
}

// 主动退出。创建者不能退出，只能解散
async function leaveFamily(db, ctx) {
  if (ctx.role === ROLE.OWNER) {
    throw new ApiError(E.OWNER_CANNOT_LEAVE, '创建者不能退出家庭，只能解散')
  }

  const now = new Date()
  const res = await db.collection(COL.USER_FAMILY)
    .where({ _id: ctx.openid, familyId: ctx.familyId, status: ACTIVE })
    .update({ data: { status: MEMBERSHIP_STATUS.LEFT, updateTime: now } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '退出失败，请重试')
  }

  await pullMemberOpenid(db, ctx.familyId, ctx.openid)
  return { left: true }
}

// 解散家庭。只标记状态并阻断访问，不物理删除任何数据
async function dissolveFamily(db, ctx, payload) {
  if (payload.confirm !== true) {
    throw new ApiError(E.CONFIRM_REQUIRED, '解散家庭需要二次确认')
  }

  const now = new Date()
  const res = await db.collection(COL.FAMILY)
    .where({ _id: ctx.familyId, status: FAMILY_STATUS.ACTIVE })
    .update({
      data: {
        status: FAMILY_STATUS.DISSOLVED,
        memberOpenids: [],
        updateTime: now
        // invite 保留：唯一索引下清空会导致多个缺失值冲突
      }
    })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '解散失败，请重试')
  }

  // 成员关系置为退出，否则他们无法再加入其他家庭
  const memberRes = await db.collection(COL.USER_FAMILY)
    .where({ familyId: ctx.familyId, status: ACTIVE })
    .update({ data: { status: MEMBERSHIP_STATUS.LEFT, updateTime: now } })

  return { dissolved: true, releasedMembers: memberRes.stats ? memberRes.stats.updated : 0 }
}

async function listMembers(db, ctx) {
  const res = await db.collection(COL.USER_FAMILY)
    .where({ familyId: ctx.familyId, status: ACTIVE })
    .orderBy('joinedAt', 'asc')
    .limit(LIMITS.PAGE_SIZE_MAX)
    .get()

  const members = (res.data || []).map(function (item) {
    return {
      // memberId 用于后续角色变更与移除，UI 不展示
      memberId: item.openid,
      nickname: item.nickname,
      role: item.role,
      joinedAt: item.joinedAt,
      isSelf: item.openid === ctx.openid
    }
  })

  const invite = ctx.family && ctx.family.invite ? ctx.family.invite : null

  return {
    familyId: ctx.familyId,
    familyName: ctx.family ? ctx.family.name : '',
    // 邀请码对全部成员可见：家人都可以帮忙拉人；重新生成仍只限创建者与管理员
    inviteCode: invite ? invite.code : '',
    inviteExpiresAt: invite ? invite.expiresAt : null,
    maxMembers: ctx.family ? ctx.family.maxMembers : LIMITS.MEMBER_DEFAULT,
    role: ctx.role,
    isOwner: ctx.role === ROLE.OWNER,
    canManage: ctx.role === ROLE.OWNER || ctx.role === ROLE.ADMIN,
    members: members
  }
}

async function updateNickname(db, ctx, payload) {
  const nickname = assertText(payload.nickname, LIMITS.NICKNAME_MIN, LIMITS.NICKNAME_MAX, '家庭内昵称')
  const res = await db.collection(COL.USER_FAMILY)
    .where({ _id: ctx.openid, familyId: ctx.familyId, status: ACTIVE })
    .update({ data: { nickname: nickname, updateTime: new Date() } })
  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '昵称更新失败，请重试')
  }
  return { nickname: nickname }
}

// 自检动作：确认鉴权链路是否走通，不产生任何写入
async function ping(db, ctx) {
  return {
    openid: ctx.openid,
    hasFamily: !!ctx.familyId,
    familyId: ctx.familyId,
    familyName: ctx.family ? ctx.family.name : '',
    role: ctx.role,
    memberNickname: ctx.membership ? ctx.membership.nickname : ''
  }
}

const MANAGE = { roles: [ROLE.OWNER, ROLE.ADMIN] }
const OWNER_ONLY = { roles: [ROLE.OWNER] }

const ACTIONS = {
  ping: { auth: { requireFamily: false }, run: ping },
  createFamily: { auth: { requireFamily: false }, run: createFamily },
  joinFamily: { auth: { requireFamily: false }, run: joinFamily },
  listMembers: { auth: {}, run: listMembers },
  updateNickname: { auth: {}, run: updateNickname },
  regenerateInvite: { auth: MANAGE, run: regenerateInvite },
  updateCapacity: { auth: MANAGE, run: updateCapacity },
  renameFamily: { auth: MANAGE, run: renameFamily },
  setRole: { auth: OWNER_ONLY, run: setRole },
  removeMember: { auth: MANAGE, run: removeMember },
  leaveFamily: { auth: {}, run: leaveFamily },
  dissolveFamily: { auth: OWNER_ONLY, run: dissolveFamily }
}

module.exports = { ACTIONS }
