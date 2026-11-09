// 菜谱详情：只读展示 + 食材「已准备」本地勾选 + 步骤计时。
// 点菜在 M4 接入，此处底部按钮先给提示。
const app = getApp()
const api = require('../../utils/api.js')

// 全局只允许一个进行中的计时器，按菜品存本地
const TIMER_KEY = 'dishTimer'

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
    dishId: '',
    dish: null,
    initial: '',
    ingredients: [],
    steps: [],
    preparedCount: 0,
    timer: null
  },

  onLoad(options) {
    const dishId = (options && options.id) || ''
    if (!dishId) {
      this.setData({ loading: false, loadError: '缺少菜品参数' })
      return
    }
    this.setData({ dishId: dishId })
    this.load()
  },

  onShow() {
    this.resumeTimer()
  },

  onHide() {
    this.clearTick()
  },

  onUnload() {
    this.clearTick()
  },

  async load() {
    this.setData({ loading: true, loadError: '' })
    try {
      const dish = await api.get('DishList', this.data.dishId)
      if (!dish) throw new Error('菜品不存在')

      let imageUrl = ''
      if (dish.image && String(dish.image).indexOf('cloud://') === 0) {
        const map = await app.getTempFileURLs([dish.image])
        imageUrl = map[dish.image] || ''
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
        return { text: item.text, minutes: item.minutes || 0 }
      })

      this.setData({
        loading: false,
        dish: Object.assign({}, dish, { imageUrl: imageUrl }),
        initial: String(dish.name || '?').slice(0, 1),
        ingredients: ingredients,
        steps: steps,
        preparedCount: ingredients.filter(function (item) { return item.prepared }).length
      })
    } catch (err) {
      console.error('[DishDetail] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
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
      const that = this
      wx.showModal({
        title: '切换计时',
        content: '第 ' + (stored.stepIndex + 1) + ' 步正在计时，切换会重新开始。',
        success: function (res) {
          if (res.confirm) that.beginTimer(index, minutes)
        }
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

  orderDish() {
    wx.showToast({ title: '点菜功能即将接入', icon: 'none' })
  },

  retry() {
    this.load()
  }
})
