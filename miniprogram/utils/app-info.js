// 应用版本与署名信息。关于页与「我的」页的版本号都从这里取，避免两处各写一份。
// 线上版本号由微信发布时注入；开发版、体验版取不到，回落到下面的本地常量。
const FALLBACK_VERSION = '1.0.0'
const REPO_URL = 'https://github.com/630999Steven/PairBite'

function getVersion() {
  try {
    const info = wx.getAccountInfoSync()
    const version = info && info.miniProgram && info.miniProgram.version
    if (version) return version
  } catch (err) {
    console.warn('[app-info] 读取线上版本号失败，使用本地常量', err)
  }
  return FALLBACK_VERSION
}

module.exports = {
  getVersion: getVersion,
  REPO_URL: REPO_URL
}
