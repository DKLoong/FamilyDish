// 本地单元测试：购物清单展示层合并
// 运行：node test/shopping-view.test.js
const path = require('path')
const view = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'shopping.js'))

let pass = 0
let failCount = 0

function assert(label, condition, detail) {
  if (condition) { console.log('  OK    ' + label + (detail ? ' → ' + detail : '')); pass++ }
  else { console.log('  FAIL  ' + label); failCount++ }
}

function item(id, name, quantity, unit, extra) {
  return Object.assign({
    _id: id,
    familyId: 'f1',
    sourceType: 'order',
    orderId: 'o1',
    createdBy: 'u2',
    ingredient: { name: name, quantity: quantity, unit: unit, note: '' },
    purchased: false,
    purchasedBy: '',
    purchasedAt: null,
    purchaseGroupId: ''
  }, extra || {})
}

const member = { openid: 'u2', role: 'member' }
const owner = { openid: 'u1', role: 'owner' }

console.log('1. 未购合并规则')
let result = view.buildView([
  item('a', '排骨', 500, 'g'),
  item('b', '排骨', 300, 'g'),
  item('c', '排骨', 1, 'kg'),
  item('d', '番茄', 300, 'g')
], member)

assert('同名同单位合并为一行', result.pendingGroups.length === 3, 'groups=' + result.pendingGroups.length)
const ribs = result.pendingGroups[0]
assert('数量相加', ribs.quantityText === '800 g', ribs.quantityText)
assert('标记多个来源', ribs.sourceLabel === '2 个来源' && ribs.sourceCount === 2, ribs.sourceLabel)
assert('不同单位分开', result.pendingGroups[1].quantityText === '1 kg', result.pendingGroups[1].quantityText)
assert('计数按来源条数统计', result.pendingCount === 4, 'pendingCount=' + result.pendingCount)

console.log('2. 无数量不参与合并')
result = view.buildView([
  item('a', '盐', null, ''),
  item('b', '盐', null, ''),
  item('c', '盐', 5, 'g')
], member)
assert('两条「适量」各自成行', result.pendingGroups.length === 3, 'groups=' + result.pendingGroups.length)
assert('展示为适量', result.pendingGroups[0].quantityText === '适量')
assert('有数量的单独一行', result.pendingGroups[2].quantityText === '5 g')

result = view.buildView([item('a', '盐', null, '', { ingredient: { name: '盐', quantity: null, unit: '', note: '少许' } })], member)
assert('无数量但有备注时显示备注', result.pendingGroups[0].quantityText === '少许')

console.log('3. 已购按购买批次合并')
result = view.buildView([
  item('a', '排骨', 500, 'g', { purchased: true, purchaseGroupId: 'g1', purchasedAt: 1 }),
  item('b', '排骨', 300, 'g', { purchased: true, purchaseGroupId: 'g1', purchasedAt: 1 }),
  item('c', '排骨', 200, 'g', { purchased: true, purchaseGroupId: 'g2', purchasedAt: 2 }),
  item('d', '番茄', 300, 'g')
], member)
assert('待购只有番茄', result.pendingGroups.length === 1 && result.pendingGroups[0].name === '番茄')
assert('同批次合并成一行', result.purchasedGroups.length === 2, 'groups=' + result.purchasedGroups.length)
assert('同批次数量相加', result.purchasedGroups[0].quantityText === '800 g', result.purchasedGroups[0].quantityText)
assert('分开批次各自成行', result.purchasedGroups[1].quantityText === '200 g')
assert('已购计数', result.purchasedCount === 3, 'purchasedCount=' + result.purchasedCount)

console.log('4. 删除权限')
result = view.buildView([
  item('a', '排骨', 500, 'g'),
  item('m1', '纸巾', null, '', { sourceType: 'manual', orderId: null, createdBy: 'u2' }),
  item('m2', '垃圾袋', null, '', { sourceType: 'manual', orderId: null, createdBy: 'u3' })
], member)
const manualMine = result.pendingGroups.find(function (g) { return g.name === '纸巾' })
const manualOther = result.pendingGroups.find(function (g) { return g.name === '垃圾袋' })
const orderGroup = result.pendingGroups.find(function (g) { return g.name === '排骨' })
assert('普通成员可删自己的手工项', manualMine.canRemove === true)
assert('普通成员不能删他人的手工项', manualOther.canRemove === false)
assert('普通成员不能删订单来源项', orderGroup.canRemove === false)

result = view.buildView([
  item('a', '排骨', 500, 'g'),
  item('m2', '垃圾袋', null, '', { sourceType: 'manual', orderId: null, createdBy: 'u3' })
], owner)
assert('管理员可删订单来源项', result.pendingGroups[0].canRemove === true)
assert('管理员可删他人手工项', result.pendingGroups[1].canRemove === true)

console.log('5. 边界')
result = view.buildView([], member)
assert('空数组不报错', result.pendingGroups.length === 0 && result.pendingCount === 0)
result = view.buildView(null, member)
assert('非数组输入按空处理', result.pendingGroups.length === 0)
result = view.buildView([item('a', '排骨', 0.1, 'g'), item('b', '排骨', 0.2, 'g')], member)
assert('小数相加不出现浮点尾巴', result.pendingGroups[0].quantityText === '0.3 g', result.pendingGroups[0].quantityText)
result = view.buildView([item('a', '排骨', 15, 'ml'), item('b', '排骨', 15, 'ml')], member)
assert('整数相加为整数', result.pendingGroups[0].quantityText === '30 ml')

console.log('6. 手工添加校验')
let manual = view.buildManualIngredient({ name: '  ', quantity: '1' })
assert('名称为空时报错', !!manual.error)
manual = view.buildManualIngredient({ name: '鸡蛋', quantity: '-1' })
assert('负数报错', !!manual.error)
manual = view.buildManualIngredient({ name: '鸡蛋', quantity: 'abc' })
assert('非数字报错', !!manual.error)
manual = view.buildManualIngredient({ name: ' 鸡蛋 ', quantity: ' 6 ', unit: ' 个 ', note: ' 土鸡蛋 ' })
assert('正常输入被清洗', manual.value.name === '鸡蛋' && manual.value.quantity === 6 && manual.value.unit === '个' && manual.value.note === '土鸡蛋')
manual = view.buildManualIngredient({ name: '盐' })
assert('数量留空时存 null', manual.value.quantity === null)

console.log('\nRESULT: ' + pass + ' passed, ' + failCount + ' failed')
if (failCount) process.exit(1)
