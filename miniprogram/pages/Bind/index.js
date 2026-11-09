// 创建家庭 / 加入家庭。取代上游的「伴侣绑定」。
const app = getApp()
const api = require('../../utils/api.js')

const MODE_CREATE = 'create'
const MODE_JOIN = 'join'
const CODE_LENGTH = 6

Page({
  data: {
    mode: MODE_CREATE,
    familyName: '',
    nickname: '',
    inviteCode: '',
    submitting: false,
    statusBarHeight: 20,
    fromInvite: false
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync()
    const inviteCode = (options && options.inviteCode) || ''
    const normalized = String(inviteCode).toUpperCase()
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      inviteCode: normalized,
      mode: normalized ? MODE_JOIN : MODE_CREATE,
      fromInvite: !!normalized
    })
  },

  async onShow() {
    // 已有家庭直接回首页，避免重复创建
    const ctx = await app.refreshContext()
    if (ctx.membership) {
      wx.reLaunch({ url: '/pages/MainPage/index' })
    }
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode || this.data.submitting) return
    this.setData({ mode: mode })
  },

  onFamilyNameInput(e) {
    this.setData({ familyName: e.detail.value })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onCodeInput(e) {
    const value = String(e.detail.value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH)
    this.setData({ inviteCode: value })
    return value
  },

  async submit() {
    if (this.data.submitting) return

    const nickname = this.data.nickname.trim()
    if (!nickname) return this.toast('请填写家庭内昵称')
    if (nickname.length > 20) return this.toast('昵称最多 20 个字符')

    if (this.data.mode === MODE_CREATE) {
      const familyName = this.data.familyName.trim()
      if (!familyName) return this.toast('请填写家庭名称')
      if (familyName.length > 12) return this.toast('家庭名称最多 12 个字符')
      await this.run(MODE_CREATE, {
        action: 'createFamily',
        payload: { familyName: familyName, nickname: nickname }
      })
      return
    }

    if (this.data.inviteCode.length !== CODE_LENGTH) {
      return this.toast('请输入 ' + CODE_LENGTH + ' 位邀请码')
    }
    await this.run(MODE_JOIN, {
      action: 'joinFamily',
      payload: { inviteCode: this.data.inviteCode, nickname: nickname }
    })
  },

  async run(mode, request) {
    this.setData({ submitting: true })
    try {
      await api.withLoading(mode === MODE_CREATE ? '创建中' : '加入中', function () {
        return api.action(request.action, request.payload)
      })
      await app.refreshContext(true)
      wx.showToast({
        title: mode === MODE_CREATE ? '家庭已创建' : '已加入家庭',
        icon: 'success',
        duration: 800
      })
      setTimeout(function () {
        wx.reLaunch({ url: '/pages/MainPage/index' })
      }, 700)
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  toast(message) {
    wx.showToast({ title: message, icon: 'none' })
  }
})
