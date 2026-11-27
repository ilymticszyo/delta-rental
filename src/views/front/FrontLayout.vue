<template>
  <div>
    <header class="top">
      <div class="inner">
        <div class="brand">◆ 三角洲行动 · 账号租赁</div>
        <el-menu mode="horizontal" :default-active="active" router :ellipsis="false" class="nav"
          background-color="#141a22" text-color="#cfd3da" active-text-color="#c9a24d">
          <el-menu-item index="/accounts">账号大厅</el-menu-item>
          <el-menu-item index="/pricing">出租算价</el-menu-item>
          <el-menu-item index="/recycle">回收估值</el-menu-item>
          <el-menu-item index="/contact">客服中心</el-menu-item>
          <el-menu-item v-if="canOwner" index="/owner/accounts">我的账号</el-menu-item>
          <el-menu-item v-if="user?.role === 'owner'" index="/owner/list">上架</el-menu-item>
        </el-menu>
        <div class="user">
          <router-link v-if="user && can(user.role, 'adminArea')" to="/admin" class="adm">后台管理</router-link>
          <RoleSwitcher dark />
          <span>{{ user?.displayName }}</span>
          <el-button size="small" text style="color:#cfd3da" @click="logout">退出</el-button>
        </div>
      </div>
    </header>
    <router-view />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api'
import { can } from '../../domain/permissions'
import RoleSwitcher from '../../components/RoleSwitcher.vue'
const route = useRoute()
const router = useRouter()
const user = api.currentUser()
const canOwner = computed(() => !!user && (can(user.role, 'ownerPortal') || can(user.role, 'ownerPortalAll')))
const active = computed(() => {
  if (route.path.startsWith('/owner/list')) return '/owner/list'
  if (route.path.startsWith('/owner')) return '/owner/accounts'
  return '/' + (route.path.split('/')[1] || 'accounts')
})
async function logout() { await api.logout(); router.replace('/login') }
</script>
<style scoped>
.top { background: #141a22; }
.inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; padding: 0 20px; }
.brand { color: var(--accent); font-weight: 700; font-size: 18px; margin-right: 24px; white-space: nowrap; }
.nav { flex: 1; border-bottom: none; }
.user { color: #cfd3da; display: flex; gap: 12px; align-items: center; white-space: nowrap; }
.adm { color: var(--accent); }
</style>
