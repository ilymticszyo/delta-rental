<template>
  <el-container style="min-height:100vh">
    <el-aside width="200px" style="background:#141a22">
      <div class="brand">◆ 后台管理</div>
      <el-menu :default-active="$route.path" router background-color="#141a22" text-color="#cfd3da" active-text-color="#c9a24d" style="border-right:none">
        <el-menu-item index="/admin/dashboard">看板</el-menu-item>
        <el-menu-item index="/admin/inventory">账号库存</el-menu-item>
        <el-menu-item index="/admin/orders">出租订单</el-menu-item>
        <el-menu-item index="/admin/recycles">回收申请</el-menu-item>
        <el-menu-item index="/admin/rules">规则配置</el-menu-item>
        <el-menu-item index="/admin/audit">操作日志</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="hdr">
        <span class="muted">三角洲行动 · 账号租赁与回收估值（内部）</span>
        <div class="row-gap">
          <router-link to="/accounts">前台大厅 ↗</router-link>
          <el-popconfirm title="清空本浏览器的演示数据并恢复初始？" @confirm="reset"><template #reference><el-button size="small">重置演示数据</el-button></template></el-popconfirm>
          <span>{{ user?.displayName }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main style="background:#f3f4f6"><router-view :key="key" /></el-main>
    </el-container>
  </el-container>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../../api'
const router = useRouter()
const route = useRoute()
const user = api.currentUser()
const n = ref(0)
const key = computed(() => route.fullPath + n.value)
async function logout() { await api.logout(); router.replace('/admin/login') }
async function reset() { await api.resetDemo(); n.value++; ElMessage.success('已恢复初始演示数据') }
</script>
<style scoped>
.brand { color: var(--accent); font-weight: 700; font-size: 17px; padding: 18px 20px; }
.hdr { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e5e7eb; }
</style>
