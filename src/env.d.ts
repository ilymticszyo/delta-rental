/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
declare module 'element-plus/dist/locale/zh-cn.mjs'

interface ImportMetaEnv {
  /** mock（默认）| http */
  readonly VITE_API_MODE?: 'mock' | 'http'
  /** http 模式的接口前缀，默认 /api（相对路径，同域） */
  readonly VITE_API_BASE?: string
  /** 前台登录：缺省开启；设为 'false' 时屏蔽前台登录（生产 build:prod 默认关闭） */
  readonly VITE_ENABLE_FRONT_LOGIN?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
declare const __APP_VERSION__: string
