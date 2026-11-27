<template>
  <el-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" title="联系客服下单" width="380px" align-center>
    <div v-if="agent" style="text-align:center">
      <QrCode :text="`微信:${agent.wechat}｜咨询账号:${accountNo ?? '-'}`" :size="200" />
      <div style="margin-top:8px"><b>{{ agent.name }}</b>（微信：{{ agent.wechat }}）</div>
      <div v-if="accountNo" style="margin-top:6px">咨询账号编号：<el-tag>{{ accountNo }}</el-tag>
        <el-button link type="primary" @click="copy(accountNo)">复制</el-button></div>
      <p class="muted">扫码添加客服，发送账号编号即可。成交在线下完成。</p>
    </div>
    <el-empty v-else description="当前暂无在班客服，请稍后再试" />
  </el-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { api } from '../api'
import type { CsAgent } from '../domain/types'
import QrCode from './QrCode.vue'
import { copy } from '../utils'
const props = defineProps<{ modelValue: boolean; accountNo?: string }>()
defineEmits(['update:modelValue'])
const agent = ref<CsAgent | null>(null)
watch(() => props.modelValue, async (v) => { if (v) agent.value = await api.currentCsAgent() }, { immediate: true })
</script>
