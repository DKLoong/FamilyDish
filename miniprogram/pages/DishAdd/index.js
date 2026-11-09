// 菜品新增 / 编辑统一表单。带 id 为编辑，不带为新增。
// 前端只做「够用的即时提示」，最终校验以后端 validators 为准。
const api = require('../../utils/api.js')

const DIFFICULTIES = ['简单', '中等', '较难']

function newKey() {
  return 'i' + Date.now() + Math.floor(Math.random() * 1000)
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
    time: '',
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
    return { id: newKey(), text: '', minutes: '' }
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
        return {
          id: newKey(),
          text: item.text || '',
          minutes: typeof item.minutes === 'number' ? String(item.minutes) : ''
        }
      })

      this.setData({
        loading: false,
        name: dish.name || '',
        category: dish.category || '',
        difficultyIndex: Math.max(0, DIFFICULTIES.indexOf(dish.difficulty)),
        time: dish.time ? String(dish.time) : '',
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
      let quantity = null
      if (raw !== '') {
        const num = Number(raw)
        if (!Number.isFinite(num) || num < 0) {
          wx.showToast({ title: '食材「' + name + '」的用量需为非负数字', icon: 'none' })
          return null
        }
        quantity = num
      }

      result.push({
        key: row.key || newKey(),
        name: name,
        quantity: quantity,
        unit: String(row.unit || '').trim(),
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

      let minutes = null
      const raw = String(row.minutes === undefined || row.minutes === null ? '' : row.minutes).trim()
      if (raw !== '') {
        const num = Number(raw)
        if (!Number.isFinite(num) || num < 0) {
          wx.showToast({ title: '第 ' + (i + 1) + ' 步的时长需为非负数字', icon: 'none' })
          return null
        }
        minutes = Math.round(num)
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

    const time = Number(this.data.time)
    if (!Number.isFinite(time) || time <= 0) {
      return wx.showToast({ title: '请填写总耗时（分钟）', icon: 'none' })
    }

    const payload = {
      name: name,
      category: String(this.data.category || '').trim(),
      difficulty: DIFFICULTIES[this.data.difficultyIndex] || '简单',
      time: Math.round(time),
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
