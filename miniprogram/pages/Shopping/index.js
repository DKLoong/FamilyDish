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
    refreshing: false,
    pendingGroups: [],
    purchasedGroups: [],
    // 数量口径统一用合并后的组数（pendingGroups/purchasedGroups 的长度），
    // utils 里的来源条数不再上屏，避免看板与清空提示出现两个数字
    canClearPurchased: false,
    showSheet: false,
    form: { name: '', quantity: '', unit: '', note: '' },
    submitting: false,

    // 删除与清空共用一套自定义确认弹层，替代样式不可控的 wx.showModal
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmMode: '',
    confirmTargetIds: []
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
    const lines = ids.length > 1
      ? ['这一行由 ' + ids.length + ' 条来源记录组成，将全部删除。']
      : ['删除「' + group.name + '」？']

    this.setData({
      showConfirm: true,
      confirmTitle: '删除项目',
      confirmLines: lines,
      confirmText: '删除',
      confirmMode: 'remove',
      confirmTargetIds: ids
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
    if (!this.data.canClearPurchased || this.data.purchasedGroups.length === 0) return
    this.setData({
      showConfirm: true,
      confirmTitle: '清空已购项目',
      confirmLines: ['将清空 ' + this.data.purchasedGroups.length + ' 项已购买食材，待购买项目不受影响。'],
      confirmText: '清空',
      confirmMode: 'clear',
      confirmTargetIds: []
    })
  },

  closeConfirm() {
    this.setData({ showConfirm: false, confirmTargetIds: [] })
  },

  submitConfirm() {
    const mode = this.data.confirmMode
    const ids = this.data.confirmTargetIds.slice()
    this.setData({ showConfirm: false, confirmTargetIds: [] })
    if (mode === 'remove') this.doRemove(ids)
    else if (mode === 'clear') this.doClear()
  },

  async doClear() {
    // 提示按食材种类计数，与看板口径一致；底层仍按来源逐条删除
    const count = this.data.purchasedGroups.length
    this.setData({ submitting: true })
    try {
      await api.withLoading('清空中', () => api.action('clearPurchased'))
      await this.load(true)
      wx.showToast({ title: '已清空 ' + count + ' 项', icon: 'none' })
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
