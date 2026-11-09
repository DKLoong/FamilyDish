// ensureUser —— 幂等创建用户存根，并返回当前家庭上下文。
// 替代上游 createUser（注册与绑定合一）。本函数不做任何绑定动作，只读状态。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COL_USER = 'User'
const COL_USER_FAMILY = 'UserFamily'
const COL_FAMILY = 'Family'
const MEMBERSHIP_ACTIVE = 'active'

function respond(success, code, message, data) {
  return {
    success: success,
    code: code,
    message: message || '',
    data: data === undefined ? null : data
  }
}

function isNotFound(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)
}

async function ensureUserDoc(openid) {
  try {
    const res = await db.collection(COL_USER).doc(openid).get()
    if (res && res.data) {
      try {
        await db.collection(COL_USER).doc(openid).update({ data: { lastSeenAt: new Date() } })
      } catch (err) {
        console.error('[ensureUser] touch lastSeenAt failed', err)
      }
      return res.data
    }
  } catch (err) {
    if (!isNotFound(err)) {
      console.error('[ensureUser] read user failed', err)
      throw err
    }
  }

  const now = new Date()
  // doc(id).set 是 upsert 语义：不存在则创建、存在则覆盖，不会因主键冲突失败。
  // 相比 add 更耐并发，也不依赖「自定义 _id 是否被允许」这一行为。
  await db.collection(COL_USER).doc(openid).set({
    data: { createTime: now, lastSeenAt: now }
  })
  return { _id: openid }
}

async function loadMembership(openid) {
  const res = await db.collection(COL_USER_FAMILY)
    .where({ openid: openid, status: MEMBERSHIP_ACTIVE })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function loadFamily(familyId) {
  if (!familyId) return null
  try {
    const res = await db.collection(COL_FAMILY).doc(familyId).get()
    return res && res.data ? res.data : null
  } catch (err) {
    if (isNotFound(err)) return null
    console.error('[ensureUser] read family failed', err)
    throw err
  }
}

exports.main = async function () {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  if (!openid) return respond(false, 'NO_OPENID', '无法获取用户身份')

  // 开发期执行轨迹：失败时能直接看出卡在哪一步。定位完成后可以移除。
  const trace = ['openid_ok']

  try {
    await ensureUserDoc(openid)
    trace.push('user_ok')

    const membership = await loadMembership(openid)
    trace.push(membership ? 'membership_found' : 'membership_empty')

    const family = membership ? await loadFamily(membership.familyId) : null
    if (membership) trace.push(family ? 'family_found' : 'family_missing')

    return respond(true, 'OK', '', {
      trace: trace,
      openid: openid,
      nickname: membership ? membership.nickname : '',
      membership: membership
        ? {
            familyId: membership.familyId,
            role: membership.role,
            nickname: membership.nickname
          }
        : null,
      family: family
        ? {
            familyId: family._id,
            name: family.name,
            status: family.status,
            maxMembers: family.maxMembers
          }
        : null
    })
  } catch (err) {
    console.error('[ensureUser] unhandled error', err)
    const detail = (err && (err.errMsg || err.message)) || '未知错误'
    // 开发期把错误信息透传到返回值，避免只能翻云端日志
    return respond(false, 'INTERNAL_ERROR', '服务异常：' + detail, { trace: trace })
  }
}
