// 购物清单领域动作：勾选已购买、取消已购买、清空已购。
// 购物项按来源独立存储（订单来源 / 手工添加），合并只发生在展示层，
// 因此这里只处理「某几条记录一起变更状态」，不维护合并后的数量字段。
const { COL, ROLE } = require('../constants')
const { ApiError, E } = require('../errors')

// 一个合并组内的来源条数上限。家庭场景远低于此，超量说明调用异常。
const MAX_BATCH = 100

function requireIds(payload) {
  const raw = payload.ids
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(E.INVALID_PAYLOAD, '请选择要操作的项目')
  }
  if (raw.length > MAX_BATCH) {
    throw new ApiError(E.INVALID_PAYLOAD, '一次最多操作 ' + MAX_BATCH + ' 项')
  }
  const ids = []
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new ApiError(E.INVALID_PAYLOAD, '项目标识格式不正确')
    }
    // 去重：同一 id 重复传入不应导致重复写入
    if (ids.indexOf(item) < 0) ids.push(item)
  }
  return ids
}

function isNotFound(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /not exist|not found|DOCUMENT_NOT_FOUND/i.test(msg)
}

async function readOwnedItem(db, id, familyId) {
  let doc = null
  try {
    const res = await db.collection(COL.SHOPPING).doc(id).get()
    doc = res && res.data ? res.data : null
  } catch (err) {
    if (!isNotFound(err)) {
      console.error('[familyApi] read shopping failed', { id: id, err: err })
      throw new ApiError(E.INTERNAL_ERROR, '读取购物清单失败')
    }
  }
  if (!doc) throw new ApiError(E.NOT_FOUND, '购物项目不存在')
  if (doc.familyId !== familyId) throw new ApiError(E.FORBIDDEN, '无权操作该购物项目')
  return doc
}

function newGroupId(now) {
  return 'g' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 一次勾选对应一个 purchaseGroupId：合并组内所有来源共享同一组标识，
// 已购后仍能作为一行显示，也便于将来追溯「这批是谁买的」。
async function setPurchase(db, ctx, payload) {
  const ids = requireIds(payload)
  const purchased = payload.purchased !== false
  const now = new Date()
  const groupId = purchased ? newGroupId(now) : ''

  let changed = 0
  let unchanged = 0

  for (const id of ids) {
    const item = await readOwnedItem(db, id, ctx.familyId)
    // 状态已一致时直接跳过，保证重复点击是幂等的
    if (!!item.purchased === purchased) {
      unchanged++
      continue
    }

    const patch = purchased
      ? {
        purchased: true,
        purchasedBy: ctx.openid,
        purchasedAt: now,
        purchaseGroupId: groupId,
        updateTime: now
      }
      : {
        purchased: false,
        purchasedBy: '',
        purchasedAt: null,
        purchaseGroupId: '',
        updateTime: now
      }

    // 条件更新：状态在读取后被他人改动时不覆盖，计入未变更
    const res = await db.collection(COL.SHOPPING)
      .where({ _id: id, familyId: ctx.familyId, purchased: !purchased })
      .update({ data: patch })

    if (res.stats && res.stats.updated === 1) changed++
    else unchanged++
  }

  return {
    changed: changed,
    unchanged: unchanged,
    purchased: purchased,
    purchaseGroupId: groupId
  }
}

async function clearPurchased(db, ctx) {
  if (ctx.role !== ROLE.OWNER && ctx.role !== ROLE.ADMIN) {
    throw new ApiError(E.FORBIDDEN, '只有创建者或管理员可以清空已购项目')
  }
  const res = await db.collection(COL.SHOPPING)
    .where({ familyId: ctx.familyId, purchased: true })
    .remove()
  const removed = res.stats ? res.stats.removed : 0
  return { removed: removed }
}

const ACTIONS = {
  setPurchase: { auth: {}, run: setPurchase },
  clearPurchased: { auth: {}, run: clearPurchased }
}

module.exports = { ACTIONS: ACTIONS }
