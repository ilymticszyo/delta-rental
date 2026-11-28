# API 对照

> 路径与字段以仓库根目录的 `docs/api-contract.md` 与 `docs/openapi.yaml`（**0.4.0-draft**）为准。下面「未租重算」和「密码」两节是当前后端行为。其余表格是接入契约之前的旧草稿，路径已过时。

## 未租重算（0.4.0）

改计价规则先预览，确认后再保存。权限与改规则相同：运营或管理员。金额是整数元。错误仍是 `{ error: { code, message, fields?, details?, requestId? } }`。

### `POST /api/rules/pricing/preview`

请求 `{ "rule": PricingRule }`。不落库。`rule.version` 忽略。

响应 `PricingRulePreview`：`baseVersion`、`nextVersion`、`previewToken`、`affected[]`、`skipped[]`、`summary`。

- `affected`：未删除，且状态是 `draft` / `listed` / `off` / `held`。每项含 `accountId`、`accountNo`、`oldPrice`、`newPrice`、`delta`、`changed`。价格是一个租期的报价明细，`delta` 是租客应付（`renterRent`）的差额。价格没变的也在里面。
- `skipped`：`rented` → `RENTED`，`settling` → `SETTLING`。新规则算不出价 → `PRICING_ERROR`，并带 `message`。这些账号保留旧报价。
- `previewToken` 形如 `pv1.{baseVersion}.{hmac-sha256}`。客户端只原样带回。

一次返回全部，不分页。客服、号主、成员：403 `FORBIDDEN`。未登录：401 `UNAUTHENTICATED`。

### `PUT /api/rules/pricing`

```json
{
  "rule": { "version": 1 },
  "summary": "说明",
  "baseVersion": 1,
  "previewToken": "<预览返回的 previewToken>"
}
```

缺少 `baseVersion` 或 `previewToken`：422 `VALIDATION_FAILED`。`baseVersion` 不是当前版本：409 `RULE_CONFLICT`，`details.reason` 为 `VERSION_CHANGED`。令牌对不上：409 `RULE_CONFLICT`，`details.reason` 为 `PREVIEW_STALE`。都不写入。

成功时在同一个数据库事务里：规则版本 +1，重写 `affected` 里账号的完整报价并盖上新 `ruleVersion`，写一条操作日志（新版本、重算数、变动数、合计差额、按原因的跳过数）。租赁中、待结算和已登记订单不动。

响应：`{ "rule": PricingRule, "repriced": { "affectedCount", "changedCount", "skippedCount", "totalDelta" } }`。

## 密码（与契约一致）

`POST /api/staff` 和 `POST /api/staff/{username}/password` 的密码为 **8–128 个字符**，不再加额外复杂度规则。用 bcrypt（cost 8）存储，响应和操作日志都不含密码或哈希。只有管理员可以新建用户和重置密码；用户不能在这两个接口上改自己的密码。重置后该用户的全部登录令牌立即作废。

前端 `src/api/types.ts` 里的每个 `Api` 方法对应一个 HTTP 接口。成功时响应 JSON 就是该方法的返回值（`void` 返回 `{ "ok": true }`，`undefined` / 找不到返回 `null`）。

错误：

```json
{ "message": "无权限（403）", "code": 403 }
```

HTTP 状态与 `code` 相同。常见值：400 参数，401 未登录，403 无权限，404 不存在，409 冲突，413 请求体过大，429 登录过频，500 服务器错误。

鉴权见 [README](./README.md)。除登录、退出、演示账号、健康检查、`/api/docs` 与 `/api/openapi.json` 外，都要带 JWT。

权限与 `src/domain/permissions.ts` 的五档角色一致，在服务端按接口检查，不只靠前端藏菜单。字段裁剪也在服务端做（`lobbyAccountFor` / `pricingFor` / 号主白名单）。

| 能力 | owner | member | cs | ops | admin |
|---|---|---|---|---|---|
| 前台 / 算价 / 估值 / 客服 | 是 | 是 | 是 | 是 | 是 |
| 号主门户（仅本人） | 是 | | | | |
| 号主门户（全部） | | | | | 是 |
| 后台、订单、回收、档案、报表、看板 | | | 是 | 是 | 是 |
| 库存查看 | | | 是 | 是 | 是 |
| 库存编辑、规则 | | | | 是 | 是 |
| 员工、操作日志 | | | | | 是 |

`GET /api/admin/rules/pricing` 例外：任意已登录角色都能读，因为前台算价页要拿周期和渠道。响应里包含渠道服务费率。

## 方法对照

| `Api` 方法 | 方法 | 路径 | 请求 |
|---|---|---|---|
| `login` | POST | `/api/auth/login` | `{ username, password }` → `User`。Token 在头 `X-Auth-Token` 和 cookie `token` |
| `logout` | POST | `/api/auth/logout` | 无。响应 `{ ok: true }` |
| `currentUser` | GET | `/api/auth/me` | 无 token 时 `null` |
| `demoAccounts` | GET | `/api/auth/demo-accounts` | 关闭开关时 `[]` |
| `listListedAccounts` | GET | `/api/lobby/accounts` | |
| `getAccount` | GET | `/api/lobby/accounts/:id` | 没有或不可见时 `null` |
| `calcPricing` | POST | `/api/pricing/calc` | `PricingInput`。熟客由服务端按档案判断，忽略客户端的 `renterRegular` |
| `calcValuation` | POST | `/api/valuation/calc` | `ValuationInput` |
| `submitRecycle` | POST | `/api/recycles` | `ValuationInput`，可多一个 `sourceAccountId`。也接受 `{ input, sourceAccountId }` |
| `myRecycles` | GET | `/api/recycles/mine` | |
| `currentCsAgent` | GET | `/api/cs/current?now=` | `now` 为 ISO 时间，可选 |
| `listCsAgents` | GET | `/api/cs/agents` | |
| `ownerAccounts` | GET | `/api/owner/accounts` | |
| `ownerAccount` | GET | `/api/owner/accounts/:id` | |
| `ownerEstimate` | POST | `/api/owner/estimate` | `{ asset }` 或直接 `ValuationInput`。需要 `ownerPortal`（管理员没有） |
| `ownerSubmitListing` | POST | `/api/owner/listings` | `OwnerListingInput`。`attachments[].dataUrl` 为 data URL 或 `/api/uploads/:id` |
| `ownerRecycleDraft` | GET | `/api/owner/accounts/:id/recycle-draft` | |
| `listAccounts` | GET | `/api/admin/accounts` | |
| `saveAccount` | POST | `/api/admin/accounts` | `AccountInput`。带 `id` 为更新，不带为新增 |
| `importContext` | GET | `/api/admin/accounts/import/context` | |
| `importAccounts` | POST | `/api/admin/accounts/import` | `{ aoa, fileName }` |
| `deleteAccount` | DELETE | `/api/admin/accounts/:id` | |
| `setAccountStatus` | POST | `/api/admin/accounts/:id/status` | `{ status }` |
| `listOrders` | GET | `/api/admin/orders` | 每条多 `reminder`、`ownerPayableBalance` |
| `previewOrder` | POST | `/api/admin/orders/preview` | `{ accountId, renterContact }` |
| `createOrder` | POST | `/api/admin/orders` | `OrderInput` |
| `markHandover` | POST | `/api/admin/orders/:id/handover` | `{ note? }` |
| `extendOrder` | POST | `/api/admin/orders/:id/extend` | `{ rentalDays, note? }` |
| `endOrder` | POST | `/api/admin/orders/:id/end` | `{ note? }` |
| `markReturned` | POST | `/api/admin/orders/:id/returned` | `{ note? }` |
| `addDepositEntry` | POST | `/api/admin/orders/:id/deposits` | `{ type, amount, reason }`，`type` 为 `collect` / `deduct` / `refund` |
| `payOwner` | POST | `/api/admin/orders/:id/pay-owner` | `{ amount, note }` |
| `completeOrder` | POST | `/api/admin/orders/:id/complete` | `{ relist, note? }`。必须已经交号且还号，否则 409，账号不会回到上架 |
| `cancelOrder` | POST | `/api/admin/orders/:id/cancel` | `{ note? }` |
| `listPayables` | GET | `/api/admin/payables?ownerId=` | |
| `renterProfiles` | GET | `/api/admin/renters` | |
| `lookupRenter` | GET | `/api/admin/renters/lookup?contact=` | 没有时 `null` |
| `saveRenter` | POST | `/api/admin/renters` | `{ contact, displayName, tag, note }`，`tag` 为 `regular` / `caution` / `blacklist` / `null` |
| `ownerProfiles` | GET | `/api/admin/owners` | |
| `listRecycles` | GET | `/api/admin/recycles` | |
| `updateRecycle` | POST | `/api/admin/recycles/:id` | `{ toStatus, note, staffPrice? }` |
| `recycleToInventory` | POST | `/api/admin/recycles/:id/to-inventory` | |
| `getPricingRule` | GET | `/api/admin/rules/pricing` | |
| `savePricingRule` | PUT | `/api/admin/rules/pricing` | `{ rule, summary? }`。也接受把规则字段放在顶层并带 `summary` |
| `getValuationRule` | GET | `/api/admin/rules/valuation` | |
| `saveValuationRule` | PUT | `/api/admin/rules/valuation` | `{ rule, summary? }` |
| `ruleHistory` | GET | `/api/admin/rules/history` | 只有版本元数据 |
| `trialPricing` | POST | `/api/admin/rules/pricing/trial` | `{ input, rule }` |
| `trialValuation` | POST | `/api/admin/rules/valuation/trial` | `{ input, rule }` |
| `report` | GET | `/api/admin/reports?fromMs&toMs&dimension` | `dimension` 为 `safeBox` / `rank` / `price` / `channel` |
| `dashboard` | GET | `/api/admin/dashboard?now=` | `now` 为 ISO 时间，可选 |
| `listUsers` | GET | `/api/admin/users` | |
| `setUserEnabled` | POST | `/api/admin/users/:username/enabled` | `{ enabled }` |
| `auditLogs` | GET | `/api/admin/audit` | 最新在前，最多 800 条 |
| `resetDemo` | POST | `/api/admin/reset-demo` | 仅管理员，且 `ENABLE_DEMO_RESET=true` |

## 额外接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ ok: true, service: "delta-rental-api" }` |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/openapi.json` | OpenAPI 3 |
| GET | `/api/admin/rules/pricing/versions/:version` | 某一版计价规则全文 |
| GET | `/api/admin/rules/valuation/versions/:version` | 某一版估值规则全文 |
| POST | `/api/admin/accounts/import/xlsx` | `multipart` 字段 `file`（xlsx / csv），校验与 `importAccounts` 相同 |
| POST | `/api/uploads` | `multipart` 字段 `file`，≤ 1 MB，png / jpeg / webp / gif。响应 `{ id, name, dataUrl, uploadedBy, at }`，`dataUrl` 为 `/api/uploads/:id` |
| GET | `/api/uploads/:id` | 读取截图，必须登录 |

保存账号或号主上架时如果 `dataUrl` 是 `data:image/...;base64,...`，服务端会落盘并把它换成 `/api/uploads/:id`。前端 `<img :src>` 在同域下可以直接用这个路径（登录 cookie 会带上）。

## 和前端契约的差异

前端还没有 `HttpApi`，这些是接真接口时要注意的地方。前端代码没有改。

1. `login` / `currentUser` / `logout` 从同步的 localStorage 变成 HTTP。`login` 的响应体仍然是 `User`，token 不在 body 里。
2. `getAccount` 找不到时返回 JSON `null`，不是 `undefined`。`currentCsAgent`、`lookupRenter`、`currentUser` 同样用 `null`。
3. `deleteAccount`、`logout`、`resetDemo` 返回 `{ ok: true }`。
4. `listCsAgents` 和 `currentCsAgent` 需要已登录（`front`）。本地演示实现没有检查登录。
5. `resetDemo` 需要管理员，并且可以被环境变量关掉。本地演示实现没有鉴权。
6. `demoAccounts` 在 `ENABLE_DEMO_ACCOUNTS=false` 时返回空数组。
7. 截图不再建议长期存 data URL。上传接口和落盘后的 `dataUrl` 都是 `/api/uploads/:id`。读取图片要带登录态。
8. 规则历史接口仍只给元数据。完整快照是上面的 versions 接口。计算当时的版本号已经写在报价和估值结果的 `ruleVersion` 上。
9. 多了健康检查、OpenAPI、xlsx 文件上传。JSON `aoa` 导入仍然是和 `importAccounts(aoa, fileName)` 对应的那一个。
10. 被停用的账号如果还拿着旧 token，下一次请求是 401，文案是「该账号已停用」。
11. 登录：同一客户端 IP、同一用户名各自计算，10 分钟内失败满 10 次后返回 429（成功登录会把这两边的计数清掉）。IP 是反代后的真实地址，由环境变量 `TRUST_PROXY` 决定信任哪些来源的 `X-Forwarded-For`，默认只信任本机和内网，不会相信任意客户端自己填的转发头。见 README。
12. 账号备注分成对外 `remark`（大厅可见、可搜索）和内部 `internalRemark`（只给客服、运营、管理员）。号主、成员和未登录访客的大厅响应里没有内部备注，搜索也匹配不到。数据库里原来的备注已迁移成内部备注。号主上架时填的备注记在内部备注里。
13. 租期结束仍是「租赁中」的订单，会在打开订单、库存或看板时，以及大约每分钟，自动改成「待结算」，账号从「租赁中」改成「待结算」。不会自动登记还号，也不会自动上架。
