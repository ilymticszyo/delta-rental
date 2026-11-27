import { createRouter, createWebHashHistory } from 'vue-router'
import { api } from './api'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/accounts' },
    { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
    {
      path: '/',
      component: () => import('./views/front/FrontLayout.vue'),
      meta: { auth: 'member' },
      children: [
        { path: 'accounts', component: () => import('./views/front/Lobby.vue') },
        { path: 'accounts/:id', component: () => import('./views/front/AccountDetail.vue') },
        { path: 'pricing', component: () => import('./views/front/Pricing.vue') },
        { path: 'recycle', component: () => import('./views/front/Recycle.vue') },
        { path: 'contact', component: () => import('./views/front/Contact.vue') },
      ],
    },
    { path: '/admin/login', component: () => import('./views/admin/AdminLogin.vue'), meta: { public: true } },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      meta: { auth: 'admin' },
      children: [
        { path: '', redirect: '/admin/dashboard' },
        { path: 'dashboard', component: () => import('./views/admin/Dashboard.vue') },
        { path: 'inventory', component: () => import('./views/admin/Inventory.vue') },
        { path: 'orders', component: () => import('./views/admin/Orders.vue') },
        { path: 'recycles', component: () => import('./views/admin/Recycles.vue') },
        { path: 'rules', component: () => import('./views/admin/Rules.vue') },
        { path: 'audit', component: () => import('./views/admin/Audit.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/accounts' },
  ],
})

router.beforeEach((to) => {
  const user = api.currentUser()
  const need = to.matched.map((r) => r.meta.auth).find(Boolean)
  if (need === 'admin') {
    if (!user || user.role === 'member') return { path: '/admin/login', query: { redirect: to.fullPath } }
  } else if (need === 'member' && !user) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})
