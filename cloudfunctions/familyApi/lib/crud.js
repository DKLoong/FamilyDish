// 白名单 CRUD。所有查询强制附加 familyId，所有写入强制注入服务端字段。
// 前端永远无法指定归属家庭、创建者或受保护字段。
const { COL, ROLE, SHOPPING_SOURCE } = require('./constants')
const { ApiError, E } = require('./errors')
const schema = require('./schema')

function buildWhere(collection, table, ctx, filters) {
  const where = { familyId: ctx.familyId }
  const input = filters && typeof filters === 'object' ? filters : {}
  for (const key of table.filters || []) {
    if (input[key] !== undefined && input[key] !== null) where[key] = input[key]
  }
  // 菜品列表默认只返回未归档；显式传 archived 时以传入值为准
  if (collection === COL.DISH && where.archived === undefined) where.archived = false
  return where
}

async function list(db, ctx, payload) {
  const collection = payload.collection
  const table = schema.getTable(collection)
  const paging = schema.normalizePaging(payload)
  const order = schema.normalizeOrder(table, payload)
  const where = buildWhere(collection, table, ctx, payload.filters)

  const col = db.collection(collection)
  const countRes = await col.where(where).count()
  const res = await col.where(where)
    .orderBy(order.orderBy, order.order)
    .skip(paging.skip)
    .limit(paging.limit)
    .get()

  return {
    items: res.data || [],
    total: countRes.total || 0,
    limit: paging.limit,
    skip: paging.skip
  }
}

async function getOwnedDoc(db, collection, id, familyId) {
  if (!id || typeof id !== 'string') throw new ApiError(E.BAD_REQUEST, '缺少文档 id')
  let doc = null
  try {
    const res = await db.collection(collection).doc(id).get()
    doc = res && res.data ? res.data : null
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || ''
    if (/not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)) {
      doc = null
    } else {
      console.error('[familyApi] read doc failed', collection, id, e)
      throw new ApiError(E.INTERNAL_ERROR, '读取数据失败')
    }
  }
  if (!doc) throw new ApiError(E.NOT_FOUND, '数据不存在')
  if (doc.familyId !== familyId) throw new ApiError(E.FORBIDDEN, '无权访问该数据')
  return doc
}

async function get(db, ctx, payload) {
  schema.getTable(payload.collection)
  const doc = await getOwnedDoc(db, payload.collection, payload.id, ctx.familyId)
  return doc
}

async function add(db, ctx, payload) {
  const collection = payload.collection
  const table = schema.getTable(collection)
  const cleaned = schema.sanitize(collection, 'add', payload.data)
  const now = new Date()

  const doc = Object.assign({}, table.createDefaults || {}, cleaned, {
    familyId: ctx.familyId,
    createdBy: ctx.openid,
    createTime: now,
    updateTime: now
  })

  if (collection === COL.SHOPPING) {
    // 手工项目：来源与购买状态由服务端固定，不接受前端传入
    doc.sourceType = SHOPPING_SOURCE.MANUAL
    doc.orderId = null
    doc.purchased = false
    doc.purchasedBy = ''
    doc.purchasedAt = null
    doc.purchaseGroupId = ''
    doc.ingredient = normalizeIngredient(doc.ingredient)
  }

  if (collection === COL.DISH && !String(doc.name || '').trim()) {
    throw new ApiError(E.INVALID_PAYLOAD, '菜品名称必填')
  }
  if (collection === COL.CATEGORY && !String(doc.name || '').trim()) {
    throw new ApiError(E.INVALID_PAYLOAD, '分类名称必填')
  }

  const res = await db.collection(collection).add({ data: doc })
  return { id: res._id }
}

function normalizeIngredient(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(E.INVALID_PAYLOAD, '食材内容格式不正确')
  }
  const name = String(input.name || '').trim()
  if (!name) throw new ApiError(E.INVALID_PAYLOAD, '食材名称必填')
  const quantity = typeof input.quantity === 'number' && Number.isFinite(input.quantity) ? input.quantity : null
  return {
    name: name,
    quantity: quantity,
    unit: input.unit ? String(input.unit).trim() : '',
    note: input.note ? String(input.note).trim() : ''
  }
}

async function update(db, ctx, payload) {
  const collection = payload.collection
  const table = schema.getTable(collection)
  const cleaned = schema.sanitize(collection, 'update', payload.data)
  const existing = await getOwnedDoc(db, collection, payload.id, ctx.familyId)

  const res = await db.collection(collection)
    .where({ _id: existing._id, familyId: ctx.familyId })
    .update({ data: Object.assign({}, cleaned, { updateTime: new Date() }) })

  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '更新失败，数据可能已被他人修改')
  }
  return { id: existing._id, updated: res.stats.updated }
}

async function archive(db, ctx, payload) {
  const existing = await getOwnedDoc(db, COL.DISH, payload.id, ctx.familyId)
  if (existing.archived) return { id: existing._id, archived: true }

  const res = await db.collection(COL.DISH)
    .where({ _id: existing._id, familyId: ctx.familyId })
    .update({ data: { archived: true, updateTime: new Date() } })

  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '归档失败，请重试')
  }
  return { id: existing._id, archived: true }
}

async function remove(db, ctx, payload) {
  const collection = payload.collection
  const table = schema.getTable(collection)
  const existing = await getOwnedDoc(db, collection, payload.id, ctx.familyId)

  if (table.removeRule === 'self-manual-unless-admin') {
    const isAdmin = ctx.role === ROLE.OWNER || ctx.role === ROLE.ADMIN
    if (!isAdmin) {
      const isOwnManual = existing.createdBy === ctx.openid && existing.sourceType === SHOPPING_SOURCE.MANUAL
      if (!isOwnManual) throw new ApiError(E.FORBIDDEN, '只能删除自己添加的项目')
    }
  }

  const res = await db.collection(collection)
    .where({ _id: existing._id, familyId: ctx.familyId })
    .remove()

  if (!res.stats || res.stats.removed !== 1) {
    throw new ApiError(E.CONFLICT, '删除失败，请重试')
  }
  return { id: existing._id, removed: res.stats.removed }
}

const HANDLERS = { list, get, add, update, archive, remove }

async function run(db, ctx, payload) {
  const op = payload.op
  const handler = HANDLERS[op]
  if (!handler) throw new ApiError(E.OP_NOT_ALLOWED, '不支持的操作类型：' + op)
  schema.assertOp(payload.collection, op, ctx.role)
  return handler(db, ctx, payload)
}

module.exports = { run, list, get, add, update, archive, remove, getOwnedDoc, normalizeIngredient, buildWhere }
