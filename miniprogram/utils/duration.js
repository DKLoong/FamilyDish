// 时长以「分钟」为存储单位，允许小数（如 1.3333 表示 1 分 20 秒）。
// 统一在这里转成可读文案，避免各页面各自拼字符串导致口径不一。
function formatMinutes(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''

  const total = Math.round(num * 60)
  if (total <= 0) return ''

  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  if (minutes === 0) return seconds + ' 秒'
  if (seconds === 0) return minutes + ' 分钟'
  return minutes + ' 分 ' + seconds + ' 秒'
}

module.exports = { formatMinutes: formatMinutes }
