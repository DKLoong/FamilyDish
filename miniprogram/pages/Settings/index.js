// 「我的」页：家庭信息、邀请、成员管理、人数上限、退出与解散。
const app = getApp()
const api = require('../../utils/api.js')

const ROLE_LABEL = { owner: '创建者', admin: '管理员', member: '成员' }

Page({
  data: {
    loading: true,
    loadError: '',
    submitting: false,

    familyName: '',
    myNickname: '',
    roleLabel: '',
    inviteCode: '',
    inviteHint: '',

    memberCount: 0,
    maxMembers: 10,
    members: [],

    isOwner: false,
    isAdmin: false,
    canManage: false,

    showCapacity: false,
    tempCapacity: 10,
    showNickname: false,
    tempNickname: ''
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
      const isAdmin = data.role === 'admin'

      const members = (data.members || []).map(function (item) {
        const canManageThis = !item.isSelf && item.role !== 'owner'
        return {
          memberId: item.memberId,
          nickname: item.nickname,
          role: item.role,
          roleLabel: ROLE_LABEL[item.role] || item.role,
          isSelf: item.isSelf,
          // 与后端规则保持一致：创建者可改任意非创建者；管理员只能改普通成员
          canSetRole: isOwner && canManageThis,
          canRemove: (isOwner && canManageThis) || (isAdmin && item.role === 'member'),
          nextRole: item.role === 'admin' ? 'member' : 'admin',
          nextRoleLabel: item.role === 'admin' ? '撤销管理员' : '设为管理员'
        }
      })

      this.setData({
        loading: false,
        familyName: data.familyName,
        myNickname: app.getCurrentUserName(),
        roleLabel: ROLE_LABEL[data.role] || '',
        inviteCode: data.inviteCode,
        inviteHint: data.inviteExpiresAt ? '3 天内有效，可多人使用' : '',
        memberCount: members.length,
        maxMembers: data.maxMembers,
        members: members,
        isOwner: isOwner,
        isAdmin: isAdmin,
        canManage: data.canManage
      })
    } catch (err) {
      console.error('[Settings] load failed', err)
      this.setData({ loading: false, loadError: err.message || '加载失败' })
    }

    if (force === true) wx.stopPullDownRefresh()
  },

  // —— 邀请 ——
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
    const that = this
    wx.showModal({
      title: '重新生成邀请码',
      content: '旧邀请码将立即失效，已加入的成员不受影响。确定继续？',
      success: async function (res) {
        if (!res.confirm) return
        try {
          const data = await api.withLoading('生成中', function () {
            return api.action('regenerateInvite')
          })
          that.setData({ inviteCode: data.inviteCode })
          wx.showToast({ title: '已更新邀请码', icon: 'success' })
        } catch (err) {
          api.toastError(err)
        }
      }
    })
  },

  // —— 成员管理 ——
  async toggleRole(e) {
    const memberId = e.currentTarget.dataset.id
    const nextRole = e.currentTarget.dataset.role
    const target = this.data.members.find(function (m) { return m.memberId === memberId })
    if (!target) return

    const that = this
    wx.showModal({
      title: nextRole === 'admin' ? '设为管理员' : '撤销管理员',
      content: '将「' + target.nickname + '」' + (nextRole === 'admin' ? '设为管理员？' : '恢复为普通成员？'),
      success: async function (res) {
        if (!res.confirm) return
        try {
          await api.withLoading('处理中', function () {
            return api.action('setRole', { memberId: memberId, role: nextRole })
          })
          await that.load()
        } catch (err) {
          api.toastError(err)
        }
      }
    })
  },

  async removeMember(e) {
    const memberId = e.currentTarget.dataset.id
    const target = this.data.members.find(function (m) { return m.memberId === memberId })
    if (!target) return

    const that = this
    wx.showModal({
      title: '移除成员',
      content: '将「' + target.nickname + '」移出家庭？他的历史点菜记录会保留，但将无法再访问家庭数据。',
      confirmColor: '#C9663B',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await api.withLoading('移除中', function () {
            return api.action('removeMember', { memberId: memberId })
          })
          await that.load()
        } catch (err) {
          api.toastError(err)
        }
      }
    })
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
    const that = this
    try {
      await api.withLoading('保存中', function () {
        return api.action('updateCapacity', { maxMembers: that.data.tempCapacity })
      })
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
      await api.withLoading('保存中', function () {
        return api.action('updateNickname', { nickname: nickname })
      })
      await app.refreshContext(true)
      this.setData({ showNickname: false, myNickname: nickname })
      await this.load()
      wx.showToast({ title: '已更新', icon: 'success' })
    } catch (err) {
      api.toastError(err)
    }
  },

  // —— 退出 / 解散 ——
  leaveOrDissolve() {
    const that = this
    const isOwner = this.data.isOwner

    wx.showModal({
      title: isOwner ? '解散家庭' : '退出家庭',
      content: isOwner
        ? '解散后所有成员都将失去访问权限，历史记录保留但无法再查看。确定解散？'
        : '退出后将无法查看家庭菜品与点菜记录，历史数据会保留。确定退出？',
      confirmText: isOwner ? '解散' : '退出',
      confirmColor: '#C9663B',
      success: async function (res) {
        if (!res.confirm) return
        try {
          if (isOwner) {
            await api.withLoading('解散中', function () {
              return api.action('dissolveFamily', { confirm: true })
            })
          } else {
            await api.withLoading('退出中', function () {
              return api.action('leaveFamily')
            })
          }
          await app.refreshContext(true)
          wx.reLaunch({ url: '/pages/Bind/index' })
        } catch (err) {
          api.toastError(err)
        }
      }
    })
  },

  noop() {},

  retry() {
    this.load(true)
  }
})
