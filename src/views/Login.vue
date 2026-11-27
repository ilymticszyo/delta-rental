<template>
  <LoginCard title="成员登录" demo-user="demo" demo-pass="demo123" home="/accounts">
    <router-link to="/admin/login">进入后台 →</router-link>
  </LoginCard>
</template>
<script setup lang="ts">
import LoginCard from '../components/LoginCard.vue'
</script>
