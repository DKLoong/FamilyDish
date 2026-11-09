// 家庭首页：菜品列表、食材搜索、分类筛选、随机选菜、示例菜导入。
// 菜谱详情与点菜在后续里程碑接入，此处先保证浏览可用。
const app = getApp()
const api = require('../../utils/api.js')

const ALL = '全部'

Page({
  data: {
    loading: true,
    loadError: '',
    seeding: false,

    familyName: '',
    roleLabel: '',
    memberCount: 0,
    maxMembers: 0,
    canManage: false,
    isOwner: false,

    keyword: '',
    categories: [ALL],
    activeCategory: ALL,
    dishes: [],
    visible: []
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  async load(force) {
    if (force !== true) this.setData({ loading: true, loadError: '' })
    if (force === true) await app.refreshContext(true)

    try {
      const results = await Promise.all([
        api.action('listMembers'),
        api.list('DishList', { limit: 100 })
      ])
      const members = results[0]
      const listRes = results[1]

      const dishes = (listRes.items || []).map(this.decorate)
      const categories = [ALL]
      dishes.forEach(function (dish) {
        if (dish.category && categories.indexOf(dish.category) < 0) categories.push(dish.category)
      })

      // 当前分类若已不存在（菜品被归档或改名），回到「全部」
      const activeCategory = categories.indexOf(this.data.activeCategory) >= 0
        ? this.data.activeCategory
        : ALL

      this.setData({
        loading: false,
        familyName: members.familyName,
        roleLabel: app.getRoleLabel(),
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

    if (force === true) wx.stopPullDownRefresh()
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
      // 首版按食材搜索，不匹配菜名
      ingredientNames: ingredients.map(function (item) { return item.name }).join(' '),
      initial: String(dish.name || '?').slice(0, 1)
    }
  },

  applyFilter() {
    const keyword = (this.data.keyword || '').trim()
    const category = this.data.activeCategory
    const visible = this.data.dishes.filter(function (dish) {
      if (category !== ALL && dish.category !== category) return false
      if (keyword && dish.ingredientNames.indexOf(keyword) < 0) return false
      return true
    })
    this.setData({ visible: visible })
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
    const pick = list[Math.floor(Math.random() * list.length)]
    const that = this
    wx.showModal({
      title: '今天吃这个',
      content: pick.name,
      confirmText: '看看菜谱',
      success: function (res) {
        if (res.confirm) that.openDishById(pick.id)
      }
    })
  },

  openDish(e) {
    this.openDishById(e.currentTarget.dataset.id)
  },

  openDishById() {
    // 菜谱详情页在下一步接入，届时替换为 navigateTo
    wx.showToast({ title: '菜谱详情即将接入', icon: 'none' })
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

  goMine() {
    wx.navigateTo({ url: '/pages/Settings/index' })
  },

  retry() {
    this.load(true)
  }
})
