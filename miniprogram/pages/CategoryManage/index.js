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
    formName: '',

    // 删除确认：先试行，有菜品在用时服务端返回 CONFIRM_REQUIRED，
    // 用同一弹层转成二次确认，不另起一个弹窗
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmDanger: false,
    confirmTargetId: '',
    confirmForced: false,
    confirming: false
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
    // 骨架只在首次进入时铺：改名、删除、排序失败后的刷新保留现有列表原地替换
    if (!this._loaded) this.setData({ loading: true })
    this.setData({ loadError: '' })

    // 请求序号：静默刷新会与删除/排序后的刷新并发，只应用最后一次结果
    const seq = (this._seq || 0) + 1
    this._seq = seq

    try {
      // 幂等同步：把菜品里已有、但分类表还没登记的分类补进来，避免首次进入是空列表
      if (!this._synced) {
        await api.action('syncCategories')
        this._synced = true
      }
      if (seq !== this._seq) return

      const res = await api.list('Category', { orderBy: 'sort', order: 'asc', limit: 100 })
      if (seq !== this._seq) return

      this.setData({
        loading: false,
        loadError: '',
        categories: (res.items || []).map(function (item) {
          return { id: item._id, name: item.name }
        })
      })
      this._loaded = true
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[CategoryManage] load failed', err)
      if (this._loaded) {
        console.warn('[CategoryManage] 静默刷新失败，沿用上次数据')
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
      }
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

  // 删除：先直接尝试，若还有菜品在用，服务端返回 CONFIRM_REQUIRED，
  // 用服务端文案在同一个弹层里转成二次确认，确认后带 confirm 重试。
  removeCategory(e) {
    if (this.data.submitting) return
    const id = e.currentTarget.dataset.id
    const found = this.data.categories.find(function (item) { return item.id === id })
    const name = found ? found.name : ''

    this.setData({
      showConfirm: true,
      confirmTitle: '删除分类',
      confirmLines: ['删除「' + name + '」？'],
      confirmText: '删除',
      confirmDanger: true,
      confirmTargetId: id,
      confirmForced: false
    })
  },

  closeConfirm() {
    if (this.data.confirming) return
    this.setData({ showConfirm: false, confirmTargetId: '' })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const id = this.data.confirmTargetId
    if (!id) return

    this.setData({ confirming: true })
    try {
      await api.action('deleteCategory', { id: id, confirm: this.data.confirmForced === true })
      this.setData({ showConfirm: false, confirmTargetId: '' })
      await this.load(true)
      wx.showToast({ title: '已删除', icon: 'none' })
    } catch (err) {
      if (err && err.code === 'CONFIRM_REQUIRED') {
        this.setData({
          confirmTitle: '确认删除',
          confirmLines: [err.message],
          confirmText: '仍然删除',
          confirmForced: true
        })
      } else {
        api.toastError(err)
      }
    } finally {
      this.setData({ confirming: false })
    }
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
