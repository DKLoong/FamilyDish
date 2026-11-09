// 家庭首页（M2 最小版本）。
// 菜品库、搜索、随机选菜在 M3 接入，本页先提供家庭概览与入口。
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    loading: true,
    loadError: '',
    familyName: '',
    roleLabel: '',
    memberCount: 0,
    maxMembers: 0,
    canManage: false
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  async load(force) {
    this.setData({ loading: !force, loadError: '' })

    if (!app.hasFamily()) {
      // 守卫会导流到 Bind，这里只保证页面不空转
      this.setData({ loading: false })
      return
    }

    const ctx = await app.refreshContext(force === true)
    this.setData({
      familyName: ctx.family ? ctx.family.name : '',
      roleLabel: app.getRoleLabel(),
      maxMembers: ctx.family ? ctx.family.maxMembers : 0
    })

    try {
      const data = await api.action('listMembers')
      this.setData({
        loading: false,
        familyName: data.familyName,
        roleLabel: app.getRoleLabel(),
        memberCount: data.members.length,
        maxMembers: data.maxMembers,
        canManage: data.canManage
      })
    } catch (err) {
      console.error('[MainPage] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }

    if (force) wx.stopPullDownRefresh()
  },

  goMine() {
    wx.navigateTo({ url: '/pages/Settings/index' })
  },

  retry() {
    this.load(true)
  }
})
