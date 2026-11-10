// 家庭首页：问候、搜索、分类、随机、菜品列表。
// 顶部区固定，页面本身不滚动，只有菜品列表在 scroll-view 内滚动。
const app = getApp()
const api = require('../../utils/api.js')

const ALL = '全部'

function greetingOf(hour) {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

Page({
  data: {
    loading: true,
    loadError: '',
    seeding: false,
    refreshing: false,

    familyName: '',
    greeting: '',
    nickname: '',
    memberCount: 0,
    maxMembers: 0,
    canManage: false,
    isOwner: false,

    keyword: '',
    categories: [ALL],
    activeCategory: ALL,
    dishes: [],
    visible: [],

    // 随机选菜结果用卡片弹层展示，代替只显示菜名的系统弹窗
    showRandom: false,
    randomDish: null
  },

  onShow() {
    this.load()
  },

  // 页面不滚动，下拉刷新由列表 scroll-view 承担
  async onRefresherRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    await this.load(true)
    this.setData({ refreshing: false })
  },

  async load(force) {
    if (force !== true) this.setData({ loading: true, loadError: '' })
    if (force === true) await app.refreshContext(true)

    try {
      const results = await Promise.all([
        api.action('listMembers'),
        api.list('DishList', { limit: 100 }),
        // 分类顺序以分类表为准；表为空时退回菜品出现顺序作为兜底
        api.list('Category', { orderBy: 'sort', order: 'asc', limit: 100 }).catch(function (err) {
          console.error('[MainPage] load categories failed', err)
          return { items: [] }
        })
      ])
      const members = results[0]
      const listRes = results[1]
      const categoryRes = results[2]

      const dishes = (listRes.items || []).map(this.decorate)
      const categories = [ALL]
      const registered = (categoryRes.items || [])
        .map(function (item) { return item.name })
        .filter(Boolean)

      if (registered.length > 0) {
        registered.forEach(function (name) {
          if (categories.indexOf(name) < 0) categories.push(name)
        })
      } else {
        dishes.forEach(function (dish) {
          if (dish.category && categories.indexOf(dish.category) < 0) categories.push(dish.category)
        })
      }

      // 当前分类若已不存在（菜品被归档或改名），回到「全部」
      const activeCategory = categories.indexOf(this.data.activeCategory) >= 0
        ? this.data.activeCategory
        : ALL

      const membership = app.globalData.membership

      this.setData({
        loading: false,
        familyName: members.familyName,
        greeting: greetingOf(new Date().getHours()),
        nickname: (membership && membership.nickname) || '',
        memberCount: members.members.length,
        maxMembers: members.maxMembers,
        canManage: members.canManage,
        isOwner: members.isOwner,
        categories: categories,
        activeCategory: activeCategory,
        dishes: dishes
      })
      this.applyFilter()
    } catch (err) {
      console.error('[MainPage] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }
  },

  decorate(dish) {
    const ingredients = dish.ingredients || []
    return {
      id: dish._id,
      name: dish.name,
      category: dish.category || '未分类',
      time: dish.time || 0,
      difficulty: dish.difficulty || '',
      ingredientCount: ingredients.length,
      // 搜索用：菜名与食材名拼接，菜名单独命中时排在前面
      ingredientNames: ingredients.map(function (item) { return item.name }).join(' '),
      initial: String(dish.name || '?').slice(0, 1)
    }
  },

  applyFilter() {
    const keyword = (this.data.keyword || '').trim()
    const category = this.data.activeCategory
    const ranked = []

    this.data.dishes.forEach(function (dish) {
      if (category !== ALL && dish.category !== category) return
      if (!keyword) {
        ranked.push({ dish: dish, rank: 0 })
        return
      }
      const inName = dish.name.indexOf(keyword) >= 0
      const inIngredients = dish.ingredientNames.indexOf(keyword) >= 0
      if (!inName && !inIngredients) return
      // 菜名命中的排在仅食材命中的之前，其余保持原有顺序
      ranked.push({ dish: dish, rank: inName ? 2 : 1 })
    })

    if (keyword) ranked.sort(function (a, b) { return b.rank - a.rank })
    this.setData({ visible: ranked.map(function (item) { return item.dish }) })
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilter()
  },

  clearSearch() {
    this.setData({ keyword: '', activeCategory: ALL })
    this.applyFilter()
  },

  selectCategory(e) {
    const category = e.currentTarget.dataset.cat
    if (category === this.data.activeCategory) return
    this.setData({ activeCategory: category })
    this.applyFilter()
  },

  randomPick() {
    const list = this.data.visible
    if (!list.length) {
      wx.showToast({ title: '没有可选的菜', icon: 'none' })
      return
    }
    this.setData({ showRandom: true, randomDish: this.pickOne(list, null) })
  },

  // 多于一道菜时排除当前结果，避免「换一个」抽回同一道
  pickOne(list, excludeId) {
    const pool = (list.length > 1 && excludeId)
      ? list.filter(function (item) { return item.id !== excludeId })
      : list
    return pool[Math.floor(Math.random() * pool.length)]
  },

  reroll() {
    const list = this.data.visible
    if (!list.length) return
    const current = this.data.randomDish
    this.setData({ randomDish: this.pickOne(list, current && current.id) })
  },

  closeRandom() {
    this.setData({ showRandom: false })
  },

  viewPicked() {
    const dish = this.data.randomDish
    this.setData({ showRandom: false })
    if (dish) this.openDishById(dish.id)
  },

  noop() {},

  openDish(e) {
    this.openDishById(e.currentTarget.dataset.id)
  },

  openDishById(id) {
    if (!id) return
    wx.navigateTo({ url: '/pages/DishDetail/index?id=' + id })
  },

  async seedDishes() {
    if (this.data.seeding) return
    this.setData({ seeding: true })
    try {
      const result = await api.withLoading('导入中', function () {
        return api.action('seedSampleDishes')
      })
      await this.load(true)
      wx.showToast({ title: '已导入 ' + result.created + ' 道菜', icon: 'success' })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ seeding: false })
    }
  },

  goManage() {
    wx.navigateTo({ url: '/pages/DishManage/index' })
  },

  retry() {
    this.load(true)
  }
})
