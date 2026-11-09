// 点菜记录：状态筛选、完成与取消、快照查看、微信原生分享。
const app = getApp()
const api = require('../../utils/api.js')

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待做' },
  { key: 'completed', label: '已完成' },
  { key: 'cancelled', label: '已取消' }
]

const STATUS_LABEL = { pending: '待做', completed: '已完成', cancelled: '已取消' }
const STATUS_CLASS = { pending: 'pending', completed: 'done', cancelled: 'cancelled' }

function pad(value) {
  return value < 10 ? '0' + value : String(value)
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (isNaN(date.getTime())) return ''
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function formatAmount(item) {
  if (typeof item.quantity === 'number') {
    return item.quantity + (item.unit ? ' ' + item.unit : '')
  }
  return item.note || '适量'
}

Page({
  data: {
    loading: true,
    loadError: '',
    filters: FILTERS,
    activeFilter: 'pending',
    orders: [],
    showSnapshot: false,
    detail: null
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  async load(force) {
    if (force !== true) this.setData({ loading: true, loadError: '' })
    const ctx = await app.refreshContext(force === true)
    const openid = ctx.openid
    const isManager = app.isAdmin()
    const that = this

    try {
      const filters = this.data.activeFilter ? { status: this.data.activeFilter } : {}
      const listRes = await api.list('OrderList', { filters: filters, limit: 50 })
      const orders = (listRes.items || []).map(function (order) {
        return that.decorate(order, openid, isManager)
      })
      this.setData({ loading: false, orders: orders })
    } catch (err) {
      console.error('[OrderHistory] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }

    if (force === true) wx.stopPullDownRefresh()
  },

  decorate(order, openid, isManager) {
    const snapshot = order.dishSnapshot || {}
    const status = order.status
    const isSelf = order.ordererOpenid === openid
    const pending = status === 'pending'

    const metaParts = []
    if (order.ordererNickname) metaParts.push(order.ordererNickname)
    if (order.mealDate) metaParts.push(order.mealDate)
    if (order.mealType) metaParts.push(order.mealType)

    const ingredients = (snapshot.ingredients || []).map(function (item) {
      return {
        key: item.key || item.name,
        name: item.name,
        amount: formatAmount(item)
      }
    })

    const steps = (snapshot.steps || []).map(function (item, index) {
      return { no: index + 1, text: item.text }
    })

    return {
      id: order._id,
      dishName: snapshot.name || '（菜品已归档或删除）',
      status: status,
      statusLabel: STATUS_LABEL[status] || status,
      statusClass: STATUS_CLASS[status] || '',
      metaText: metaParts.join(' · '),
      remark: order.remark || '',
      createdText: formatTime(order.createTime),
      shoppingCount: order.shoppingCount || 0,
      isSelf: isSelf,
      canOperate: pending && (isManager || isSelf),
      ingredients: ingredients,
      steps: steps
    }
  },

  switchFilter(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeFilter) return
    this.setData({ activeFilter: key })
    this.load()
  },

  openSnapshot(e) {
    const id = e.currentTarget.dataset.id
    const order = this.data.orders.find(function (item) { return item.id === id })
    if (!order) return
    this.setData({ showSnapshot: true, detail: order })
  },

  closeSnapshot() {
    this.setData({ showSnapshot: false, detail: null })
  },

  complete(e) {
    const orderId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '标记完成',
      content: '确认这道菜已经做好了？完成之后状态不能再变更。',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await api.withLoading('处理中', function () {
            return api.action('completeOrder', { orderId: orderId })
          })
          wx.showToast({ title: '已完成', icon: 'success' })
          that.load(true)
        } catch (err) {
          api.toastError(err)
        }
      }
    })
  },

  cancel(e) {
    const orderId = e.currentTarget.dataset.id
    const count = Number(e.currentTarget.dataset.count || 0)
    const content = count > 0
      ? '取消后将同时移除本次点菜带入的 ' + count + ' 项购物清单项目，其他菜品不受影响。记录本身会保留。'
      : '取消后这条记录标记为已取消，历史仍保留。'

    const that = this
    wx.showModal({
      title: '取消点菜',
      content: content,
      confirmText: '取消点菜',
      confirmColor: '#C9663B',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await api.withLoading('处理中', function () {
            return api.action('cancelOrder', { orderId: orderId })
          })
          wx.showToast({ title: '已取消', icon: 'success' })
          that.load(true)
        } catch (err) {
          api.toastError(err)
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: (app.getFamilyName() || '家庭') + '的点菜记录',
      path: '/pages/OrderHistory/index'
    }
  },

  noop() {},

  retry() {
    this.load(true)
  }
})
