# FamilyDish · Family Meal Ordering Mini Program

A WeChat Mini Program for families: multiple members share a dish library, order records, and a shopping list, so everyone can see what was ordered and which ingredients are still missing.

Built on WeChat Cloud Development (CloudBase). No servers, no maintenance. Data is isolated between families.

> This branch is derived from the upstream project [PairBite](https://github.com/630999Steven/PairBite) by **630999Steven**, licensed under [CC BY-NC-SA 4.0](LICENSE).

**Current status**: the requirements document, UI spec v1.2, and implementation plan v1.1 are finalized, but **the business code is still the upstream PairBite baseline; the refactor has not started (pre-M0)**. Everything below describes the target state, not what the current code implements. See `../家庭点菜小程序实施方案.md` for the implementation plan.

## Feature Overview (target state)

- **Family management**: create or join a family, family name, per-family nickname, 3-day invitation codes, member cap 10–50, three roles (owner / admin / member), leave / remove / dissolve.
- **Shared dish library**: manual entry by owners and admins, structured ingredients (`name / quantity / unit / note`), steps with timers, categories, archiving, and 5 self-compiled sample dishes.
- **Explicit ordering**: opening a recipe creates no record; a record is created only after tapping "I want this dish" and confirming. One record holds one dish, with states pending / completed / cancelled. Dish and orderer-nickname snapshots are stored at order time.
- **Family records**: state filters, secondary confirmation for completion and cancellation, read-only historical snapshots, immutable terminal states.
- **Shopping list**: ingredient sources stored per order, merged only for display; whole-group purchase, manual items, permission-controlled deletion, and cancellation removing only that order's sources.
- **Random pick and ingredient search**: v1 searches ingredients, not dish names.
- **Share notice**: a persistent round "Share" button on the records page uses native WeChat forwarding. A successful order shows "Order placed — share it with your family".

**Not in v1**: subscription messages (no templates, no quota ledger), long-screenshot sharing, and collaborative editing. Planned for phase two: multi-family switching, real-time watchers, nutrition calculation, comments and likes, and third-party recipe import.

Upstream UI screenshots remain under `docs/images/`. They show the old green couple-themed interface and **do not represent FamilyDish**. The current UI reference is `docs/ui/design-spec.html`.

## Tech Stack

| Layer | Technology | Description |
|---|------|------|
| Frontend | WeChat Mini Program Native | WXML + WXSS + JS |
| UI | WeUI + Warm Wood Kitchen tokens | Primary `#C9663B`, replacing the upstream green theme |
| Backend | WeChat Cloud Functions | Node.js + `wx-server-sdk ^2.6.3` |
| Database | WeChat Cloud Database | NoSQL document database, 7 collections |
| Storage | WeChat Cloud Storage | Dish images; temporary links on the free tier |
| Notification | Native WeChat sharing | No subscription messages in v1 |

No third-party API dependencies; runs entirely inside the WeChat Cloud Development ecosystem. The visual style is "Warm Wood Kitchen": low-saturation cream background, white cards, warm accent color.

## Project Structure (target state)

```
├── miniprogram/
│   ├── app.js                  # Global family guard and context
│   ├── app.json                # 4-tab bar: Home / Records / Shopping / Mine
│   ├── app.wxss                # Warm Wood Kitchen design tokens
│   ├── envList.js              # Cloud environment config
│   ├── components/             # family-guard, dish-card, order-sheet, empty-state
│   ├── utils/                  # api.js, dishSchema.js, shoppingGroup.js, timer.js
│   └── pages/                  # Home / Recipe detail / Records / Shopping / Mine + admin and snapshot pages
├── cloudfunctions/
│   ├── familyApi/              # Unified entry: whitelist CRUD + domain actions + auth + transactions + idempotency
│   ├── ensureUser/             # User registration and family context
│   └── getFileURL/             # Cloud storage temporary links (retained from upstream)
├── docs/images/                # Upstream baseline screenshots, historical reference only
├── project.config.json         # WeChat DevTools config
├── LICENSE
└── NOTICE.md                  # Refactor notes (to be added)
```

The baseline's 11 page directories and 10 cloud function directories will be retired or rewritten; the mapping is in section 7 of the implementation plan.

**Read/write channel**: the frontend never calls `wx.cloud.database()`. List reads, detail reads, and all writes go through `wx.cloud.callFunction` to `familyApi`. All 7 collections are set to "admin read/write only", with no client-side direct-access bypass.

## Deployment Guide

### Prerequisites

- Install [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
- Register a WeChat Mini Program account ([a personal account is sufficient](https://mp.weixin.qq.com/wxopen/waregister?action=step1&source=mpregister&token=&lang=zh_CN)) and complete the Mini Program Information and Category sections (Tools -> Notepad is fine as the primary category).
- **A formally registered Mini Program AppID is required**. The "test account" inside DevTools does not support Cloud Development.

> The screenshots below come from the upstream deployment guide and show WeChat DevTools; the interface may vary by tool version.

### Step 1: Get the source

```bash
git clone https://github.com/630999Steven/PairBite.git
cd PairBite
git checkout -b family-v1
```

In DevTools choose **Import Project** and select the repository root (the level containing `project.config.json`). **Do not select the `miniprogram/` subdirectory**: `miniprogramRoot` and `cloudfunctionRoot` are resolved relative to the root, so choosing the subdirectory hides the cloud functions.

### Step 2: Enable Cloud Development

1. Get your AppID from the Mini Program backend.

   ![image-20260426183947448](docs/images/image-20260426183947448.png)

2. Open the project with WeChat DevTools.

   ![image-20260426184308726](docs/images/image-20260426184308726.png)

3. Click "Cloud Development" (云开发) in the toolbar; its position varies by version.

   ![image-20260426184749860](docs/images/image-20260426184749860.png)

4. Follow the prompts to create a cloud environment (the free basic plan is sufficient).

5. Note down the **Cloud Environment ID** (for example `cloud1-xxxxxxxxxx`).

   ![image-20260426184949404](docs/images/image-20260426184949404.png)

### Step 3: Add Collections

In the Cloud Development console, go to Database and add **7 collections**:

1. `User`
2. `Family`
3. `UserFamily`
4. `DishList`
5. `Category`
6. `OrderList`
7. `ShoppingItem`

**Set all 7 collections to "admin read/write only"**. This is mandatory: the frontend never connects to the database directly; all reads and writes are authorized inside `familyApi`. Index definitions are in section 4.3 of the implementation plan.

![image-20260426203835555](docs/images/image-20260426203835555.png)

> Upgrading from upstream data: no compatibility migration is provided. Clear the old test collections before creating the new structure.

### Step 4: Update Configuration

AppID and environment ID are already configured locally for this project. When deploying to your own account, replace the values in these two files (this README does not record the concrete values):

**project.config.json** — Mini Program AppID:

```json
"appid": "YOUR_APP_ID"
```

> Find it at [WeChat Official Accounts Platform](https://mp.weixin.qq.com/) → Development Management → Development Settings.

![image-20260426193206076](docs/images/image-20260426193206076.png)

**miniprogram/envList.js** — Cloud Environment ID (`wx.cloud.init` in `app.js` reads `envList[0].envId`):

```javascript
const envList = [
  {
    "envId": "YOUR_CLOUD_ENV_ID",
    "alias": "cloud"
  }
]
```

![image-20260426193349260](docs/images/image-20260426193349260.png)

### Step 5: Upload Cloud Functions

In WeChat DevTools:

1. Select your environment.

   ![image-20260426202731252](docs/images/image-20260426202731252.png)

2. For each cloud function directory, right-click → "Upload and Deploy: Install dependencies on cloud (do not upload node_modules)".

Only **3 cloud functions** need deploying after the refactor:

| Cloud Function | Purpose |
|--------|------|
| `familyApi` | Unified read/write entry: whitelist CRUD, domain actions, auth, transactions, idempotency |
| `ensureUser` | Create `User` on first visit, return family context |
| `getFileURL` | Convert `cloud://` to temporary links |

The upstream functions `getCoupleData`, `updateCoupleData`, `manageCategory`, `bindPartner`, `unbindPartner`, `updateKitchenName`, `sendNotify`, `getOpenId`, and `createUser` are all retired; make sure no callable entry remains. In particular, `getCoupleData` / `updateCoupleData` accept arbitrary collection names and arbitrary fields from the client with no role checks — the most serious security gap this refactor closes.

### Step 6: No Subscription Message Setup

**V1 does not use subscription messages.** No template application, no field DATA IDs, no template environment variables.

Family notification uses native WeChat sharing instead: a round "Share" button on the records page plus `onShareAppMessage`. It is purely frontend — no cloud function call, no database write. When a member opens the card, cloud functions resolve family membership from `openid + UserFamily`; users with no family are routed by the global guard into the create/join flow.

> The "Message Push Configuration" page in the platform (which asks for URL / Token / EncodingAESKey) is a customer-service callback and is unrelated to subscription messages. This project does not need it either; leave it disabled.

### Step 7: Invite Experience Members (required)

Before formal release, other users must be added as **Experience Members**:

1. [WeChat Official Accounts Platform](https://mp.weixin.qq.com/) → Management → Member Management → Experience Members.
2. Click "Add" and enter the person's WeChat ID.
3. After they confirm in WeChat, they can scan the experience QR code.

> Personal accounts allow up to 15 experience members. Families are isolated by `familyId` + `UserFamily`. With only 2 accounts, the parallel "3 roles × 2 families" isolation test can be run serially by rotating roles.

### Step 8: Upload and Deploy

1. Click "Upload" in the top right of DevTools to publish an Experience Version (any version number). **No official review is required.**
2. In Management → Version Management, set it as the Experience Version. Members added in Step 7 can then scan the QR code.

   ![image-20260426202128523](docs/images/image-20260426202128523.png)

## Usage Workflow (target state)

1. **Owner** opens the app → enters a family name (1–12 characters) and a family nickname (1–20 characters) → creates the family.
2. Generates an invitation code in "Mine" (6 alphanumeric characters, valid 3 days, reusable) → forwards it to family members.
3. **Members** enter the code and a nickname to join → everyone shares the same dish library, records, and shopping list.
4. Home → pick a dish → check ingredients already prepared on the recipe page → tap "I want this dish" → confirm in the bottom sheet (meal date / meal type / remark are all optional) → a pending record is created and unchecked ingredients enter the shopping list.
5. Tap the round "Share" button on the records page to forward the Mini Program. Completing or cancelling an order requires secondary confirmation.

## Database Schema

| Collection | Purpose | Isolation / Writes |
|------|------|---------|
| `User` | User identity stub, `_id = openid` | `ensureUser` |
| `Family` | Family entity, status, member cap, invitation code | Domain actions |
| `UserFamily` | Authoritative membership, role, family nickname | Domain actions |
| `DishList` | Dishes and recipes | `familyId`, whitelist CRUD |
| `Category` | Dish categories | `familyId`, whitelist CRUD |
| `OrderList` | Order records and dish snapshots | `familyId`, domain actions only |
| `ShoppingItem` | Shopping source items | `familyId`, whitelist CRUD + domain actions |

Cloud functions read `openid` from `cloud.getWXContext()`, look up `UserFamily` for the active `familyId` and `role`, then check the permission table for the action. `familyId`, orderer, role, timestamps, and state transitions are always written server-side. `Family.memberOpenids` is display-only and must never be used for authorization.

## Cloud Development Free Tier

| Resource | Free Limit |
|------|---------|
| Database Storage | 2 GB |
| Database Reads | 500k / day |
| Cloud Storage | 5 GB |
| Cloud Function Calls | 400k / month |

Normal family use fits comfortably within the free tier. Note that routing all reads and writes through cloud functions consumes more function calls than the upstream direct-access approach.

## FAQ

**Q: Do I need multiple people?**
A: No. A single user can create a family and use dishes, ordering, and the shopping list in full; there is simply nobody to share with yet.

**Q: How do I leave or dissolve a family?**
A: Members and admins can leave voluntarily. The owner cannot leave and can only dissolve the family (with secondary confirmation). Leaving, being removed, or dissolving revokes future access only; historical order records are kept. In v1, dissolving marks the family as dissolved and blocks access — no physical deletion.

**Q: My family cannot see the images I uploaded?**
A: On the free tier, cloud storage cannot be set to "public read". The project uses the `getFileURL` cloud function to convert `cloud://` file IDs into temporary links, valid for about 2 hours (the frontend refreshes them every 1.5 hours). Images may expire on a long-open page; refresh to restore. On a paid plan, set storage to "public read" to simplify this.

**Q: Will my family receive a WeChat notification after an order?**
A: No. V1 removed subscription messages in favor of manually forwarding the Mini Program card from the records page. This was a deliberate trade-off: one-time subscription quota is credited to the recipient, so the person placing the order cannot accumulate quota on behalf of others, making delivery unreliable.

**Q: Cloud function deployment fails?**
A: Run `npm install` in the cloud function directory before uploading. If it still fails, check that your Node.js version matches the `wx-server-sdk` version.

**Q: Why does the code still use `coupleId` and a green theme?**
A: Because the refactor has not started. This README describes the finalized target state; a mismatch with the baseline code is expected. Follow milestones M0–M7 in the implementation plan.

## Contribution

Issues and Pull Requests are welcome. Product rules are defined in `../家庭点菜小程序改造需求文稿.md` and `../家庭点菜小程序实施方案.md`.

## License

The upstream project [PairBite](https://github.com/630999Steven/PairBite) was created by **630999Steven** and is licensed under [CC BY-NC-SA 4.0](LICENSE). This branch is a derivative work and follows the same terms:

- Credit the original author and retain `LICENSE`
- **Commercial use is prohibited**
- Modified works must be shared under the same license
- Refactor notes are recorded in `NOTICE.md`

The intended use of this project has been confirmed compatible with the license.
