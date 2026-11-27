<template>
  <el-container style="min-height:100vh">
    <el-aside width="200px" style="background:#141a22">
      <div class="brand">◆ 后台管理</div>
      <el-menu :default-active="$route.path" router background-color="#141a22" text-color="#cfd3da" active-text-color="#c9a24d" style="border-right:none">
        <el-menu-item v-for="m in menu" :key="m.path" :index="m.path">{{ m.label }}</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="hdr">
        <span class="muted">三角洲行动 · 账号租赁与回收估值（内部 v{{ appVersion }}）</span>
        <div class="row-gap">
          <router-link to="/accounts">前台大厅 ↗</router-link>
          <router-link v-if="user && can(user.role, 'ownerPortalAll')" to="/owner/accounts">号主门户 ↗</router-link>
          <el-popconfirm v-if="demo" title="清空本浏览器的演示数据并恢复初始？" @confirm="reset"><template #reference><el-button size="small">重置演示数据</el-button></template></el-popconfirm>
          <RoleSwitcher v-if="demo" />
          <span>{{ user?.displayName }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f3f4f6"><router-view :key="key" /></el-main>
    </el-container>
  </el-container>
</template>
<script setup lang="ts">
const appVersion = __APP_VERSION__
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
import { can, type Cap } from '../../domain/permissions'
import RoleSwitcher from '../../components/RoleSwitcher.vue'
const demo = api.features().demo
const router = useRouter()
const route = useRoute()
const user = api.currentUser()
const n = ref(0)
const key = computed(() => route.fullPath + n.value)
const all: { path: string; label: string; cap: Cap }[] = [
  { path: '/admin/dashboard', label: '看板', cap: 'dashboard' },
  { path: '/admin/inventory', label: '账号库存', cap: 'inventoryView' },
  { path: '/admin/orders', label: '出租订单', cap: 'orders' },
  { path: '/admin/payables', label: '号主应付台账', cap: 'orders' },
  { path: '/admin/recycles', label: '回收申请', cap: 'recycles' },
  { path: '/admin/renters', label: '租客档案', cap: 'profiles' },
  { path: '/admin/owners', label: '号主档案', cap: 'profiles' },
  { path: '/admin/reports', label: '经营报表', cap: 'reports' },
  { path: '/admin/rules', label: '规则与估值依据', cap: 'rulesEdit' },
  { path: '/admin/staff', label: '员工与角色', cap: 'staff' },
  { path: '/admin/audit', label: '操作日志', cap: 'audit' },
]
const menu = computed(() => all.filter((m) => can(user?.role, m.cap)))
async function logout() { await api.logout(); router.replace('/admin/login') }
async function reset() { await api.resetDemo(); n.value++; ElMessage.success('已恢复初始演示数据') }
</script>
<style scoped>
.brand { color: var(--accent); font-weight: 700; font-size: 17px; padding: 18px 20px; }
.hdr { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e5e7eb; }
</style>
