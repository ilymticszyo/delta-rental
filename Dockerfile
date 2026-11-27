# syntax=docker/dockerfile:1
# 多阶段：Node 构建（http 模式，调用同域 /api）→ nginx 静态站 + /api 反代
# 构建：docker build -t delta-rental-web .
# 运行：docker run -d -p 8088:80 -e API_UPSTREAM=http://<后端地址>:8080 delta-rental-web

FROM node:22-alpine AS build
WORKDIR /app
# 国内服务器可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_registry=${NPM_REGISTRY} \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:prod

FROM nginx:1.27-alpine
# 运行时可覆盖：后端地址（不带末尾 /）、截图所在的额外图片域名
ENV API_UPSTREAM=http://backend:8080 \
    CSP_IMG_EXTRA=""
RUN rm -f /etc/nginx/conf.d/default.conf
# 官方镜像启动时把 /etc/nginx/templates/*.template 用环境变量渲染到 /etc/nginx/conf.d/：
#   default.conf.template      → conf.d/default.conf（server 配置）
#   security-headers.inc.template → conf.d/security-headers.inc（不是 .conf，不会被自动加载，只被 include）
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/security-headers.inc /etc/nginx/templates/security-headers.inc.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
