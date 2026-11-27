import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// 模式：
//   默认（development / production）：VITE_API_MODE=mock，浏览器本地演示数据（GitHub Pages 用它）
//   --mode server：读取 .env.server → VITE_API_MODE=http，调用同域 /api（npm run build:prod / dev:http）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY || 'http://localhost:8080'
  const proxy = { '/api': { target: proxyTarget, changeOrigin: true } }
  return {
    // 哈希路由 + 相对 base：同一份 dist 可放在域名根目录或任意子路径，服务器无需改写规则
    base: './',
    plugins: [vue()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { proxy },
    preview: { proxy },
    build: { chunkSizeWarningLimit: 2000 },
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  } as any
})
