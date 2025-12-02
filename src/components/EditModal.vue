<script setup lang="ts">
import { ref, watch } from 'vue'
import type { NavItem } from '../types'
import IconUploader from './IconUploader.vue'
import IconSelectionModal from './IconSelectionModal.vue'

// 接收父组件传来的数据
const props = defineProps<{
  show: boolean
  data?: NavItem | null
  // ✨✨✨ 新增关键参数：当前分组ID (必须有这个才能支持分组添加)
  groupId?: string 
}>()

const emit = defineEmits(['update:show', 'save'])

// 图标模式：emoji 或 图片
const iconType = ref<'emoji' | 'image'>('image')
const isFetching = ref(false)

// 搜索相关状态
const showIconSelection = ref(false)
const iconCandidates = ref<string[]>([])
const searchSource = ref<'local' | 'api'>('local')
const localIcons = ref<string[]>([])
const simpleIconsData = ref<any[] | null>(null)

// 表单数据 (合并管理，比以前分散的 ref 更整洁)
const form = ref<Omit<NavItem, 'id'>>({
  title: '',
  url: '',
  lanUrl: '',
  icon: '',
  color: 'bg-blue-50 text-blue-600',
  isPublic: true
})

// 预设一些常用的 Emoji
const commonEmojis = ['🏠', '🔍', '💻', '📱', '📸', '🎵', '🎬', '📚', '🛠️', '☁️', '⚡', '🔥', '🌟', '❤️', '🚀', '🌍', '🎨', '📂', '📅', '🛒', '🎁', '🐱', '🐶', '🍀', '⚽']

// 随机选择 Emoji
const randomEmoji = () => {
  const randomIndex = Math.floor(Math.random() * commonEmojis.length)
  form.value.icon = commonEmojis[randomIndex]
}

// 检测图片是否有效
const checkImageExists = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(false), 3000)
    img.onload = () => { clearTimeout(timer); img.width > 1 ? resolve(true) : resolve(false) }
    img.onerror = () => { clearTimeout(timer); resolve(false) }
    img.src = url
  })
}

// 获取本地图标列表
const fetchLocalIcons = async () => {
  if (localIcons.value.length > 0) return
  try {
    const res = await fetch('/api/icons')
    if (res.ok) {
      const list = await res.json()
      // 加上目录前缀
      localIcons.value = list.map((f: string) => `icons/${f}`)
    }
  } catch (e) {
    console.error('Failed to fetch local icons', e)
  }
}

// 获取 Simple Icons 数据
const fetchSimpleIconsData = async () => {
  if (simpleIconsData.value) return
  try {
    const res = await fetch('https://raw.githubusercontent.com/simple-icons/simple-icons/develop/_data/simple-icons.json')
    if (res.ok) {
      const data = await res.json()
      simpleIconsData.value = data.icons
    }
  } catch (e) {
    console.error('Failed to fetch simple icons data', e)
  }
}

// 提取主域名关键词
const extractKeywordFromUrl = (url: string): string => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    // 1. 移除 www.
    let core = hostname.replace(/^www\./, '')
    
    // 2. 移除常见的顶级域名后缀 (TLD) 和二级后缀 (SLD)
    // 这是一个简化的列表，覆盖常见情况
    const suffixes = [
      '.com.cn', '.net.cn', '.org.cn', '.gov.cn', '.edu.cn',
      '.co.uk', '.co.jp', '.co.kr',
      '.com', '.cn', '.net', '.org', '.io', '.me', '.cc', '.info', '.biz', '.tv', '.top', '.xyz',
      '.edu', '.gov', '.mil', '.int'
    ]
    
    for (const suffix of suffixes) {
      if (core.endsWith(suffix)) {
        core = core.slice(0, -suffix.length)
        break // 只移除最长匹配的后缀一次
      }
    }
    
    // 3. 如果还包含点号（例如 news.163），取最后一部分
    if (core.includes('.')) {
      const parts = core.split('.')
      return parts[parts.length - 1]
    }
    
    return core
  } catch (e) {
    return ''
  }
}

// 自动适配图标 (两阶段搜索：本地 -> API)
const autoAdaptIcon = async () => {
  // 优先尝试从 URL 提取关键词，如果没有则使用标题
  let searchTerm = ''
  
  const targetUrl = form.value.url || form.value.lanUrl
  if (targetUrl) {
    searchTerm = extractKeywordFromUrl(targetUrl)
  }
  
  if (!searchTerm) {
    searchTerm = form.value.title.trim()
  }
  
  if (!searchTerm) return alert('请先填写链接或标题作为搜索关键词！')
  
  isFetching.value = true
  iconType.value = 'image'
  
  try {
    // Phase 1: 本地搜索
    console.log(`[Search] Starting Phase 1 (Local) for: "${searchTerm}"`)
    await fetchLocalIcons()
    const lowerTitle = searchTerm.toLowerCase()
    
    const localMatches = localIcons.value.filter(icon => {
      const name = icon.split('/').pop()?.split('.')[0].toLowerCase() || ''
      // 简单的模糊匹配
      return name.includes(lowerTitle)
    })
    
    console.log(`[Search] Phase 1 found ${localMatches.length} matches`)

    if (localMatches.length > 0) {
      if (localMatches.length === 1) {
        console.log(`[Search] Auto-selecting single local match: ${localMatches[0]}`)
        form.value.icon = localMatches[0]
      } else {
        console.log(`[Search] Showing selection modal for ${localMatches.length} local matches`)
        iconCandidates.value = localMatches
        searchSource.value = 'local'
        showIconSelection.value = true
      }
      return
    }
    
    // Phase 2: API Fallback (Simple Icons)
    console.log(`[Search] Phase 1 failed. Starting Phase 2 (API) for: "${searchTerm}"`)
    await fetchSimpleIconsData()
    if (simpleIconsData.value) {
      const apiMatches = simpleIconsData.value.filter((icon: any) => 
        icon.title.toLowerCase().includes(lowerTitle) || 
        (icon.slug && icon.slug.includes(lowerTitle))
      ).map((icon: any) => `https://cdn.simpleicons.org/${icon.slug}`)
      
      console.log(`[Search] Phase 2 found ${apiMatches.length} matches`)

      if (apiMatches.length > 0) {
        if (apiMatches.length === 1) {
          console.log(`[Search] Auto-selecting single API match: ${apiMatches[0]}`)
          form.value.icon = apiMatches[0]
        } else {
          console.log(`[Search] Showing selection modal for ${apiMatches.length} API matches`)
          iconCandidates.value = apiMatches
          searchSource.value = 'api'
          showIconSelection.value = true
        }
        return
      }
    }
    
    // 原始逻辑兜底：尝试根据域名匹配
    const targetUrl = form.value.url || form.value.lanUrl
    if (targetUrl) {
        const urlObj = new URL(targetUrl)
        const domain = urlObj.hostname.replace(/^www\./, '').split('.')[0].toLowerCase()
        if (domain) {
            const fallbackIcon = `https://cdn.simpleicons.org/${domain}`
            if (await checkImageExists(fallbackIcon)) {
                form.value.icon = fallbackIcon
                return
            }
        }
    }

    alert('未找到适配的图标，尝试使用自动抓取功能？')
  } catch (e) {
    console.error(e)
    alert('搜索失败，请检查网络')
  } finally {
    isFetching.value = false
  }
}

// 选中图标
const onIconSelect = (icon: string) => {
  form.value.icon = icon
}

// 自动抓取网站图标
const autoFetchIcon = async () => {
  const targetUrl = form.value.url || form.value.lanUrl
  if (!targetUrl) return alert('请先填写链接！')
  
  isFetching.value = true
  iconType.value = 'image' // 自动切换到图片模式
  
  try {
    const urlObj = new URL(targetUrl)
    // 尝试多种来源抓取图标
    const candidates = [
      `${urlObj.origin}/favicon.ico`,
      `https://api.uomg.com/api/favicon?url=${encodeURIComponent(targetUrl)}`,
      `https://icons.duckduckgo.com/ip3/${urlObj.hostname}.ico`
    ]
    
    let found = false
    for (const src of candidates) {
      if (await checkImageExists(src)) { 
        form.value.icon = src
        found = true
        break 
      }
    }
    
    if (!found) { 
      // 没抓到就用随机 Emoji 兜底
      randomEmoji()
      iconType.value = 'emoji'
    }
  } catch (e) { 
    alert('链接格式错误，无法抓取')
    isFetching.value = false 
  } finally { 
    isFetching.value = false 
  }
}

// 监听弹窗打开，初始化表单
watch(() => props.show, (newVal) => {
  if (newVal) {
    if (props.data) {
      // 编辑模式：回填数据
      form.value = { ...props.data }
      
      // 判断当前图标是图片还是 Emoji
      // 逻辑：只要 icon 有值，且看起来不像是一个单字符或双字符的 Emoji，就默认是图片模式
      // 这样可以避免把本地路径 (icons/xxx) 或 URL 误判为 Emoji
      const iconVal = form.value.icon || ''
      // Emoji 一般长度很短（1-2个字符，虽然有些组合 Emoji 会长一点，但路径通常更长）
      // 只要包含 '/' (路径) 或 '.' (文件名后缀) 或 ':' (协议)，肯定是图片
      const isLikelyImage = iconVal.length > 0 && (
        iconVal.length > 4 || 
        iconVal.includes('/') || 
        iconVal.includes('.') || 
        iconVal.includes(':') ||
        iconVal.startsWith('data:')
      )
      
      iconType.value = isLikelyImage ? 'image' : 'emoji'
      
      // 如果是空的，默认也给图片模式（配合之前修改的默认行为）
      if (!iconVal) {
        iconType.value = 'image'
      }
    } else {
      // 新增模式：重置表单
      form.value = { 
        title: '', 
        url: '', 
        lanUrl: '', 
        icon: '', 
        color: 'bg-blue-50 text-blue-600', 
        isPublic: true 
      }
      iconType.value = 'image'
    }
  }
})

const close = () => emit('update:show', false)

// 提交保存
const submit = () => {
  if (!form.value.title && !form.value.url) return alert('标题和链接总得写一个吧！')
  
  // ✨✨✨ 关键修改：将 groupId 一并传回，否则主页不知道加到哪个组 ✨✨✨
  emit('save', { 
    item: { ...form.value, id: props.data?.id }, 
    groupId: props.groupId 
  })
  
  close()
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
      
      <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
        <h3 class="text-lg font-bold text-gray-800">{{ data ? '修改项目' : '添加新项目' }}</h3>
        <button @click="close" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        
        <div class="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div>
            <span class="text-sm font-bold text-gray-700">公开显示</span>
            <p class="text-xs text-gray-400">开启后，未登录用户也能看到此项</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" v-model="form.isPublic" class="sr-only peer">
            <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
          </label>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1">标题 <span class="text-red-500">*</span></label>
          <input v-model="form.title" type="text" class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none transition-colors" placeholder="例如：我的博客">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1">外网链接 <span class="text-red-500">*</span></label>
          <input v-model="form.url" type="text" class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none transition-colors" placeholder="https://example.com">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1">内网链接 <span class="text-gray-400 text-xs">(选填，内网访问时优先跳转)</span></label>
          <input v-model="form.lanUrl" type="text" placeholder="http://192.168.1.x:8080" class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-green-500 outline-none transition-colors">
        </div>

        <div class="flex justify-between items-center">
          <button @click="autoAdaptIcon" :disabled="isFetching" class="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium transition-all" :class="isFetching ? 'bg-gray-100 text-gray-400' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'">
            <span v-if="isFetching" class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            {{ isFetching ? '适配中...' : '🧩 自动适配图标' }}
          </button>

          <button @click="autoFetchIcon" :disabled="isFetching" class="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium transition-all" :class="isFetching ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'">
            <span v-if="isFetching" class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            {{ isFetching ? '正在获取...' : '⚡ 自动抓取图标' }}
          </button>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-2">图标样式</label>
          <div class="flex bg-gray-100 p-1 rounded-lg mb-3 w-fit">
            <button @click="iconType = 'image'" class="px-4 py-1.5 rounded-md text-sm font-medium transition-all" :class="iconType === 'image' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'">🖼️ 图片</button>
            <button @click="iconType = 'emoji'" class="px-4 py-1.5 rounded-md text-sm font-medium transition-all" :class="iconType === 'emoji' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'">😊 Emoji</button>
          </div>

          <div v-if="iconType === 'emoji'" class="relative animate-fade-in">
            <input v-model="form.icon" type="text" class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none pr-20 text-xl" placeholder="输入 Emoji">
            <button @click="randomEmoji" class="absolute right-1 top-1 bottom-1 px-3 bg-yellow-50 text-yellow-600 text-xs font-bold rounded-md hover:bg-yellow-100 flex items-center gap-1">🎲 随机</button>
          </div>

          <div v-else class="space-y-3 animate-fade-in">
            <div class="flex items-center gap-2">
              <input v-model="form.icon" type="text" placeholder="图片 URL 地址..." class="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm focus:border-blue-500 outline-none">
              <div class="w-10 h-10 rounded border bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                <img v-if="form.icon" :src="form.icon" class="w-full h-full object-cover" @error="form.icon=''">
                <span v-else class="text-gray-300 text-xs">预览</span>
              </div>
            </div>
            
            <div class="text-xs text-gray-400 text-center flex items-center gap-2 before:h-px before:bg-gray-200 before:flex-1 after:h-px after:bg-gray-200 after:flex-1">或</div>
            
            <IconUploader v-model="form.icon" />
          </div>
        </div>
      </div>

      <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
        <button @click="close" class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors">取消</button>
        <button @click="submit" class="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95">{{ data ? '保存修改' : '确认添加' }}</button>
      </div>
    </div>
    
    <IconSelectionModal 
      v-model:show="showIconSelection"
      :candidates="iconCandidates"
      :title="form.title"
      :source="searchSource"
      @select="onIconSelect"
      @cancel-link="showIconSelection = false"
    />
  </div>
</template>

<style scoped>
.animate-fade-in { animation: fadeIn 0.2s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
</style>
