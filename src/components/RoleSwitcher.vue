<template>
  <el-dropdown trigger="click" @command="switchTo">
    <el-button size="small" :type="dark ? undefined : 'primary'" :plain="!dark" :style="dark ? 'background:#232c38;color:#c9a24d;border-color:#3a4656' : ''">
      {{ user ? ROLE_LABEL[user.role] : '未登录' }} · 切换演示角色 ▾
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-for="d in demos" :key="d.username" :command="d.username" :disabled="user?.username === d.username">
          <b style="width:64px;display:inline-block">{{ ROLE_LABEL[d.role] }}</b> {{ d.displayName }}（{{ d.username }}）
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import { ROLE_LABEL } from '../domain/types'
import { homeOf } from '../router'
defineProps<{ dark?: boolean }>()
const router = useRouter()
const user = api.currentUser()
const demos = api.demoAccounts()
async function switchTo(username: string) {
  const d = demos.find((x) => x.username === username)!
  try {
    const u = await api.login(d.username, d.password)
    ElMessage.success(`已切换为 ${ROLE_LABEL[u.role]}：${u.displayName}`)
    await router.replace(homeOf(u.role))
    location.reload()
  } catch (e: any) { ElMessage.error(e.message) }
}
</script>
