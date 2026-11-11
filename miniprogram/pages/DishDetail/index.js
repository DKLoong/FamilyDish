// 菜谱详情：只读展示 + 食材「已准备」本地勾选 + 步骤计时。
// 点菜在 M4 接入，此处底部按钮先给提示。
const app = getApp()
const api = require('../../utils/api.js')
const duration = require('../../utils/duration.js')

// 全局只允许一个进行中的计时器，按菜品存本地
const TIMER_KEY = 'dishTimer'

function todayStr() {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + month + '-' + day
}

function newRequestId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
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
    canManage: false,
    dishId: '',
    dish: null,
    initial: '',
    ingredients: [],
    steps: [],
    preparedCount: 0,
    timer: null,

    showOrderSheet: false,
    submitting: false,
    mealTypes: ['早餐', '午餐', '晚餐', '其他'],
    orderDate: '',
    orderMeal: '',
    orderRemark: '',
    requestId: '',
    pendingCount: 0,

    // 归档、清除已准备、切换计时共用一套确认弹层
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmMode: '',
    confirming: false
  },

  onLoad(options) {
    const dishId = (options && options.id) || ''
    if (!dishId) {
      this.setData({ loading: false, loadError: '缺少菜品参数' })
      return
    }
    this.setData({ dishId: dishId, canManage: app.isAdmin() })
    this.load()
  },

  onShow() {
    this.resumeTimer()
    // 从编辑页返回时重新拉取，保证内容是最新的
    if (this._loaded) this.load()
  },

  onHide() {
    this.clearTick()
  },

  onUnload() {
    this.clearTick()
  },

  async load() {
    // 骨架只在首次成功渲染前铺：从编辑页返回时静默刷新，内容原地更新
    if (!this._loaded) this.setData({ loading: true })
    this.setData({ loadError: '' })

    // 请求序号：静默刷新会与重试并发，只应用最后一次结果
    const seq = (this._seq || 0) + 1
    this._seq = seq

    try {
      const dish = await api.get('DishList', this.data.dishId)
      if (!dish) throw new Error('菜品不存在')
      if (seq !== this._seq) return

      let imageUrl = ''
      if (dish.image && String(dish.image).indexOf('cloud://') === 0) {
        const map = await app.getTempFileURLs([dish.image])
        imageUrl = map[dish.image] || ''
        if (seq !== this._seq) return
      }

      const preparedKeys = this.readPrepared(dish)
      const ingredients = (dish.ingredients || []).map(function (item, index) {
        const key = item.key || 'i' + (index + 1)
        return {
          key: key,
          name: item.name,
          display: formatAmount(item),
          prepared: preparedKeys.indexOf(key) >= 0
        }
      })

      const steps = (dish.steps || []).map(function (item) {
        return {
          text: item.text,
          minutes: item.minutes || 0,
          timeText: duration.formatMinutes(item.minutes)
        }
      })

      this.setData({
        loading: false,
        dish: Object.assign({}, dish, {
          imageUrl: imageUrl,
          timeText: duration.formatMinutes(dish.time)
        }),
        initial: String(dish.name || '?').slice(0, 1),
        ingredients: ingredients,
        steps: steps,
        preparedCount: ingredients.filter(function (item) { return item.prepared }).length
      })
      this._loaded = true
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[DishDetail] load failed', err)
      if (this._loaded) {
        console.warn('[DishDetail] 静默刷新失败，沿用上次数据')
      } else {
        this.setData({ loading: false, loadError: err.message || '加载失败' })
      }
    }
  },

  // 「已准备」按 openid + 菜品 + 版本存储，菜品内容更新后旧勾选自动失效
  preparedStorageKey(dish) {
    const openid = app.globalData.openid || 'anon'
    return 'prepared:' + openid + ':' + dish._id + ':' + (dish.version || 0)
  },

  readPrepared(dish) {
    try {
      const raw = wx.getStorageSync(this.preparedStorageKey(dish))
      return Array.isArray(raw) ? raw : []
    } catch (err) {
      console.error('[DishDetail] read prepared failed', err)
      return []
    }
  },

  toggleIngredient(e) {
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.ingredients.slice()
    const item = list[index]
    if (!item) return

    item.prepared = !item.prepared
    const keys = list
      .filter(function (row) { return row.prepared })
      .map(function (row) { return row.key })

    try {
      wx.setStorageSync(this.preparedStorageKey(this.data.dish), keys)
    } catch (err) {
      console.error('[DishDetail] save prepared failed', err)
    }

    this.setData({ ingredients: list, preparedCount: keys.length })
  },

  // 一键清除：只清本地的「已准备」勾选，不改任何共享数据和已生成的购物清单
  clearPrepared() {
    const count = this.data.preparedCount
    if (count === 0) return

    this.setData({
      showConfirm: true,
      confirmTitle: '清除已准备',
      confirmLines: ['将取消 ' + count + ' 项食材的勾选。已生成的购物清单不受影响。'],
      confirmText: '清除',
      confirmMode: 'clearPrepared'
    })
  },

  doClearPrepared() {
    try {
      wx.removeStorageSync(this.preparedStorageKey(this.data.dish))
    } catch (err) {
      console.error('[DishDetail] clear prepared failed', err)
    }
    const list = this.data.ingredients.map(function (row) {
      return Object.assign({}, row, { prepared: false })
    })
    this.setData({ ingredients: list, preparedCount: 0 })
    wx.showToast({ title: '已清除', icon: 'none' })
  },

  // —— 计时器 ——
  startTimer(e) {
    const index = Number(e.currentTarget.dataset.index)
    const minutes = Number(e.currentTarget.dataset.minutes)
    if (!minutes) return

    const stored = this.readTimer()

    if (stored && stored.stepIndex === index) {
      this.stopTimer()
      return
    }

    if (stored && stored.stepIndex !== index) {
      // 确认后要用的参数放实例字段，弹层字段只负责渲染
      this._pendingTimer = { index: index, minutes: minutes }
      this.setData({
        showConfirm: true,
        confirmTitle: '切换计时',
        confirmLines: ['第 ' + (stored.stepIndex + 1) + ' 步正在计时，切换会重新开始。'],
        confirmText: '切换',
        confirmMode: 'switchTimer'
      })
      return
    }

    this.beginTimer(index, minutes)
  },

  beginTimer(index, minutes) {
    const endAt = Date.now() + minutes * 60 * 1000
    try {
      wx.setStorageSync(TIMER_KEY, {
        dishId: this.data.dishId,
        stepIndex: index,
        endAt: endAt,
        total: minutes
      })
    } catch (err) {
      console.error('[DishDetail] save timer failed', err)
    }
    this.setData({ timer: { stepIndex: index, text: this.formatRemaining(endAt - Date.now()) } })
    this.startTick()
  },

  startTick() {
    this.clearTick()
    const that = this
    this._tick = setInterval(function () {
      const stored = that.readTimer()
      if (!stored) {
        that.clearTick()
        that.setData({ timer: null })
        return
      }
      const left = stored.endAt - Date.now()
      if (left <= 0) {
        that.clearTick()
        that.setData({ timer: { stepIndex: stored.stepIndex, text: '已到时' } })
        try { wx.vibrateShort({ type: 'light' }) } catch (err) { console.error('[DishDetail] vibrate failed', err) }
        wx.showToast({ title: '第 ' + (stored.stepIndex + 1) + ' 步已到时', icon: 'none' })
        that.clearTimerStorage()
        return
      }
      that.setData({ timer: { stepIndex: stored.stepIndex, text: that.formatRemaining(left) } })
    }, 1000)
  },

  // 回到页面时按结束时间戳重算，不依赖 setInterval 持续运行
  resumeTimer() {
    const stored = this.readTimer()
    if (!stored || stored.dishId !== this.data.dishId) {
      this.setData({ timer: null })
      return
    }
    const left = stored.endAt - Date.now()
    if (left <= 0) {
      this.setData({ timer: { stepIndex: stored.stepIndex, text: '已到时' } })
      this.clearTimerStorage()
      return
    }
    this.setData({ timer: { stepIndex: stored.stepIndex, text: this.formatRemaining(left) } })
    this.startTick()
  },

  stopTimer() {
    this.clearTick()
    this.clearTimerStorage()
    this.setData({ timer: null })
  },

  clearTick() {
    if (this._tick) {
      clearInterval(this._tick)
      this._tick = null
    }
  },

  readTimer() {
    try {
      const raw = wx.getStorageSync(TIMER_KEY)
      if (raw && raw.endAt && raw.dishId) return raw
    } catch (err) {
      console.error('[DishDetail] read timer failed', err)
    }
    return null
  },

  clearTimerStorage() {
    try {
      wx.removeStorageSync(TIMER_KEY)
    } catch (err) {
      console.error('[DishDetail] clear timer failed', err)
    }
  },

  formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return minutes + ':' + (seconds < 10 ? '0' + seconds : seconds)
  },

  editDish() {
    wx.navigateTo({ url: '/pages/DishAdd/index?id=' + this.data.dishId })
  },

  archiveDish() {
    this.setData({
      showConfirm: true,
      confirmTitle: '归档菜品',
      confirmLines: ['归档后不再出现在列表、随机和搜索结果中，历史点菜记录不受影响。'],
      confirmText: '归档',
      confirmMode: 'archive'
    })
  },

  closeConfirm() {
    if (this.data.confirming) return
    this.setData({ showConfirm: false })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const mode = this.data.confirmMode
    if (!mode) return

    this.setData({ confirming: true })
    try {
      if (mode === 'archive') {
        await api.archive(this.data.dishId)
        this.setData({ showConfirm: false })
        wx.showToast({ title: '已归档', icon: 'success' })
        setTimeout(function () { wx.navigateBack() }, 600)
      } else if (mode === 'clearPrepared') {
        this.doClearPrepared()
        this.setData({ showConfirm: false })
      } else if (mode === 'switchTimer') {
        const pending = this._pendingTimer || {}
        this.setData({ showConfirm: false })
        this.beginTimer(pending.index, pending.minutes)
      }
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ confirming: false })
    }
  },

  // —— 点菜 ——
  orderDish() {
    this.openOrderSheet()
  },

  openOrderSheet() {
    this.setData({
      showOrderSheet: true,
      orderDate: todayStr(),
      orderMeal: '',
      orderRemark: '',
      requestId: newRequestId(),
      pendingCount: this.data.ingredients.filter(function (item) { return !item.prepared }).length
    })
  },

  closeOrderSheet() {
    // 提交中不允许关闭：否则弹层消失但请求仍在跑，结果仍会弹出
    if (this.data.submitting) return
    this.setData({ showOrderSheet: false })
  },

  onDateChange(e) {
    this.setData({ orderDate: e.detail.value })
  },

  pickMeal(e) {
    const meal = e.currentTarget.dataset.meal
    this.setData({ orderMeal: this.data.orderMeal === meal ? '' : meal })
  },

  onRemarkInput(e) {
    this.setData({ orderRemark: e.detail.value })
  },

  async submitOrder() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const preparedKeys = this.data.ingredients
        .filter(function (item) { return item.prepared })
        .map(function (item) { return item.key })

      const result = await api.action('placeOrder', {
        dishId: this.data.dishId,
        requestId: this.data.requestId,
        preparedKeys: preparedKeys,
        mealDate: this.data.orderDate,
        mealType: this.data.orderMeal,
        remark: this.data.orderRemark
      })

      this.setData({ showOrderSheet: false })

      // 同菜同餐次不会再建一条记录，必须明确告诉用户发生了什么，
      // 否则「点了但记录没变」会被当成失败。
      let title = '已点菜'
      if (result.duplicated) title = '这笔点菜已提交过'
      else if (result.merged && result.alreadyJoined) title = '你已点过这道菜'
      else if (result.merged) title = '已合并，共 ' + result.ordererCount + ' 人点这道菜'
      if (result.shoppingFailed) title = '已合并，请手动补充购物清单'

      wx.showToast({ title: title, icon: 'none', duration: 2400 })
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  noop() {},

  retry() {
    this.load()
  }
})
