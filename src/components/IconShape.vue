<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  shape: 'rounded' | 'square' | 'circle' | 'leaf' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon'
  size?: number
  bgClass?: string
  icon?: string
}>()

const sizePx = computed(() => props.size ?? 48)

const finalIcon = computed(() => props.icon || '')

const isImg = computed(() => {
  const s = finalIcon.value
  // 支持 http, data:image, blob: 以及包含 / 或 . 的本地路径，排除 SVG 代码
  return !!s && (s.startsWith('http') || s.startsWith('data:image') || s.startsWith('blob:') || s.includes('/') || s.includes('.')) && !s.trim().startsWith('<svg')
})

const isSvg = computed(() => {
  const s = finalIcon.value
  return !!s && s.trim().startsWith('<svg')
})

const textScale = computed(() => (props.size ?? 48) >= 48 ? 0.52 : 0.56)

const resolvedFillClass = computed(() => {
  const cls = props.bgClass || 'fill-gray-100'
  if (cls.includes('bg-')) return cls.replace(/\bbg-/g, 'fill-')
  return cls
})

const pathD = computed(() => {
  switch (props.shape) {
    case 'circle': return 'M50 0 A50 50 0 1 0 50 100 A50 50 0 1 0 50 0 Z'
    case 'rounded': return 'M50 0 C68.3 0 82.6 0 91.3 8.7 C100 17.4 100 31.7 100 50 C100 68.3 100 82.6 91.3 91.3 C82.6 100 68.3 100 50 100 C31.7 100 17.4 100 8.7 91.3 C0 82.6 0 68.3 0 50 C0 31.7 0 17.4 8.7 8.7 C17.4 0 31.7 0 50 0 Z'
    case 'square': return 'M0 0 H100 V100 H0 Z'
    case 'diamond': return 'M50 0 L100 50 L50 100 L0 50 Z'
    case 'hexagon': return 'M50 0 L93.3 25 L93.3 75 L50 100 L6.7 75 L6.7 25 Z'
    case 'octagon': return 'M29.3 0 H70.7 L100 29.3 V70.7 L70.7 100 H29.3 L0 70.7 V29.3 Z'
    case 'pentagon': return 'M50 0 L97.5 34.5 L79.4 90.5 H20.6 L2.5 34.5 Z'
    case 'leaf': return 'M50 0 C80 0 100 30 100 60 C100 83 80 100 60 100 C38 100 22 87 18 72 C12 54 18 32 32 20 C40 12 45 0 50 0 Z'
    default: return 'M24 0 H76 A24 24 0 0 1 100 24 V76 A24 24 0 0 1 76 100 H24 A24 24 0 0 1 0 76 V24 A24 24 0 0 1 24 0 Z'
  }
})
</script>

<template>
  <div class="relative flex items-center justify-center overflow-hidden flex-shrink-0" :style="{ width: sizePx + 'px', height: sizePx + 'px' }">
    <svg :width="sizePx" :height="sizePx" viewBox="0 0 100 100" class="absolute inset-0" :style="{ backgroundColor: 'transparent' }">
      <defs>
        <clipPath id="icon-clip">
          <path :d="pathD" fill="none" />
        </clipPath>
      </defs>
      <path :d="pathD" class="transition-all duration-300" :class="resolvedFillClass" />

      <g clip-path="url(#icon-clip)">
        <image v-if="isImg" :href="finalIcon" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid slice" />
        <foreignObject v-else-if="isSvg" x="0" y="0" width="100" height="100">
          <div v-html="finalIcon" class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"></div>
        </foreignObject>
        <text v-else x="50" y="55" text-anchor="middle" dominant-baseline="middle" :font-size="(sizePx * textScale)" font-family="system-ui" fill="#111">{{ finalIcon }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.fill-gray-100 { fill: rgb(243 244 246); }
</style>
