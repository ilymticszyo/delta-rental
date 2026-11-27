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
        </el-menu>
        <div class="user">
          <router-link v-if="user && user.role !== 'member'" to="/admin" class="adm">后台管理</router-link>
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
const route = useRoute()
const router = useRouter()
const user = api.currentUser()
const active = computed(() => '/' + (route.path.split('/')[1] || 'accounts'))
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
