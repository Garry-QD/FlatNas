<script setup lang="ts">
import { ref } from 'vue'
import { VueCropper } from 'vue-cropper'
import 'vue-cropper/dist/index.css' // ✅ 已修正：新版叫 index.css

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits(['update:modelValue'])

const showCropper = ref(false)
const uploadImgUrl = ref('')
const cropper = ref()
const fileInput = ref<HTMLInputElement | null>(null)
const zoom = ref(1)

const triggerSelect = () => {
  fileInput.value?.click()
}

const onFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  if (file.size > 5 * 1024 * 1024) {
    alert('图片太大啦，请上传小于 5MB 的图片')
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    uploadImgUrl.value = e.target?.result as string
    zoom.value = 1 // Reset zoom
    showCropper.value = true // 打开裁剪弹窗
  }
  reader.readAsDataURL(file)
  
  if(fileInput.value) fileInput.value.value = ''
}

const onZoomChange = (e: Event) => {
  const newVal = parseFloat((e.target as HTMLInputElement).value)
  const diff = newVal - zoom.value
  cropper.value.changeScale(diff)
  zoom.value = newVal
}

const confirmCrop = () => {
  cropper.value.getCropData((data: string) => {
    // Resize to 216x216
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 216
      canvas.height = 216
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // 使用高质量缩放算法 (如果浏览器支持)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, 216, 216)
        emit('update:modelValue', canvas.toDataURL('image/png'))
      } else {
        emit('update:modelValue', data)
      }
      showCropper.value = false
    }
    img.src = data
  })
}
</script>

<template>
  <div class="w-full">
    <input 
      ref="fileInput"
      type="file" 
      accept="image/*" 
      class="hidden" 
      @change="onFileChange"
    >

    <div 
      class="w-full h-32 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group relative overflow-hidden"
      @click="triggerSelect"
    >
      <img 
        v-if="modelValue && modelValue.startsWith('data:image')" 
        :src="modelValue" 
        class="absolute inset-0 w-full h-full object-cover z-0"
      >
      
      <div class="z-10 flex flex-col items-center justify-center" :class="modelValue ? 'opacity-0 group-hover:opacity-100 bg-white/80 absolute inset-0 transition-opacity' : ''">
        <span class="text-2xl text-gray-400 mb-1 group-hover:text-blue-500">+</span>
        <span class="text-xs text-gray-500 group-hover:text-blue-600">点击上传 / 裁剪</span>
      </div>
    </div>

    <div v-if="showCropper" class="fixed inset-0 z-[999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[500px]">
        <div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <h3 class="font-bold text-gray-700">裁剪图片</h3>
          <button @click="showCropper = false" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div class="flex-1 bg-gray-900 relative">
          <VueCropper
            ref="cropper"
            :img="uploadImgUrl"
            :autoCrop="true"
            :autoCropWidth="216"
            :autoCropHeight="216"
            :fixed="true"
            :fixedNumber="[1, 1]" 
            :centerBox="true"
            outputType="png"
          ></VueCropper>
        </div>
        
        <!-- Zoom Slider -->
        <div class="px-4 py-2 bg-gray-800 flex items-center gap-3 border-t border-gray-700">
          <span class="text-gray-400 text-xs">🔍</span>
          <input 
            type="range" 
            min="0.1" 
            max="3" 
            step="0.1" 
            :value="zoom" 
            @input="onZoomChange" 
            class="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
          >
          <span class="text-gray-400 text-xs font-mono w-10 text-right">{{ Math.round(zoom * 100) }}%</span>
        </div>

        <div class="p-4 bg-gray-50 flex justify-end gap-3">
          <button @click="showCropper = false" class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors">取消</button>
          <button @click="confirmCrop" class="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all">确认使用</button>
        </div>
      </div>
    </div>
  </div>
</template>