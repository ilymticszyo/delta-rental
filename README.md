# 三角洲行动 · 账号出租与回收估值系统（初始版本）

内部使用的《三角洲行动》账号出租与回收估值站点，依据 PRD v1.1 做的**初始可用版本**（先跑通，后打磨）。

- 在线地址：https://ilymticszyo.github.io/delta-rental/
- 技术栈：Vue 3 + Vite + TypeScript + Element Plus，桌面优先，Hash 路由
- 当前为**纯前端**：演示数据保存在浏览器 localStorage，后台「重置演示数据」可恢复初始

## 演示账号

| 入口 | 地址 | 账号 / 密码 |
| --- | --- | --- |
| 前台（成员） | `#/login` | `demo` / `demo123` |
| 后台（管理员） | `#/admin/login` | `admin` / `admin123` |

## 已做页面

前台（需登录）：账号大厅（组合筛选、快捷筛选、排序、表格 / 卡片视图、复制编号、联系客服下单）、账号详情、出租算价（可一键复制算价信息）、回收估值（参考区间 + 生成回收单 + 我的回收单）、客服中心（按排班自动匹配二维码）。

后台（`#/admin`）：看板、账号库存（增删改、状态操作、粘贴算价文本预填）、出租订单（登记锁定账号、到期、押金流水、结算、取消）、回收申请（筛选、跟进、改报价、人工确认后成交入库为「已回收持有」）、规则配置（计价规则 / 估值规则 + 试算，保存后版本 +1）、操作日志。

第 13 章默认：前台也需登录；附加服务费默认 0；押金可为 0；回收估值当场展示参考区间并生成工单；算价 / 回收结果人工确认后入库，不自动上架；不做协议页。

## 结构

```
src/config/rules.ts      计价 / 估值规则默认值与选项字典（PRD 第 7 章示例数）
src/domain/              类型、计价 calcPricing、估值 calcValuation（纯函数，有单测）
src/api/types.ts         API 接口（页面只依赖它）
src/api/local.ts         localStorage 实现（模拟后端：算价、状态机、校验、审计）
src/mock/seed.ts         20 个演示账号、客服排班、演示用户
src/views/front|admin    页面
```

接后端：新增 `HttpApi implements Api`（对接 `/app-api`、`/admin-api`），在 `src/api/index.ts` 替换即可。

## 开发

```bash
npm ci
npm run dev        # 本地开发
npm test           # 单元测试（计价、估值、业务流转）
npm run build      # 类型检查 + 构建
node scripts/smoke.mjs http://localhost:4173/ shots   # 端到端冒烟（需先 npm run preview）
```

推送 main 后由 GitHub Actions 测试、构建并发布到 GitHub Pages。
