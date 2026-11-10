// 通用二次确认弹层。封装遮罩点击、提交中禁止关闭、主次按钮位置等行为，
// 各页面只需传入标题、正文、按钮文案与回调。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    // 一句一段，居中显示
    lines: { type: Array, value: [] },
    confirmText: { type: String, value: '确定' },
    // true 时确认按钮用危险色（删除、退出、解散等）
    danger: { type: Boolean, value: false },
    // 提交中：按钮禁用、文案变「处理中…」、点击遮罩不关闭
    pending: { type: Boolean, value: false }
  },

  methods: {
    noop() {},

    onCancel() {
      if (this.data.pending) return
      this.triggerEvent('cancel')
    },

    onConfirm() {
      if (this.data.pending) return
      this.triggerEvent('confirm')
    }
  }
})
