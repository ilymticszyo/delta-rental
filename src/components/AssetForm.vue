<template>
  <!-- 回收估值与号主上架共用的资产表单（E1：上架复用回收估值的资产字段） -->
  <el-form ref="formRef" :model="m" :rules="rules" label-width="110px">
    <el-row>
      <el-col v-if="showContact" :span="12"><el-form-item label="联系方式" prop="contact"><el-input v-model="m.contact" placeholder="微信 / QQ / 手机" /></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="大区" prop="region"><el-select v-model="m.region" placeholder="请选择"><el-option v-for="o in dicts.regions" :key="o" :value="o" /></el-select></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="上号方式" prop="loginMethod"><el-select v-model="m.loginMethod" placeholder="请选择"><el-option v-for="o in dicts.loginMethods" :key="o" :value="o" /></el-select></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="段位"><el-select v-model="m.rank"><el-option v-for="o in dicts.ranks" :key="o" :value="o" /></el-select></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="纯币(M)" prop="coinAmount"><el-input-number v-model="m.coinAmount" :min="0" /></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="总资产(M)" prop="totalAssets"><el-input-number v-model="m.totalAssets" :min="0" /></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="等级"><el-input-number v-model="m.level" :min="1" /></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="保险格数"><el-select v-model="m.safeBox"><el-option v-for="o in dicts.safeBoxes" :key="o" :label="o + ' 格'" :value="o" /></el-select></el-form-item></el-col>
    </el-row>
    <el-row>
      <el-col :span="6"><el-form-item label="AWM" label-width="60px"><el-input-number v-model="m.awmCount" :min="0" style="width:120px" /></el-form-item></el-col>
      <el-col :span="6"><el-form-item label="6头" label-width="50px"><el-input-number v-model="m.helmet6Count" :min="0" style="width:120px" /></el-form-item></el-col>
      <el-col :span="6"><el-form-item label="6甲" label-width="50px"><el-input-number v-model="m.armor6Count" :min="0" style="width:120px" /></el-form-item></el-col>
      <el-col :span="6"><el-form-item label="体验卡" label-width="60px"><el-input-number v-model="m.experienceCardCount" :min="0" style="width:120px" /></el-form-item></el-col>
    </el-row>
    <el-form-item label="皮肤"><el-select v-model="m.skins" multiple filterable style="width:100%" placeholder="请选择"><el-option v-for="s in dicts.skins" :key="s.name" :label="`${s.name}（${s.category}）`" :value="s.name" /></el-select></el-form-item>
    <el-form-item label="封禁记录"><el-switch v-model="m.banRecord" active-text="有" inactive-text="无" /></el-form-item>
    <slot />
  </el-form>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import type { FormInstance } from 'element-plus'
import { dicts } from '../config/rules'
import type { ValuationInput } from '../domain/types'
const props = withDefaults(defineProps<{ m: ValuationInput; showContact?: boolean }>(), { showContact: true })
const req = (msg: string) => [{ required: true, message: msg, trigger: 'change' }]
const rules = {
  contact: props.showContact ? req('请填写联系方式') : [], region: req('请选择大区'), loginMethod: req('请选择上号方式'),
  totalAssets: [{ validator: (_: any, v: number, cb: any) => (v >= props.m.coinAmount ? cb() : cb(new Error('总资产不应小于纯币'))), trigger: 'change' }],
}
const formRef = ref<FormInstance>()
defineExpose({ validate: () => formRef.value!.validate().then(() => true).catch(() => false) })
</script>
