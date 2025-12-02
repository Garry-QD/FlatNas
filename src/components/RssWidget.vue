<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useMainStore } from '../stores/main'
import type { WidgetConfig, RssFeed } from '../types'

const props = defineProps<{ widget: WidgetConfig }>()
const store = useMainStore()

interface RssItem {
  title: string
  link: string
  pubDate?: string
  content?: string
  contentSnippet?: string
}

// Cache structure: url -> { data: items, ts: timestamp }
const cache = ref<Record<string, { data: RssItem[], ts: number }>>({})
const CACHE_TTL = 5 * 60 * 1000 // Cache 5 minutes for custom RSS

const activeFeedId = ref<string>('')
const list = ref<RssItem[]>([])
const loading = ref(false)
const errorMsg = ref('')

// Get enabled feeds
const enabledFeeds = computed(() => store.rssFeeds.filter(f => f.enable))

// Watch for feed changes to reset/update
watch(enabledFeeds, (newFeeds) => {
  if (newFeeds.length > 0) {
    // If current active feed is gone, switch to first
    if (!newFeeds.find(f => f.id === activeFeedId.value)) {
      activeFeedId.value = newFeeds[0].id
      fetchFeed(newFeeds[0])
    }
  } else {
    activeFeedId.value = ''
    list.value = []
  }
}, { deep: true })

const fetchFeed = async (feed: RssFeed, force = false) => {
  if (!feed) return
  activeFeedId.value = feed.id
  errorMsg.value = ''

  // Check cache
  const now = Date.now()
  if (!force && cache.value[feed.url] && (now - cache.value[feed.url].ts < CACHE_TTL)) {
    list.value = cache.value[feed.url].data
    return
  }

  loading.value = true
  list.value = []
  
  try {
    const res = await fetch(`/api/rss/parse?url=${encodeURIComponent(feed.url)}`)
    const payload = await res.json()
    
    if (!res.ok) throw new Error(payload.error || res.statusText)
    if (payload.error) throw new Error(payload.error)
    
    const items = payload.items || []
    list.value = items.map((item: any) => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      contentSnippet: item.contentSnippet
    }))

    // Write cache
    cache.value[feed.url] = { data: list.value, ts: now }
  } catch (e: any) {
    console.error(`Failed to load RSS: ${feed.title}`, e)
    errorMsg.value = '加载失败'
    list.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (enabledFeeds.value.length > 0) {
    activeFeedId.value = enabledFeeds.value[0].id
    fetchFeed(enabledFeeds.value[0])
  }
})

const openLink = (url: string) => { if (url) window.open(url, '_blank') }
</script>

<template>
  <div class="w-full h-full bg-white/80 backdrop-blur border border-white/40 rounded-2xl flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-all group">
    
    <!-- Header / Tabs -->
    <div class="flex border-b border-gray-100 bg-white/50 select-none overflow-x-auto no-scrollbar">
      <div v-if="enabledFeeds.length === 0" class="w-full py-2.5 text-xs text-gray-400 text-center">
        暂无订阅源
      </div>
      <button 
        v-for="feed in enabledFeeds" 
        :key="feed.id"
        @click="fetchFeed(feed)" 
        class="flex-shrink-0 px-4 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 relative whitespace-nowrap" 
        :class="activeFeedId === feed.id ? 'text-orange-600 bg-orange-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'"
      >
        <span>{{ feed.title }}</span>
        <div v-if="activeFeedId === feed.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500"></div>
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative">
      <div class="h-full overflow-y-auto custom-scrollbar p-0">
        
        <div v-if="enabledFeeds.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
          <span class="text-2xl mb-2">📡</span>
          <span class="text-xs">请在设置中添加并启用 RSS 订阅源</span>
        </div>

        <div v-else-if="loading && list.length === 0" class="p-8 text-center text-gray-400 text-xs animate-pulse">
          加载中...
        </div>

        <div v-else-if="errorMsg" class="p-8 text-center text-red-400 text-xs">
          {{ errorMsg }}
          <button @click="fetchFeed(enabledFeeds.find(f=>f.id===activeFeedId)!, true)" class="block mx-auto mt-2 text-blue-500 hover:underline">重试</button>
        </div>

        <div v-else class="flex flex-col py-1">
          <a 
            v-for="(item, index) in list" 
            :key="index" 
            :href="item.link" 
            target="_blank"
            class="block px-3 py-2 hover:bg-gray-50 transition-colors group/item border-b border-gray-50 last:border-0"
          >
            <div class="text-sm text-gray-700 group-hover/item:text-orange-600 transition-colors font-medium line-clamp-2 mb-1">
              {{ item.title }}
            </div>
            <div class="flex justify-between items-center">
               <div v-if="item.contentSnippet" class="text-[10px] text-gray-400 line-clamp-1 flex-1 mr-2">
                 {{ item.contentSnippet }}
               </div>
               <div v-if="item.pubDate" class="text-[10px] text-gray-300 whitespace-nowrap">
                 {{ new Date(item.pubDate).toLocaleDateString() }}
               </div>
            </div>
          </a>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.05); border-radius: 4px; }
.custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.1); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
