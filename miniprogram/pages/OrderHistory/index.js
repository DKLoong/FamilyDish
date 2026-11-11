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

// 分享图标：内联 SVG（托盘 + 向上箭头），不依赖字体或额外图片资源
const SHARE_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMS42IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAxNVYzIi8+PHBhdGggZD0iTTcuNSA3LjVMMTIgM2w0LjUgNC41Ii8+PHBhdGggZD0iTTUgMTN2NWEzIDMgMCAwIDAgMyAzaDhhMyAzIDAgMCAwIDMtM3YtNSIvPjwvc3ZnPg=='

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

// 同菜同餐次的记录可由多人共同点，点菜人存在 orderers 数组里。
// 改造前的记录只有单点菜人字段，读取时兜底，避免旧数据展示为空。
function readOrderers(order) {
  if (order && Array.isArray(order.orderers) && order.orderers.length > 0) return order.orderers
  if (!order || (!order.ordererOpenid && !order.ordererNickname)) return []
  return [{ openid: order.ordererOpenid || '', nickname: order.ordererNickname || '' }]
}

function ordererText(orderers) {
  const names = orderers.map(function (item) { return item.nickname }).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 2) return names.join('、')
  return names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 人'
}

Page({
  data: {
    loading: true,
    loadError: '',
    refreshing: false,
    filters: FILTERS,
    activeFilter: 'pending',
    orders: [],
    shareIcon: SHARE_ICON,
    showSnapshot: false,
    detail: null,

    // 完成与取消共用一套自定义确认弹层，替代样式不可控的 wx.showModal
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmDanger: false,
    confirmAction: '',
    confirmTargetId: '',
    confirming: false
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

  // force：是否强制刷新全局上下文（下拉刷新、错误重试）
  // withSkeleton：查询条件变化（切换筛选）时显式铺骨架，
  //   否则静默刷新会让旧筛选结果留在屏上，被误读成新条件的结果
  async load(force, withSkeleton) {
    if (!this._loaded || withSkeleton === true) this.setData({ loading: true })
    this.setData({ loadError: '' })

    // 请求序号：静默刷新会与切换筛选、完成/取消后的刷新并发，
    // 只应用最后一次请求的结果，避免旧响应后到把列表改回旧数据
    const seq = (this._seq || 0) + 1
    this._seq = seq

    try {
      const ctx = await app.refreshContext(force === true)
      if (seq !== this._seq) return

      const openid = ctx.openid
      const isManager = app.isAdmin()
      const that = this

      const filters = this.data.activeFilter ? { status: this.data.activeFilter } : {}
      const listRes = await api.list('OrderList', { filters: filters, limit: 50 })
      if (seq !== this._seq) return

      const orders = (listRes.items || []).map(function (order) {
        return that.decorate(order, openid, isManager)
      })
      this.setData({ loading: false, orders: orders })
      this._loaded = true
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[OrderHistory] load failed', err)
      if (this._loaded) {
        // 静默刷新失败：保留已渲染的记录，不把整页切成错误态，下次进入会再试
        console.warn('[OrderHistory] 静默刷新失败，沿用上次数据')
      } else {
        this.setData({ loading: false, loadError: err.message || '加载失败' })
      }
    }
  },

  decorate(order, openid, isManager) {
    const snapshot = order.dishSnapshot || {}
    const status = order.status
    const orderers = readOrderers(order)
    const isSelf = orderers.some(function (item) { return item.openid === openid })
    const pending = status === 'pending'

    const metaParts = []
    const who = ordererText(orderers)
    if (who) metaParts.push(who)
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
      ordererCount: orderers.length,
      ordererText: who,
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
    // 查询条件变了必须重新铺骨架，不能让旧筛选的记录留在屏上
    this.load(false, true)
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
    this.setData({
      showConfirm: true,
      confirmTitle: '标记完成',
      confirmLines: ['确认这道菜已经做好了？完成之后状态不能再变更。'],
      confirmText: '确认完成',
      confirmDanger: false,
      confirmAction: 'complete',
      confirmTargetId: e.currentTarget.dataset.id
    })
  },

  cancel(e) {
    const count = Number(e.currentTarget.dataset.count || 0)
    const people = Number(e.currentTarget.dataset.people || 0)

    // 取消是整条取消：一道菜做不做，不拆成「退出自己那一份」。
    // 多人点过时必须说清会把别人的意愿一起去掉。
    const lines = []
    if (people > 1) lines.push('这道菜有 ' + people + ' 人点过，取消后一并移除。')
    if (count > 0) lines.push('将同时移除本次点菜带入的 ' + count + ' 项购物清单项目，其他菜品不受影响。')
    if (lines.length === 0) lines.push('取消后这条记录标记为已取消，历史仍保留。')

    this.setData({
      showConfirm: true,
      confirmTitle: '取消点菜',
      confirmLines: lines,
      confirmText: '取消点菜',
      confirmDanger: true,
      confirmAction: 'cancel',
      confirmTargetId: e.currentTarget.dataset.id
    })
  },

  closeConfirm() {
    // 处理中不允许关闭，否则弹层消失但请求仍在跑
    if (this.data.confirming) return
    this.setData({ showConfirm: false, confirmTargetId: '' })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const action = this.data.confirmAction
    const orderId = this.data.confirmTargetId
    if (!action || !orderId) return

    const isComplete = action === 'complete'
    this.setData({ confirming: true })
    try {
      await api.action(isComplete ? 'completeOrder' : 'cancelOrder', { orderId: orderId })
      this.setData({ showConfirm: false, confirmTargetId: '' })
      wx.showToast({ title: isComplete ? '已完成' : '已取消', icon: 'success' })
      this.load(true)
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ confirming: false })
    }
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
