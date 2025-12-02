<script setup lang="ts">
import { ref } from 'vue'

const display = ref('0')
const expression = ref('')

const append = (char: string) => {
  if (display.value === '0' && char !== '.') display.value = ''
  display.value += char
}

const clear = () => {
  display.value = '0'
  expression.value = ''
}

const calc = () => {
  try {
    expression.value = display.value
    // eslint-disable-next-line no-new-func
    display.value = new Function('return ' + display.value)()?.toString() || '0'
  } catch (e) {
    display.value = 'Error'
  }
}
</script>

<template>
  <div class="w-full h-full bg-gray-900/90 backdrop-blur-md border border-white/10 rounded-2xl flex flex-col p-2 text-white overflow-hidden">
    
    <div class="flex-none flex flex-col justify-end items-end mb-1 px-1 h-8">
      <div class="text-[8px] text-gray-400 truncate w-full text-right">{{ expression }}</div>
      <div class="text-lg font-mono font-bold truncate w-full text-right leading-none">{{ display }}</div>
    </div>

    <div class="flex-1 grid grid-cols-4 gap-1">
      <button @click="clear" class="bg-red-500/20 text-red-400 rounded hover:bg-red-500/40 text-[10px]">C</button>
      <button @click="append('/')" class="bg-white/10 hover:bg-white/20 rounded text-[10px]">÷</button>
      <button @click="append('*')" class="bg-white/10 hover:bg-white/20 rounded text-[10px]">×</button>
      <button @click="() => { display = display.slice(0, -1) || '0' }" class="bg-white/10 hover:bg-white/20 rounded text-[10px]">⌫</button>
      
      <button @click="append('7')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">7</button>
      <button @click="append('8')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">8</button>
      <button @click="append('9')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">9</button>
      <button @click="append('-')" class="bg-white/10 hover:bg-white/20 rounded text-[10px]">-</button>
      
      <button @click="append('4')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">4</button>
      <button @click="append('5')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">5</button>
      <button @click="append('6')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">6</button>
      <button @click="append('+')" class="bg-white/10 hover:bg-white/20 rounded text-[10px]">+</button>
      
      <button @click="append('1')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">1</button>
      <button @click="append('2')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">2</button>
      <button @click="append('3')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">3</button>
      <button @click="calc" class="bg-blue-500 hover:bg-blue-600 rounded row-span-2 flex items-center justify-center shadow-lg shadow-blue-500/30 text-sm">=</button>
      
      <button @click="append('0')" class="col-span-2 bg-white/5 hover:bg-white/10 rounded text-xs font-bold">0</button>
      <button @click="append('.')" class="bg-white/5 hover:bg-white/10 rounded text-xs font-bold">.</button>
    </div>
  </div>
</template>