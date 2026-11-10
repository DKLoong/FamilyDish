// 「关于」页：版本号、版权与开源署名。内容全部来自本地常量，不请求云端，
// 因此无加载态、无错误态，也不参与家庭数据鉴权。
const appInfo = require('../../utils/app-info.js')

Page({
  data: {
    version: 'v' + appInfo.getVersion(),
    repoUrl: appInfo.REPO_URL,
    copyright: '© 2026 FamilyDish'
  },

  copyRepo() {
    wx.setClipboardData({
      data: this.data.repoUrl,
      success: function () {
        wx.showToast({ title: '开源地址已复制', icon: 'success' })
      }
    })
  }
})
