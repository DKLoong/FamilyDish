// 购物清单展示层合并（纯函数，不依赖 wx，可在 node 下测试）。
//
// 数据层按来源独立存储，一个订单带入的每项食材都是一条独立记录。
// 这里只在渲染前把记录聚合成「看得懂的一行」，不回写数据库。
// 这样取消某道菜时，删掉它自己的来源记录即可，合并出来的总量会自动减少，
// 不会出现「减多减少」的反向计算问题。
const ADMIN_ROLES = ['owner', 'admin']

function round2(value) {
  return Math.round(value * 100) / 100
}

function readIngredient(item) {
  const source = item && item.ingredient && typeof item.ingredient === 'object' ? item.ingredient : {}
  const quantity = typeof source.quantity === 'number' && isFinite(source.quantity) ? source.quantity : null
  return {
    name: source.name ? String(source.name).trim() : '',
    quantity: quantity,
    unit: source.unit ? String(source.unit).trim() : '',
    note: source.note ? String(source.note).trim() : ''
  }
}

// 未购：名称与单位都相同、且都有数值，才合并成一行。
// 已购：同一次勾选（purchaseGroupId）合并，让「排骨 800g = 两单来源」仍显示为一行。
// 其余情况各占一行，遵循「无法可靠相加就不合并」的原则。
function groupKeyOf(item) {
  const ing = readIngredient(item)
  if (item.purchased) {
    const base = item.purchaseGroupId || ('solo|' + item._id)
    return 'bought|' + base + '|' + ing.name + '|' + ing.unit
  }
  if (ing.quantity === null) return 'single|' + item._id
  return 'pending|' + ing.name + '|' + ing.unit
}

function decorate(group, viewer) {
  const isAdmin = !!viewer && ADMIN_ROLES.indexOf(viewer.role) >= 0
  const openid = viewer ? viewer.openid : ''
  const ids = []
  const removableIds = []

  for (const item of group.items) {
    ids.push(item._id)
    if (isAdmin) {
      removableIds.push(item._id)
    } else if (item.sourceType === 'manual' && item.createdBy === openid) {
      // 普通成员只能删除自己手工添加的项目；订单来源的只能通过取消点菜移除
      removableIds.push(item._id)
    }
  }

  const sourceCount = group.items.length
  let sourceLabel = ''
  if (sourceCount > 1) sourceLabel = sourceCount + ' 个来源'
  else if (!group.purchased && group.items[0] && group.items[0].sourceType === 'manual') sourceLabel = '手工添加'

  return {
    key: group.key,
    name: group.name,
    unit: group.unit,
    quantityText: group.quantity === null
      ? (group.note || '适量')
      : (group.unit ? group.quantity + ' ' + group.unit : String(group.quantity)),
    note: group.note,
    purchased: group.purchased,
    sourceCount: sourceCount,
    sourceLabel: sourceLabel,
    ids: ids,
    removableIds: removableIds,
    canRemove: removableIds.length > 0
  }
}

// 把同类记录聚合成组，保持输入顺序（后端已按创建时间倒序）
function groupItems(items, viewer) {
  const list = Array.isArray(items) ? items : []
  const map = {}
  const order = []

  for (const item of list) {
    if (!item || !item._id) continue
    const key = groupKeyOf(item)
    let group = map[key]
    if (!group) {
      group = { key: key, name: '', unit: '', quantity: null, note: '', purchased: !!item.purchased, items: [] }
      map[key] = group
      order.push(key)
    }
    const ing = readIngredient(item)
    if (!group.name && ing.name) group.name = ing.name
    if (!group.unit && ing.unit) group.unit = ing.unit
    if (ing.quantity !== null) group.quantity = round2((group.quantity || 0) + ing.quantity)
    if (!group.note && ing.note) group.note = ing.note
    group.items.push(item)
  }

  return order.map(function (key) { return decorate(map[key], viewer) })
}

// 一次返回待购与已购两组，页面直接渲染
function buildView(items, viewer) {
  const groups = groupItems(items, viewer)
  const pendingGroups = []
  const purchasedGroups = []
  let pendingItemCount = 0
  let purchasedItemCount = 0

  for (const group of groups) {
    if (group.purchased) {
      purchasedGroups.push(group)
      purchasedItemCount += group.sourceCount
    } else {
      pendingGroups.push(group)
      pendingItemCount += group.sourceCount
    }
  }

  return {
    pendingGroups: pendingGroups,
    purchasedGroups: purchasedGroups,
    pendingCount: pendingItemCount,
    purchasedCount: purchasedItemCount
  }
}

function buildManualIngredient(input) {
  const source = input || {}
  const name = String(source.name || '').trim()
  if (!name) return { error: '请填写食材名称' }
  let quantity = null
  const rawQuantity = source.quantity
  if (rawQuantity !== undefined && rawQuantity !== null && String(rawQuantity).trim() !== '') {
    const num = Number(rawQuantity)
    if (!isFinite(num) || num < 0) return { error: '数量必须是非负数字' }
    quantity = round2(num)
  }
  return {
    value: {
      name: name,
      quantity: quantity,
      unit: String(source.unit || '').trim(),
      note: String(source.note || '').trim()
    }
  }
}

module.exports = {
  buildView: buildView,
  groupItems: groupItems,
  groupKeyOf: groupKeyOf,
  buildManualIngredient: buildManualIngredient,
  readIngredient: readIngredient
}
