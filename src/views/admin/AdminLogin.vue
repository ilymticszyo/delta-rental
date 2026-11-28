<template>
  <LoginCard title="后台登录" admin>
    <router-link v-if="frontLogin" to="/login">← 返回前台登录</router-link>
  </LoginCard>
</template>
<script setup lang="ts">
import LoginCard from '../../components/LoginCard.vue'
import { ENABLE_FRONT_LOGIN } from '../../config/frontLogin'
const frontLogin = ENABLE_FRONT_LOGIN
</script>
