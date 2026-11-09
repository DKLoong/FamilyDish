// 鉴权中间件：openid → User → UserFamily → Family → role
// 身份来自 cloud.getWXContext()，客户端无法伪造；业务规则只在这里判定一次。
const cloud = require('wx-server-sdk')
const { COL, FAMILY_STATUS, MEMBERSHIP_STATUS } = require('./constants')
const { ApiError, E } = require('./errors')

function getOpenid() {
  const ctx = cloud.getWXContext() || {}
  return ctx.OPENID || ''
}

// doc().get() 在文档不存在时会抛错，统一折叠为 null
async function safeGet(db, collection, id) {
  if (!id) return null
  try {
    const res = await db.collection(collection).doc(id).get()
    return res && res.data ? res.data : null
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || ''
    // 只有「文档不存在」是预期分支，其余错误必须上抛，不能静默当作无数据
    if (/not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)) return null
    console.error('[familyApi] read failed', { collection: collection, id: id, err: e })
    throw new ApiError(E.INTERNAL_ERROR, '读取数据失败')
  }
}

async function loadMembership(db, openid) {
  const res = await db.collection(COL.USER_FAMILY)
    .where({ openid: openid, status: MEMBERSHIP_STATUS.ACTIVE })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

/**
 * options:
 *   requireUser    默认 false。User 只是身份存根，不是鉴权依据；只有确实需要 user 数据时才传 true
 *   requireFamily  默认 true。false 时允许「尚未加入家庭」，用于 createFamily / joinFamily
 *   requireActive  默认 true。false 时不校验 Family.status
 *   roles          允许的角色数组，不传表示不限
 */
async function authenticate(db, openid, options) {
  const opts = options || {}
  if (!openid) throw new ApiError(E.NO_OPENID, '无法获取用户身份')

  const user = await safeGet(db, COL.USER, openid)
  if (opts.requireUser === true && !user) {
    throw new ApiError(E.USER_NOT_FOUND, '用户信息不存在，请重新进入小程序')
  }

  const membership = await loadMembership(db, openid)
  const ctx = {
    openid: openid,
    user: user,
    membership: membership,
    familyId: null,
    family: null,
    role: null
  }

  if (!membership) {
    if (opts.requireFamily === false) return ctx
    throw new ApiError(E.NO_FAMILY, '尚未加入家庭')
  }

  ctx.familyId = membership.familyId
  ctx.role = membership.role
  ctx.family = await safeGet(db, COL.FAMILY, membership.familyId)

  if (!ctx.family) {
    if (opts.requireFamily === false) return ctx
    throw new ApiError(E.NO_FAMILY, '家庭不存在或已被解散')
  }
  if (opts.requireActive !== false && ctx.family.status !== FAMILY_STATUS.ACTIVE) {
    throw new ApiError(E.FAMILY_INACTIVE, '家庭已解散')
  }
  if (Array.isArray(opts.roles) && opts.roles.length > 0 && !opts.roles.includes(ctx.role)) {
    throw new ApiError(E.FORBIDDEN, '当前角色无权执行该操作')
  }
  return ctx
}

module.exports = { getOpenid, safeGet, loadMembership, authenticate }
