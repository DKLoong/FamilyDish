// 「我的」页：身份、邀请入口、管理入口、家庭设置、退出与解散。
// 成员的角色调整与移除已移入独立的家庭成员页。
const app = getApp()
const api = require('../../utils/api.js')
const appInfo = require('../../utils/app-info.js')

const ROLE_LABEL = { owner: '创建者', admin: '管理员', member: '成员' }

Page({
  data: {
    loading: true,
    loadError: '',

    familyName: '',
    myNickname: '',
    initial: '',
    roleLabel: '',
    inviteCode: '',
    memberCount: 0,
    maxMembers: 10,

    isOwner: false,
    canManage: false,
    appVersion: 'v' + appInfo.getVersion(),

    showInvite: false,
    sharing: false,
    showCapacity: false,
    tempCapacity: 10,
    showNickname: false,
    tempNickname: '',
    showRename: false,
    tempFamilyName: '',

    // 重新生成邀请码、退出/解散共用一套确认弹层
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmDanger: false,
    confirmAction: '',
    confirming: false
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  async load(force) {
    if (force !== true) this.setData({ loading: true })
    this.setData({ loadError: '' })

    if (force === true) await app.refreshContext(true)

    try {
      const data = await api.action('listMembers')
      const isOwner = data.role === 'owner'
      const members = data.members || []
      const nickname = app.getCurrentUserName() || ''

      this.setData({
        loading: false,
        familyName: data.familyName,
        myNickname: nickname,
        initial: String(nickname || data.familyName || '?').slice(0, 1),
        roleLabel: ROLE_LABEL[data.role] || '',
        inviteCode: data.inviteCode,
        memberCount: members.length,
        maxMembers: data.maxMembers,
        isOwner: isOwner,
        canManage: data.canManage
      })
    } catch (err) {
      console.error('[Settings] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }

    if (force === true) wx.stopPullDownRefresh()
  },

  // —— 邀请 ——
  openInvite() {
    this.setData({ showInvite: true })
  },

  closeInvite() {
    this.setData({ showInvite: false, sharing: false })
  },

  // open-type="share" 没有完成回调，只能在自己被点击时先切外观，
  // 分享面板盖上来之后再把抽屉收起，用户返回时看到的就是已关闭状态
  onShareTap() {
    if (this.data.sharing) return
    this.setData({ sharing: true })
    const that = this
    setTimeout(function () {
      that.setData({ showInvite: false, sharing: false })
    }, 600)
  },

  copyCode() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: function () { wx.showToast({ title: '邀请码已复制', icon: 'success' }) }
    })
  },

  onShareAppMessage() {
    const code = this.data.inviteCode
    return {
      title: '邀请你加入「' + (this.data.familyName || '家庭菜单') + '」',
      path: code ? '/pages/Bind/index?inviteCode=' + code : '/pages/MainPage/index'
    }
  },

  regenerate() {
    this.setData({
      showConfirm: true,
      confirmTitle: '重新生成邀请码',
      confirmLines: ['旧邀请码将立即失效，已加入的成员不受影响。'],
      confirmText: '重新生成',
      confirmDanger: false,
      confirmAction: 'regenerate'
    })
  },

  // —— 入口 ——
  goDishManage() {
    wx.navigateTo({ url: '/pages/DishManage/index' })
  },

  goCategories() {
    wx.navigateTo({ url: '/pages/CategoryManage/index' })
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/MemberManage/index' })
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/About/index' })
  },

  // —— 家庭名称 ——
  openRename() {
    this.setData({ showRename: true, tempFamilyName: this.data.familyName })
  },

  closeRename() {
    this.setData({ showRename: false })
  },

  onFamilyNameInput(e) {
    this.setData({ tempFamilyName: e.detail.value })
  },

  async saveRename() {
    const name = (this.data.tempFamilyName || '').trim()
    if (!name) return wx.showToast({ title: '家庭名称不能为空', icon: 'none' })
    if (name.length > 12) return wx.showToast({ title: '最多 12 个字', icon: 'none' })

    try {
      await api.action('renameFamily', { name: name })
      this.setData({ showRename: false, familyName: name })
      await app.refreshContext(true)
      wx.showToast({ title: '已更新', icon: 'success' })
    } catch (err) {
      api.toastError(err)
    }
  },

  // —— 人数上限 ——
  openCapacity() {
    this.setData({ showCapacity: true, tempCapacity: this.data.maxMembers })
  },

  closeCapacity() {
    this.setData({ showCapacity: false })
  },

  decCapacity() {
    const next = Math.max(this.data.memberCount, this.data.tempCapacity - 1)
    this.setData({ tempCapacity: next })
  },

  incCapacity() {
    const next = Math.min(50, this.data.tempCapacity + 1)
    this.setData({ tempCapacity: next })
  },

  async saveCapacity() {
    try {
      await api.action('updateCapacity', { maxMembers: this.data.tempCapacity })
      this.setData({ showCapacity: false })
      await this.load()
      wx.showToast({ title: '已更新', icon: 'success' })
    } catch (err) {
      api.toastError(err)
    }
  },

  // —— 昵称 ——
  openNickname() {
    this.setData({ showNickname: true, tempNickname: this.data.myNickname })
  },

  closeNickname() {
    this.setData({ showNickname: false })
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value })
  },

  async saveNickname() {
    const nickname = (this.data.tempNickname || '').trim()
    if (!nickname) return wx.showToast({ title: '昵称不能为空', icon: 'none' })
    if (nickname.length > 20) return wx.showToast({ title: '最多 20 个字符', icon: 'none' })

    try {
      await api.action('updateNickname', { nickname: nickname })
      await app.refreshContext(true)
      this.setData({
        showNickname: false,
        myNickname: nickname,
        initial: String(nickname).slice(0, 1)
      })
      await this.load()
      wx.showToast({ title: '已更新', icon: 'success' })
    } catch (err) {
      api.toastError(err)
    }
  },

  // —— 退出 / 解散 ——
  leaveOrDissolve() {
    const isOwner = this.data.isOwner
    this.setData({
      showConfirm: true,
      confirmTitle: isOwner ? '解散家庭' : '退出家庭',
      confirmLines: isOwner
        ? ['解散后所有成员都将失去访问权限，历史记录保留但无法再查看。']
        : ['退出后将无法查看家庭菜品与点菜记录，历史数据会保留。'],
      confirmText: isOwner ? '解散' : '退出',
      confirmDanger: true,
      confirmAction: isOwner ? 'dissolve' : 'leave'
    })
  },

  closeConfirm() {
    if (this.data.confirming) return
    this.setData({ showConfirm: false })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const action = this.data.confirmAction
    if (!action) return

    this.setData({ confirming: true })
    try {
      if (action === 'regenerate') {
        const data = await api.action('regenerateInvite')
        this.setData({ showConfirm: false, inviteCode: data.inviteCode })
        wx.showToast({ title: '已更新邀请码', icon: 'success' })
      } else if (action === 'dissolve') {
        await api.action('dissolveFamily', { confirm: true })
        await app.refreshContext(true)
        wx.reLaunch({ url: '/pages/Bind/index' })
      } else if (action === 'leave') {
        await api.action('leaveFamily')
        await app.refreshContext(true)
        wx.reLaunch({ url: '/pages/Bind/index' })
      }
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ confirming: false })
    }
  },

  noop() {},

  retry() {
    this.load(true)
  }
})
