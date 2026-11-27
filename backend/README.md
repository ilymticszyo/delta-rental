# 三角洲行动 · 租赁 / 回收估值后端

Node.js（Express + TypeScript）+ PostgreSQL（Prisma）。业务规则与仓库里的 `src/api/local.ts` 对齐，HTTP 路径都在 `/api` 下。接口对照见 [API.md](./API.md)，Swagger 在 `/api/docs`。

目标机器是阿里云轻量 2 核 / 2 GB、1Panel 镜像。不要把数据库端口暴露到公网。OpenResty 托管前端静态文件，并把 `/api` 反代到本服务。

## 默认账号

种子会创建演示账号。管理员用户名和密码只从环境变量读，默认写在 [`.env.example`](./.env.example)：

| 环境变量 | 默认值 |
|---|---|
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | `admin123` |

同一文件的注释里列出了其余五个演示账号（`owner1` / `owner2` / `demo` / `cs` / `ops`）。密码以 bcrypt 存在数据库里，接口响应不返回密码或哈希。

`ENABLE_DEMO_ACCOUNTS=true` 时，登录页可以调 `GET /api/auth/demo-accounts` 拿到明文密码（和现有演示站一样）。**上生产前把它和 `ENABLE_DEMO_RESET` 都改成 `false`。**

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

API 文档：<http://127.0.0.1:3000/api/docs>

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
| `JWT_SECRET` | JWT 签名密钥。生产至少 16 位 |
| `JWT_EXPIRES_IN` | 默认 `7d`。同时决定 cookie 的 Max-Age |
| `COOKIE_SECURE` | HTTPS 站点设 `true` |
| `PORT` | 默认 `3000` |
| `UPLOAD_DIR` | 截图目录。容器内为 `/data/uploads` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 初始管理员。见上文 |
| `ENABLE_DEMO_ACCOUNTS` | 是否公开演示账号密码。生产 `false` |
| `ENABLE_DEMO_RESET` | 是否允许 `POST /api/admin/reset-demo`。生产 `false` |
| `CORS_ORIGIN` | 逗号分隔的前端源。同域反代留空 |
| `NODE_OPTIONS` | 建议 `--max-old-space-size=192` |

登录成功时响应体是 `User`（不含 token）。JWT 在响应头 `X-Auth-Token`，同时写入 httpOnly cookie `token`。之后请求带 `Authorization: Bearer <token>`，或同域自动带 cookie。截图 `<img src="/api/uploads/...">` 依赖这个 cookie。

停用员工后，旧 JWT 在下一次请求会被拒绝。退出登录只清 cookie，不能作废已经发出去的 JWT，它会在过期前一直有效，除非账号被停用。

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
