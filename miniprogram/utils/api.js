// 云函数调用统一封装。页面只依赖这里：
// 不直接调用 wx.cloud.callFunction，也不使用 wx.cloud.database()。
// 7 个集合权限均为「所有用户不可读写」，客户端直连必然失败。
const API_NAME = 'familyApi'

function makeError(code, message) {
  const err = new Error(message || '操作失败')
  err.code = code || 'UNKNOWN'
  return err
}

async function invoke(body) {
  let res = null
  try {
    res = await wx.cloud.callFunction({ name: API_NAME, data: body })
  } catch (e) {
    console.error('[api] callFunction failed', body && (body.action || body.op), e)
    // -504002 = 云函数内部执行失败（依赖缺失、代码抛错），与网络无关，不能一律报「网络异常」
    if (e && e.errCode === -504002) {
      throw makeError('FUNCTION_ERROR', '云函数执行失败，请检查部署与依赖')
    }
    throw makeError('NETWORK_ERROR', '网络异常，请重试')
  }

  const result = res && res.result
  if (!result || typeof result.success === 'undefined') {
    console.error('[api] unexpected response', result)
    throw makeError('BAD_RESPONSE', '服务返回异常，请重试')
  }
  if (!result.success) throw makeError(result.code, result.message)
  return result.data
}

function action(name, payload) {
  return invoke({ action: name, payload: payload || {} })
}

function list(collection, options) {
  const opts = options || {}
  return invoke({
    collection: collection,
    op: 'list',
    filters: opts.filters,
    orderBy: opts.orderBy,
    order: opts.order,
    limit: opts.limit,
    skip: opts.skip
  })
}

function get(collection, id) {
  return invoke({ collection: collection, op: 'get', id: id })
}

function add(collection, data) {
  return invoke({ collection: collection, op: 'add', data: data })
}

function update(collection, id, data) {
  return invoke({ collection: collection, op: 'update', id: id, data: data })
}

function archive(dishId) {
  return invoke({ collection: 'DishList', op: 'archive', id: dishId })
}

function remove(collection, id) {
  return invoke({ collection: collection, op: 'remove', id: id })
}

// 包一层 loading，保证异常时也会关闭
async function withLoading(title, task) {
  wx.showLoading({ title: title || '处理中', mask: true })
  try {
    return await task()
  } finally {
    wx.hideLoading()
  }
}

// 统一的错误提示。业务代码只关心成功路径。
function toastError(err) {
  const message = (err && err.message) || '操作失败，请重试'
  wx.showToast({ title: message, icon: 'none', duration: 2000 })
  console.error('[api] error', err && err.code, message)
}

module.exports = {
  API_NAME: API_NAME,
  invoke: invoke,
  action: action,
  list: list,
  get: get,
  add: add,
  update: update,
  archive: archive,
  remove: remove,
  withLoading: withLoading,
  toastError: toastError
}
