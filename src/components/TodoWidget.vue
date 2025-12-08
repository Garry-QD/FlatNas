<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
import { ref, watch, onMounted } from 'vue'
import { useStorage } from '@vueuse/core'
import type { WidgetConfig } from '@/types'

const props = defineProps<{ widget: WidgetConfig }>()
const newItem = ref('')

// 本地持久化备份：防止网络断开时数据丢失
const localBackup = useStorage<any[]>(`flatnas-todo-backup-${props.widget.id}`, [])

watch(
  () => props.widget.data,
  (newVal) => {
    if (newVal) localBackup.value = newVal
  },
  { deep: true },
)

onMounted(() => {
  // 如果服务端数据为空，但本地有备份，则恢复备份
  if ((!props.widget.data || props.widget.data.length === 0) && localBackup.value.length > 0) {
    props.widget.data = localBackup.value
  }
})

const add = () => {
  if (!newItem.value) return
  if (!props.widget.data) props.widget.data = []
  props.widget.data.push({ id: Date.now().toString(), text: newItem.value, done: false })
  newItem.value = ''
}

const remove = (index: number) => {
  props.widget.data.splice(index, 1)
}
</script>

<template>
  <div
    class="w-full h-full bg-white/90 backdrop-blur-md border border-white/40 rounded-2xl flex flex-col overflow-hidden p-3"
  >
    <div class="font-bold text-gray-800 text-xs mb-2 flex justify-between items-center">
      <span>✅ 待办</span>
      <span class="text-[10px] text-gray-400"
        >{{ widget.data?.filter((i: any) => !i.done).length || 0 }} 待完成</span
      >
    </div>

    <div class="flex-1 overflow-y-auto space-y-1 scrollbar-hide">
      <div v-for="(item, idx) in widget.data" :key="item.id" class="flex items-start gap-2 group">
        <input
          type="checkbox"
          v-model="item.done"
          class="rounded text-blue-500 focus:ring-0 cursor-pointer mt-0.5"
        />
        <span
          class="text-xs flex-1 break-all whitespace-normal leading-tight"
          :class="item.done ? 'text-gray-400 line-through' : 'text-gray-700'"
          >{{ item.text }}</span
        >
        <button
          @click="remove(idx)"
          class="text-xs text-gray-400 hover:text-red-600 border border-gray-200 rounded px-2 py-0.5 hover:bg-red-50 transition-colors whitespace-nowrap shrink-0"
        >
          删除
        </button>
      </div>
      <div v-if="!widget.data?.length" class="text-xs text-gray-400 text-center py-2">
        无待办事项
      </div>
    </div>

    <div class="mt-2 pt-2 border-t border-gray-100 flex gap-2">
      <input
        v-model="newItem"
        @keyup.enter="add"
        placeholder="添加待办..."
        class="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 outline-none focus:bg-white focus:border-blue-300 transition-colors text-gray-700"
      />
      <button
        @click="add"
        class="bg-blue-500 text-white text-xs px-3 py-1 rounded hover:bg-blue-600 transition-colors whitespace-nowrap"
      >
        回车
      </button>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
</style>
