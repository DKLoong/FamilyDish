// 集合名、角色、状态与全局限制。集中定义，禁止在业务代码里散落字符串字面量。
const COL = {
  USER: 'User',
  FAMILY: 'Family',
  USER_FAMILY: 'UserFamily',
  DISH: 'DishList',
  CATEGORY: 'Category',
  ORDER: 'OrderList',
  SHOPPING: 'ShoppingItem'
}

const ROLE = { OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' }

const FAMILY_STATUS = { ACTIVE: 'active', DISSOLVED: 'dissolved' }
const MEMBERSHIP_STATUS = { ACTIVE: 'active', LEFT: 'left', REMOVED: 'removed' }
const ORDER_STATUS = { PENDING: 'pending', COMPLETED: 'completed', CANCELLED: 'cancelled' }
const SHOPPING_SOURCE = { ORDER: 'order', MANUAL: 'manual' }

const LIMITS = {
  FAMILY_NAME_MIN: 1,
  FAMILY_NAME_MAX: 12,
  NICKNAME_MIN: 1,
  NICKNAME_MAX: 20,
  MEMBER_DEFAULT: 10,
  MEMBER_HARD_MAX: 50,
  INVITE_LEN: 6,
  INVITE_TTL_MS: 3 * 24 * 60 * 60 * 1000,
  INVITE_MAX_TRIES: 8,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100
}

// 32 字符集，去掉易混的 I / O / 0 / 1
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// 任何写操作都不接受前端传入这些字段，一律由服务端生成或维护。
const PROTECTED_FIELDS = [
  '_id', 'openid', 'familyId', 'createdBy', 'createTime', 'updateTime',
  'role', 'status', 'statusTimes', 'memberOpenids', 'invite', 'maxMembers',
  'ordererOpenid', 'ordererNickname', 'orderers', 'ordererOpenids',
  'dishSnapshot', 'requestId',
  'purchasedBy', 'purchasedAt', 'purchaseGroupId',
  'version', 'archived', 'orderId', 'sourceType'
]

module.exports = {
  COL,
  ROLE,
  FAMILY_STATUS,
  MEMBERSHIP_STATUS,
  ORDER_STATUS,
  SHOPPING_SOURCE,
  LIMITS,
  INVITE_ALPHABET,
  PROTECTED_FIELDS
}
