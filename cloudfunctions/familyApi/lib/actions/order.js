// 点菜领域动作：点菜、完成、取消。
// 一条记录只含一道菜，状态 pending → completed / cancelled，终态不可再变。
const { COL, ROLE, ORDER_STATUS, SHOPPING_SOURCE } = require('../constants')
const { ApiError, E } = require('../errors')

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '其他']
const REMARK_MAX = 100

function isNotFound(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)
}

function normalizeMealDate(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApiError(E.INVALID_PAYLOAD, '用餐日期格式应为 YYYY-MM-DD')
  }
  return text
}

function normalizeMealType(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (MEAL_TYPES.indexOf(text) < 0) {
    throw new ApiError(E.INVALID_PAYLOAD, '餐次只能是：' + MEAL_TYPES.join(' / '))
  }
  return text
}

function normalizeRemark(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > REMARK_MAX) {
    throw new ApiError(E.INVALID_PAYLOAD, '备注不能超过 ' + REMARK_MAX + ' 个字符')
  }
  return text
}

async function readOwnedDoc(db, collection, id, familyId, label) {
  let doc = null
  try {
    const res = await db.collection(collection).doc(id).get()
    doc = res && res.data ? res.data : null
  } catch (err) {
    if (!isNotFound(err)) {
      console.error('[familyApi] read ' + collection + ' failed', { id: id, err: err })
      throw new ApiError(E.INTERNAL_ERROR, '读取' + label + '失败')
    }
  }
  if (!doc) throw new ApiError(E.NOT_FOUND, label + '不存在')
  if (doc.familyId !== familyId) throw new ApiError(E.FORBIDDEN, '无权访问该' + label)
  return doc
}

async function findOrderByRequestId(db, familyId, requestId) {
  const res = await db.collection(COL.ORDER)
    .where({ familyId: familyId, requestId: requestId })
    .limit(1)
    .get()
  return res.data && res.data[0] ? res.data[0] : null
}

// 写入失败时回收已产生的数据，避免留下「有订单没食材」的半成品
async function rollbackOrder(db, orderId, shoppingIds) {
  for (const id of shoppingIds) {
    try {
      await db.collection(COL.SHOPPING).doc(id).remove()
    } catch (err) {
      console.error('[familyApi] rollback shopping failed', { id: id, err: err })
    }
  }
  try {
    await db.collection(COL.ORDER).doc(orderId).remove()
  } catch (err) {
    console.error('[familyApi] rollback order failed', { orderId: orderId, err: err })
  }
}

async function placeOrder(db, ctx, payload) {
  const dishId = typeof payload.dishId === 'string' ? payload.dishId.trim() : ''
  const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : ''

  if (!dishId) throw new ApiError(E.INVALID_PAYLOAD, '缺少菜品')
  if (!requestId || requestId.length < 8 || requestId.length > 64) {
    throw new ApiError(E.INVALID_PAYLOAD, '缺少有效的请求标识')
  }

  // 幂等：同一 requestId 只生成一条记录，重复提交直接返回原单
  const duplicated = await findOrderByRequestId(db, ctx.familyId, requestId)
  if (duplicated) {
    return { orderId: duplicated._id, duplicated: true, shoppingCount: 0 }
  }

  const dish = await readOwnedDoc(db, COL.DISH, dishId, ctx.familyId, '菜品')
  if (dish.archived) throw new ApiError(E.INVALID_PAYLOAD, '该菜品已归档，无法点菜')

  const preparedKeys = Array.isArray(payload.preparedKeys)
    ? payload.preparedKeys.filter(function (key) { return typeof key === 'string' })
    : []

  const ingredients = (dish.ingredients || []).map(function (item, index) {
    return {
      key: item.key || 'i' + (index + 1),
      name: item.name,
      quantity: typeof item.quantity === 'number' ? item.quantity : null,
      unit: item.unit || '',
      note: item.note || ''
    }
  })

  // 只有「未标记已准备」的食材才进入购物清单
  const pendingIngredients = ingredients.filter(function (item) {
    return preparedKeys.indexOf(item.key) < 0
  })

  const now = new Date()
  const orderId = 'o' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 8)

  const dishSnapshot = {
    name: dish.name,
    image: dish.image || '',
    ingredients: ingredients,
    steps: (dish.steps || []).map(function (item) {
      return { text: item.text, minutes: item.minutes || null, image: item.image || '' }
    }),
    difficulty: dish.difficulty || '',
    time: dish.time || 0,
    tips: dish.tips || ''
  }

  await db.collection(COL.ORDER).add({
    data: {
      _id: orderId,
      orderId: orderId,
      familyId: ctx.familyId,
      dishId: dishId,
      dishSnapshot: dishSnapshot,
      ordererOpenid: ctx.openid,
      ordererNickname: ctx.membership ? ctx.membership.nickname : '',
      mealDate: normalizeMealDate(payload.mealDate),
      mealType: normalizeMealType(payload.mealType),
      remark: normalizeRemark(payload.remark),
      status: ORDER_STATUS.PENDING,
      statusTimes: { createdAt: now, completedAt: null, cancelledAt: null },
      requestId: requestId,
      createTime: now,
      updateTime: now
    }
  })

  const createdIds = []
  try {
    for (const item of pendingIngredients) {
      const res = await db.collection(COL.SHOPPING).add({
        data: {
          familyId: ctx.familyId,
          sourceType: SHOPPING_SOURCE.ORDER,
          orderId: orderId,
          dishId: dishId,
          ingredient: item,
          purchased: false,
          purchasedBy: '',
          purchasedAt: null,
          purchaseGroupId: '',
          createdBy: ctx.openid,
          createTime: now
        }
      })
      createdIds.push(res._id)
    }
  } catch (err) {
    console.error('[familyApi] placeOrder shopping failed', { orderId: orderId, err: err })
    await rollbackOrder(db, orderId, createdIds)
    throw new ApiError(E.INTERNAL_ERROR, '点菜失败，请重试')
  }

  return { orderId: orderId, duplicated: false, shoppingCount: createdIds.length }
}

function assertOperable(ctx, order) {
  const isManager = ctx.role === ROLE.OWNER || ctx.role === ROLE.ADMIN
  const isOrderer = order.ordererOpenid === ctx.openid
  if (!isManager && !isOrderer) {
    throw new ApiError(E.FORBIDDEN, '只能操作自己点的菜')
  }
}

function requireOrderId(payload) {
  const orderId = typeof payload.orderId === 'string' ? payload.orderId.trim() : ''
  if (!orderId) throw new ApiError(E.INVALID_PAYLOAD, '缺少点菜记录')
  return orderId
}

async function completeOrder(db, ctx, payload) {
  const orderId = requireOrderId(payload)
  const order = await readOwnedDoc(db, COL.ORDER, orderId, ctx.familyId, '点菜记录')
  assertOperable(ctx, order)

  const now = new Date()
  const res = await db.collection(COL.ORDER)
    .where({ _id: orderId, familyId: ctx.familyId, status: ORDER_STATUS.PENDING })
    .update({
      data: {
        status: ORDER_STATUS.COMPLETED,
        'statusTimes.completedAt': now,
        updateTime: now
      }
    })

  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '该记录已处理或状态已变更')
  }
  // 完成不改变购物清单：食材可能已经买了
  return { orderId: orderId, status: ORDER_STATUS.COMPLETED }
}

async function cancelOrder(db, ctx, payload) {
  const orderId = requireOrderId(payload)
  const order = await readOwnedDoc(db, COL.ORDER, orderId, ctx.familyId, '点菜记录')
  assertOperable(ctx, order)

  const now = new Date()
  const res = await db.collection(COL.ORDER)
    .where({ _id: orderId, familyId: ctx.familyId, status: ORDER_STATUS.PENDING })
    .update({
      data: {
        status: ORDER_STATUS.CANCELLED,
        'statusTimes.cancelledAt': now,
        updateTime: now
      }
    })

  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '该记录已处理或状态已变更')
  }

  // 取消时移除这次点菜带入的购物来源，其他订单的食材不受影响
  let removedShopping = 0
  try {
    const shoppingRes = await db.collection(COL.SHOPPING)
      .where({ familyId: ctx.familyId, orderId: orderId })
      .remove()
    removedShopping = shoppingRes.stats ? shoppingRes.stats.removed : 0
  } catch (err) {
    // 订单已取消，购物清单残留不影响主流程，记录日志供排查
    console.error('[familyApi] cancelOrder remove shopping failed', { orderId: orderId, err: err })
  }

  return { orderId: orderId, status: ORDER_STATUS.CANCELLED, removedShopping: removedShopping }
}

const ACTIONS = {
  placeOrder: { auth: {}, run: placeOrder },
  completeOrder: { auth: {}, run: completeOrder },
  cancelOrder: { auth: {}, run: cancelOrder }
}

module.exports = { ACTIONS: ACTIONS, MEAL_TYPES: MEAL_TYPES }
