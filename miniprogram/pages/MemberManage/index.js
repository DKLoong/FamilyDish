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
    // 创建者看到「解散家庭」，其他人看到「退出家庭」
    isOwner: false,

    // 角色调整、移除成员、退出/解散共用一个确认弹层
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
    // 骨架只在首次进入时铺：改完角色/移除成员后的刷新保留现有列表原地替换
    if (!this._loaded) this.setData({ loading: true })
    this.setData({ loadError: '' })

    // 请求序号：静默刷新会与确认操作后的刷新并发，只应用最后一次结果
    const seq = (this._seq || 0) + 1
    this._seq = seq

    try {
      const data = await api.action('listMembers')
      if (seq !== this._seq) return

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
        maxMembers: data.maxMembers,
        isOwner: isOwner
      })
      this._loaded = true
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[MemberManage] load failed', err)
      if (this._loaded) {
        console.warn('[MemberManage] 静默刷新失败，沿用上次数据')
      } else {
        this.setData({ loading: false, loadError: (err && err.message) || '加载失败' })
      }
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

  // —— 退出 / 解散：低频危险操作放在成员页末尾，位置与文案沿用「我的」页 ——
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
      confirmAction: isOwner ? 'dissolve' : 'leave',
      confirmTargetId: ''
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
    const isFamilyAction = action === 'dissolve' || action === 'leave'
    if (!action) return
    if (!isFamilyAction && !memberId) return

    this.setData({ confirming: true })
    try {
      // 退出/解散会让当前用户立即失去家庭，直接回到绑定页，不再刷新成员列表
      if (isFamilyAction) {
        if (action === 'dissolve') {
          await api.action('dissolveFamily', { confirm: true })
        } else {
          await api.action('leaveFamily')
        }
        await app.refreshContext(true)
        wx.reLaunch({ url: '/pages/Bind/index' })
        return
      }

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
