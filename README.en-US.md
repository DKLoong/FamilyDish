# 家肴匣 · FamilyDish

A WeChat Mini Program for families: multiple members share a dish library, order records, and a shopping list, so everyone can see what was ordered and which ingredients are still missing.

Built on WeChat Cloud Development (CloudBase). No servers, no maintenance. Data is isolated between families.

> This repository is derived from the upstream project [PairBite](https://github.com/630999Steven/PairBite) by **630999Steven**, licensed under [CC BY-NC-SA 4.0](LICENSE). Mini Program name: **家肴匣**.

**Current status**: milestones M0–M7 are implemented; the code matches the features described below. The project is in pre-release preparation. The design baseline is [`docs/ui/design-spec.html`](docs/ui/design-spec.html) (v1.6); requirements and the implementation plan live in `docs/`.

## Feature Overview

- **Family management**: create or join a family, family name, per-family nickname, 3-day invitation codes, member cap 10–50, three roles (owner / admin / member), leave / remove / dissolve.
- **Shared dish library**: entry by owners and admins, structured ingredients (`name / quantity / unit / note`), steps with timers, categories, archive and restore, and 5 self-compiled sample dishes.
- **Explicit ordering**: opening a recipe creates no record; a record is created only after tapping "I want this dish" and confirming. One record holds one dish, with states pending / completed / cancelled. Dish and orderer-nickname snapshots are stored at order time.
- **Family records**: status filters, secondary confirmation for completion and cancellation, read-only historical snapshots, immutable terminal states.
- **Shopping list**: ingredient sources stored per order, merged only for display; whole-group purchase, manual items, permission-controlled deletion, and cancellation removing only that order's sources.
- **Random pick and search**: matches both dish names and ingredient names; name matches rank first.
- **About page**: version, copyright, and open-source attribution. The version comes from the number injected by WeChat at release, falling back to a local constant in development.
- **Sharing**: two separate paths — inviting family members (carries an invitation code, lands on the bind page) and recommending to friends (lands on the home page). A successful order only shows "Order placed".

**Not in v1**: subscription messages (no templates, no quota ledger), long-screenshot sharing, and collaborative editing. Planned for phase two: public recipe library, third-party recipe import, multi-family switching, and real-time watchers.

Upstream UI screenshots remain under `docs/images/`. They show the old green couple-themed interface and **do not represent the current UI**. The current UI reference is `docs/ui/design-spec.html`; the clickable prototype is `docs/ui/index.html`.

## Tech Stack

| Layer | Technology | Description |
|---|------|------|
| Frontend | WeChat Mini Program Native | WXML + WXSS + JS, no third-party UI library |
| UI | Custom WXSS + Warm Wood Kitchen tokens | Primary `#C9663B`, unrelated to the upstream green theme |
| Backend | WeChat Cloud Functions | Node.js + `wx-server-sdk ~2.6.3` |
| Database | WeChat Cloud Database | NoSQL document database, 7 collections |
| Storage | WeChat Cloud Storage | Dish images; temporary links on the free tier |
| Notification | Native WeChat sharing | No subscription messages in v1 |

No third-party API dependencies; everything runs inside the WeChat Cloud Development ecosystem.

## Project Structure

```
├── miniprogram/
│   ├── app.js                  # Global family guard and context cache
│   ├── app.json                # 4-tab bar: Home / Records / Shopping / Mine
│   ├── app.wxss                # Page background, button reset, skeleton animation
│   ├── sitemap.json            # Only Home and About are indexable by WeChat search
│   ├── envList.js              # Cloud environment config
│   ├── components/confirm-modal/   # Single confirmation dialog used app-wide
│   ├── utils/                  # api.js, app-info.js, duration.js, recipe.js, shopping.js
│   ├── images/                 # Tab bar icons and app icon logo.jpg
│   └── pages/                  # 11 pages, see the table below
├── cloudfunctions/
│   ├── familyApi/              # Unified entry: whitelist CRUD + domain actions + auth + transactions
│   │   └── test/               # 6 suites, 210 cases; run directly with node
│   ├── ensureUser/             # User registration and family context
│   └── getFileURL/             # Cloud storage temporary links
├── docs/
│   ├── ui/                     # design-spec.html + clickable prototype index.html
│   ├── brand/                  # Original app icon artwork
│   ├── images/                 # Upstream baseline screenshots, historical reference only
│   └── *.html / *.md           # Requirements, implementation plan, M0 guide, M6/M7 reports
├── project.config.json
├── LICENSE
└── NOTICE.md                   # Attribution and refactor notes
```

| Page | Purpose |
|------|---------|
| `MainPage` | Home: greeting, search, categories, random pick, dish grid |
| `DishDetail` | Recipe detail: prepared ingredients, step timers, order sheet |
| `DishAdd` | Create or edit a dish |
| `DishManage` | Dish management: active / archived tabs, sticky tabs |
| `CategoryManage` | Category management: add, rename, reorder |
| `OrderHistory` | Order records: state filters, complete / cancel, snapshots |
| `Shopping` | Shopping list: merged display, check-off, manual items |
| `Settings` | Mine: identity, entries, family settings, About |
| `MemberManage` | Family members: roles, removal, leave / dissolve |
| `Bind` | Create or join a family; also handles invitation links |
| `About` | Version, copyright, open-source attribution |

**Read/write channel**: the frontend never calls `wx.cloud.database()`. List reads, detail reads, and all writes go through `wx.cloud.callFunction` to `familyApi`. All 7 collections are set to "admin read/write only", with no client-side direct-access bypass.

## Deployment Guide

### Prerequisites

- Install [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
- Register a WeChat Mini Program account and complete the Mini Program Information and Category sections. The category directly affects search matching — pick the closest matching category, not a generic one.
- **A formally registered Mini Program AppID is required**. The "test account" inside DevTools does not support Cloud Development.

> The screenshots below come from the upstream deployment guide and show WeChat DevTools; the interface may vary by tool version.

### Step 1: Get the source

```bash
git clone https://github.com/DKLoong/FamilyDish.git
cd FamilyDish
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

**Set all 7 collections to "admin read/write only"**. This is mandatory: the frontend never connects to the database directly; all reads and writes are authorized inside `familyApi`.

![image-20260426203835555](docs/images/image-20260426203835555.png)

> Upgrading from upstream data: no compatibility migration is provided. Clear the old test collections before creating the new structure.

### Step 4: Update Configuration

When deploying to your own account, replace the values in these two files (this README does not record the concrete values):

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

In WeChat DevTools, deploy **only these 3 cloud functions** (right-click the directory → "Upload and Deploy: install dependencies on cloud"):

| Cloud Function | Purpose |
|--------|------|
| `familyApi` | Unified read/write entry: whitelist CRUD, domain actions, auth, transactions, idempotency |
| `ensureUser` | Create `User` on first visit, return family context |
| `getFileURL` | Convert `cloud://` to temporary links |

> The 9 upstream cloud functions (`getCoupleData`, `updateCoupleData`, `manageCategory`, `bindPartner`, `unbindPartner`, `updateKitchenName`, `sendNotify`, `getOpenId`, `createUser`) have been removed from this repository; `cloudfunctions/` now holds only the 3 listed above. They belong to the old `coupleId` two-person model: `getCoupleData` / `updateCoupleData` accept arbitrary collection names and fields and can rewrite `coupleId` itself, which allows reading other families' data. **Do not restore them.** If your cloud environment still has them deployed, delete them in the Cloud Development console.

### Step 6: No Subscription Message Setup

**V1 does not use subscription messages.** No template application, no field DATA IDs, no template environment variables.

> The "Message Push Configuration" page in the platform (which asks for URL / Token / EncodingAESKey) is a customer-service callback and is unrelated to subscription messages. This project does not need it either; leave it disabled.

### Step 7: Invite Experience Members

Before formal release, other users must be added as **Experience Members**:

1. [WeChat Official Accounts Platform](https://mp.weixin.qq.com/) → Management → Member Management → Experience Members.
2. Click "Add" and enter the person's WeChat ID.
3. After they confirm in WeChat, they can scan the experience QR code.

> Personal accounts allow up to 15 experience members. Families are isolated by `familyId` + `UserFamily`.

### Step 8: Upload the Code

1. Click "Upload" in the top right of DevTools to publish an Experience Version.
2. In Management → Version Management, set it as the Experience Version. Members added in Step 7 can then scan the QR code.
3. Formal release requires submitting for review; after approval, publish from the Mini Program backend.

   ![image-20260426202128523](docs/images/image-20260426202128523.png)

### Step 9: Search Indexing (optional)

To make the Mini Program discoverable in WeChat search:

1. Turn on "page indexing" in the Mini Program backend — without it, `sitemap.json` has no effect.
2. Include core keywords naturally in the name and description; the description is limited to 120 characters (one Chinese character counts as two).
3. `sitemap.json` only allows the Home and About pages; other pages hold private family data and stay blocked.

## Usage Workflow

1. **Owner** opens the Mini Program → enters a family name (1–12 characters) and a family nickname (1–20 characters) → creates the family.
2. Generates an invitation code in "Mine" (6 alphanumeric characters, valid 3 days, reusable) → forwards it to family members.
3. **Members** enter the code and a nickname to join → everyone shares the same dish library, records, and shopping list.
4. Home → pick a dish → check ingredients already prepared on the recipe page → tap "I want this dish" → confirm in the bottom sheet (meal date / meal type / remark are all optional) → a pending record is created and unchecked ingredients enter the shopping list.
5. Completing or cancelling an order requires secondary confirmation. The round button on the records page recommends the Mini Program to friends.
6. "Mine → About" shows the version and attribution; leave / dissolve lives at the bottom of the family members page.

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

## Tests

The cloud function ships with 6 self-contained suites:

```bash
cd cloudfunctions/familyApi
node test/family.test.js
# also: category / dish / order / shopping / schema
```

## Cloud Development Free Tier

| Resource | Free Limit |
|------|------|
| Database Storage | 2 GB |
| Database Reads | 500k / day |
| Cloud Storage | 5 GB |
| Cloud Function Calls | 400k / month |

Normal family use fits comfortably within the free tier. Note that routing all reads and writes through cloud functions consumes more function calls than the upstream direct-access approach.

## FAQ

**Q: Do I need multiple people?**
A: No. A single user can create a family and use dishes, ordering, and the shopping list in full.

**Q: How do I leave or dissolve a family?**
A: Open "Mine → Family members"; the button at the bottom of that page handles both. Members and admins see "Leave family"; the owner sees "Dissolve family" (with secondary confirmation). Access is revoked; historical order records are kept.

**Q: My family cannot see the images I uploaded?**
A: On the free tier, cloud storage cannot be set to "public read". The project uses the `getFileURL` cloud function to convert `cloud://` file IDs into temporary links, valid for about 2 hours (the frontend refreshes them every 1.5 hours). Refresh the page if images expire.

**Q: Will my family receive a WeChat notification after an order?**
A: No. V1 does not use subscription messages; use the button on the records page to recommend the Mini Program instead.

**Q: Why does content take a moment to appear when navigating back?**
A: The WeChat client rebuilds the lower page's first frame on return: the native navigation bar updates immediately while the webview repaints slightly later. A control experiment (disabling the refresh on return) reproduced it, so it is a platform behaviour, not application code.

**Q: Cloud function deployment fails?**
A: Run `npm install` in the cloud function directory before uploading. If it still fails, check that your Node.js version matches the `wx-server-sdk` version.

## Contribution

Issues and Pull Requests are welcome. Development conventions (read/write channel, page data loading, confirmation dialog, prohibitions) are documented in [CLAUDE.md](CLAUDE.md).

## License

The upstream project [PairBite](https://github.com/630999Steven/PairBite) was created by **630999Steven** and is licensed under [CC BY-NC-SA 4.0](LICENSE). This repository is a derivative work and follows the same terms:

- Credit the original author and retain `LICENSE`
- **Commercial use is prohibited**
- Modified works must be shared under the same license
- Refactor notes are recorded in `NOTICE.md`
