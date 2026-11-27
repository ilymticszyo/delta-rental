<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 style="margin:0 0 4px">{{ title }}</h2>
      <p class="muted" style="margin:0 0 12px">三角洲行动 · 账号租赁与回收估值（内部系统 v{{ version }}）</p>
      <el-alert v-if="$route.query.expired" type="info" :closable="false" show-icon style="margin-bottom:10px" title="登录已失效，请重新登录" />
      <el-alert v-if="$route.query.denied" type="warning" :closable="false" show-icon style="margin-bottom:10px" title="当前角色无权进入后台，请换一个员工账号" />
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="账号"><el-input v-model="username" name="username" placeholder="请输入账号" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="password" name="password" type="password" show-password placeholder="请输入密码" /></el-form-item>
        <el-button type="primary" native-type="submit" style="width:100%" :loading="loading">登录</el-button>
      </el-form>
      <div v-if="demos.length" class="muted" style="margin:14px 0 6px">演示账号（点击填入）：</div>
      <el-table v-if="demos.length" :data="demos" size="small" class="demo-table" @row-click="fill">
        <el-table-column label="角色" width="80"><template #default="{ row }"><el-tag size="small">{{ ROLE_LABEL[row.role as Role] }}</el-tag></template></el-table-column>
        <el-table-column prop="username" label="账号" width="80" />
        <el-table-column prop="password" label="密码" width="90" />
        <el-table-column prop="displayName" label="名称" />
      </el-table>
      <div style="margin-top:12px;text-align:right"><slot /></div>
    </el-card>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import { can } from '../domain/permissions'
import { ROLE_LABEL, type Role } from '../domain/types'
import { homeOf } from '../router'
const props = defineProps<{ title: string; admin?: boolean }>()
const version = __APP_VERSION__
const username = ref('')
const password = ref('')
const loading = ref(false)
const route = useRoute()
const router = useRouter()
const demos = computed(() => api.demoAccounts().filter((d) => !props.admin || can(d.role, 'adminArea')))
const fill = (d: { username: string; password: string }) => { username.value = d.username; password.value = d.password }
async function submit() {
  loading.value = true
  try {
    const u = await api.login(username.value, password.value)
    if (props.admin && !can(u.role, 'adminArea')) { await api.logout(); throw new Error('该账号没有后台权限') }
    ElMessage.success(`欢迎，${u.displayName}`)
    const redirect = route.query.redirect as string
    router.replace(redirect && !redirect.startsWith('/admin/login') ? redirect : homeOf(u.role))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally { loading.value = false }
}
</script>
<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #141a22, #2b3a2f); }
.login-card { width: 460px; }
.demo-table :deep(tr) { cursor: pointer; }
</style>
