import { createRouter, createWebHashHistory } from 'vue-router'
import { api } from './api'
import { can, type Cap } from './domain/permissions'
import type { Role } from './domain/types'
import { ENABLE_FRONT_LOGIN } from './config/frontLogin'

export function homeOf(role: Role) {
  if (role === 'owner') return '/owner/accounts'
  if (role === 'member') return '/accounts'
  return '/admin/dashboard'
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/accounts' },
    ENABLE_FRONT_LOGIN
      ? { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } }
      : { path: '/login', redirect: '/accounts' },
    {
      path: '/',
      component: () => import('./views/front/FrontLayout.vue'),
      meta: { cap: 'front' },
      children: [
        { path: 'accounts', component: () => import('./views/front/Lobby.vue') },
        { path: 'accounts/:id', component: () => import('./views/front/AccountDetail.vue') },
        { path: 'pricing', component: () => import('./views/front/Pricing.vue') },
        { path: 'recycle', component: () => import('./views/front/Recycle.vue') },
        { path: 'contact', component: () => import('./views/front/Contact.vue') },
        { path: 'owner/accounts', component: () => import('./views/owner/OwnerAccounts.vue'), meta: { cap: ['ownerPortal', 'ownerPortalAll'] } },
        { path: 'owner/accounts/:id', component: () => import('./views/owner/OwnerAccountDetail.vue'), meta: { cap: ['ownerPortal', 'ownerPortalAll'] } },
        { path: 'owner/list', component: () => import('./views/owner/OwnerList.vue'), meta: { cap: 'ownerPortal' } },
      ],
    },
    { path: '/admin/login', component: () => import('./views/admin/AdminLogin.vue'), meta: { public: true } },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      meta: { cap: 'adminArea', admin: true },
      children: [
        { path: '', redirect: '/admin/dashboard' },
        { path: 'dashboard', component: () => import('./views/admin/Dashboard.vue'), meta: { cap: 'dashboard' } },
        { path: 'inventory', component: () => import('./views/admin/Inventory.vue'), meta: { cap: 'inventoryView' } },
        { path: 'orders', component: () => import('./views/admin/Orders.vue'), meta: { cap: 'orders' } },
        { path: 'payables', component: () => import('./views/admin/Payables.vue'), meta: { cap: 'orders' } },
        { path: 'recycles', component: () => import('./views/admin/Recycles.vue'), meta: { cap: 'recycles' } },
        { path: 'renters', component: () => import('./views/admin/Renters.vue'), meta: { cap: 'profiles' } },
        { path: 'owners', component: () => import('./views/admin/Owners.vue'), meta: { cap: 'profiles' } },
        { path: 'reports', component: () => import('./views/admin/Reports.vue'), meta: { cap: 'reports' } },
        { path: 'rules', component: () => import('./views/admin/Rules.vue'), meta: { cap: 'rulesEdit' } },
        { path: 'staff', component: () => import('./views/admin/Staff.vue'), meta: { cap: 'staff' } },
        { path: 'audit', component: () => import('./views/admin/Audit.vue'), meta: { cap: 'audit' } },
        { path: 'forbidden', component: () => import('./views/admin/Forbidden.vue') },
      ],
    },
    { path: '/forbidden', component: () => import('./views/admin/Forbidden.vue'), meta: { cap: 'front' } },
    { path: '/:pathMatch(.*)*', redirect: '/accounts' },
  ],
})

router.beforeEach((to) => {
  if (!ENABLE_FRONT_LOGIN && to.path.startsWith('/owner')) return { path: '/accounts' }
  if (to.meta.public) return
  const user = api.currentUser()
  const isAdmin = to.matched.some((r) => r.meta.admin)
  if (!user) {
    if (isAdmin) return { path: '/admin/login', query: { redirect: to.fullPath } }
    if (!ENABLE_FRONT_LOGIN) {
      const caps = to.matched.flatMap((r) => {
        const c = r.meta.cap as Cap | Cap[] | undefined
        if (!c) return []
        return Array.isArray(c) ? c : [c]
      })
      if (caps.every((c) => c === 'front')) return
      return { path: '/accounts' }
    }
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  for (const r of to.matched) {
    const c = r.meta.cap as Cap | Cap[] | undefined
    if (!c) continue
    const ok = Array.isArray(c) ? c.some((x) => can(user.role, x)) : can(user.role, c)
    if (!ok) {
      if (r.path === '/admin') return { path: '/admin/login', query: { redirect: to.fullPath, denied: '1' } }
      return { path: isAdmin ? '/admin/forbidden' : '/forbidden' }
    }
  }
})
