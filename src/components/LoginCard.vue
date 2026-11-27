<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 style="margin:0 0 4px">{{ title }}</h2>
      <p class="muted" style="margin:0 0 16px">三角洲行动 · 账号租赁与回收估值（内部系统）</p>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:16px">
        演示账号：<b>{{ demoUser }}</b> / 密码：<b>{{ demoPass }}</b>
        <el-button link type="primary" @click="fill">一键填入</el-button>
      </el-alert>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="账号"><el-input v-model="username" name="username" placeholder="请输入账号" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="password" name="password" type="password" show-password placeholder="请输入密码" /></el-form-item>
        <el-button type="primary" native-type="submit" style="width:100%" :loading="loading">登录</el-button>
      </el-form>
      <div style="margin-top:12px;text-align:right"><slot /></div>
    </el-card>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
const props = defineProps<{ title: string; demoUser: string; demoPass: string; home: string; admin?: boolean }>()
const username = ref('')
const password = ref('')
const loading = ref(false)
const route = useRoute()
const router = useRouter()
const fill = () => { username.value = props.demoUser; password.value = props.demoPass }
async function submit() {
  loading.value = true
  try {
    const u = await api.login(username.value, password.value)
    if (props.admin && u.role === 'member') { await api.logout(); throw new Error('该账号没有后台权限') }
    ElMessage.success(`欢迎，${u.displayName}`)
    router.replace((route.query.redirect as string) || props.home)
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally { loading.value = false }
}
</script>
<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #141a22, #2b3a2f); }
.login-card { width: 400px; }
</style>
