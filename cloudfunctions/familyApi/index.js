// familyApi —— FamilyDish 唯一读写入口。
// 两类请求：
//   { action, payload }                         领域动作，动作名固定，不接收集合名
//   { collection, op, id?, data?, filters? }    白名单 CRUD
// 鉴权、集合白名单、字段白名单、归属注入都在本函数内完成，前端无法绕过。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const { ok, fail } = require('./lib/response')
const { ApiError, E } = require('./lib/errors')
const { getOpenid, authenticate } = require('./lib/auth')
const crud = require('./lib/crud')
const { ACTIONS: FAMILY_ACTIONS } = require('./lib/actions/family')
const { ACTIONS: DISH_ACTIONS } = require('./lib/actions/dish')
const { ACTIONS: ORDER_ACTIONS } = require('./lib/actions/order')

// 动作注册表：新增动作模块时在此合并，动作名全局唯一
const ACTIONS = Object.assign({}, FAMILY_ACTIONS, DISH_ACTIONS, ORDER_ACTIONS)

exports.main = async function (event) {
  try {
    const openid = getOpenid()
    if (!openid) return fail(E.NO_OPENID, '无法获取用户身份')

    const input = event && typeof event === 'object' ? event : {}
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : {}

    if (input.action) {
      return await runAction(openid, input.action, payload)
    }
    if (input.collection || input.op) {
      return await runCrud(openid, input)
    }
    return fail(E.BAD_REQUEST, '请指定 action，或 collection + op')
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message)
    }
    console.error('[familyApi] unhandled error', err)
    return fail(E.INTERNAL_ERROR, '服务异常，请稍后重试')
  }
}

async function runAction(openid, action, payload) {
  const entry = ACTIONS[action]
  if (!entry) {
    return fail(E.UNKNOWN_ACTION, '不支持的动作：' + action)
  }
  const ctx = await authenticate(db, openid, entry.auth || {})
  const data = await entry.run(db, ctx, payload)
  return ok(data)
}

async function runCrud(openid, input) {
  const payload = {
    collection: input.collection,
    op: input.op,
    id: input.id,
    data: input.data,
    filters: input.filters,
    orderBy: input.orderBy,
    order: input.order,
    limit: input.limit,
    skip: input.skip
  }
  // CRUD 一律要求已加入有效家庭
  const ctx = await authenticate(db, openid, {})
  const data = await crud.run(db, ctx, payload)
  return ok(data)
}
