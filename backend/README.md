# 三角洲行动 · 租赁 / 回收估值后端

Node.js（Express + TypeScript）+ PostgreSQL（Prisma）。接口以仓库里的 [`docs/api-contract.md`](../docs/api-contract.md) 和 [`docs/openapi.yaml`](../docs/openapi.yaml) 为准，路径都在同域 `/api` 下。

目标机器是阿里云轻量 2 核 / 2 GB、1Panel 镜像。不要把数据库端口暴露到公网。OpenResty 托管前端静态文件，并把 `/api` 反代到本服务。

## 默认账号

种子会创建演示账号。管理员用户名和密码只从环境变量读，默认写在 [`.env.example`](./.env.example)：

| 环境变量 | 默认值 |
|---|---|
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | `admin123` |

同一文件的注释里列出了其余五个演示账号（`owner1` / `owner2` / `demo` / `cs` / `ops`）。密码以 bcrypt 存在数据库里，接口响应不返回密码或哈希。

`DEMO=true` 时，`GET /api/meta` 会带上演示账号明文密码。**上生产前把它和 `ENABLE_DEMO_RESET` 都改成 `false`。**

改了 `ADMIN_PASSWORD` 之后，只有重新播种才会生效：`npm run seed:force`（会清空业务数据）。

## 本地开发

需要 Node 22 和本机可连的 PostgreSQL 16。

```bash
cd backend
cp .env.example .env
# 本机直连数据库时，把 DATABASE_URL 里的 @db 改成 @127.0.0.1
npm ci
npx prisma migrate deploy
npm run dev
```

`npm run dev` 会在空库上自动播种。常用命令：

```bash
npm test          # 计价、估值、权限与订单（不连数据库）
npm run build
npm run seed      # 仅空库播种
npm run seed:force
```

契约：`docs/openapi.yaml`（59 个操作）。本地健康检查：<http://127.0.0.1:3000/api/meta>

## Docker Compose

在 2 GB 机器上建议先加一点 swap，再构建镜像。Postgres 限制约 320 MB，API 限制约 384 MB，Node 堆上限 192 MB，连接池 5。

```bash
cd backend
cp .env.example .env
# 至少改 JWT_SECRET。DATABASE_URL 在 compose 里会被覆盖成主机名 db，不用改。
docker compose up -d --build
```

- API：`127.0.0.1:3000`（健康检查 `GET /api/health`）
- Postgres：`127.0.0.1:5432`，数据卷 `pgdata`
- 截图：卷 `uploads`，容器内 `/data/uploads`

```bash
node scripts/smoke.mjs http://127.0.0.1:3000
```

只起数据库、本机跑 Node 时：

```bash
docker compose up -d db
# .env 的 DATABASE_URL 使用 127.0.0.1
npm run dev
```

## 环境变量

| 变量 | 作用 |
|---|---|
| `DATABASE_URL` | Postgres 连接串。请带 `connection_limit=5&pool_timeout=10` |
| `JWT_SECRET` | 截图 URL 的 HMAC 密钥。生产至少 16 位 |
| `SESSION_SLIDE_HOURS` | 令牌滑动续期，默认 12 |
| `SESSION_ABSOLUTE_DAYS` | 令牌绝对最长天数，默认 7 |
| `PORT` | 默认 `3000` |
| `UPLOAD_DIR` | 截图目录。容器内为 `/data/uploads` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初始管理员。见上文 |
| `DEMO` | 是否在 `GET /api/meta` 返回演示账号。生产 `false`。也认 `ENABLE_DEMO_ACCOUNTS` |
| `ENABLE_DEMO_RESET` | 是否允许 `POST /api/demo/reset`。生产 `false` |
| `NODE_OPTIONS` | 建议 `--max-old-space-size=192` |

登录 `POST /api/auth/login` 返回 `{ token, expiresAt, user }`。`token` 是 48 位十六进制不透明串，服务端只存 SHA-256。之后请求带 `Authorization: Bearer <token>`。同域部署，不启用 CORS。

令牌 12 小时滑动续期，绝对最长 7 天（`SESSION_SLIDE_HOURS`、`SESSION_ABSOLUTE_DAYS`）。退出或停用用户会立刻吊销该用户的全部令牌。截图地址是 1 小时有效的 HMAC 签名 URL，`<img>` 不需要带 Authorization。

`GET /api/meta` 免登录，返回 `{ version, demo, serverTime, demoAccounts? }`。`demo` 由 `DEMO`（或兼容旧名 `ENABLE_DEMO_ACCOUNTS`）控制。

## 部署（1Panel / OpenResty）

1. 在服务器上 `cd backend && docker compose up -d --build`。API 只监听 `127.0.0.1:3000`。
2. 把前端 `npm run build` 的 `dist` 放到站点根目录。
3. 把 [`deploy/openresty-api.conf`](./deploy/openresty-api.conf) 里的两个 `location` 放进站点 server。`client_max_body_size 8m`，和后端 JSON 上限一致。单张截图业务上仍限制 1 MB。
4. 安全组不要放行 3000 和 5432。

1Panel 的 OpenResty 如果跑在 Docker 里，访问不到宿主机的 `127.0.0.1`。把反代改成宿主机网桥地址（常见是 `http://172.17.0.1:3000`），并把 compose 里 api 的端口改成 `"3000:3000"`，同时继续用安全组挡住公网访问 3000。

规则每次保存都会生成新版本并留下快照。订单和估值单上的 `ruleVersion` 是计算当时的生效版本。历史正文在 `GET /api/admin/rules/pricing/versions/:version` 和估值对应路径。`ruleHistory()` 仍然只返回元数据，和前端类型一致。

## 测试

```bash
npm test
node scripts/smoke.mjs http://127.0.0.1:3000
```

`npm test` 覆盖计价、回收估值、五档权限、订单 / 押金 / 号主应付、规则版本和 Excel 行导入。冒烟脚本打在真实 HTTP 上，会写一条订单（随后取消）、一张截图和一条导入账号。
