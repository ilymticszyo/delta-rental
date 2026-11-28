/** 前台（号主 / 成员）登录开关。生产构建（.env.server）默认关闭；mock / GitHub Pages 保持开启。 */
export const ENABLE_FRONT_LOGIN = import.meta.env.VITE_ENABLE_FRONT_LOGIN !== 'false'
