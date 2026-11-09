// 分类管理：新增、重命名（同步菜品）、排序。
// 首版分类只是「名称 + 排序」的轻量标签，菜品上仍存分类文本，
// 所以重命名必须由服务端批量同步，否则菜品会挂在不存在的分类上。
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    loadError: '',
    categories: [],
    submitting: false,
    showSheet: false,
    editingId: '',
    formName: ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    // 下拉时重新同步一次，兜住「新增菜品带来新分类」的情况
    this._synced = false
    this.load(true)
  },

  reload() {
    this.load()
  },

  async load(refresh) {
    if (refresh !== true) this.setData({ loading: true, loadError: '' })
    try {
      // 幂等同步：把菜品里已有、但分类表还没登记的分类补进来，避免首次进入是空列表
      if (!this._synced) {
        await api.action('syncCategories')
        this._synced = true
      }
      const res = await api.list('Category', { orderBy: 'sort', order: 'asc', limit: 100 })
      this.setData({
        loading: false,
        loadError: '',
        categories: (res.items || []).map(function (item) {
          return { id: item._id, name: item.name }
        })
      })
    } catch (err) {
      console.error('[CategoryManage] load failed', err)
      this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
    } finally {
      if (refresh === true) wx.stopPullDownRefresh()
    }
  },

  // 上下移动：先在本地交换，再整体提交顺序。失败时重载回到服务端顺序。
  async move(e) {
    if (this.data.submitting) return
    const index = Number(e.currentTarget.dataset.index)
    const dir = Number(e.currentTarget.dataset.dir)
    const target = index + dir
    if (target < 0 || target >= this.data.categories.length) return

    const list = this.data.categories.slice()
    const temp = list[index]
    list[index] = list[target]
    list[target] = temp
    this.setData({ categories: list })

    try {
      await api.action('reorderCategories', {
        ids: list.map(function (item) { return item.id })
      })
    } catch (err) {
      api.toastError(err)
      this.load(true)
    }
  },

  openCreate() {
    this.setData({ showSheet: true, editingId: '', formName: '' })
  },

  openRename(e) {
    const id = e.currentTarget.dataset.id
    const found = this.data.categories.find(function (item) { return item.id === id })
    this.setData({ showSheet: true, editingId: id, formName: found ? found.name : '' })
  },

  closeSheet() {
    this.setData({ showSheet: false })
  },

  noop() {},

  onNameInput(e) {
    this.setData({ formName: e.detail.value })
  },

  async submitSheet() {
    if (this.data.submitting) return
    const name = (this.data.formName || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写分类名称', icon: 'none' })
      return
    }

    const payload = { name: name }
    if (this.data.editingId) payload.id = this.data.editingId

    this.setData({ submitting: true })
    try {
      const result = await api.action('saveCategory', payload)
      this.setData({ showSheet: false })
      await this.load(true)
      const tip = result && result.renamedDishes > 0
        ? '已重命名，同步 ' + result.renamedDishes + ' 道菜'
        : '已保存'
      wx.showToast({ title: tip, icon: 'none' })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  }
})
