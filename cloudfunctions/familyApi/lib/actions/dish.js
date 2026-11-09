// 菜品领域动作。菜品本身的增删改查走白名单 CRUD，这里只放需要跨多条数据的动作。
const { COL, ROLE } = require('../constants')
const { ApiError, E } = require('../errors')
const SAMPLE_DISHES = require('../sampleDishes')

// 一次性导入 5 道示例菜。幂等：同名菜品已存在则跳过，可重复调用。
// 只允许创建者执行，避免成员无意中往家庭菜品库里灌数据。
async function seedSampleDishes(db, ctx) {
  const existing = await db.collection(COL.DISH)
    .where({ familyId: ctx.familyId })
    .field({ name: true })
    .limit(200)
    .get()

  const names = new Set((existing.data || []).map(function (item) { return item.name }))
  const pending = SAMPLE_DISHES.filter(function (item) { return !names.has(item.name) })

  if (pending.length === 0) {
    return { created: 0, skipped: SAMPLE_DISHES.length, failed: [] }
  }

  const now = new Date()
  let created = 0
  const failed = []

  // 云数据库没有批量插入接口，只能逐条写；已先批量查重，循环内不再查询
  for (const dish of pending) {
    try {
      await db.collection(COL.DISH).add({
        data: Object.assign({}, dish, {
          familyId: ctx.familyId,
          createdBy: ctx.openid,
          archived: false,
          version: 1,
          createTime: now,
          updateTime: now
        })
      })
      created++
    } catch (err) {
      console.error('[familyApi] seed dish failed', { name: dish.name, err: err })
      failed.push(dish.name)
    }
  }

  return {
    created: created,
    skipped: SAMPLE_DISHES.length - created,
    failed: failed
  }
}

// 撤销归档。归档是软删除，管理页需要一个对称的回退入口。
// 只有确实处于归档状态的菜品才会更新，避免无意义的写。
async function restoreDish(db, ctx, payload) {
  const id = typeof payload.dishId === 'string' ? payload.dishId.trim() : ''
  if (!id) throw new ApiError(E.INVALID_PAYLOAD, '缺少菜品')

  const res = await db.collection(COL.DISH)
    .where({ _id: id, familyId: ctx.familyId, archived: true })
    .update({ data: { archived: false, updateTime: new Date() } })

  if (!res.stats || res.stats.updated !== 1) {
    throw new ApiError(E.CONFLICT, '菜品不存在或未归档')
  }
  return { id: id, archived: false }
}

const manager = { roles: [ROLE.OWNER, ROLE.ADMIN] }

const ACTIONS = {
  seedSampleDishes: { auth: { roles: [ROLE.OWNER] }, run: seedSampleDishes },
  restoreDish: { auth: manager, run: restoreDish }
}

module.exports = { ACTIONS: ACTIONS }
