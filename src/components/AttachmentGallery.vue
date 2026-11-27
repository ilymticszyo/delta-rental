<template>
  <div class="att-gallery">
    <el-image v-for="(x, i) in items" :key="x.id || i" :src="x.dataUrl" :preview-src-list="urls" :initial-index="i" fit="cover" preview-teleported
      :style="{ width: width + 'px', height: height + 'px', margin: '4px', borderRadius: '6px' }" @error="onError(i)">
      <template #error><div class="att-error" :style="{ width: width + 'px', height: height + 'px' }">图片加载失败</div></template>
    </el-image>
    <span v-if="!items.length" class="muted">{{ emptyText }}</span>
  </div>
</template>
<script setup lang="ts">
// 显示截图；http 模式下地址是 1 小时过期的签名 URL：快过期时提前续签，加载失败时续签一次再试。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api'
import { isExpiring } from '../api/attachments'
import type { Attachment } from '../domain/types'

const emit = defineEmits<{ (e: 'expired'): void }>()
const props = withDefaults(defineProps<{ attachments: Attachment[]; width?: number; height?: number; emptyText?: string }>(), { width: 160, height: 120, emptyText: '无截图' })
const items = ref<Attachment[]>([])
const urls = computed(() => items.value.map((x) => x.dataUrl))
const lastTry = new Map<string, number>()
let lastExpired = 0 // 不随 attachments 变化重置：父组件重新拉取后若仍失败，60 秒内不再让它重拉，避免死循环

async function renew(i: number) {
  const x = items.value[i]
  if (!x?.id) return false
  const t = lastTry.get(x.id) ?? 0
  if (Date.now() - t < 30_000) return false // 同一张 30 秒内只续签一次，避免坏图死循环
  lastTry.set(x.id, Date.now())
  try {
    const n = await api.refreshAttachment(x.id)
    if (items.value[i]?.id === x.id) items.value[i] = { ...x, ...n }
    return true
  } catch {
    // 后端没有 GET /uploads/{id}（契约提议接口）或不可见：让父组件重新拉取资源（列表 / 详情每次都会重签 url）
    if (Date.now() - lastExpired > 60_000) { lastExpired = Date.now(); emit('expired') }
    return false
  }
}
function renewExpiring() { items.value.forEach((x, i) => { if (isExpiring(x)) void renew(i) }) }
function onError(i: number) { void renew(i) }

watch(() => props.attachments, (v) => { items.value = (v ?? []).map((x) => ({ ...x })); lastTry.clear(); renewExpiring() }, { immediate: true })
const timer = setInterval(renewExpiring, 60_000) // 页面长时间打开时，预览大图前地址也保持有效
onBeforeUnmount(() => clearInterval(timer))
</script>
<style scoped>
.att-gallery { display: flex; flex-wrap: wrap; align-items: center; }
.att-error { display: flex; align-items: center; justify-content: center; background: #f4f4f5; color: #999; font-size: 12px; }
</style>
