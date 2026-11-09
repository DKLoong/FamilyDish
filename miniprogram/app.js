// 全局家庭守卫：白名单之外的页面，未加入家庭时统一导流到 Bind。
// 守卫在 Page 构造时注入，pages 名单外的页面一律拦截，不依赖各页面自觉。
const _originalPage = Page
const PAGE_WHITELIST = ['pages/Bind/index']

Page = function (options) {
  const originalOnShow = options.onShow
  options.onShow = function (...args) {
    const app = getApp()
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    const route = (current && current.route) || ''
    const whitelisted = PAGE_WHITELIST.some(function (w) { return route.indexOf(w) === 0 })

    if (!whitelisted && app && app.familyGuard && !app.familyGuard(this)) {
      return
    }
    if (originalOnShow) {
      return originalOnShow.apply(this, args)
    }
  }
  _originalPage(options)
}

App({
  onLaunch() {
    this.globalData = {
      ready: false,
      openid: '',
      membership: null,
      family: null,
      role: null,

      // —— 以下字段仅为兼容尚未重写的旧页面（M3–M6 清理）——
      currentUser: null,
      partner: null,
      userLoaded: false,
      collectionDishList: 'DishList',
      collectionOrderList: 'OrderList',
      categories: [],
      categoriesLoaded: false
    }
    this.initCloud()
    // 不阻塞启动：页面 onShow 时若上下文未就绪，守卫会自行等待
    this.refreshContext()
  },

  initCloud() {
    const envList = require('./envList.js').envList || []
    const first = envList[0]
    if (first && first.envId) {
      wx.cloud.init({ traceUser: true, env: first.envId })
      return
    }
    wx.showModal({ content: '未找到云开发环境配置，请检查 envList.js', showCancel: false })
  },

  // 读取用户与家庭上下文。同一时刻只发一次请求。
  async refreshContext(force) {
    if (this.globalData.ready && !force) return this.contextSummary()
    if (this._contextPromise && !force) return this._contextPromise

    this._contextPromise = this._loadContext()
    try {
      return await this._contextPromise
    } finally {
      this._contextPromise = null
    }
  },

  async _loadContext() {
    try {
      const res = await wx.cloud.callFunction({ name: 'ensureUser' })
      const result = res && res.result
      if (!result || !result.success) {
        console.error('[app] ensureUser failed', result)
      } else {
        const data = result.data || {}
        // 开发期日志：一行看清 openid / membership / trace，定位完可移除
        console.log('[app] context', JSON.stringify(data))
        this.globalData.openid = data.openid || ''
        this.globalData.membership = data.membership || null
        this.globalData.family = data.family || null
        this.globalData.role = data.membership ? data.membership.role : null
      }
    } catch (err) {
      console.error('[app] load context failed', err)
    }

    this.globalData.ready = true
    this.globalData.userLoaded = true
    // 旧页面读取 currentUser / partner，这里给最小可用值，避免空指针
    this.globalData.currentUser = this.globalData.openid
      ? {
          _id: this.globalData.openid,
          nickname: this.globalData.membership ? this.globalData.membership.nickname : ''
        }
      : null
    this.globalData.partner = null

    return this.contextSummary()
  },

  contextSummary() {
    return {
      openid: this.globalData.openid,
      membership: this.globalData.membership,
      family: this.globalData.family,
      role: this.globalData.role,
      ready: this.globalData.ready
    }
  },

  // 页面守卫：返回 false 表示已接管跳转，页面 onShow 应中止
  familyGuard(page) {
    const apply = () => {
      if (page && page.setData) {
        page.setData({
          familyReady: true,
          familyName: this.getFamilyName(),
          roleLabel: this.getRoleLabel()
        })
      }
    }

    if (!this.globalData.ready) {
      // 首次启动上下文未就绪：先放行，加载完再决定是否导流
      this.refreshContext().then(() => {
        if (!this.globalData.membership) {
          wx.reLaunch({ url: '/pages/Bind/index' })
        } else {
          apply()
        }
      })
      return true
    }

    if (!this.globalData.membership) {
      wx.reLaunch({ url: '/pages/Bind/index' })
      return false
    }

    apply()
    return true
  },

  hasFamily() {
    return !!this.globalData.membership
  },

  getFamilyName() {
    return this.globalData.family ? this.globalData.family.name : ''
  },

  getRoleLabel() {
    const role = this.globalData.role
    if (role === 'owner') return '创建者'
    if (role === 'admin') return '管理员'
    if (role === 'member') return '成员'
    return ''
  },

  isAdmin() {
    return this.globalData.role === 'owner' || this.globalData.role === 'admin'
  },

  isOwner() {
    return this.globalData.role === 'owner'
  },

  // 临时链接缓存（fileID -> { url, expireTime }）
  _tempUrlCache: {},

  async getTempFileURLs(fileIds) {
    if (!fileIds || fileIds.length === 0) return {}
    const now = Date.now()
    const result = {}
    const needFetch = []

    for (const id of fileIds) {
      if (!id || !String(id).startsWith('cloud://')) continue
      const cached = this._tempUrlCache[id]
      if (cached && cached.expireTime > now) {
        result[id] = cached.url
      } else {
        needFetch.push(id)
      }
    }

    if (needFetch.length > 0) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getFileURL', data: { fileList: needFetch } })
        if (res.result && res.result.success) {
          for (const item of res.result.fileList) {
            if (item.tempFileURL) {
              result[item.fileID] = item.tempFileURL
              this._tempUrlCache[item.fileID] = {
                url: item.tempFileURL,
                expireTime: now + 90 * 60 * 1000
              }
            }
          }
        }
      } catch (err) {
        console.error('[app] getTempFileURLs failed', err)
      }
    }
    return result
  },

  async convertFileURLs(items, fields) {
    const allIds = []
    for (const item of items) {
      for (const field of fields) {
        const val = item[field]
        if (val && String(val).startsWith('cloud://')) allIds.push(val)
      }
    }
    const urlMap = await this.getTempFileURLs(allIds)
    for (const item of items) {
      for (const field of fields) {
        const raw = item[field]
        if (urlMap[raw] && urlMap[raw] !== raw) {
          item['_raw_' + field] = raw
          item[field] = urlMap[raw]
        }
      }
    }
    return items
  },

  // —— 兼容层：旧页面仍在调用这些方法（M3–M6 重写后删除）——
  async loadUserInfo() {
    await this.refreshContext()
    return { currentUser: this.globalData.currentUser, partner: null }
  },

  isBound() {
    return this.hasFamily()
  },

  bindGuard(page) {
    return this.familyGuard(page)
  },

  getCurrentUserName() {
    const membership = this.globalData.membership
    return membership && membership.nickname ? membership.nickname : '我'
  },

  getPartnerName() {
    return '家人'
  },

  getDisplayName() {
    return '家人'
  },

  getKitchenName() {
    return this.getFamilyName() || '家庭菜单'
  },

  setKitchenTitle() {
    wx.setNavigationBarTitle({ title: this.getKitchenName() })
  },

  // 以下为已停用能力的兜底桩，只为避免旧页面报 "is not a function"。
  // 对应页面在 M3–M6 重写后，这些桩可以整体删除。
  async loadCategories() {
    return this.globalData.categories
  },

  isProfileComplete() {
    return true
  },

  async bindPartner() {
    return { success: false, message: '该功能已停用' }
  },

  async unbindPartner() {
    return { success: false, message: '该功能已停用' }
  },

  async updateNickname() {
    return { success: false, message: '该功能已停用' }
  },

  async updateKitchenName() {
    return { success: false, message: '该功能已停用' }
  },

  async database() {
    // 故意抛错：静默返回假实例会掩盖「前端不该直连数据库」这件事
    throw new Error('前端已禁止直连数据库，请通过 utils/api.js 调用云函数')
  }
})
