# CLAUDE.md

本文件为 Claude Code 及其他 AI 编码工具提供项目上下文。它不是产品需求：规则以《家庭点菜小程序改造需求文稿.md》和《家庭点菜小程序实施方案.md》为准。

## 项目定位

**FamilyDish · 家庭点菜小程序**。由上游 PairBite（情侣小厨房）改造而来，面向一个家庭内的多名成员共享菜品库、点菜记录与购物清单。

- 技术栈：微信原生小程序（WXML + WXSS + JS）+ 微信云开发（云函数、云数据库、云存储），无第三方后端。
- 项目名 `FamilyDish`；分支 `family-v1`；上游基线提交 `99623ac`。
- 当前阶段：**M0 之前**。需求、UI 与实施规划已定稿，**业务代码仍是上游 PairBite 基线，尚未实施改造**。

> 下面「目标架构」描述的是改造后的状态，不是当前代码的状态。读到 `coupleId`、`sendNotify`、`bindPartner`、绿色主题等旧实现时，不要把它当成需要保留的设计。

## 开发环境

- 用**微信开发者工具**打开仓库根目录（含 `project.config.json` 的一层），不要选 `miniprogram/` 子目录：`miniprogramRoot` 与 `cloudfunctionRoot` 都相对根目录解析。
- AppID 在 `project.config.json`；云环境 ID 在 `miniprogram/envList.js`，`app.js` 的 `wx.cloud.init` 读 `envList[0].envId`。当前为免费基础版。
- 前端 npm 依赖（仅 weui-miniprogram）已预构建在 `miniprogram/miniprogram_npm/`，一般无需重装。若需重建：在 `miniprogram/` 下 `npm install`，再用开发者工具「工具 → 构建 npm」。
- 云函数部署：右键云函数目录 →「上传并部署：云端安装依赖」。云函数依赖 `wx-server-sdk ^2.6.3`。
- 无构建命令、无测试套件、无 CI。

## 目标架构

### 读写通道（最高优先级）

前端不调用 `wx.cloud.database()`。列表读取、详情读取与全部写操作都通过 `wx.cloud.callFunction` 走 `familyApi`。

7 个集合 `User`、`Family`、`UserFamily`、`DishList`、`Category`、`OrderList`、`ShoppingItem` 的数据库权限**统一设为「仅管理端可读写」**，不保留客户端直连旁路。云存储同样保持「仅管理端可读写」，图片经 `getFileURL` 转临时链接展示。

基线里 `pages/Order/index.js` 用 `app.database().add()` 前端直写 `OrderList`、各页用 `app.database()` 直连读取，这两类入口都要移除。代价是每个列表页多一次云函数调用，收益是权限判断只有一处、无客户端绕过路径。

### 数据隔离与鉴权

`UserFamily` 是权威成员关系。云函数用 `cloud.getWXContext()` 取 `openid` → 查 `UserFamily` 得有效 `familyId` 与 `role`（`owner` / `admin` / `member`）→ 校验 `Family.status === 'active'` → 按动作查权限表。

`familyId`、`createdBy`、点菜人、角色、时间戳、状态变更一律由服务端写入；前端传入的这些字段全部忽略。`Family.memberOpenids` 仅用于展示，不得作为鉴权依据。首版一个 `openid` 最多一条 `status = 'active'` 的 `UserFamily`。

`openid` 由微信运行时注入，前端直连与云函数都伪造不了。收口的目的不是防伪造身份，而是让角色、状态机、归属键、事务与字段白名单只在服务端执行。

### 集合

| 集合 | 用途 | 写入方式 |
| --- | --- | --- |
| `User` | 用户身份存根，`_id = openid` | `ensureUser` |
| `Family` | 家庭主体、状态、人数上限、邀请码 | 领域动作 |
| `UserFamily` | 权威成员关系、角色、家庭内昵称 | 领域动作 |
| `DishList` | 菜品与菜谱（含 `archived`、`version`） | 白名单 CRUD |
| `Category` | 菜品分类 | 白名单 CRUD |
| `OrderList` | 点菜记录与菜品快照、状态机 | 仅领域动作 |
| `ShoppingItem` | 购物来源记录（按 `orderId` 独立存放） | 白名单 CRUD + 领域动作 |

索引见《实施方案》4.3。购物清单**按来源独立存储、页面合并显示**；取消点菜只删除该 `orderId` 的来源记录。

### 云函数

| 云函数 | 职责 |
| --- | --- |
| `familyApi` | 统一入口。白名单 CRUD + 领域动作 + 鉴权 + 事务 + 幂等 |
| `ensureUser` | 首次进入创建 `User`，返回家庭上下文 |
| `getFileURL` | `cloud://` → 临时链接（原样保留） |

改造完成后停用：`getCoupleData`、`updateCoupleData`、`manageCategory`、`bindPartner`、`unbindPartner`、`updateKitchenName`、`sendNotify`、`getOpenId`、`createUser`。停用不是删除目录，而是确保没有可调用的残留入口。

统一响应格式 `{ success, code, message, data }`。白名单 CRUD 与领域动作的清单见《实施方案》5.1 / 5.2。

### 前端页面

底部 4 个入口：**首页 / 记录 / 购物 / 我的**。首页即菜品库入口；菜谱详情页内用底部弹层完成点菜确认；「我的」承载家庭与成员管理。页面改造映射见《实施方案》第 7 节。

### 设计规范

暖木厨房风格：页面背景 `#FAF5EE`、卡片 `#FFFFFF`、主色 `#C9663B`、正文 `#3B2B23`、边框 `#E7D9CB`、辅助绿 `#708B57`。基线 `app.wxss` 的绿色主题 `--primary-color: #6FCF97` 需整体替换。尺寸、圆角、状态与 1pt = 2rpx 换算见 `docs/ui/design-spec.html`。

### 页面数据加载约定

页面显示的数据几乎都是「进入时读一次、写操作后更新」，因此统一按下面四条处理，避免切页出现「内容 → 骨架 → 内容」三段闪。

| 场景 | 是否铺骨架 | 说明 |
| --- | --- | --- |
| 首次进入 | 铺 | 骨架块高对齐真实卡片/行高 |
| 切回 tab、从子页面返回 | 不铺 | 保留现有内容，数据回来后原地替换 |
| 下拉刷新 | 不铺 | 用滚动区原生 `refresher` 或 `wx.stopPullDownRefresh` |
| 写操作后刷新 | 不铺 | 同上 |
| 查询条件变化（切换筛选标签） | 铺 | 否则旧条件的记录会留在屏上，被误读成新条件的结果 |

实现约定：

- 用页面实例字段 `this._loaded` 记录「是否已成功渲染过」，不放进 `data`（不参与渲染）。骨架判定写成 `if (!this._loaded) this.setData({ loading: true })`。
- 条件变化需要强制铺骨架时，额外传参而不是改全局判定，例如记录页 `this.load(false, true)` 里的第二个参数 `withSkeleton`。
- 静默刷新失败要保留已渲染的数据，只 `console.warn`，**不得**把整页切成错误态；只有首次加载失败才显示错误态与「重新加载」。
- 并发保护：`const seq = (this._seq || 0) + 1`，每个 `await` 之后 `if (seq !== this._seq) return`，只应用最后一次请求的结果，防止旧响应后到把列表改回旧数据。
- 低频资料型页面（「我的」）额外加缓存 TTL（当前 5 分钟）与变更失效标记；协作型数据（首页、记录、购物）不加 TTL，每次显示静默刷新。
- 骨架统一为纯色块 `#F1E8DC`，不做「白卡 + 内部占位」的结构化骨架：结构化要模拟条件渲染（按钮、标签按角色显隐），收益不稳定且要维护两份结构。

### 分享告知（替代订阅通知）

**首版不做订阅消息**。`sendNotify` 停用；订阅模板、字段 DATA ID、额度账本、`notifySummary`、「我的」页订阅开关全部作废。

分享分两条独立路径，不要混用：

- **邀请家人**：只在「我的 > 邀请成员」弹层里发起，`path` 带邀请码（`/pages/Bind/index?inviteCode=xxx`），`title` 为「邀请你加入「家庭名」」。
- **推荐给朋友**：记录页 56px 圆形 `<button open-type="share">`（纯图标，居中固定在导航栏上方 16px），`path` 固定为 `/pages/MainPage/index`、**不带任何查询参数**，`title` 为产品介绍。

两者都不传 `imageUrl`，均为纯前端能力，不调云函数、不写数据库、不进点菜事务。点菜成功只提示「已点菜」，不再引导分享。长截屏分享不做，也不列二期。

### 搜索索引

`sitemap.json` 只允许 `pages/MainPage/index` 与 `pages/About/index` 被微信索引，其余页面用 `disallow` 兜底——记录、购物、成员、分类等页含家庭私有数据，放开等于公开。首页标题承担搜索关键词（当前为「家庭菜单与点菜」），不要改回纯品牌名。页面能否被搜到还取决于 mp 后台的「页面收录」开关是否打开。

## 禁止项

1. 禁止沿用 `coupleId`、`partnerId`、`bindStatus`、`kitchenName` 等双人模型字段。
2. 禁止前端用 `wx.cloud.database()` 或 `app.database()` 直连任何集合，读或写都不行。
3. 禁止云函数接收任意 `collection` 或任意 `data` 而不做集合白名单与字段裁剪。
4. 禁止物理删除点菜历史记录；菜品「删除」一律改为 `archived = true`。`OrderList` 的 `add` / `update` / `remove` 对前端关闭，只允许领域动作写入。
5. 禁止把模板 ID、密钥、环境凭据写进前端或业务代码硬编码。
6. 禁止用 `Family.memberOpenids` 做鉴权。
7. 禁止用 `setInterval` 作为计时器的真实计时依据；用结束时间戳 `endAt`，`onShow` 重算。
8. 禁止用 `wx.showModal` 做二次确认。统一用 `miniprogram/components/confirm-modal`：传 `title` / `lines` / `confirmText` / `danger` / `pending`，页面持有 `showConfirm` 与 `confirming` 两个状态，`pending` 期间禁止关闭。

## 平台约束（沿用上游，仍然有效）

- 云函数使用 `cloud.DYNAMIC_CURRENT_ENV` 自动匹配环境，不硬编码环境 ID。
- 云数据库单次查询上限 100 条，分页用 `skip + limit`。
- 免费基础版云存储不能设为「所有用户可读」，成员互看图片依赖 `getFileURL` 临时链接（约 2 小时有效，前端缓存 1.5 小时）。
- 事务由云函数侧提供；`wx-server-sdk ^2.6.3` 是否支持事务内批量 `add` 需实测，预留「预留 `_id` + 逐条写」方案。

## 文档索引（相对本仓库）

| 文档 | 内容 |
| --- | --- |
| `../家庭点菜小程序改造需求文稿.md` | 产品规则、角色权限、36 项验收用例 |
| `../家庭点菜小程序实施方案.md` | 架构、数据模型、云函数契约、M0–M7 里程碑 |
| `docs/ui/design-spec.html` | UI 设计令牌与 6 张标注稿 |
| `docs/ui/index.html` | 可点击 HTML 原型 |
| `../家庭点菜小程序实施总览.html` | 架构图与风险总览 |
| `../家庭点菜小程序M0环境开通指引.html` | 项目导入、云环境、体验成员操作指引 |

## 许可证

上游项目：PairBite，作者 **630999Steven**（<https://github.com/630999Steven/PairBite>），许可证 **CC BY-NC-SA 4.0**。

不得删除 `LICENSE`。须保留原作者署名、非商业用途限制与相同方式共享条款；改造说明写入 `NOTICE.md`。本项目用途已确认符合该许可证。
