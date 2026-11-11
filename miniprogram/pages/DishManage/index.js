// 菜品管理：列出全部菜品（含已归档），支持新增、编辑、归档与恢复。
// 归档是软删除，这里提供对称的恢复入口，避免误归档后无处可退。
const app = getApp()
const api = require('../../utils/api.js')
const duration = require('../../utils/duration.js')

Page({
  data: {
    loading: true,
    loadError: '',
    tab: 'active',
    dishes: [],
    activeDishes: [],
    archivedDishes: [],
    activeTotal: 0,
    archivedTotal: 0,

    // 归档与恢复共用一套确认弹层
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmAction: '',
    confirmTargetId: '',
    confirming: false
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  reload() {
    this.load()
  },

  async load(refresh) {
    // 骨架只在首次进入时铺：从详情页、编辑页返回都保留现有列表原地替换
    if (!this._loaded) this.setData({ loading: true })
    this.setData({ loadError: '' })

    // 请求序号：静默刷新会与归档/恢复后的刷新并发，只应用最后一次结果
    const seq = (this._seq || 0) + 1
    this._seq = seq

    try {
      // 一次取两组，切 tab 不再发请求
      const results = await Promise.all([
        api.list('DishList', { filters: { archived: false }, limit: 100 }),
        api.list('DishList', { filters: { archived: true }, limit: 100 })
      ])
      if (seq !== this._seq) return

      const activeDishes = (results[0].items || []).map(decorate)
      const archivedDishes = (results[1].items || []).map(decorate)

      this.setData({
        loading: false,
        loadError: '',
        activeDishes: activeDishes,
        archivedDishes: archivedDishes,
        activeTotal: results[0].total || activeDishes.length,
        archivedTotal: results[1].total || archivedDishes.length,
        dishes: this.data.tab === 'archived' ? archivedDishes : activeDishes
      })
      this._loaded = true
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[DishManage] load failed', err)
      if (this._loaded) {
        console.warn('[DishManage] 静默刷新失败，沿用上次数据')
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
      }
    } finally {
      if (refresh === true) wx.stopPullDownRefresh()
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({
      tab: tab,
      dishes: tab === 'archived' ? this.data.archivedDishes : this.data.activeDishes
    })
  },

  createDish() {
    wx.navigateTo({ url: '/pages/DishAdd/index' })
  },

  editDish(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/DishAdd/index?id=' + id })
  },

  openDish(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/DishDetail/index?id=' + id })
  },

  toggleArchive(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const isArchived = this.data.tab === 'archived'

    this.setData({
      showConfirm: true,
      confirmTitle: isArchived ? '恢复菜品' : '归档菜品',
      confirmLines: [
        isArchived
          ? '「' + name + '」将重新出现在首页和搜索结果中。'
          : '「' + name + '」将从首页、随机和搜索中消失。历史点菜记录不受影响，之后可以恢复。'
      ],
      confirmText: isArchived ? '恢复' : '归档',
      confirmAction: isArchived ? 'restore' : 'archive',
      confirmTargetId: id
    })
  },

  closeConfirm() {
    if (this.data.confirming) return
    this.setData({ showConfirm: false })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const action = this.data.confirmAction
    const id = this.data.confirmTargetId
    if (!action || !id) return
    const isArchived = action === 'restore'

    this.setData({ confirming: true })
    try {
      if (isArchived) {
        await api.action('restoreDish', { dishId: id })
      } else {
        await api.archive(id)
      }
      this.setData({ showConfirm: false })
      await this.load(true)
      wx.showToast({ title: isArchived ? '已恢复' : '已归档', icon: 'none' })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ confirming: false })
    }
  },

  noop() {}
})

function decorate(dish) {
  const meta = []
  if (dish.category) meta.push(dish.category)
  const timeText = duration.formatMinutes(dish.time)
  if (timeText) meta.push(timeText)
  meta.push((dish.ingredients || []).length + ' 项食材')

  return {
    id: dish._id,
    name: dish.name,
    meta: meta.join(' · '),
    initial: String(dish.name || '?').slice(0, 1)
  }
}
