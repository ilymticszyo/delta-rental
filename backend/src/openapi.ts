/** OpenAPI 3 文档。字段级说明以 API.md 与领域类型为准。 */
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: '三角洲行动 · 账号租赁与回收估值 API',
    version: '1.0.0',
    description: '与前端 `src/api` 的 `Api` 接口一一对应。除特别说明外，成功响应体就是该函数的返回值。错误体为 `{ message, code }`，HTTP 状态与 `code` 相同。',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'auth', description: '登录与会话' },
    { name: 'front', description: '前台大厅、算价、估值、客服' },
    { name: 'owner', description: '号主门户' },
    { name: 'inventory', description: '库存与导入' },
    { name: 'orders', description: '订单、押金、号主应付' },
    { name: 'profiles', description: '租客 / 号主档案' },
    { name: 'recycles', description: '回收单' },
    { name: 'rules', description: '计价与估值规则（版本化）' },
    { name: 'reports', description: '报表、看板、员工、日志' },
    { name: 'uploads', description: '截图' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { message: { type: 'string' }, code: { type: 'integer' } },
        required: ['message', 'code'],
      },
      User: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          displayName: { type: 'string' },
          role: { type: 'string', enum: ['owner', 'member', 'cs', 'ops', 'admin'] },
          ownerId: { type: 'string' },
        },
        required: ['username', 'displayName', 'role'],
      },
      Ok: { type: 'object', properties: { ok: { type: 'boolean' } } },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {
    '/api/health': { get: op('reports', '健康检查', false, '数据库连通时返回 { ok: true }。') },
    '/api/auth/login': {
      post: op('auth', 'login', false, '校验用户名密码，响应体为 User。JWT 在响应头 X-Auth-Token，并写入 httpOnly cookie `token`。', {
        requestBody: jsonBody({ type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } }),
        responses: { '200': { description: 'User', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, '401': err(), '403': err(), '429': err() },
      }),
    },
    '/api/auth/logout': { post: op('auth', 'logout', false, '清除 cookie。JWT 无状态，停用账号后下一次请求即失效。') },
    '/api/auth/me': { get: op('auth', 'currentUser', true, '已登录返回 User，未登录返回 null。') },
    '/api/auth/demo-accounts': { get: op('auth', 'demoAccounts', false, '演示账号列表。ENABLE_DEMO_ACCOUNTS=false 时返回空数组。生产环境应关闭。') },
    '/api/lobby/accounts': { get: op('front', 'listListedAccounts', true, '在架账号，按角色裁剪字段。') },
    '/api/lobby/accounts/{id}': { get: op('front', 'getAccount', true, '不存在或无权查看时返回 null。', { parameters: [pathParam('id')] }) },
    '/api/pricing/calc': { post: op('front', 'calcPricing', true, '按当前生效计价规则计算，并按角色裁剪。熟客由服务端按租客档案判定。', { requestBody: jsonBody({ type: 'object', description: 'PricingInput' }) }) },
    '/api/valuation/calc': { post: op('front', 'calcValuation', true, '按当前生效估值规则计算。', { requestBody: jsonBody({ type: 'object', description: 'ValuationInput' }) }) },
    '/api/recycles': { post: op('front', 'submitRecycle', true, '请求体为 ValuationInput，可额外带 sourceAccountId。也接受 { input, sourceAccountId }。', { requestBody: jsonBody({ type: 'object' }) }) },
    '/api/recycles/mine': { get: op('front', 'myRecycles', true, '当前用户提交的回收单。') },
    '/api/cs/current': { get: op('front', 'currentCsAgent', true, '按排班返回当前客服，无人值班时返回备用。查询参数 now 为 ISO 时间。', { parameters: [queryParam('now', 'ISO 时间，可选')] }) },
    '/api/cs/agents': { get: op('front', 'listCsAgents', true, '全部客服排班。') },
    '/api/owner/accounts': { get: op('owner', 'ownerAccounts', true, '号主只看自己的号；管理员可看全部寄租号。') },
    '/api/owner/accounts/{id}': { get: op('owner', 'ownerAccount', true, '越权返回 404。', { parameters: [pathParam('id')] }) },
    '/api/owner/accounts/{id}/recycle-draft': { get: op('owner', 'ownerRecycleDraft', true, '把账号资产预填成估值入参。', { parameters: [pathParam('id')] }) },
    '/api/owner/estimate': { post: op('owner', 'ownerEstimate', true, '估算寄租到手。请求体 { asset } 或直接 ValuationInput。需要 ownerPortal（管理员没有该能力）。', { requestBody: jsonBody({ type: 'object' }) }) },
    '/api/owner/listings': { post: op('owner', 'ownerSubmitListing', true, '号主提交上架，状态为待确认。attachments[].dataUrl 可以是 data URL 或 /api/uploads/:id。', { requestBody: jsonBody({ type: 'object', description: 'OwnerListingInput' }) }) },
    '/api/admin/accounts': {
      get: op('inventory', 'listAccounts', true, '后台库存，含累计收入与回本进度。'),
      post: op('inventory', 'saveAccount', true, '无 id 为新增，有 id 为编辑。状态变更请走状态接口。', { requestBody: jsonBody({ type: 'object', description: 'AccountInput' }) }),
    },
    '/api/admin/accounts/import/context': { get: op('inventory', 'importContext', true, '导入校验字典与已有编号。') },
    '/api/admin/accounts/import': { post: op('inventory', 'importAccounts', true, '请求体 { aoa, fileName }。合法行以待确认入库。', { requestBody: jsonBody({ type: 'object', required: ['aoa', 'fileName'], properties: { aoa: { type: 'array' }, fileName: { type: 'string' } } }) }) },
    '/api/admin/accounts/import/xlsx': { post: op('inventory', 'importAccounts', true, '额外入口：multipart 字段 file，.xlsx 或 .csv。与 JSON aoa 入口同一套校验。') },
    '/api/admin/accounts/{id}': { delete: op('inventory', 'deleteAccount', true, '逻辑删除。租赁中 / 待结算不可删。', { parameters: [pathParam('id')] }) },
    '/api/admin/accounts/{id}/status': { post: op('inventory', 'setAccountStatus', true, '手工状态流转。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object', required: ['status'], properties: { status: { type: 'string' } } }) }) },
    '/api/admin/orders': {
      get: op('orders', 'listOrders', true, '含 reminder 与本单号主应付余额。'),
      post: op('orders', 'createOrder', true, '登记订单。黑名单拒绝并记日志。租金按当前规则重算。', { requestBody: jsonBody({ type: 'object', description: 'OrderInput' }) }),
    },
    '/api/admin/orders/preview': { post: op('orders', 'previewOrder', true, '{ accountId, renterContact }。', { requestBody: jsonBody({ type: 'object', required: ['accountId', 'renterContact'], properties: { accountId: { type: 'string' }, renterContact: { type: 'string' } } }) }) },
    '/api/admin/orders/{id}/handover': { post: op('orders', 'markHandover', true, '{ note? }', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/extend': { post: op('orders', 'extendOrder', true, '{ rentalDays, note? }', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/end': { post: op('orders', 'endOrder', true, '租赁中 → 待结算。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/returned': { post: op('orders', 'markReturned', true, '待结算后登记还号。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/deposits': { post: op('orders', 'addDepositEntry', true, '{ type: collect|deduct|refund, amount, reason }', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/pay-owner': { post: op('orders', 'payOwner', true, '{ amount, note }', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/complete': { post: op('orders', 'completeOrder', true, '{ relist, note? }。押金或号主应付未清零时必须填说明。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/orders/{id}/cancel': { post: op('orders', 'cancelOrder', true, '未交号才可取消，自动冲销应付并退押金余额。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/payables': { get: op('orders', 'listPayables', true, '查询参数 ownerId 可选。', { parameters: [queryParam('ownerId', '号主 id，可选')] }) },
    '/api/admin/renters': {
      get: op('profiles', 'renterProfiles', true, '租客档案，统计字段由订单汇总。'),
      post: op('profiles', 'saveRenter', true, '{ contact, displayName, tag, note }。tag 为 regular / caution / blacklist / null。', { requestBody: jsonBody({ type: 'object' }) }),
    },
    '/api/admin/renters/lookup': { get: op('profiles', 'lookupRenter', true, '没有档案且没有订单时返回 null。', { parameters: [queryParam('contact', '联系方式')] }) },
    '/api/admin/owners': { get: op('profiles', 'ownerProfiles', true, '号主档案与应付余额。') },
    '/api/admin/recycles': { get: op('recycles', 'listRecycles', true, '全部回收单。') },
    '/api/admin/recycles/{id}': { post: op('recycles', 'updateRecycle', true, '{ toStatus, note, staffPrice? }。成交请走 to-inventory。', { parameters: [pathParam('id')], requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/recycles/{id}/to-inventory': { post: op('recycles', 'recycleToInventory', true, '已报价的单成交入库，或把号主账号转为自收持有。', { parameters: [pathParam('id')] }) },
    '/api/admin/rules/pricing': {
      get: op('rules', 'getPricingRule', true, '任意已登录用户可读（前台算价页需要周期 / 渠道）。含服务费率。'),
      put: op('rules', 'savePricingRule', true, '{ rule, summary? }。版本号由服务端 +1，并保存快照。', { requestBody: jsonBody({ type: 'object' }) }),
    },
    '/api/admin/rules/valuation': {
      get: op('rules', 'getValuationRule', true, '需要 rulesEdit。'),
      put: op('rules', 'saveValuationRule', true, '{ rule, summary? }。', { requestBody: jsonBody({ type: 'object' }) }),
    },
    '/api/admin/rules/history': { get: op('rules', 'ruleHistory', true, '版本元数据，不含规则正文。') },
    '/api/admin/rules/pricing/versions/{version}': { get: op('rules', '（扩展）计价规则快照', true, '按版本取回保存时的完整计价规则。', { parameters: [pathParam('version')] }) },
    '/api/admin/rules/valuation/versions/{version}': { get: op('rules', '（扩展）估值规则快照', true, '按版本取回保存时的完整估值规则。', { parameters: [pathParam('version')] }) },
    '/api/admin/rules/pricing/trial': { post: op('rules', 'trialPricing', true, '{ input, rule }，不落库。', { requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/rules/valuation/trial': { post: op('rules', 'trialValuation', true, '{ input, rule }，不落库。', { requestBody: jsonBody({ type: 'object' }) }) },
    '/api/admin/reports': { get: op('reports', 'report', true, '查询参数 fromMs、toMs、dimension=safeBox|rank|price|channel。', { parameters: [queryParam('fromMs', '起始毫秒'), queryParam('toMs', '结束毫秒'), queryParam('dimension', 'safeBox | rank | price | channel')] }) },
    '/api/admin/dashboard': { get: op('reports', 'dashboard', true, '查询参数 now 可选，ISO 时间。', { parameters: [queryParam('now', 'ISO 时间，可选')] }) },
    '/api/admin/users': { get: op('reports', 'listUsers', true, '员工列表，不含密码。') },
    '/api/admin/users/{username}/enabled': { post: op('reports', 'setUserEnabled', true, '{ enabled }。不能停用自己或最后一个管理员。', { parameters: [pathParam('username')], requestBody: jsonBody({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }) }) },
    '/api/admin/audit': { get: op('reports', 'auditLogs', true, '操作日志，最新在前，最多 800 条。') },
    '/api/admin/reset-demo': { post: op('reports', 'resetDemo', true, '管理员且 ENABLE_DEMO_RESET=true 时重建演示数据。') },
    '/api/uploads': { post: op('uploads', '（扩展）上传截图', true, 'multipart 字段 file，≤1MB，png/jpeg/webp/gif。返回 { id, name, dataUrl, uploadedBy, at }，dataUrl 为 /api/uploads/:id。') },
    '/api/uploads/{id}': { get: op('uploads', '（扩展）读取截图', true, '需登录。浏览器同域请求会带上登录 cookie。', { parameters: [pathParam('id')] }) },
  },
} as const

function op(tag: string, summary: string, auth: boolean, description: string, extra: Record<string, unknown> = {}) {
  return {
    tags: [tag],
    summary,
    description,
    security: auth ? undefined : [],
    responses: { '200': { description: 'OK' }, '400': err(), '401': err(), '403': err(), '404': err() },
    ...extra,
  }
}
function err() {
  return { description: '错误', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
}
function jsonBody(schema: unknown) {
  return { required: true, content: { 'application/json': { schema } } }
}
function pathParam(name: string) {
  return { name, in: 'path', required: true, schema: { type: 'string' } }
}
function queryParam(name: string, description: string) {
  return { name, in: 'query', required: false, description, schema: { type: 'string' } }
}
