<script setup lang="ts">
import { ref } from 'vue'
import type { WidgetConfig, TodoItem } from '../types'

const props = defineProps<{ widget: WidgetConfig }>()
const newItem = ref('')

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
  <div class="w-full h-full bg-white/90 backdrop-blur-md border border-white/40 rounded-2xl flex flex-col overflow-hidden p-3">
    <div class="font-bold text-gray-800 text-xs mb-2 flex justify-between items-center">
      <span>✅ 待办</span>
      <span class="text-[10px] text-gray-400">{{ widget.data?.filter((i:any)=>!i.done).length || 0 }} 待完成</span>
    </div>
    
    <div class="flex-1 overflow-y-auto space-y-1 scrollbar-hide">
      <div v-for="(item, idx) in widget.data" :key="item.id" class="flex items-center gap-2 group">
        <input type="checkbox" v-model="item.done" class="rounded text-blue-500 focus:ring-0 cursor-pointer">
        <span class="text-xs flex-1 truncate" :class="item.done ? 'text-gray-400 line-through' : 'text-gray-700'">{{ item.text }}</span>
        <button @click="remove(idx)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs">×</button>
      </div>
      <div v-if="!widget.data?.length" class="text-[10px] text-gray-400 text-center py-2">无待办事项</div>
    </div>

    <div class="mt-2 pt-2 border-t border-gray-100">
      <input 
        v-model="newItem" 
        @keyup.enter="add"
        placeholder="回车添加..." 
        class="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 outline-none focus:bg-white focus:border-blue-300 transition-colors text-gray-700"
      >
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar { display: none; }
</style>