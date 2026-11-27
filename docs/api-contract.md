# API 契约（前端 ↔ 后端）

> 机器可读版本：[`docs/openapi.yaml`](./openapi.yaml)（OpenAPI 3.0.3，63 个操作，其中 4 个为 `x-status: proposed` 提议操作，见 10.1）。两者冲突时以 openapi.yaml 为准，并同步修正本文。
> 前端实现：`src/api/http.ts`（HttpApi）；接口定义：`src/api/types.ts`（`Api`）；共享领域类型：`src/domain/types.ts`、`src/config/rules.ts`。
> 契约测试：`tests/contract/`（`npm run test:contract`）——设 `CONTRACT_BASE_URL` 即可把同一套用例指向真实后端做回归（见第 11 节）。

## 1. 总则

| 项 | 约定 |
|---|---|
| 前缀 | 所有接口在相对路径 **`/api`** 下，与前端**同域**部署（OpenResty 反代），前端不写死域名 |
| 格式 | 请求 / 响应均为 `application/json; charset=utf-8`（上传为 `multipart/form-data`）；字段 camelCase |
| 金额 | **整数，单位人民币元（不是分）**。PRD 7.1 的算价每一步都取整到元，系统里不存在角；所有金额字段（租金、押金、成本、应付、报价、成交价…）是 ≥0 的整数，非整数直接 422。百分比是 0–100 的数（`serviceFeeRate: 5` = 5%），系数是小数（`marketCoefficient: 1.05`） |
| 时间 | ISO 8601 **带时区**。服务端统一输出 UTC 毫秒格式 `2026-11-27T14:37:36.000Z`；接收任何带偏移的值（`+08:00` 也可），不带时区的时间 → 422。纯日期字段（`dealAt`）为 `YYYY-MM-DD`，按 Asia/Shanghai 解释。业务上的“今天 / 本周 / 本月 / 自然日”一律按 **Asia/Shanghai** 计算 |
| ID | 字符串，前端不解析其结构。业务编号（`accountNo` DF…、`orderNo` ZD…、`requestNo` HS…）由服务端生成；导入可指定 `accountNo`，全局唯一且**大小写不敏感**，删除后不复用 |
| 空值 | 可空字段返回 `null`（不省略）；可选字段可省略。前端把 `undefined` 与缺省视为相同 |
| 幂等 | `PUT` / `DELETE` / 状态流转天然幂等或返回 409。`POST /orders`、`POST /accounts/import`（`dryRun=false`）、`POST /orders/{id}/owner-payments` 接受可选请求头 `Idempotency-Key`（8–128 位 `[A-Za-z0-9_-]`），语义见第 12 节第 7 条：同键同体 24 小时内重放原响应，同键不同体 → 409 `DUPLICATE`。建议 5xx / 401 / 403 / 429 不入库，重放响应带 `Idempotent-Replayed: true`（可选）。前端每次提交生成一个 UUID，重试、双击沿用同一键；拿到确定结果（成功或 4xx）或请求体变了才换新键 |
| 提议项 | openapi.yaml 中标 `x-status: proposed` 的操作 / 字段 / 参数是前端提议、**后端暂未实现**：不计入覆盖检查，前端在 404 / 405 / 501 或字段缺省时降级（见 10.1） |

### 1.1 分页、过滤、排序

- 所有“列表”型 GET（大厅、库存、订单、台账、回收、档案、号主门户、日志）都分页：
  - 请求：`page`（从 1 开始，默认 1）、`pageSize`（默认 50，**最大 200**，超出按 200 处理）。
  - 响应：`{ "items": [...], "total": 123, "page": 1, "pageSize": 50 }`。
- 排序：`sort=字段[,字段]`，`-` 前缀表示降序，例如 `sort=-createdAt,accountNo`；默认按 `createdAt` 降序。未知字段 → 422。`/payables` 与 `/audit-logs` 的时间字段叫 `at`，`sort=createdAt` 作为 `at` 的别名同样接受。
- 过滤：普通查询参数（`status=listed&source=buyin`），同名参数之间是 AND；`q` 为关键字模糊匹配（大小写不敏感，匹配字段见各接口）；时间区间统一用 `from`（含）/ `to`（不含），ISO 8601。
- 小型配置列表不分页，直接返回数组：`/cs-agents`、`/staff`、`/rules/versions`。
- **前端现状**：页面目前在前端做筛选，HttpApi 会以 `pageSize=200` 循环翻页拉全量（最多 50 页）。数据量上来后再把订单 / 日志改成服务端分页，不影响契约。

## 2. 鉴权：Bearer 令牌（选定）

- 登录 `POST /api/auth/login {username,password}` → `{ token, expiresAt, user }`；之后每个请求带 `Authorization: Bearer <token>`。
- 令牌为**不透明随机串**（≥128 位，服务端只存哈希），**不是 JWT**：服务端每次查会话表，所以
  - 停用用户（`PATCH /staff/{username}`）、改密、退出 → 立即吊销该用户全部令牌（mock 里“停用立即生效”的行为保持不变）；
  - 有效期 12 小时滑动续期、最长 7 天（可配置），过期返回 401。
- 启动：前端先调 `GET /api/meta`（免登录），本地有令牌时再调 `GET /api/auth/me` 恢复会话。
- 401 处理：非登录接口返回 401 → 前端清除令牌并跳转到 `#/login?redirect=…&expired=1`（后台页跳 `#/admin/login`）；登录接口的 401 只提示、不跳转。
- 登录失败统一 `401 INVALID_CREDENTIALS`（不区分账号不存在 / 密码错误）；停用账号 `403 USER_DISABLED`；同账号或同 IP 连续失败 → `429 RATE_LIMITED`。密码用 argon2id / bcrypt 存储。

**为什么选 Bearer 而不是 Cookie：**
1. 前后端同域、同一个 OpenResty 后面，两种都可行；Bearer 不需要 CSRF 防护（不会被浏览器自动携带），后端实现最简单，也方便后续接小程序 / 脚本 / 第三方工具。
2. 用不透明令牌 + 服务端会话，保留了 Cookie 会话“可即时吊销”的优点。
3. 代价是令牌存在 `localStorage`（键 `dr:http:token`），XSS 时可被读取。缓解：前端无 `v-html` / 无第三方脚本；`deploy/nginx.conf` 下发严格 CSP；令牌有效期短、可吊销。如果后端更倾向 HttpOnly Cookie，前端只需改 `src/api/http.ts` 的 `TokenStore` 与 `credentials`，并加 CSRF 头——列为待确认问题。
4. `<img>` 无法携带 Authorization 头，所以截图 URL 需要签名（见 §7）。

## 3. 角色与权限

五档固定角色：`owner` 号主、`member` 内部成员、`cs` 客服、`ops` 运营、`admin` 管理员（能力表见 `src/domain/permissions.ts`）。**权限一律由服务端判定**，前端隐藏菜单只是体验。每个操作的允许角色写在 openapi 的 `x-roles`；不在列表中的已登录角色 → `403 FORBIDDEN`；未登录 → `401`。

| 资源 / 接口 | owner | member | cs | ops | admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `GET /meta`、`POST /auth/login` | 公开 | 公开 | 公开 | 公开 | 公开 |
| `/auth/me`、`/auth/logout` | ✓ | ✓ | ✓ | ✓ | ✓ |
| 大厅 `GET /lobby/accounts[/{id}]` | ✓（裁剪） | ✓（裁剪） | ✓ | ✓ | ✓ |
| `GET /pricing/options`、`POST /pricing/quote`、`POST /valuation/quote` | ✓（裁剪） | ✓（裁剪） | ✓ | ✓ | ✓ |
| `/cs-agents`、`/cs-agents/current` | ✓ | ✓ | ✓ | ✓ | ✓ |
| 提交回收 `POST /recycles`、`GET /recycles/mine` | ✓ | ✓ | ✓ | ✓ | ✓ |
| 号主门户 `GET /owner/accounts[/{id}]` | 仅本人 | – | – | – | 全部 |
| `/owner/estimate`、`/owner/listings`、`/owner/accounts/{id}/recycle-draft` | 仅本人 | – | – | – | – |
| 库存 `GET /accounts` | – | – | ✓（只读） | ✓ | ✓ |
| 库存写 `POST/PUT/DELETE /accounts…`、`/accounts/{id}/status` | – | – | – | ✓ | ✓ |
| 导入 `/accounts/import`、`/accounts/import/context` | – | – | **–（403）** | ✓ | ✓ |
| 上传 `POST /uploads` | ✓（上架用） | – | – | ✓ | ✓ |
| 订单及其全部动作、`/payables` | – | – | ✓ | ✓ | ✓ |
| 回收后台 `GET /recycles`、`/transitions`、`/to-inventory` | – | – | ✓ | ✓ | ✓ |
| 档案 `/renters…`、`/owners` | – | – | ✓ | ✓ | ✓ |
| `GET /rules/pricing`（含服务费率） | – | – | ✓ | ✓ | ✓ |
| `PUT /rules/*`、`GET /rules/valuation`、`/rules/versions`、`/rules/*/trial` | – | – | – | ✓ | ✓ |
| `/reports`、`/dashboard` | – | – | ✓ | ✓ | ✓ |
| `/staff…`、`/audit-logs` | – | – | – | – | ✓ |
| `/demo/reset`（仅演示环境） | – | – | – | – | ✓ |

### 3.1 字段裁剪（服务端执行，不能靠前端隐藏）

**号主（owner）永远拿不到**：租客信息（`renterContact`、租客档案）、订单（`orderNo` 等）、租金与报价（`quote`、`coinRent`、`renterRent`、`totalAmount`、`extraFee`、`deposit`、`coinRatio`、折扣参数）、服务费 / 抽成（`serviceFee`、`serviceFeeRate`、平台收入）、`ownerPayable` 明细、`costAmount`。具体：

| 接口 | owner 看到 | member 看到 | 员工（cs/ops/admin） |
|---|---|---|---|
| 大厅账号 | 资产字段；`quote: null`；无 `deposit/coinRatio/discountMode/customDiscountPercent/ownerContact/ownerId/costAmount` | 资产 + `quote` 的租客应付部分（无 `serviceFeeRate/serviceFee/ownerSettlement`）；无号主 / 成本字段 | 全部 |
| `POST /pricing/quote` | 只有 `{ruleVersion, ownerSettlement}`（= 预计到手） | 去掉 `serviceFeeRate/serviceFee/ownerSettlement` | 完整 `PricingResult` |
| `GET /pricing/options` | 渠道 / 周期名称、折扣上下限、默认押金（**不含费率**） | 同左 | 同左 |
| 号主门户 | `OwnerAccountView` 白名单：状态、到期时间 `expireAt`、到手 `takeHome`、回收进度、资产、截图 | 403 | admin：全部 + `ownerName`；cs/ops：403 |

前端用 `FORBIDDEN_OWNER_KEYS`（`src/domain/visibility.ts`）在单测与契约测试里深度扫描号主能拿到的全部响应；后端请用同一份清单写测试。

## 4. 错误格式

```json
HTTP/1.1 422
X-Request-Id: 7f3a9c
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "数据校验未通过",
    "fields": [{ "field": "coinAmount", "message": "纯币需大于 0" }],
    "details": {},
    "requestId": "7f3a9c"
  }
}
```

- `message`：可直接展示给用户的中文；前端优先显示它，没有时用 `fields` 拼接，再没有时按状态码给默认文案。
- `fields[].field`：JSON 路径（`asset.skins[1]`、`rows[3]`）。
- 每个响应带 `X-Request-Id`，日志里同号，方便排查。
- 前端映射为 `ApiError(message, code=HTTP 状态, errorCode, fields, requestId)`（`src/api/errors.ts`）；网络错误 / 超时分别是 `code=0` + `NETWORK_ERROR` / `TIMEOUT`。调用提议操作得到 404 / 405 / 501 时映射为 `errorCode=NOT_SUPPORTED`（例如员工页显示“后端暂未支持新建用户”）。

| HTTP | code | 场景 |
|---|---|---|
| 400 | `BAD_REQUEST` | JSON 解析失败、参数类型错误 |
| 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | 未登录 / 令牌失效 / 用户被停用；登录失败 |
| 403 | `FORBIDDEN` / `USER_DISABLED` | 角色无权限；停用账号登录 |
| 404 | `NOT_FOUND` | 不存在，或对当前用户不可见（号主访问他人账号一律 404，不泄露存在性） |
| 409 | `INVALID_TRANSITION` | 非法状态流转（账号、订单、回收单） |
| 409 | `ACCOUNT_NOT_AVAILABLE` | 登记订单时账号不是 listed |
| 409 | `RENTER_BLACKLISTED` | 黑名单联系方式登记订单（同时写操作日志「拦截黑名单」） |
| 409 | `BALANCE_NOT_SETTLED` | 结单时押金或号主应付未清零且未填说明 |
| 409 | `DUPLICATE` | 编号 / 联系方式等唯一键冲突 |
| 409 | `VERSION_CONFLICT` | 保存规则时 `rule.version` 不是当前版本（乐观锁） |
| 409 | `LAST_ADMIN` | 停用自己或最后一个管理员 |
| 409 | `DUPLICATE` | 同一 `Idempotency-Key` 配不同请求体（幂等冲突，与唯一键冲突同码） |
| 409 | `OWNER_ALREADY_BOUND` | （提议，随 `POST /staff`）号主档案已绑定其他用户 |
| 413 | `PAYLOAD_TOO_LARGE` | 文件 > 1 MB、请求体 > 5 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 非 png / jpeg / webp |
| 422 | `VALIDATION_FAILED` | 字段校验失败（含金额非整数、时间无时区） |
| 422 | `IMPORT_INVALID_FILE` | 导入文件级错误：缺必填列、空文件、超过 500 行 |
| 429 | `RATE_LIMITED` | 登录等频率限制 |
| 500 | `INTERNAL` | 未预期错误（不要把堆栈返回给前端） |

> 注：mock（`src/api/local.ts`）的多数业务错误目前用 400；真实后端请按上表用 409 / 422，前端只看 `message`，不会因此出错。

## 5. 状态与流转

**账号 `AccountStatus`**：`draft` 草稿/待确认 · `listed` 空闲可租 · `rented` 租赁中 · `settling` 待结算 · `off` 已下架 · `held` 已回收持有。

| 从 → 到 | 触发 |
|---|---|
| (新建) → draft / listed / off / held | `POST /accounts`（号主上架与批量导入固定为 draft） |
| draft → listed（人工确认上架）/ off（作废） | `POST /accounts/{id}/status` |
| listed → off；off → listed；held → listed / off | 同上 |
| listed → rented | `POST /orders`（登记订单） |
| rented → settling | `POST /orders/{id}/end` |
| settling → listed / off | `POST /orders/{id}/complete`（`relist`） |
| rented → listed | `POST /orders/{id}/cancel`（未交号） |
| 任意寄租号 → held（source 变 buyin） | `POST /recycles/{id}/to-inventory`（号主转回收） |

rented / settling 不能人工改、不能删除、不能编辑状态字段（`PUT` 里 status 必须等于当前值）。

**订单 `OrderStatus`**：`active` → `settling`（end）→ `done`（complete）；`active` → `cancelled`（仅未交号）。active 期间可交号（handover，一次）、改租期（extend）、记押金；settling 期间登记还号（return，一次）、记押金、付号主款。`done / cancelled` 后只读（付号主款在 cancelled 后也禁止）。
生命周期事件 `OrderEvent.step`：`register handover extend collect deduct refund expire return payOwner settle cancel`，每个动作追加一条（含操作人与时间），嵌在订单的 `events` 里返回，**只增不改**。

**押金台账 `DepositEntry`**：`collect` 收 / `deduct` 扣（须写原因）/ `refund` 退；余额 = 收 − 扣 − 退，扣和退不能超过余额。登记订单时押金 > 0 会自动记一笔 collect（熟客免押则为 0）。

**号主应付 `OwnerPayableEntry`**：`accrue`（登记订单时计提 = 按账号报价快照的 `ruleVersion` 对应的那版规则算出的 `ownerSettlement`，即一个租期的号主可得；改规则不影响已登记库存的订单金额）· `pay`（付款，≤ 本单余额）· `reverse`（取消订单冲销）。自收号不计提。

**回收单 `RecycleStatus`**：`submitted → following | cancelled`；`following → quoted | rejected | cancelled`；`quoted → quoted（改价） | deal | rejected`；`deal / rejected / cancelled` 为终态。`deal` 只能经 `/to-inventory`。报价 `staffPrice` > 0。

**租客标签 `RenterTag`**：`regular` 熟客（自动熟客折扣、按规则免押）· `caution` 慎租（登记时提示，不拦）· `blacklist` 黑名单（禁止登记）。联系方式规范化：去首尾空格、小写后比较。

## 6. 计算以服务端为准

| 计算 | 权威 | 说明 |
|---|---|---|
| 出租报价（PRD 7.1，逐步取整到元）、熟客折扣与免押 | **服务端** | `quote` 在账号保存时按当时规则生成快照；订单租金 `coinRent`、号主应付在 `POST /orders` 时由服务端按账号报价 + 熟客规则计算；`deposit` / `extraFee` 是客服录入值（服务端取整、熟客免押时押金强制为 0）；`totalAmount = coinRent + extraFee + deposit` 由服务端算 |
| 回收估值（中心价、区间、参考成交） | **服务端** | 回收单保存提交时的估值快照（含规则版本），改规则不影响历史单 |
| 号主到手、号主应付、押金余额、回本进度、报表、看板 | **服务端** | |
| 批量导入校验 | **服务端** | 前端用同一套规则做即时预览（红色标错），提交后服务端以当前库存**重新逐行校验**，以服务端结果为准；同一文件重复提交 → 全部判为与库存重复 |
| 权限、字段裁剪、状态流转、编号生成 | **服务端** | |
| 前端 | 仅预览 | `src/domain/*` 是参考实现：`pricing.ts`、`valuation.ts`、`importAccounts.ts`、`reports.ts`；`tests/pricing.test.ts`、`tests/valuation.test.ts`、`tests/import.test.ts` 里的 PRD 例题与边界用例是后端必须同样通过的“金标准” |

规则保存（`PUT /rules/pricing|valuation`）：请求 `{rule, summary}`，`rule.version` 必须等于当前版本（乐观锁，否则 409 `VERSION_CONFLICT`），成功后版本 +1 并记 `RuleVersionMeta`（保存人、时间、说明）。旧账号报价快照不自动重算（第 12 节第 4 条）：登记订单的租金、号主应付、熟客免押都按**账号报价的 `ruleVersion` 那一版规则**算（mock 已改为保存每版规则快照）；建议订单与 `/orders/preview` 回 `ruleVersion`（提议字段），前端在有值时展示“计价规则 vN”，库存列表展示报价版本并标出落后于当前规则的账号。`/rules/*/trial` 用未保存的规则试算，不落库，必须与正式计算走同一实现。

## 7. 上传（资产截图）

1. `POST /api/uploads`，`multipart/form-data`，字段名 `file`。只收 `image/png|jpeg|webp`，≤ 1 MB，**以服务端嗅探的真实类型为准**；去掉 EXIF。角色：owner（上架）、ops、admin。
2. 返回 `Attachment { id, name, url, mime, size, uploadedBy, at }`（201）。
3. 保存账号时通过 `attachmentIds` 绑定：`POST/PUT /accounts` 的 `AccountWrite.attachmentIds`、`POST /owner/listings` 的 `attachmentIds`；最多 5 个，顺序即展示顺序；`PUT` 省略该字段 = 截图不变。只能绑定**自己上传且未绑定**的 id，或该账号已有的 id。24 小时未绑定的上传可清理。
4. `url` 必须能直接放进 `<img src>`（浏览器不会带 Bearer 头）：建议返回**带签名和过期时间**的地址（如 `/api/uploads/{id}/content?exp=…&sig=…`，或 OSS 私有 Bucket 的签名 URL），有效期 1 小时（第 12 节第 2 条）；列表接口每次返回新签名。号主只能拿到自己账号的截图 URL。过期返回 403（`URL_EXPIRED` 或 `FORBIDDEN`）。
   - 提议：`Attachment.expiresAt`（签名到期时间）与 `GET /uploads/{id}`（重签单个附件）。前端在到期前 2 分钟或图片加载失败时先调 `GET /uploads/{id}`；未实现（404 / 501）时重新拉取所在资源（账号详情 / 库存行）拿新签名，同一张图 30 秒内最多续一次，避免循环。
5. 前端（HttpApi）负责：把新选的图片先上传换 id，再保存账号；响应里的 `url` 映射到前端字段 `dataUrl`（历史命名，仅作显示地址）。

## 8. 批量导入

- `GET /api/accounts/import/context`：字典（大区、上号方式、渠道、周期、段位、保险格、体力、负重、皮肤）+ 已占用编号（含已删除），前端用于预览。
- `POST /api/accounts/import`：`{ fileName, rows, dryRun? }`。`rows` 是前端用 SheetJS 读出的二维数组（第 0 行为表头，**下标 + 1 = Excel 行号**，空行保留）；列名见模板（允许带 `*`、全角括号、调换顺序）。后端**不需要解析 xlsx**。
- 服务端逐行校验（必填、条件必填、数字 / 整数 / 是否 / 枚举 / 皮肤字典 / 编号格式、文件内重复、与库存重复、跨字段规则），合法行**一次性**以 `status=draft` 入库（同一事务），非法行跳过；返回 `ImportOutcome { imported: [accountNo], skipped: [{rowNo, accountNo, errors}], operator }`；`dryRun=true` 只返回 `ImportPreview` 不入库。
- 文件级错误（缺必填列 / 空 / >500 行）→ 422 `IMPORT_INVALID_FILE`。写一条操作日志「批量导入」：文件名、导入条数与编号、跳过行号。

## 9. 操作日志

`GET /api/audit-logs`（仅 admin，新→旧，只增不改）：`{ at, actor, action, summary }`。至少记录（与 mock 一致）：
`新增账号 编辑账号 删除账号 账号状态 批量导入 号主上架 登记订单 拦截黑名单 回收提交 回收跟进 回收入库 计价规则 估值依据 租客标签 员工启停`；建议再加登录成功 / 失败、付号主款、押金扣除、订单取消。

## 10. 接口一览

| 方法 | 路径 | 前端方法 | 说明 |
|---|---|---|---|
| GET | /meta | `init()` | 版本、`demo` 开关（生产必须 false）、演示账号 |
| POST | /auth/login · /auth/logout | `login` · `logout` | |
| GET | /auth/me | `init()` | |
| GET | /lobby/accounts · /lobby/accounts/{id} | `listListedAccounts` · `getAccount` | 仅 listed；按角色裁剪 |
| GET | /pricing/options | `pricingOptions` | |
| POST | /pricing/quote · /valuation/quote | `calcPricing` · `calcValuation` | |
| GET | /cs-agents · /cs-agents/current | `listCsAgents` · `currentCsAgent` | |
| POST · GET | /recycles | `submitRecycle` · `listRecycles` | |
| GET | /recycles/mine | `myRecycles` | |
| POST | /recycles/{id}/transitions · /recycles/{id}/to-inventory | `updateRecycle` · `recycleToInventory` | |
| GET | /owner/accounts · /owner/accounts/{id} · /owner/accounts/{id}/recycle-draft | `ownerAccounts` · `ownerAccount` · `ownerRecycleDraft` | |
| POST | /owner/estimate · /owner/listings | `ownerEstimate` · `ownerSubmitListing` | |
| GET · POST | /accounts | `listAccounts` · `saveAccount`(新建) | |
| PUT · DELETE | /accounts/{id} | `saveAccount`(编辑) · `deleteAccount` | |
| POST | /accounts/{id}/status | `setAccountStatus` | |
| GET · POST | /accounts/import/context · /accounts/import | `importContext` · `importAccounts` | |
| POST | /uploads | 内部（保存账号 / 上架前） | |
| GET · POST | /orders | `listOrders` · `createOrder` | |
| POST | /orders/preview | `previewOrder` | |
| GET | /orders/{id} | `getOrder` | 订单详情抽屉使用（已去掉 `x-client-unused`） |
| POST | /orders/{id}/handover · extend · end · return · deposits · owner-payments · complete · cancel | `markHandover` · `extendOrder` · `endOrder` · `markReturned` · `addDepositEntry` · `payOwner` · `completeOrder` · `cancelOrder` | |
| GET | /payables | `listPayables` | `ownerId`；`orderId`（提议参数，未支持时前端本地按订单过滤） |
| GET · POST | /renters | `renterProfiles` · `saveRenter`(upsert) | |
| GET | /renters/lookup?contact= · /owners | `lookupRenter` · `ownerProfiles` | |
| GET · PUT | /rules/pricing · /rules/valuation | `get/savePricingRule` · `get/saveValuationRule` | |
| GET | /rules/versions | `ruleHistory` | |
| POST | /rules/pricing/trial · /rules/valuation/trial | `trialPricing` · `trialValuation` | |
| GET | /reports?from&to&dimension · /dashboard | `report` · `dashboard` | |
| GET · PATCH | /staff · /staff/{username} | `listUsers` · `setUserEnabled` | 用户行带 `ownerId` |
| GET | /audit-logs | `auditLogs` | |
| POST | /demo/reset | `resetDemo` | 仅演示环境，生产 404 |

请求 / 响应字段见 openapi.yaml 的 `components.schemas`，名称与 `src/domain/types.ts` 一致。

### 10.1 前端提议（`x-status: proposed`，后端暂未实现，不阻塞首版）

| 方法 | 路径 / 字段 | 前端方法 | 为什么要 | 未实现时前端怎么做 |
|---|---|---|---|---|
| GET | /dicts | `getDicts` | 所有登录角色都要字典（大区、段位、皮肤…）；第 12 节第 6 条说走 `/accounts/import/context`，但它只对 ops / admin 开放，客服、号主、会员拿不到 | ops / admin 退回 `import/context`，其他角色用前端内置字典 |
| GET | /uploads/{id} | `refreshAttachment` | 1 小时签名过期后只重签一张图，不必重拉整个资源 | 重新拉取所在资源 |
| POST | /staff | `createUser` | 第 12 节第 5 条：管理员在员工管理里新建号主登录并选号主档案（1:1）。**后端已就是否新增该接口询问用户，待确认** | 员工页“新建用户”表单显示“后端暂未支持新建用户”，创建按钮禁用 |
| POST | /staff/{username}/password | （无界面入口） | 重置密码并吊销旧令牌 | 无 |
| 字段 | `RentalOrder.ruleVersion`、`OrderPreview.ruleVersion` | | 订单记录按哪版规则计价 | 不显示“计价规则”一行 |
| 字段 | `Attachment.expiresAt` | | 到期前主动续签 | 图片加载失败时再续 |
| 参数 | `GET /payables?orderId=` | `listPayables` | 订单详情只拉本单台账 | 前端本地过滤 |


## 11. 联调与验证

- 本地：`npm run fake-api`（契约参考假后端，:8080，内存数据，`FAKE_DEMO=0` 关闭演示开关，`FAKE_PROPOSED=0` 模拟未实现提议项的后端，`FAKE_ADMIN_ONLY=1` 只留管理员）+ `npm run dev:http`（Vite 把 `/api` 代理到 `VITE_API_PROXY`，默认 `http://localhost:8080`）。真实后端起在 8080 时直接 `npm run dev:http` 即可。
- 契约测试：`npm run test:contract`。它检查：每个前端方法打到契约里的方法 + 路径、查询参数已声明、请求体与响应都通过 openapi schema 校验、契约里每个操作都被客户端用到、号主响应深度扫描无禁用字段、错误 / 401 / 超时 / 网络错误映射、幂等重放与 409 `DUPLICATE`、签名地址过期。`tests/contract/fakeBackend.ts` 的路由表同时就是一份可执行的“参考语义”。
- 对真实后端跑契约测试：先起后端 `cd backend && cp .env.example .env && docker compose up -d --build`，再 `CONTRACT_BASE_URL=http://127.0.0.1:3000 npm run test:contract`（自动补 `/api`，不再启动内存假后端）。可选 `CONTRACT_ADMIN_USER` / `CONTRACT_ADMIN_PASSWORD`（默认 `admin` / 演示密码）；`CONTRACT_ALLOW_RESET=1` 才会调用 `/demo/reset`。用例通过 API 自建数据（带随机后缀，可重复跑）；依赖演示账号或提议接口的用例会跳过并打印原因，提议项缺失只作提示、不算失败。**会写入测试数据，请指向开发库。**
- 后端回归建议：后端用 openapi.yaml 做响应校验中间件（或 schemathesis 之类工具），并把 `tests/pricing|valuation|import.test.ts` 的用例移植过去。

## 12. 已确认的决定

1. **鉴权**：不透明 Bearer 令牌（≥128 位随机，服务端只存 SHA-256）。12 小时滑动续期，绝对最长 7 天。退出、停用用户立即吊销该用户全部令牌。不用 JWT，也不下发 Cookie。无效或过期 → 401 `UNAUTHENTICATED`。登录失败统一 `401 INVALID_CREDENTIALS`；停用账号登录 `403 USER_DISABLED`。
2. **截图**：存在本机磁盘（compose 卷 `uploads`）。`url` 为 HMAC 签名地址 `/api/uploads/{id}/content?exp=&sig=`，有效期 1 小时，列表接口每次重签。`<img>` 不带 Authorization。号主只能把**自己上传且未绑定**的 id，或该账号已有的 id，绑到自己的号。
3. **分页**：首版就做服务端分页。`page` / `pageSize`（默认 50，最大 200，超出按 200）。前端可以继续用 `pageSize=200` 翻页拉全量。
4. **改规则不自动重算**已有库存报价。每条报价快照保留自己的 `ruleVersion`。不提供批量重算接口（留给以后单独做）。
5. **号主登录**：用户行带 `ownerId`，与号主档案 1:1（种子里 owner1↔ow1、owner2↔ow2）。`GET /staff` 返回该字段。契约目前只有启用 / 停用，没有新建用户或重置密码的操作，因此首版不另加接口；要做新建需先补 openapi。
6. **字典与客服排班**：只读。字典走 `GET /accounts/import/context` 与 `GET /pricing/options`，排班走 `GET /cs-agents`。管理接口以后再加。
7. **幂等**：`POST /orders`、`POST /accounts/import`、`POST /orders/{id}/owner-payments` 接受可选请求头 `Idempotency-Key`。同一用户、同一路径、同一请求体在 24 小时内重放当时的响应；同一把钥匙配不同请求体 → 409 `DUPLICATE`。
8. **租金与租期（产品已确认，沿用演示 / PRD 第 7 章）**：租金按纯币和比例计算，**天数不参与金额**。默认天数 = `max(1, floor(纯币 M / 周期字典的 M/天))`；固定天数模式下周期值就是天数。租客应付 = 折后租金 + 附加服务费（默认 0）；总金额 = 应付 + 押金。号主到手 = 折后租金 − 折后租金 × 渠道费率。登记订单时租期、押金、附加费由客服填写（默认带出账号报价，可改）；`coinRent` / `ownerPayable` 由服务端按账号报价锁定。改租期只改 `endAt`，不重算租金。熟客折扣与系统档取更优（`regularMode=best`，可配置为叠乘），熟客免押时押金强制为 0。
9. **导入上限**：500 行、请求体 5 MB。超过 → 422 `IMPORT_INVALID_FILE` 或 413 `PAYLOAD_TOO_LARGE`。
10. **`GET /orders/{id}`** 已实现（`x-client-unused`），返回与列表相同的订单视图（含 events、deposits、reminder、ownerPayableBalance）。
