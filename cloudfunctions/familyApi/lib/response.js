// 统一响应格式：{ success, code, message, data }
// 所有动作都返回这个结构，前端只需判断 success，不处理「有时是数组、有时是 null」的分支。
function ok(data, message) {
  return {
    success: true,
    code: 'OK',
    message: message || '',
    data: data === undefined ? null : data
  }
}

function fail(code, message, data) {
  return {
    success: false,
    code: code || 'ERROR',
    message: message || code || '操作失败',
    data: data === undefined ? null : data
  }
}

module.exports = { ok, fail }
