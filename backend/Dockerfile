FROM node:22-alpine

WORKDIR /app
# Prisma 在 Alpine 上要能找到 libssl，否则 migrate / 查询引擎会按 OpenSSL 1.1 去加载并失败。
RUN apk add --no-cache tini openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=192
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data/uploads

EXPOSE 3000
VOLUME ["/data/uploads"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
