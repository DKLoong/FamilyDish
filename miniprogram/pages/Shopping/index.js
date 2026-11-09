// 购物清单：待购与已购合并显示、勾选购买、手工添加、清空已购。
// 合并只发生在展示层（utils/shopping.js），数据仍按来源独立存储，
// 所以取消某道菜只删它自己的来源记录，其余食材数量自动重算。
const app = getApp()
const api = require('../../utils/api.js')
const shoppingView = require('../../utils/shopping.js')

const PAGE_SIZE = 100
const MAX_ITEMS = 500

Page({
  data: {
    loading: true,
    loadError: '',
    pendingGroups: [],
    purchasedGroups: [],
    pendingCount: 0,
    purchasedCount: 0,
    canClearPurchased: false,
    showSheet: false,
    form: { name: '', quantity: '', unit: '', note: '' },
    submitting: false
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

  async load(silent) {
    if (!silent) this.setData({ loading: true, loadError: '' })
    try {
      const items = await this.fetchAll()
      this.apply(items)
      this.setData({ loading: false, loadError: '' })
    } catch (err) {
      console.error('[shopping] load failed', err)
      this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // 分页拉全量：购物清单通常只有几十条，但真超过一页时不能静默截断
  async fetchAll() {
    let all = []
    let skip = 0
    let total = Infinity
    while (skip < total && all.length < MAX_ITEMS) {
      const res = await api.list('ShoppingItem', {
        orderBy: 'createTime',
        order: 'desc',
        limit: PAGE_SIZE,
        skip: skip
      })
      const items = (res && res.items) || []
      all = all.concat(items)
      total = res && typeof res.total === 'number' ? res.total : all.length
      if (items.length < PAGE_SIZE) break
      skip += PAGE_SIZE
    }
    return all
  },

  apply(items) {
    const viewer = { openid: app.globalData.openid, role: app.globalData.role }
    const view = shoppingView.buildView(items, viewer)
    this.setData({
      pendingGroups: view.pendingGroups,
      purchasedGroups: view.purchasedGroups,
      pendingCount: view.pendingCount,
      purchasedCount: view.purchasedCount,
      canClearPurchased: app.isAdmin()
    })
  },

  findGroup(key) {
    const all = this.data.pendingGroups.concat(this.data.purchasedGroups)
    for (const group of all) {
      if (group.key === key) return group
    }
    return null
  },

  // 勾选合并组：组内所有来源一起变更，避免出现「一半买了一半没买」
  async toggleGroup(e) {
    if (this.data.submitting) return
    const group = this.findGroup(e.currentTarget.dataset.key)
    if (!group) return

    const nextPurchased = !group.purchased
    this.setData({ submitting: true })
    try {
      await api.action('setPurchase', { ids: group.ids, purchased: nextPurchased })
      await this.load(true)
      if (nextPurchased) {
        wx.showToast({ title: '已标记为已购买', icon: 'none' })
      }
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  removeGroup(e) {
    if (this.data.submitting) return
    const group = this.findGroup(e.currentTarget.dataset.key)
    if (!group || !group.canRemove) return

    const ids = group.removableIds
    const content = ids.length > 1
      ? '这一行由 ' + ids.length + ' 条来源记录组成，将全部删除。'
      : '删除「' + group.name + '」？'

    wx.showModal({
      title: '删除项目',
      content: content,
      confirmText: '删除',
      confirmColor: '#C9663B',
      success: (res) => {
        if (!res.confirm) return
        this.doRemove(ids)
      }
    })
  },

  async doRemove(ids) {
    this.setData({ submitting: true })
    try {
      await api.withLoading('删除中', async () => {
        for (const id of ids) {
          await api.remove('ShoppingItem', id)
        }
      })
      await this.load(true)
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  clearPurchased() {
    if (!this.data.canClearPurchased || this.data.purchasedCount === 0) return
    wx.showModal({
      title: '清空已购项目',
      content: '将删除 ' + this.data.purchasedCount + ' 条已购买记录，待购买项目不受影响。',
      confirmText: '清空',
      confirmColor: '#C9663B',
      success: (res) => {
        if (!res.confirm) return
        this.doClear()
      }
    })
  },

  async doClear() {
    this.setData({ submitting: true })
    try {
      const result = await api.withLoading('清空中', () => api.action('clearPurchased'))
      await this.load(true)
      wx.showToast({ title: '已清空 ' + ((result && result.removed) || 0) + ' 项', icon: 'none' })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  openSheet() {
    this.setData({ showSheet: true, form: { name: '', quantity: '', unit: '', note: '' } })
  },

  closeSheet() {
    this.setData({ showSheet: false })
  },

  noop() {},

  onFormInput(e) {
    const patch = {}
    patch['form.' + e.currentTarget.dataset.field] = e.detail.value
    this.setData(patch)
  },

  async submitManual() {
    if (this.data.submitting) return
    const built = shoppingView.buildManualIngredient(this.data.form)
    if (built.error) {
      wx.showToast({ title: built.error, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await api.withLoading('添加中', () => api.add('ShoppingItem', { ingredient: built.value }))
      this.setData({ showSheet: false })
      await this.load(true)
      wx.showToast({ title: '已加入清单', icon: 'none' })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/MainPage/index' })
  }
})
