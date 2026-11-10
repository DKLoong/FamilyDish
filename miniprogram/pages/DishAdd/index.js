// 菜品新增 / 编辑统一表单。带 id 为编辑，不带为新增。
// 前端只做「够用的即时提示」，最终校验以后端 validators 为准。
const api = require('../../utils/api.js')

const DIFFICULTIES = ['简单', '中等', '较难']

function newKey() {
  return 'i' + Date.now() + Math.floor(Math.random() * 1000)
}

// 分秒输入统一归一化：秒满 60 进位到分，避免出现「1 分 80 秒」。
function normalizeDuration(minRaw, secRaw) {
  const min = Math.floor(Number(minRaw) || 0)
  const sec = Math.round(Number(secRaw) || 0)
  const total = Math.max(0, min) * 60 + Math.max(0, sec)
  if (total <= 0) return { min: '', sec: '' }
  return { min: String(Math.floor(total / 60)), sec: String(total % 60) }
}

// 分秒合成分钟数（保留到秒），未填写返回 null。
function toMinutes(minRaw, secRaw) {
  const min = Math.max(0, Number(minRaw) || 0)
  const sec = Math.max(0, Number(secRaw) || 0)
  const total = Math.round(min * 60 + sec)
  return total > 0 ? total / 60 : null
}

// 已存储的分钟数（可能带小数）拆回分与秒两个输入框。
function splitMinutes(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return { min: '', sec: '' }
  const total = Math.round(num * 60)
  return { min: String(Math.floor(total / 60)), sec: String(total % 60) }
}

Page({
  data: {
    id: '',
    loading: true,
    loadError: '',
    submitting: false,

    difficulties: DIFFICULTIES,
    // 分类候选唯一来源是分类表，不再内置常量，避免与分类管理页不一致
    categories: [],
    name: '',
    category: '',
    difficultyIndex: 0,
    // 总耗时拆成分与秒两个输入，保存时合成分钟数
    timeMin: '',
    timeSec: '',
    description: '',
    tips: '',
    ingredients: [],
    steps: []
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    this.setData({ id: id })

    if (id) {
      wx.setNavigationBarTitle({ title: '编辑菜品' })
      this.loadDish(id)
    } else {
      wx.setNavigationBarTitle({ title: '新增菜品' })
      this.setData({
        loading: false,
        ingredients: [this.blankIngredient()],
        steps: [this.blankStep()]
      })
    }
    this.loadCategories()
  },

  blankIngredient() {
    return { key: newKey(), name: '', quantity: '', unit: '', note: '' }
  },

  blankStep() {
    return { id: newKey(), text: '', min: '', sec: '' }
  },

  // 分类候选来自分类表（含排序），与首页、分类管理页同源
  async loadCategories() {
    try {
      let res = await api.list('Category', { orderBy: 'sort', order: 'asc', limit: 100 })
      let names = (res.items || []).map(function (item) { return item.name })

      // 分类表为空说明老数据还没登记过，先同步一次再读
      if (names.length === 0) {
        try {
          await api.action('syncCategories')
          res = await api.list('Category', { orderBy: 'sort', order: 'asc', limit: 100 })
          names = (res.items || []).map(function (item) { return item.name })
        } catch (err) {
          console.error('[DishAdd] sync categories failed', err)
        }
      }

      this.setData({ categories: names })
    } catch (err) {
      console.error('[DishAdd] load categories failed', err)
      this.setData({ categories: [] })
    }
  },

  // 输入了分类表里没有的名称时自动登记，让首页和分类管理页立刻同步。
  // 分类属于附属信息，登记失败不阻塞菜品保存，下次进分类页会由同步动作补上。
  async ensureCategory(name) {
    if (!name || this.data.categories.indexOf(name) >= 0) return
    try {
      await api.action('saveCategory', { name: name })
      this.setData({ categories: this.data.categories.concat([name]) })
    } catch (err) {
      console.error('[DishAdd] register category failed', err)
    }
  },

  async loadDish(id) {
    try {
      const dish = await api.get('DishList', id)
      const ingredients = (dish.ingredients || []).map(function (item) {
        return {
          key: item.key || newKey(),
          name: item.name || '',
          quantity: typeof item.quantity === 'number' ? String(item.quantity) : '',
          unit: item.unit || '',
          note: item.note && item.note !== '适量' ? item.note : ''
        }
      })
      const steps = (dish.steps || []).map(function (item) {
        const parts = splitMinutes(item.minutes)
        return {
          id: newKey(),
          text: item.text || '',
          min: parts.min,
          sec: parts.sec
        }
      })

      const timeParts = splitMinutes(dish.time)

      this.setData({
        loading: false,
        name: dish.name || '',
        category: dish.category || '',
        difficultyIndex: Math.max(0, DIFFICULTIES.indexOf(dish.difficulty)),
        timeMin: timeParts.min,
        timeSec: timeParts.sec,
        description: dish.description || '',
        tips: dish.tips || '',
        ingredients: ingredients.length ? ingredients : [this.blankIngredient()],
        steps: steps.length ? steps : [this.blankStep()]
      })
    } catch (err) {
      console.error('[DishAdd] load dish failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    const patch = {}
    patch[field] = e.detail.value
    this.setData(patch)
  },

  // 总耗时失焦：秒满 60 进位，如输入 80 秒变成 1 分 20 秒
  onTimeBlur() {
    const parts = normalizeDuration(this.data.timeMin, this.data.timeSec)
    this.setData({ timeMin: parts.min, timeSec: parts.sec })
  },

  // 步骤耗时失焦：同一套进位规则
  onStepDurationBlur(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.steps.slice()
    if (!list[index]) return
    const parts = normalizeDuration(list[index].min, list[index].sec)
    list[index].min = parts.min
    list[index].sec = parts.sec
    this.setData({ steps: list })
  },

  pickCategory(e) {
    this.setData({ category: e.currentTarget.dataset.cat })
  },

  onDifficultyChange(e) {
    this.setData({ difficultyIndex: Number(e.detail.value) })
  },

  onIngredientInput(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const list = this.data.ingredients.slice()
    if (!list[index] || !field) return
    list[index][field] = e.detail.value
    this.setData({ ingredients: list })
  },

  addIngredient() {
    if (this.data.ingredients.length >= 60) {
      wx.showToast({ title: '食材最多 60 项', icon: 'none' })
      return
    }
    this.setData({ ingredients: this.data.ingredients.concat([this.blankIngredient()]) })
  },

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.ingredients.slice()
    if (list.length <= 1) {
      this.setData({ ingredients: [this.blankIngredient()] })
      return
    }
    list.splice(index, 1)
    this.setData({ ingredients: list })
  },

  onStepInput(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    const list = this.data.steps.slice()
    if (!list[index] || !field) return
    list[index][field] = e.detail.value
    this.setData({ steps: list })
  },

  addStep() {
    if (this.data.steps.length >= 30) {
      wx.showToast({ title: '步骤最多 30 条', icon: 'none' })
      return
    }
    this.setData({ steps: this.data.steps.concat([this.blankStep()]) })
  },

  removeStep(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.steps.slice()
    if (list.length <= 1) {
      this.setData({ steps: [this.blankStep()] })
      return
    }
    list.splice(index, 1)
    this.setData({ steps: list })
  },

  buildIngredients() {
    const result = []
    for (let i = 0; i < this.data.ingredients.length; i++) {
      const row = this.data.ingredients[i]
      const name = String(row.name || '').trim()
      if (!name) continue

      const raw = String(row.quantity === undefined || row.quantity === null ? '' : row.quantity).trim()
      const unit = String(row.unit || '').trim()
      let quantity = null
      if (raw !== '') {
        const num = Number(raw)
        if (!Number.isFinite(num) || num < 0) {
          wx.showToast({ title: '食材「' + name + '」的用量需为非负数字', icon: 'none' })
          return null
        }
        // 有数量就必须有单位，否则「排骨 500」无法表达也无法参与合并
        if (!unit) {
          wx.showToast({ title: '食材「' + name + '」填写数量时需同时填写单位', icon: 'none' })
          return null
        }
        quantity = num
      }

      result.push({
        key: row.key || newKey(),
        name: name,
        quantity: quantity,
        unit: unit,
        note: String(row.note || '').trim()
      })
    }
    return result
  },

  buildSteps() {
    const result = []
    for (let i = 0; i < this.data.steps.length; i++) {
      const row = this.data.steps[i]
      const text = String(row.text || '').trim()
      if (!text) continue

      const minutes = toMinutes(row.min, row.sec)
      if (minutes !== null && minutes > 600) {
        wx.showToast({ title: '第 ' + (i + 1) + ' 步的时长不能超过 600 分钟', icon: 'none' })
        return null
      }

      result.push({ text: text, minutes: minutes, image: '' })
    }
    return result
  },

  async save() {
    if (this.data.submitting) return

    const name = String(this.data.name || '').trim()
    if (!name) return wx.showToast({ title: '请填写菜名', icon: 'none' })

    const ingredients = this.buildIngredients()
    if (!ingredients) return
    if (ingredients.length === 0) return wx.showToast({ title: '至少填写一项食材', icon: 'none' })

    const steps = this.buildSteps()
    if (!steps) return
    if (steps.length === 0) return wx.showToast({ title: '至少填写一个步骤', icon: 'none' })

    const time = toMinutes(this.data.timeMin, this.data.timeSec)
    if (time === null) {
      return wx.showToast({ title: '请填写总耗时', icon: 'none' })
    }
    if (time > 600) {
      return wx.showToast({ title: '总耗时不能超过 600 分钟', icon: 'none' })
    }

    const payload = {
      name: name,
      category: String(this.data.category || '').trim(),
      difficulty: DIFFICULTIES[this.data.difficultyIndex] || '简单',
      time: time,
      description: String(this.data.description || '').trim(),
      tips: String(this.data.tips || '').trim(),
      ingredients: ingredients,
      steps: steps
    }

    this.setData({ submitting: true })
    const isEdit = !!this.data.id
    const dishId = this.data.id
    try {
      // 先保证分类已登记，再保存菜品，避免菜品挂着表里没有的分类
      await this.ensureCategory(payload.category)
      await api.withLoading('保存中', function () {
        return isEdit
          ? api.update('DishList', dishId, payload)
          : api.add('DishList', payload)
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(function () { wx.navigateBack() }, 600)
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  retry() {
    this.loadDish(this.data.id)
  }
})
