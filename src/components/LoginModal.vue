<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useMainStore } from '../stores/main'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits(['update:show'])
const store = useMainStore()

const password = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// 监听打开：一旦打开，自动聚焦输入框，并清空旧密码
watch(() => props.show, (newVal) => {
  if (newVal) {
    password.value = ''
    nextTick(() => {
      inputRef.value?.focus()
    })
  }
})

const close = () => emit('update:show', false)

const handleLogin = () => {
  if (store.login(password.value)) {
    close() // 登录成功直接关闭
  } else {
    alert('密码错误！(默认是 admin)')
    password.value = '' // 清空重输
    inputRef.value?.focus()
  }
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100">
      
      <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <h3 class="text-lg font-bold text-gray-800">🔒 管理员验证</h3>
        <button @click="close" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="p-6">
        <div class="mb-5">
          <input 
            ref="inputRef"
            v-model="password" 
            type="password" 
            placeholder="请输入访问密码" 
            class="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all text-center text-lg tracking-widest"
            @keyup.enter="handleLogin"
          >
        </div>
        
        <button 
          @click="handleLogin" 
          class="w-full bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-black active:scale-95 transition-all shadow-lg"
        >
          登 录
        </button>
      </div>

    </div>
  </div>
</template>