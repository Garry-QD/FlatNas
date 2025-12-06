<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import type { WidgetConfig } from '@/types'

const props = defineProps<{
  widget: WidgetConfig
  isLanMode?: boolean
}>()

const isLoading = ref(true)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const refreshKey = ref(0)
const currentProtocol = ref('')

onMounted(() => {
  currentProtocol.value = window.location.protocol
})

const currentUrl = computed(() => {
  const { lanUrl, wanUrl, url } = props.widget.data || {}
  // 兼容旧数据：如果 wanUrl 为空，使用 url
  const effectiveWan = wanUrl || url || ''
  // 如果 lanUrl 为空，回退到 wanUrl (避免内网访问时白屏)
  const effectiveLan = lanUrl || effectiveWan

  return props.isLanMode ? effectiveLan : effectiveWan
})

const onLoad = () => {
  isLoading.value = false
}

const onError = () => {
  isLoading.value = false
}

const refresh = () => {
  isLoading.value = true
  refreshKey.value++
}

watch(
  () => currentUrl.value,
  () => {
    isLoading.value = true
  },
)
</script>

<template>
  <div
    class="w-full h-full rounded-2xl bg-white backdrop-blur border border-white/10 overflow-hidden relative group"
  >
    <div
      v-if="isLoading && currentUrl"
      class="absolute inset-0 flex items-center justify-center bg-gray-50/50 z-10"
    >
      <div
        class="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"
      ></div>
    </div>

    <iframe
      v-if="currentUrl"
      :key="refreshKey"
      ref="iframeRef"
      :src="currentUrl"
      class="w-full h-full border-0"
      allowfullscreen
      allow="geolocation; microphone; camera; midi; vr; accelerometer; gyroscope; payment; ambient-light-sensor; encrypted-media; clipboard-write"
      sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads allow-pointer-lock"
      referrerpolicy="no-referrer"
      loading="lazy"
      @load="onLoad"
      @error="onError"
    ></iframe>

    <div
      v-else
      class="absolute inset-0 flex items-center justify-center text-gray-400 text-xs flex-col gap-2"
    >
      <span>未设置 URL</span>
      <span class="text-[10px] opacity-50">请在编辑模式下配置</span>
    </div>

    <!-- Controls Overlay (Visible on Hover) -->
    <div
      class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex gap-1.5"
    >
      <button
        @click="refresh"
        class="p-1.5 bg-black/40 text-white rounded-full hover:bg-blue-500/80 backdrop-blur-md transition-colors shadow-sm"
        title="刷新"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>

      <a
        v-if="currentUrl"
        :href="currentUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="p-1.5 bg-black/40 text-white rounded-full hover:bg-blue-500/80 backdrop-blur-md transition-colors shadow-sm flex items-center justify-center"
        title="在新窗口打开 (解决显示异常)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    </div>

    <!-- Helper Tip (Only visible if Mixed Content might happen) -->
    <div
      class="absolute bottom-0 left-0 right-0 bg-red-500/90 backdrop-blur text-white text-[10px] p-1.5 text-center transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 z-20 flex items-center justify-center gap-2"
      v-if="currentUrl && currentUrl.startsWith('http://') && currentProtocol === 'https:'"
    >
      <span>⚠️ 检测到混合内容 (HTTPS引用HTTP)</span>
    </div>
  </div>
</template>
