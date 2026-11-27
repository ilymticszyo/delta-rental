<template>
  <el-result icon="warning" title="无权限（403）" sub-title="当前角色不能访问此页面。可用右上角「切换演示角色」换一个角色。">
    <template #extra><el-button @click="$router.back()">返回</el-button></template>
  </el-result>
</template>
