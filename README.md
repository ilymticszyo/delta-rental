# 三角洲行动 · 账号租赁与回收估值系统（v0.2 演示版）

纯前端演示（Vue 3 + Vite + TypeScript + Element Plus），数据存在浏览器 localStorage，按 PRD v1.2 实现。
所有数据读写都经过 `src/api`（`Api` 接口 → `LocalApi` 模拟后端，负责权限校验与按角色裁剪字段），后续接真实后端只需替换实现。

## 演示账号（登录页点表格行即可填入；页头「切换演示角色」随时切换）

| 角色 | 账号 / 密码 | 入口 | 能看到什么 |
|---|---|---|---|
| 号主 | owner1 / owner123（王老板）、owner2 / owner123（李老板） | `#/login` → 我的账号 | 仅自己账号的状态、到期时间、到手金额；上架新号；把自己的号转入回收估值。看不到租客、租金、抽成 |
| 内部成员 | demo / demo123 | `#/login` → 账号大厅 | 大厅、算价（只见租客应付部分）、回收估值、客服 |
| 客服 | cs / cs123 | `#/admin/login` | 看板、订单全流程、号主应付、回收、租客 / 号主档案、报表；库存只读；无规则 / 员工 / 日志 |
| 运营 | ops / ops123 | `#/admin/login` | 客服权限 + 库存编辑、计价规则与估值依据（版本化） |
| 管理员 | admin / admin123 | `#/admin/login` | 全部，含员工启停、操作日志、号主门户（全部号主） |

数据版本升级（`SEED_VERSION = 2`）后，旧 v0.1 的本地数据会自动重置；后台「重置演示数据」可随时恢复初始数据。

## v0.2 新增（对照 PRD v1.2）

- **号主门户（E1–E4）**：我的账号 / 账号详情（状态、到期、到手、回收进度）；上架新号复用回收估值的资产表单与已有回收单，可上传截图，自动估算到手，提交后为「待确认」由运营人工确认上架；一键「转入回收估值」，成交后原账号转为自收持有。
- **库存来源与回本**：号主寄租 / 自收，自收号成本、累计平台收入、回本进度。
- **回收估值依据**：整体市场系数、保险格系数、近期同类成交参考价（只展示不改中心价），保存即生成新版本，估值单保留当时规则快照；支持试算。
- **订单生命周期**：登记 → 收押金 → 交号 → 续租 / 到期结束 → 归还 → 结算完成 / 取消，全程事件留痕；到期提醒（默认 24 小时内，看板与订单页高亮）。结算完成前必须已经交号并且还号，否则不能把账号放回上架。租期过了仍无人处理的订单会自动变成待结算（账号仍是待结算，不会自动上架）。
- **号主应付台账**：订单登记即计提，登记付款，取消自动冲回；结单要求押金与号主应付都已清零（或填写说明）。
- **C11 经营报表**：出租率、流水、平台收入、单号日均；按保险格 / 段位 / 价位 / 渠道分组；自收号回本周期。
- **C12 轻量客户管理**：租客档案按联系方式识别，标签 熟客 / 慎租 / 黑名单；登记订单时提示，黑名单禁止登记（并记日志），熟客自动带入熟客折扣（取优 / 叠乘可配）与免押金；号主档案。
- **五档权限**：页面路由与菜单按权限显示；接口层按角色裁剪字段（号主拿不到租客 / 租金 / 抽成字段，成员拿不到号主可得 / 服务费）。

- **Excel 批量导入（库存页，仅运营 / 管理员）**：「下载模板」得到 .xlsx（每个账号字段一列 + 示例行 + 「填写说明」表列出可选值）；上传 .xlsx / .csv 后逐行校验，缺必填、格式错误、文件内编号重复、与库存编号重复都标红并给出行号与原因；确认后合法行一次性入库，非法行跳过。导入的账号一律为「待确认」，运营人工确认后才上架；写操作日志。截图不随表格导入，导入后在账号内单独上传。SheetJS 按需加载，不进主包。客服看不到入口，接口层也会拒绝（403）。

不做：风险预警、站内申诉。

## 开发

两种运行模式，由构建时的 `VITE_API_MODE` 决定（默认 `mock`）：

- **mock**：数据存在浏览器 localStorage，带演示账号。GitHub Pages 演示站用的就是这个模式。
- **http**：请求同域 `/api`，接真实后端。接口契约见 [`docs/api-contract.md`](docs/api-contract.md) 和 [`docs/openapi.yaml`](docs/openapi.yaml)。

```bash
npm ci
npm run dev          # mock 模式开发
npm run fake-api     # 按契约实现的假后端（:8080，内部复用 mock 逻辑）
npm run dev:http     # http 模式开发，/api 代理到 VITE_API_PROXY（默认 http://localhost:8080）
npm test             # 单元测试 + 契约测试（vitest）
npm run test:contract
npm run build        # mock 构建 → dist/（Pages）
npm run build:prod   # http 构建 → dist/（服务器）
npx vite preview --port 4173 &
node scripts/smoke.mjs http://localhost:4173/ shots   # 端到端点击测试（Playwright + 系统 Chrome）
node scripts/e2e-roles.mjs http://localhost:4175/ shots-roles   # 六个角色逐页点遍：页面报错、错误提示、坏图、非预期 4xx/5xx、号主隔离
```

### 对真实后端跑契约测试

默认 `npm run test:contract` 会在进程内起一个内存假后端。设了 `CONTRACT_BASE_URL`，就不起假后端，直接请求该地址（自动补 `/api`）：

```bash
cd backend && cp .env.example .env && docker compose up -d --build && cd ..   # 后端仓库 / 分支里的启动方式
CONTRACT_BASE_URL=http://127.0.0.1:3000 npm run test:contract
```

| 变量 | 作用 |
|---|---|
| `CONTRACT_BASE_URL` | 后端地址，如 `http://127.0.0.1:3000` |
| `CONTRACT_ADMIN_USER` / `CONTRACT_ADMIN_PASSWORD` | 管理员账号，默认 `admin` / `admin123` |
| `CONTRACT_ALLOW_RESET=1` | 允许调用 `/demo/reset`（会清空数据），默认跳过 |

- 用例通过 API 自建数据（编号、联系方式带随机后缀），可重复跑。**会写入测试数据，请指向开发库，不要指向生产。**
- 依赖演示账号（owner1、cs 等）或提议接口（`x-status: proposed`）的用例，条件不满足时跳过并打印原因；提议字段缺失只作提示，不算失败。
- 没有 Docker 时，可以用假后端模拟外部服务：`PORT=8091 npm run fake-api &` 再 `CONTRACT_BASE_URL=http://127.0.0.1:8091 npm run test:contract`。假后端加 `FAKE_PROPOSED=0 FAKE_ADMIN_ONLY=1 FAKE_DEMO=0` 时，表现接近尚未实现提议项、也没有演示账号的后端。

环境变量见 `.env.example`。服务器部署（1Panel / OpenResty / Docker / HTTPS）见 [`deploy/README.md`](deploy/README.md)。

## 已知不足

字典管理、客服排班编辑、站点设置、新建员工未做；截图以 data URL 存在 localStorage（演示用，容量有限）；大厅快捷筛选固定；保存新规则后已有账号需逐个编辑才会重算报价；移动端未专门适配；打包体积偏大（Element Plus 全量引入）。
