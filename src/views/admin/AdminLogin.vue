<template>
  <LoginCard title="后台登录" demo-user="admin" demo-pass="admin123" home="/admin/dashboard" admin>
    <router-link to="/login">← 返回前台登录</router-link>
  </LoginCard>
</template>
<script setup lang="ts">
import LoginCard from '../../components/LoginCard.vue'
</script>
