// 家庭成员管理：角色调整与移除。从「我的」页的家庭成员入口进入。
const app = getApp()
const api = require('../../utils/api.js')

const ROLE_LABEL = { owner: '创建者', admin: '管理员', member: '成员' }

Page({
  data: {
    loading: true,
    loadError: '',

    members: [],
    memberCount: 0,
    maxMembers: 10,

    // 角色调整与移除共用一个确认弹层
    showConfirm: false,
    confirmTitle: '',
    confirmLines: [],
    confirmText: '',
    confirmDanger: false,
    confirmAction: '',
    confirmTargetId: '',
    confirmNextRole: '',
    confirming: false
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(true)
  },

  async load(force) {
    if (force !== true) this.setData({ loading: true, loadError: '' })
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
          // 与后端规则一致：创建者可改任意非创建者；管理员只能改普通成员
          canSetRole: isOwner && canManageThis,
          canRemove: (isOwner && canManageThis) || (isAdmin && item.role === 'member'),
          nextRole: item.role === 'admin' ? 'member' : 'admin',
          nextRoleLabel: item.role === 'admin' ? '撤销管理员' : '设为管理员'
        }
      })

      this.setData({
        loading: false,
        members: members,
        memberCount: members.length,
        maxMembers: data.maxMembers
      })
    } catch (err) {
      console.error('[MemberManage] load failed', err)
      this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
    }

    if (force === true) wx.stopPullDownRefresh()
  },

  toggleRole(e) {
    const memberId = e.currentTarget.dataset.id
    const nextRole = e.currentTarget.dataset.role
    const target = this.data.members.find(function (m) { return m.memberId === memberId })
    if (!target) return

    const toAdmin = nextRole === 'admin'
    this.setData({
      showConfirm: true,
      confirmTitle: toAdmin ? '设为管理员' : '撤销管理员',
      confirmLines: [
        toAdmin
          ? '将「' + target.nickname + '」设为管理员，可管理菜品、邀请成员与普通成员。'
          : '将「' + target.nickname + '」恢复为普通成员。'
      ],
      confirmText: toAdmin ? '设为管理员' : '撤销',
      confirmDanger: false,
      confirmAction: 'role',
      confirmTargetId: memberId,
      confirmNextRole: nextRole
    })
  },

  removeMember(e) {
    const memberId = e.currentTarget.dataset.id
    const target = this.data.members.find(function (m) { return m.memberId === memberId })
    if (!target) return

    this.setData({
      showConfirm: true,
      confirmTitle: '移除成员',
      confirmLines: ['将「' + target.nickname + '」移出家庭？历史点菜记录会保留，但ta将无法再访问家庭数据。'],
      confirmText: '移除',
      confirmDanger: true,
      confirmAction: 'remove',
      confirmTargetId: memberId
    })
  },

  closeConfirm() {
    if (this.data.confirming) return
    this.setData({ showConfirm: false, confirmTargetId: '' })
  },

  async submitConfirm() {
    if (this.data.confirming) return
    const action = this.data.confirmAction
    const memberId = this.data.confirmTargetId
    if (!action || !memberId) return

    this.setData({ confirming: true })
    try {
      if (action === 'role') {
        await api.action('setRole', { memberId: memberId, role: this.data.confirmNextRole })
      } else {
        await api.action('removeMember', { memberId: memberId })
      }
      this.setData({ showConfirm: false, confirmTargetId: '' })
      this.notifyOpener()
      wx.showToast({ title: action === 'role' ? '已更新角色' : '已移除', icon: 'success' })
      await this.load(true)
    } catch (err) {
      api.toastError(err)
    } finally {
      this.setData({ confirming: false })
    }
  },

  // 成员变动会改变「我的」页的人数与可管理状态，通知上一页在返回时重新拉取。
  // 本页也可能不是经 navigateTo 打开，取不到通道时静默跳过。
  notifyOpener() {
    try {
      const channel = this.getOpenerEventChannel()
      if (channel && typeof channel.emit === 'function') channel.emit('membersChanged')
    } catch (err) {
      console.warn('[MemberManage] 通知上一页失败', err)
    }
  },

  noop() {},

  retry() {
    this.load()
  }
})
