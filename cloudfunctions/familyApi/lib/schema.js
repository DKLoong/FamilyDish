// 集合与字段白名单。这里是唯一允许定义「前端能写什么」的地方。
// 新增集合或字段必须改本文件，不允许在动作代码里临时放行。
const { COL, ROLE, PROTECTED_FIELDS, LIMITS } = require('./constants')
const { ApiError, E } = require('./errors')

const TABLES = {
  [COL.DISH]: {
    readOps: ['list', 'get'],
    writeOps: ['add', 'update', 'archive'],
    writeRoles: [ROLE.OWNER, ROLE.ADMIN],
    addFields: ['name', 'image', 'category', 'description', 'ingredients', 'steps', 'difficulty', 'time', 'tips'],
    updateFields: ['name', 'image', 'category', 'description', 'ingredients', 'steps', 'difficulty', 'time', 'tips'],
    filters: ['archived', 'category'],
    orderBy: ['createTime', 'updateTime', 'name'],
    defaultOrderBy: 'createTime',
    defaultOrder: 'desc',
    createDefaults: { archived: false, version: 1 }
  },
  [COL.CATEGORY]: {
    readOps: ['list', 'get'],
    writeOps: ['add', 'update', 'remove'],
    writeRoles: [ROLE.OWNER, ROLE.ADMIN],
    addFields: ['name', 'sort'],
    updateFields: ['name', 'sort'],
    filters: [],
    orderBy: ['sort', 'createTime'],
    defaultOrderBy: 'sort',
    defaultOrder: 'asc',
    createDefaults: {}
  },
  [COL.SHOPPING]: {
    readOps: ['list', 'get'],
    writeOps: ['add', 'remove'],
    writeRoles: [ROLE.OWNER, ROLE.ADMIN, ROLE.MEMBER],
    addFields: ['ingredient'],
    updateFields: [],
    filters: ['purchased', 'sourceType'],
    orderBy: ['createTime'],
    defaultOrderBy: 'createTime',
    defaultOrder: 'desc',
    createDefaults: {},
    // 普通成员只能删除自己添加的手工项目；管理员与创建者可删任意项目
    removeRule: 'self-manual-unless-admin'
  },
  [COL.ORDER]: {
    readOps: ['list', 'get'],
    writeOps: [],
    writeRoles: [],
    filters: ['status', 'dishId', 'mealDate'],
    orderBy: ['createTime', 'updateTime'],
    defaultOrderBy: 'createTime',
    defaultOrder: 'desc'
  }
}

// 这三类集合只允许通过领域动作写入，前端不能直接 CRUD
const DOMAIN_ONLY = [COL.USER, COL.FAMILY, COL.USER_FAMILY]

function getTable(collection) {
  if (typeof collection !== 'string' || !collection) {
    throw new ApiError(E.BAD_REQUEST, '缺少集合名')
  }
  if (DOMAIN_ONLY.includes(collection)) {
    throw new ApiError(E.COLLECTION_NOT_ALLOWED, '该集合只允许通过领域动作操作')
  }
  const table = TABLES[collection]
  if (!table) {
    throw new ApiError(E.COLLECTION_NOT_ALLOWED, '不允许的集合：' + collection)
  }
  return table
}

// 返回 'read' | 'write'，并在此处完成角色校验
function assertOp(collection, op, role) {
  const table = getTable(collection)
  if (!op || typeof op !== 'string') {
    throw new ApiError(E.BAD_REQUEST, '缺少操作类型')
  }
  if (table.readOps.includes(op)) return 'read'
  if (!table.writeOps.includes(op)) {
    throw new ApiError(E.OP_NOT_ALLOWED, '集合 ' + collection + ' 不支持操作：' + op)
  }
  if (!table.writeRoles.includes(role)) {
    throw new ApiError(E.FORBIDDEN, '当前角色无权执行该操作')
  }
  return 'write'
}

// 逐字段校验：受保护字段直接拒绝，未在白名单内的字段也拒绝（不做静默丢弃，
// 否则前端传错字段名时会以为写入成功）。
function sanitize(collection, op, data) {
  const table = getTable(collection)
  const allowed = op === 'add' ? table.addFields : table.updateFields
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new ApiError(E.OP_NOT_ALLOWED, '集合 ' + collection + ' 不支持写入操作：' + op)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(E.INVALID_PAYLOAD, '写入内容必须是对象')
  }

  const cleaned = {}
  const keys = Object.keys(data)
  for (const key of keys) {
    if (PROTECTED_FIELDS.includes(key)) {
      throw new ApiError(E.FIELD_PROTECTED, '字段由服务端维护：' + key)
    }
    if (!allowed.includes(key)) {
      throw new ApiError(E.FIELD_NOT_ALLOWED, '集合 ' + collection + ' 不允许写入字段：' + key)
    }
    cleaned[key] = data[key]
  }
  if (Object.keys(cleaned).length === 0) {
    throw new ApiError(E.EMPTY_PAYLOAD, '没有可写入的字段')
  }
  return cleaned
}

function normalizePaging(input) {
  const raw = input || {}
  let limit = Number(raw.limit)
  if (!Number.isFinite(limit) || limit <= 0) limit = LIMITS.PAGE_SIZE_DEFAULT
  limit = Math.min(Math.floor(limit), LIMITS.PAGE_SIZE_MAX)
  let skip = Number(raw.skip)
  if (!Number.isFinite(skip) || skip < 0) skip = 0
  return { limit, skip: Math.floor(skip) }
}

function normalizeOrder(table, input) {
  const raw = input || {}
  const orderBy = table.orderBy.includes(raw.orderBy) ? raw.orderBy : table.defaultOrderBy
  const order = raw.order === 'asc' || raw.order === 'desc' ? raw.order : table.defaultOrder
  return { orderBy, order }
}

module.exports = {
  TABLES,
  DOMAIN_ONLY,
  getTable,
  assertOp,
  sanitize,
  normalizePaging,
  normalizeOrder
}
