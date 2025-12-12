<template>
  <div
    class="absolute bottom-12 right-2 bg-white rounded-xl shadow-xl border border-gray-200 p-3 z-[9999] w-48 animate-fade-in"
    @click.stop
    @mousedown.stop
    @touchstart.stop
    @pointerdown.stop
  >
    <div class="mb-2 text-xs font-bold text-gray-500 flex justify-between items-center">
      <span>调整尺寸</span>
      <span class="text-blue-600">{{ currentCols }} x {{ currentRows }}</span>
    </div>
    <div class="grid grid-cols-4 gap-1.5" @mouseleave="hoverIndex = null">
      <div
        v-for="i in 16"
        :key="i"
        class="w-8 h-8 rounded-md border-2 transition-all cursor-pointer"
        :class="getCellClass(i)"
        @mouseenter="hoverIndex = i"
        @click="selectSize(i)"
      ></div>
    </div>
    <div class="mt-2 text-[10px] text-gray-400 text-center">
      点击选择网格大小
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  currentCol?: number
  currentRow?: number
}>()

const emit = defineEmits(['select'])

const hoverIndex = ref<number | null>(null)

const getCoords = (i: number) => {
  // i is 1..16
  // row is ceil(i / 4)
  // col is (i - 1) % 4 + 1
  const r = Math.ceil(i / 4)
  const c = ((i - 1) % 4) + 1
  return { c, r }
}

const currentCols = computed(() => {
  if (hoverIndex.value !== null) {
    return getCoords(hoverIndex.value).c
  }
  return props.currentCol || 1
})

const currentRows = computed(() => {
  if (hoverIndex.value !== null) {
    return getCoords(hoverIndex.value).r
  }
  return props.currentRow || 1
})

const getCellClass = (i: number) => {
  const { c, r } = getCoords(i)
  const targetC = currentCols.value
  const targetR = currentRows.value

  if (c <= targetC && r <= targetR) {
    return 'bg-blue-500 border-blue-600 scale-105'
  }
  return 'bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-200'
}

const selectSize = (i: number) => {
  const { c, r } = getCoords(i)
  emit('select', { colSpan: c, rowSpan: r })
}
</script>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
