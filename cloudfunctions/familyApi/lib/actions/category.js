// 分类领域动作。首版分类是「名称 + 排序」的轻量标签，不是独立实体：
// 菜品上仍存分类文本，重命名时由本模块批量同步，避免菜品存 categoryId 带来的迁移成本。
const { COL, ROLE, LIMITS } = require('../constants')
const { ApiError, E } = require('../errors')

const NAME_MAX = 12

function assertName(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new ApiError(E.INVALID_PAYLOAD, '分类名称必填')
  if (text.length > NAME_MAX) {
    throw new ApiError(E.INVALID_PAYLOAD, '分类名称不能超过 ' + NAME_MAX + ' 个字')
  }
  return text
}

function isNotFound(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)
}

async function readOwnedCategory(db, id, familyId) {
  let doc = null
  try {
    const res = await db.collection(COL.CATEGORY).doc(id).get()
    doc = res && res.data ? res.data : null
  } catch (err) {
    if (!isNotFound(err)) {
      console.error('[familyApi] read category failed', { id: id, err: err })
      throw new ApiError(E.INTERNAL_ERROR, '读取分类失败')
    }
  }
  if (!doc) throw new ApiError(E.NOT_FOUND, '分类不存在')
  if (doc.familyId !== familyId) throw new ApiError(E.FORBIDDEN, '无权操作该分类')
  return doc
}

async function listCategories(db, familyId) {
  const res = await db.collection(COL.CATEGORY)
    .where({ familyId: familyId })
    .orderBy('sort', 'asc')
    .limit(LIMITS.PAGE_SIZE_MAX)
    .get()
  return res.data || []
}

// 未归档菜品里出现过的分类名，按首次出现顺序去重
async function dishCategoryNames(db, familyId) {
  const res = await db.collection(COL.DISH)
    .where({ familyId: familyId, archived: false })
    .limit(LIMITS.PAGE_SIZE_MAX)
    .get()
  const names = []
  for (const dish of res.data || []) {
    const name = String(dish.category || '').trim()
    if (name && names.indexOf(name) < 0) names.push(name)
  }
  return names
}

// 幂等同步：把菜品里已存在、但分类表还没登记的分类补进去。
// 用于接入老数据和示例菜，避免用户第一次进分类页看到空列表。
async function syncCategories(db, ctx) {
  const rows = await listCategories(db, ctx.familyId)
  const known = rows.map(function (item) { return item.name })
  const dishNames = await dishCategoryNames(db, ctx.familyId)
  const missing = dishNames.filter(function (name) { return known.indexOf(name) < 0 })

  if (missing.length === 0) {
    return { created: 0, total: known.length, names: known }
  }

  const maxSort = rows.reduce(function (acc, item) {
    const value = Number(item.sort) || 0
    return value > acc ? value : acc
  }, 0)

  const now = new Date()
  let sort = maxSort
  for (const name of missing) {
    sort += 1
    try {
      await db.collection(COL.CATEGORY).add({
        data: {
          familyId: ctx.familyId,
          name: name,
          sort: sort,
          createdBy: ctx.openid,
          createTime: now,
          updateTime: now
        }
      })
    } catch (err) {
      console.error('[familyApi] sync category failed', { name: name, err: err })
      throw new ApiError(E.INTERNAL_ERROR, '同步分类失败，请重试')
    }
  }

  return { created: missing.length, total: known.length + missing.length, names: known.concat(missing) }
}

// 无 id 新建；有 id 重命名，并批量把菜品上的旧分类名改掉
async function saveCategory(db, ctx, payload) {
  const name = assertName(payload.name)
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  const now = new Date()

  if (!id) {
    const dup = await db.collection(COL.CATEGORY)
      .where({ familyId: ctx.familyId, name: name })
      .count()
    if (dup.total > 0) throw new ApiError(E.CONFLICT, '已有同名分类')

    const rows = await listCategories(db, ctx.familyId)
    const maxSort = rows.reduce(function (acc, item) {
      const value = Number(item.sort) || 0
      return value > acc ? value : acc
    }, 0)

    const res = await db.collection(COL.CATEGORY).add({
      data: {
        familyId: ctx.familyId,
        name: name,
        sort: maxSort + 1,
        createdBy: ctx.openid,
        createTime: now,
        updateTime: now
      }
    })
    return { id: res._id, name: name, renamedDishes: 0, created: true }
  }

  const current = await readOwnedCategory(db, id, ctx.familyId)
  const oldName = current.name
  if (oldName === name) {
    return { id: id, name: name, renamedDishes: 0, created: false }
  }

  const dup = await db.collection(COL.CATEGORY)
    .where({ familyId: ctx.familyId, name: name })
    .count()
  if (dup.total > 0) throw new ApiError(E.CONFLICT, '已有同名分类')

  await db.collection(COL.CATEGORY)
    .where({ _id: id, familyId: ctx.familyId })
    .update({ data: { name: name, updateTime: now } })

  // 分类改名必须带上菜品，否则菜品会挂在一个不存在的分类上。
  // 只改 category 字段，不动 version，避免无谓地重置「已准备」勾选。
  // 用 oldName 而不是 current.name：改名后 current 可能已被上层对象复用。
  const dishes = await db.collection(COL.DISH)
    .where({ familyId: ctx.familyId, category: oldName })
    .limit(LIMITS.PAGE_SIZE_MAX)
    .get()

  let renamedDishes = 0
  let failed = 0
  for (const dish of dishes.data || []) {
    try {
      const res = await db.collection(COL.DISH)
        .where({ _id: dish._id, familyId: ctx.familyId })
        .update({ data: { category: name, updateTime: now } })
      if (res.stats && res.stats.updated === 1) renamedDishes++
    } catch (err) {
      console.error('[familyApi] sync dish category failed', { dishId: dish._id, err: err })
      failed++
    }
  }

  return { id: id, name: name, renamedDishes: renamedDishes, failedDishes: failed, created: false }
}

async function reorderCategories(db, ctx, payload) {
  const ids = Array.isArray(payload.ids) ? payload.ids : []
  if (ids.length === 0) throw new ApiError(E.INVALID_PAYLOAD, '缺少分类顺序')

  const now = new Date()
  let sort = 0
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue
    sort += 1
    await db.collection(COL.CATEGORY)
      .where({ _id: id, familyId: ctx.familyId })
      .update({ data: { sort: sort, updateTime: now } })
  }
  return { updated: sort }
}

const manager = { auth: { roles: [ROLE.OWNER, ROLE.ADMIN] } }

const ACTIONS = {
  syncCategories: { auth: manager.auth, run: syncCategories },
  saveCategory: { auth: manager.auth, run: saveCategory },
  reorderCategories: { auth: manager.auth, run: reorderCategories }
}

module.exports = { ACTIONS: ACTIONS }
