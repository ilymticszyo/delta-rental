# 部署说明（阿里云 + 1Panel / OpenResty）

前端是纯静态站（Vue 3 + Vite），生产构建走 **http 模式**：所有请求发往**同域相对路径 `/api`**，由 OpenResty / nginx 反向代理到后端。
前后端同域部署，不需要 CORS，也不需要把后端地址写进前端包里。

| 构建命令 | 模式 | 用途 |
|---|---|---|
| `npm run build` | mock（浏览器 localStorage 假数据，带演示账号） | GitHub Pages 演示站，**保持不变** |
| `npm run build:prod` | http（读 `.env.server`：`VITE_API_MODE=http`、`VITE_API_BASE=/api`） | 服务器部署 |

两种产物都输出到 `dist/`。http 构建里不含 mock 数据库和演示密码；演示账号表、角色切换器、"重置演示数据"按钮只有在后端 `GET /api/meta` 返回 `demo: true` 时才显示。

文件：

- `deploy/nginx.conf`：server 配置（SPA 回退、缓存头、`/api` 反代、gzip、`/healthz`）。其中 `${API_UPSTREAM}`、`${CSP_IMG_EXTRA}` 是占位符。
- `deploy/security-headers.inc`：安全响应头（CSP、nosniff、X-Frame-Options、Referrer-Policy、Permissions-Policy），被 nginx.conf include。
- `Dockerfile` / `.dockerignore`：多阶段镜像（node:22 构建 → nginx:1.27-alpine）。

---

## 路由与路径决定

- **保留哈希路由**（`/#/admin/orders` 这种）。服务器只会收到 `/`、`/index.html` 和 `/assets/*` 的请求，刷新任何页面都不会 404，也不依赖服务器重写规则。nginx.conf 里仍保留 `try_files … /index.html` 作为兜底。
- **Vite `base: './'`**（相对资源路径）。同一份 `dist/` 可以放在域名根 `/`，也可以放在子路径（如 `/rental/`），不需要重新构建。
- `/api` 是**站点根的绝对路径**。如果前端放在子路径、后端也在子路径（如 `/rental/api`），用 `VITE_API_BASE=/rental/api npm run build:prod` 构建，或者在 OpenResty 里把 `/api` 代理在根上。推荐：前端放根路径，后端走 `/api`。

---

## 方案 A：1Panel 静态网站 + 反向代理（推荐，最简单）

1. **本地构建**
   ```bash
   npm ci
   npm test            # 可选：单测 + 契约测试
   npm run build:prod  # 产物在 dist/
   ```
   打包上传：`cd dist && zip -r ../delta-rental-web.zip .`

2. **1Panel 创建网站**：网站 → 创建网站 → **静态网站**，填写主域名（如 `rent.example.com`）。
   1Panel 会在 `/opt/1panel/apps/openresty/openresty/www/sites/<域名>/index` 建好站点目录。

3. **上传文件**：网站 → 该站点 → 网站目录，在 `index` 目录里上传并解压 zip，确保 `index/index.html` 和 `index/assets/` 直接位于站点根目录（不要多一层 `dist/`）。
   以后发新版本只要：清空旧的 `assets/`，覆盖 `index.html` 和新 `assets/`。资源文件名带哈希，用户刷新就能拿到新版本。

4. **配置 /api 反向代理**：网站 → 该站点 → 反向代理 → 创建
   - 名称 `api`，**前端请求路径 `/api`**
   - 后端代理地址：后端服务地址，如 `http://127.0.0.1:8080`。如果后端也是 1Panel 里的容器，就用宿主机端口或容器名。**末尾不要带 `/`**，这样 `/api` 前缀原样转给后端；后端路由本身就是 `/api/...`。
   - 保存后，到"源文"里确认代理块有 `proxy_set_header X-Forwarded-For` 和 `X-Forwarded-Proto`（1Panel 默认会带）。后端要用它们记录真实 IP、判断 https。

5. **补充配置**：网站 → 该站点 → 配置文件，在 `server { … }` 内加入以下内容（对应 `deploy/nginx.conf` 中的配置）：
   ```nginx
   client_max_body_size 6m;   # 截图 ≤1MB、导入 ≤5MB

   location /assets/ {
       try_files $uri =404;
       add_header Cache-Control "public, max-age=31536000, immutable" always;
   }
   location = /index.html {
       add_header Cache-Control "no-cache" always;
   }
   location / {
       try_files $uri $uri/ /index.html;
       add_header Cache-Control "no-cache" always;
   }
   ```
   如果 1Panel 已经生成了 `location /`，就把 `try_files` 和 `Cache-Control` 合并进去，不要重复定义同一个 location。
   安全头：把 `deploy/security-headers.inc` 里的 `add_header` 行复制到 server 块。`${CSP_IMG_EXTRA}` 改成空，或改成截图所在的 OSS 域名。
   注意 nginx 的规则：**location 里只要有一条 `add_header`，就不再继承 server 级的 `add_header`**。所以需要安全头的 location，要么也写上这些行，要么把文件放到服务器上再 `include`（Docker 方案就是这样做的）。
   保存后 1Panel 会先做 `nginx -t` 检查，再 reload。

6. **验证**
   ```bash
   curl -I https://rent.example.com/                    # 200，Cache-Control: no-cache
   curl -I https://rent.example.com/assets/<某个>.js     # Cache-Control: public, max-age=31536000, immutable
   curl -s https://rent.example.com/api/meta            # 后端的 JSON
   ```
   打开 `https://rent.example.com/#/admin/login` 登录后台，打开 `/#/login` 登录号主 / 成员前台。

## 方案 B：Docker 容器（1Panel 容器 / 编排均可）

镜像启动时，官方 nginx 镜像会用环境变量渲染 `/etc/nginx/templates/*.template`：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `API_UPSTREAM` | `http://backend:8080` | 后端地址，**不带末尾 `/`**（保留 `/api` 前缀） |
| `CSP_IMG_EXTRA` | 空 | 截图不在同域时，填图片域名（空格分隔），如 `https://xxx.oss-cn-hangzhou.aliyuncs.com` |

```bash
# 构建（国内服务器建议用 npm 镜像源）
docker build -t delta-rental-web --build-arg NPM_REGISTRY=https://registry.npmmirror.com .

# 运行：后端在宿主机 8080 上
docker run -d --name delta-rental-web --restart unless-stopped \
  -p 127.0.0.1:8088:80 \
  --add-host=host.docker.internal:host-gateway \
  -e API_UPSTREAM=http://host.docker.internal:8080 \
  delta-rental-web

curl -s http://127.0.0.1:8088/healthz      # ok
curl -s http://127.0.0.1:8088/api/meta     # 经容器转发到后端
```

和后端放在同一个 Docker 网络时，直接用容器名，例如 `-e API_UPSTREAM=http://delta-rental-api:8080 --network delta-net`。

**对外入口**：容器只绑定 `127.0.0.1:8088`，再在 1Panel 建一个**反向代理网站**（网站 → 创建网站 → 反向代理，代理到 `http://127.0.0.1:8088`），由 1Panel 的 OpenResty 负责域名和 HTTPS。这时 `/api` 由容器里的 nginx 转发，1Panel 侧不需要再单独配置 `/api`。

构建注意：
- `package-lock.json` 里的 `xlsx` 是从 `https://cdn.sheetjs.com` 下载的 tarball（SheetJS 官方分发，npm 上的旧版本有漏洞）。npm 镜像源不覆盖这个地址，构建机需要能访问它。访问不了的话，可以在本地 `npm run build:prod` 后只打包 nginx 阶段，或者改用方案 A。
- 镜像构建时设置了 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，不会下载测试用的浏览器。
- 健康检查：`/healthz` 返回 `ok`，镜像里配置了 `HEALTHCHECK`。

---

## HTTPS

- **证书**：1Panel → 网站 → 证书 → 申请证书（Let's Encrypt，HTTP-01 需要 80 端口能从公网访问；DNS-01 可以对接阿里云 DNS 的 AccessKey，用 RAM 子账号并只授权 DNS 权限）。也可以上传阿里云 SSL 证书服务签发的证书。申请后开启自动续签。
- **启用**：网站 → 该站点 → HTTPS → 启用，选择证书，**HTTP 选项选"HTTP 自动跳转 HTTPS"**。
- **HSTS**：确认全站 HTTPS 稳定后，再在 1Panel 里开启 HSTS，或手工加 `add_header Strict-Transport-Security "max-age=31536000" always;`。一开始建议设短一些（如 `max-age=86400`），确认无误再加长。不要随意加 `includeSubDomains` 或 `preload`。
- **阿里云安全组**：放行 80 / 443。后端端口（8080）和容器端口（8088）**不要对公网放行**，只允许本机或内网访问。
- **备案**：中国内地服务器用 80 / 443 对外提供网站，域名需要先完成 ICP 备案。
- 后端拿到的是 `X-Forwarded-Proto: https`。后端如果使用 Cookie 或生成绝对链接（如截图的签名 URL），要信任这个头（只信任来自本机代理的请求）。
- 截图签名 URL 必须是 https。否则会触发混合内容警告，同时 CSP `img-src` 也要包含该域名。

---

## 发版检查清单

1. `npm test`（单测 + 契约测试全部通过）
2. `npm run build:prod`
3. 上传 `dist/`（方案 A），或 `docker build` 后重启容器（方案 B）
4. `curl -I` 确认 index.html 是 `no-cache`，assets 是 `immutable`
5. 用浏览器登录后台和前台，走一遍：登记订单 → 交付 → 归还 → 结算

## 本地联调（不部署）

```bash
npm run fake-api                              # 契约里的假后端，端口 8080（FAKE_DEMO=0 关闭演示数据）
npm run dev:http                              # http 模式开发服务器，/api 代理到 VITE_API_PROXY（默认 http://localhost:8080）
VITE_API_PROXY=http://192.168.1.10:8080 npm run dev:http   # 代理到真实后端
```
