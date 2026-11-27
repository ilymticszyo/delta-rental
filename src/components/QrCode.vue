<template>
  <img v-if="src" :src="src" :width="size" :height="size" alt="客服二维码" />
</template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'
const props = withDefaults(defineProps<{ text: string; size?: number }>(), { size: 180 })
const src = ref('')
watchEffect(async () => { src.value = await QRCode.toDataURL(props.text, { width: props.size, margin: 1 }) })
defineExpose({ src })
</script>
