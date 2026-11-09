// 集合级业务校验。白名单只保证「字段名合法」，这里保证「字段内容合法」。
// 结构性约束（至少一项食材、至少一个步骤）是需求 5.x 的硬要求，不能只靠前端。
const { ApiError, E } = require('./errors')

const DIFFICULTIES = ['简单', '中等', '较难']
const LIMITS = {
  DISH_NAME: 30,
  CATEGORY_NAME: 20,
  DESCRIPTION: 200,
  TIPS: 300,
  STEP_TEXT: 300,
  INGREDIENT_NAME: 30,
  INGREDIENT_UNIT: 10,
  INGREDIENT_NOTE: 20,
  MAX_INGREDIENTS: 60,
  MAX_STEPS: 30,
  MAX_MINUTES: 600
}

function assertText(value, label, max) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new ApiError(E.INVALID_PAYLOAD, label + '不能为空')
  if (text.length > max) throw new ApiError(E.INVALID_PAYLOAD, label + '不能超过 ' + max + ' 个字符')
  return text
}

function optionalText(value, max) {
  if (value === undefined || value === null) return ''
  return String(value).trim().slice(0, max)
}

function normalizeIngredient(item, index) {
  const at = '第 ' + (index + 1) + ' 项食材'
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new ApiError(E.INVALID_PAYLOAD, at + '格式不正确')
  }
  const name = assertText(item.name, at + '名称', LIMITS.INGREDIENT_NAME)

  let quantity = null
  if (item.quantity !== undefined && item.quantity !== null && item.quantity !== '') {
    const num = Number(item.quantity)
    if (!Number.isFinite(num) || num < 0) {
      throw new ApiError(E.INVALID_PAYLOAD, '食材「' + name + '」的用量需为非负数字；不确定时请留空并填写备注')
    }
    quantity = num
  }

  return {
    key: typeof item.key === 'string' && item.key ? item.key.slice(0, 40) : 'i' + (index + 1),
    name: name,
    quantity: quantity,
    unit: optionalText(item.unit, LIMITS.INGREDIENT_UNIT),
    // 无数量的食材必须有说明（如「适量」），否则购物清单无法表达
    note: optionalText(item.note, LIMITS.INGREDIENT_NOTE) || (quantity === null ? '适量' : '')
  }
}

function normalizeStep(item, index) {
  const at = '第 ' + (index + 1) + ' 个步骤'
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new ApiError(E.INVALID_PAYLOAD, at + '格式不正确')
  }
  const text = assertText(item.text, at + '内容', LIMITS.STEP_TEXT)

  let minutes = null
  if (item.minutes !== undefined && item.minutes !== null && item.minutes !== '') {
    const num = Number(item.minutes)
    if (!Number.isFinite(num) || num < 0 || num > LIMITS.MAX_MINUTES) {
      throw new ApiError(E.INVALID_PAYLOAD, at + '时长需在 0–' + LIMITS.MAX_MINUTES + ' 分钟之间')
    }
    minutes = Math.round(num)
  }

  return { text: text, minutes: minutes, image: item.image ? String(item.image) : '' }
}

function validateDish(data, isUpdate) {
  const out = Object.assign({}, data)

  if (out.name === undefined) {
    if (!isUpdate) throw new ApiError(E.INVALID_PAYLOAD, '菜品名称必填')
  } else {
    out.name = assertText(out.name, '菜品名称', LIMITS.DISH_NAME)
  }

  if (out.ingredients === undefined) {
    if (!isUpdate) throw new ApiError(E.INVALID_PAYLOAD, '至少填写一项食材')
  } else {
    if (!Array.isArray(out.ingredients) || out.ingredients.length === 0) {
      throw new ApiError(E.INVALID_PAYLOAD, '至少填写一项食材')
    }
    if (out.ingredients.length > LIMITS.MAX_INGREDIENTS) {
      throw new ApiError(E.INVALID_PAYLOAD, '食材不能超过 ' + LIMITS.MAX_INGREDIENTS + ' 项')
    }
    out.ingredients = out.ingredients.map(normalizeIngredient)
  }

  if (out.steps === undefined) {
    if (!isUpdate) throw new ApiError(E.INVALID_PAYLOAD, '至少填写一个步骤')
  } else {
    if (!Array.isArray(out.steps) || out.steps.length === 0) {
      throw new ApiError(E.INVALID_PAYLOAD, '至少填写一个步骤')
    }
    if (out.steps.length > LIMITS.MAX_STEPS) {
      throw new ApiError(E.INVALID_PAYLOAD, '步骤不能超过 ' + LIMITS.MAX_STEPS + ' 条')
    }
    out.steps = out.steps.map(normalizeStep)
  }

  if (out.difficulty !== undefined) {
    if (!DIFFICULTIES.includes(out.difficulty)) {
      throw new ApiError(E.INVALID_PAYLOAD, '难度只能是：' + DIFFICULTIES.join(' / '))
    }
  }

  if (out.time !== undefined) {
    const minutes = Number(out.time)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > LIMITS.MAX_MINUTES) {
      throw new ApiError(E.INVALID_PAYLOAD, '总耗时需在 1–' + LIMITS.MAX_MINUTES + ' 分钟之间')
    }
    out.time = Math.round(minutes)
  }

  if (out.description !== undefined) out.description = optionalText(out.description, LIMITS.DESCRIPTION)
  if (out.tips !== undefined) out.tips = optionalText(out.tips, LIMITS.TIPS)
  if (out.image !== undefined) out.image = out.image ? String(out.image) : ''
  if (out.category !== undefined) out.category = optionalText(out.category, LIMITS.CATEGORY_NAME)

  return out
}

function validateCategory(data, isUpdate) {
  const out = Object.assign({}, data)

  if (out.name === undefined) {
    if (!isUpdate) throw new ApiError(E.INVALID_PAYLOAD, '分类名称必填')
  } else {
    out.name = assertText(out.name, '分类名称', LIMITS.CATEGORY_NAME)
  }

  if (out.sort !== undefined) {
    const sort = Number(out.sort)
    if (!Number.isFinite(sort)) throw new ApiError(E.INVALID_PAYLOAD, '排序需为数字')
    out.sort = Math.round(sort)
  }

  return out
}

module.exports = {
  DIFFICULTIES: DIFFICULTIES,
  LIMITS: LIMITS,
  DishList: validateDish,
  Category: validateCategory
}
