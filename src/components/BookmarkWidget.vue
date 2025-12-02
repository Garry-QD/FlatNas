<script setup lang="ts">
import { ref } from 'vue'
import type { WidgetConfig, BookmarkCategory, BookmarkItem } from '../types'
import { useMainStore } from '../stores/main'
import { isInternalDomain, processSecurityUrl } from '../utils/security'

const props = defineProps<{ widget: WidgetConfig }>()
const store = useMainStore()

const showInput = ref<string | null>(null)
const editingLinkId = ref<string | null>(null)
const newTitle = ref('')
const newUrl = ref('')
const newIcon = ref('')
const isFetching = ref(false)

// 添加分类
const addCategory = () => {
  const title = prompt('请输入分类名称')
  if (title) {
    if (!props.widget.data) props.widget.data = []
    props.widget.data.push({ id: Date.now().toString(), title, collapsed: false, children: [] })
  }
}

// 图片检测
const checkImageExists = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(false), 3000)
    img.onload = () => { clearTimeout(timer); if (img.width > 1) resolve(true); else resolve(false) }
    img.onerror = () => { clearTimeout(timer); resolve(false) }
    img.src = url
  })
}

// 自动获取图标
const autoFetchIcon = async () => {
  if (!newUrl.value) return alert('请先填写网址！')
  isFetching.value = true
  
  try {
    const urlObj = new URL(newUrl.value.startsWith('http') ? newUrl.value : 'https://' + newUrl.value)
    const origin = urlObj.origin
    const hostname = urlObj.hostname
    
    const candidates = [
      `${origin}/favicon.ico`,
      `${origin}/logo.svg`,
      `${origin}/logo.png`,
      `${origin}/icon.png`,
      `https://api.iowen.cn/favicon/${hostname}.png`,
      `https://api.uomg.com/api/favicon?url=${encodeURIComponent(origin)}`,
      `https://icons.duckduckgo.com/ip3/${hostname}.ico`
    ]

    let found = false
    for (const src of candidates) {
      if (await checkImageExists(src)) {
        newIcon.value = src
        found = true
        break
      }
    }
    if (!found) newIcon.value = `https://icon.horse/icon/${hostname}`

  } catch (e) {
    // 忽略错误
  } finally {
    isFetching.value = false
  }
}

const startAdd = (catId: string) => {
  showInput.value = catId
  editingLinkId.value = null
  newTitle.value = ''
  newUrl.value = ''
  newIcon.value = ''
}

const startEdit = (catId: string, link: BookmarkItem) => {
  showInput.value = catId
  editingLinkId.value = link.id
  newTitle.value = link.title
  newUrl.value = link.url
  newIcon.value = link.icon || ''
}

const confirmSubmit = (cat: BookmarkCategory) => {
  if (newTitle.value && newUrl.value) {
    let finalUrl = newUrl.value
    if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl
    
    if (!newIcon.value) {
       try { newIcon.value = `https://api.iowen.cn/favicon/${new URL(finalUrl).hostname}.png` } catch(e){}
    }

    if (editingLinkId.value) {
      const target = cat.children.find(l => l.id === editingLinkId.value)
      if (target) {
        target.title = newTitle.value
        target.url = finalUrl
        target.icon = newIcon.value
      }
    } else {
      cat.children.push({
        id: Date.now().toString(),
        title: newTitle.value,
        url: finalUrl,
        icon: newIcon.value
      })
    }
    
    showInput.value = null
    editingLinkId.value = null
  }
}

const deleteItem = (catIndex: number, childIndex?: number) => {
  if (!confirm('确定删除吗？')) return
  if (typeof childIndex === 'number') {
    props.widget.data[catIndex].children.splice(childIndex, 1)
  } else {
    props.widget.data.splice(catIndex, 1)
  }
}

const openUrl = (url: string) => {
  if (!url) return
  
  // Security Rule: Intercept unlogged users
  if (!store.isLogged) {
    if (isInternalDomain(url)) {
      alert('为了您的安全，未登录状态下禁止访问内网资源')
      return
    }
    const targetUrl = processSecurityUrl(url)
    window.location.href = targetUrl
    return
  }
  
  window.open(url, '_blank')
}
</script>

<template>
  <div class="w-full h-full bg-white/90 backdrop-blur-md border border-white/40 rounded-2xl flex flex-col overflow-hidden shadow-sm relative group hover:bg-white transition-colors">
    
    <div class="px-4 py-3 border-b border-gray-200/50 flex justify-between items-center bg-white/50 shrink-0">
      <div class="font-bold text-gray-800 text-sm flex items-center gap-2">📑 收藏夹</div>
      <div v-if="store.isLogged" class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button @click="addCategory" class="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded hover:bg-green-200">+ 分类</button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
      <div v-for="(cat, catIdx) in widget.data" :key="cat.id">
        
        <div class="flex items-center justify-between mb-3 group/cat border-b border-gray-100 pb-1">
          <span 
            class="font-bold text-gray-600 text-sm flex items-center gap-1 cursor-pointer select-none"
            @click="cat.collapsed = !cat.collapsed"
          >
            <span class="transform transition-transform text-xs" :class="cat.collapsed ? '-rotate-90' : ''">▼</span>
            {{ cat.title }}
          </span>
          <div v-if="store.isLogged" class="flex gap-2 opacity-0 group-hover/cat:opacity-100 transition-opacity">
            <button @click="startAdd(cat.id)" class="text-blue-500 hover:text-blue-700 text-xs font-bold">+ 添加</button>
            <button @click="deleteItem(catIdx)" class="text-gray-300 hover:text-red-500 text-xs">删除分类</button>
          </div>
        </div>

        <div v-if="!cat.collapsed" class="flex flex-wrap gap-3">
          <div 
            v-for="(link, linkIdx) in cat.children" 
            :key="link.id" 
            class="flex items-center gap-3 px-5 py-3 bg-gray-100 hover:bg-blue-50 hover:text-blue-600 rounded-xl cursor-pointer transition-all border border-gray-100 hover:border-blue-200 group/link min-w-[140px]"
            @click.stop="openUrl(link.url)"
            title="点击跳转"
          >
            <img :src="link.icon" class="w-8 h-8 rounded object-cover bg-white shadow-sm" @error="link.icon='https://api.iowen.cn/favicon/unknown.png'">
            <span class="font-medium text-gray-700 text-base group-hover:text-blue-600">{{ link.title }}</span>
            
            <div v-if="store.isLogged" class="flex gap-1 ml-auto pl-2 opacity-0 group-hover/link:opacity-100 transition-opacity">
              <button @click.stop="startEdit(cat.id, link)" class="text-blue-400 hover:text-blue-600 p-1" title="编辑">✎</button>
              <button @click.stop="deleteItem(catIdx, linkIdx)" class="text-gray-300 hover:text-red-500 p-1" title="删除">×</button>
            </div>
          </div>

          <div v-if="cat.children.length === 0 && showInput !== cat.id" class="text-sm text-gray-400 py-2 px-4 border border-dashed border-gray-200 rounded-lg select-none">
            (空文件夹)
          </div>
        </div>

        <div v-if="showInput === cat.id" class="mt-3 p-4 bg-white rounded-xl border border-blue-200 shadow-lg animate-fade-in z-10 relative">
          <div class="text-xs font-bold text-blue-500 mb-2">{{ editingLinkId ? '编辑书签' : '添加新书签' }}</div>
          <div class="grid grid-cols-1 gap-3 mb-3">
            <div class="flex gap-2">
              <input v-model="newTitle" placeholder="标题" class="flex-1 text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all">
              <button 
                @click="autoFetchIcon" 
                :disabled="isFetching"
                class="px-3 bg-blue-50 text-blue-600 text-xs rounded-lg font-bold hover:bg-blue-100 transition-colors flex items-center gap-1"
              >
                <span v-if="isFetching" class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                {{ isFetching ? '获取中' : '⚡ 抓取' }}
              </button>
            </div>
            <input v-model="newUrl" placeholder="网址" class="w-full text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all">
            <div class="flex gap-2 items-center">
              <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border overflow-hidden shrink-0">
                <img v-if="newIcon" :src="newIcon" class="w-full h-full object-cover">
                <span v-else class="text-xs text-gray-300">icon</span>
              </div>
              <input v-model="newIcon" placeholder="图标地址 (选填)" class="flex-1 text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all">
            </div>
          </div>
          <div class="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button @click="showInput = null" class="text-sm text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded transition-colors">取消</button>
            <button @click="confirmSubmit(cat)" class="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 shadow-md transition-all">{{ editingLinkId ? '保存' : '添加' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.animate-fade-in { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
</style>