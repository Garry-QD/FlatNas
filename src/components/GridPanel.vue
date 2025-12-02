<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useStorage } from '@vueuse/core'
import { useMainStore } from '../stores/main'
import type { NavItem, WidgetConfig } from '../types'
import EditModal from './EditModal.vue'
import SettingsModal from './SettingsModal.vue'
import GroupSettingsModal from './GroupSettingsModal.vue'
import LoginModal from './LoginModal.vue'
import BookmarkWidget from './BookmarkWidget.vue'
import TodoWidget from './TodoWidget.vue'
import CalculatorWidget from './CalculatorWidget.vue'
import MiniPlayer from './MiniPlayer.vue'
import HotWidget from './HotWidget.vue'
import ClockWeatherWidget from './ClockWeatherWidget.vue'
import RssWidget from './RssWidget.vue'
import IconShape from './IconShape.vue'

const store = useMainStore()

const showEditModal = ref(false)
const showSettingsModal = ref(false)
const showGroupSettingsModal = ref(false)
const showLoginModal = ref(false)
const isEditMode = ref(false)
const currentEditItem = ref<NavItem | null>(null)
const currentGroupId = ref<string>('') 
const isLanMode = ref(false)
const latency = ref(0)
const isChecking = ref(true)
const searchEngineStored = useStorage('flat-nas-engine', 'google')
const engines = computed(() => store.appConfig.searchEngines || [
  { id: 'google', key: 'google', label: 'Google', urlTemplate: 'https://www.google.com/search?q={q}' },
  { id: 'bing', key: 'bing', label: 'Bing', urlTemplate: 'https://cn.bing.com/search?q={q}' },
  { id: 'baidu', key: 'baidu', label: '百度', urlTemplate: 'https://www.baidu.com/s?wd={q}' }
])
const effectiveEngine = computed({
  get: () => (store.appConfig.rememberLastEngine ? searchEngineStored.value : (store.appConfig.defaultSearchEngine || engines.value[0]?.key || 'google')),
  set: (val: string) => {
    if (store.appConfig.rememberLastEngine) {
      searchEngineStored.value = val
    } else {
      store.appConfig.defaultSearchEngine = val
    }
  }
})
const searchText = ref('')

// --- 核心修复逻辑开始 ---
// 用于清洗 SVG 代码中的无效颜色类名，强制转为白色
const processIcon = (iconStr: string) => {
  if (!iconStr) return ''
  if (!iconStr.trim().startsWith('<svg')) return iconStr
  let fixed = iconStr
  const badColorRegex = /fill-[a-z]+-(50|100|200)/g
  if (badColorRegex.test(fixed)) {
     fixed = fixed.replace(/class="([^"]*)\bfill-[a-z]+-(50|100|200)\b([^"]*)"/g, 'class="$1 $3" style="fill: #ffffff;"')
  }
  return fixed
}
// --- 核心修复逻辑结束 ---

const checkVisible = (obj?: WidgetConfig | NavItem) => {
  if (!obj) return false
  if ('enable' in obj && !obj.enable) return false
  if (store.isLogged) return true
  return !!obj.isPublic
}

const draggableWidgets = computed({
  get: () => store.widgets.filter(w => 
    checkVisible(w) && 
    w.type !== 'player' && 
    w.type !== 'search' && 
    w.type !== 'quote'
  ),
  set: (newOrder: WidgetConfig[]) => {
    const hiddenWidgets = store.widgets.filter(w => 
      !checkVisible(w) || 
      w.type === 'player' || 
      w.type === 'search' || 
      w.type === 'quote'
    )
    store.widgets = [...newOrder, ...hiddenWidgets]
    store.saveData()
  }
})

const displayGroups = computed(() => {
  return store.groups.map(g => ({
    ...g,
    items: g.items.filter(item => {
      const isMatch = !searchText.value || 
                      item.title.toLowerCase().includes(searchText.value.toLowerCase()) || 
                      item.url.toLowerCase().includes(searchText.value.toLowerCase())
      const isVisible = checkVisible(item)
      return isMatch && isVisible
    })
  })).filter(g => {
    if (store.isLogged) return true
    return g.items.length > 0 || !!g.preset
  })
})

const cycleWidgetSize = (widget: WidgetConfig) => {
  const currentC = widget.colSpan || 1
  const currentR = widget.rowSpan || (widget.type === 'bookmarks' ? 2 : 1)
  if (currentC === 1 && currentR === 1) { widget.colSpan = 2; widget.rowSpan = 1; }
  else if (currentC === 2 && currentR === 1) { widget.colSpan = 1; widget.rowSpan = 2; }
  else if (currentC === 1 && currentR === 2) { widget.colSpan = 2; widget.rowSpan = 2; }
  else { widget.colSpan = 1; widget.rowSpan = 1; }
  store.saveData()
}


const devtoolsClickCount = ref(0)
const devtoolsClickTimer = ref<number | null>(null)

const toggleDevTools = () => {
  const style = document.getElementById('devtools-hider')
  if (style) {
    style.remove()
  } else {
    const newStyle = document.createElement('style')
    newStyle.id = 'devtools-hider'
    newStyle.innerHTML = `
      #vue-devtools-anchor,
      .vue-devtools__anchor,
      .vue-devtools__trigger,
      [data-v-inspector-toggle] {
        display: none !important;
      }
    `
    document.head.appendChild(newStyle)
  }
}

const handleNetworkClick = async () => {
  checkNetwork()
  
  const now = Date.now()
  if (!devtoolsClickTimer.value) {
    devtoolsClickTimer.value = now
    devtoolsClickCount.value = 1
  } else {
    if (now - devtoolsClickTimer.value > 5000) {
      devtoolsClickTimer.value = now
      devtoolsClickCount.value = 1
    } else {
      devtoolsClickCount.value++
    }
  }

  if (devtoolsClickCount.value >= 10) {
    toggleDevTools()
    devtoolsClickCount.value = 0
    devtoolsClickTimer.value = null
  }
}

const checkNetwork = async () => {
  isChecking.value = true
  const start = performance.now()
  try {
    const pingUrl = `/api/data?ping=${Date.now()}`
    await fetch(pingUrl, { method: 'GET', cache: 'no-cache' })
    const end = performance.now()
    latency.value = Math.round(end - start)
    isLanMode.value = latency.value < 27
  } catch (e) {
    isLanMode.value = false
  } finally {
    isChecking.value = false
  }
}

onMounted(() => { 
  setTimeout(() => checkNetwork(), 2000)
  fetchIp()
  store.init().then(() => { store.cleanInvalidGroups() })
})

const doSearch = () => {
  if (!searchText.value) return
  const eng = engines.value.find(e => e.key === effectiveEngine.value)
  const template = eng?.urlTemplate || 'https://www.google.com/search?q={q}'
  const url = template.replace('{q}', encodeURIComponent(searchText.value))
  window.open(url, '_blank')
  searchText.value = ''
}

const openAddModal = (groupId: string) => { 
  currentEditItem.value = null
  currentGroupId.value = groupId 
  showEditModal.value = true 
}
const openEditModal = (item: NavItem) => { 
  currentEditItem.value = item
  showEditModal.value = true 
}
const handleSave = (payload: { item: NavItem, groupId?: string }) => {
  if (payload.item.id) store.updateItem(payload.item)
  else if (payload.groupId) store.addItem({ ...payload.item, id: Date.now().toString() }, payload.groupId)
}

const deleteItem = (id: string) => {
  openDeleteConfirm(id)
}
const handleCardClick = (item: NavItem) => {
  if (isEditMode.value) return
  
  // 逻辑优化：
  // 1. 默认使用外网链接 (item.url)
  // 2. 只有在【已登录】且【处于内网环境】且【配置了内网链接】时，才优先使用内网链接
  // 这样实现了：未登录状态下，即使在内网，也强制使用外网链接；除非根本没有外网链接。
  
  let targetUrl = item.url

  if (store.isLogged && isLanMode.value && item.lanUrl) {
    targetUrl = item.lanUrl
  }

  // 特殊情况：如果解析出的 targetUrl 为空（说明没有外网链接），
  // 但存在内网链接（说明是因为未登录被降级了，或者是压根没配外网链接）
  // 此时如果用户未登录，则拦截并提示登录。
  if (!targetUrl && item.lanUrl && !store.isLogged) {
    showLoginModal.value = true
    return
  }

  // 如果确实没有链接可跳，则不做反应
  if (!targetUrl) return

  window.open(targetUrl, '_blank')
}
const handleAuthAction = () => { if (store.isLogged) { if (confirm('确定要退出管理员模式吗？')) { store.logout(); isEditMode.value = false } } else { showLoginModal.value = true } }
const openSettings = () => { if (!store.isLogged) { showLoginModal.value = true } else { showSettingsModal.value = true } }

const updateGroupName = (id: string, e: Event) => {
  const val = (e.target as HTMLElement).innerText
  store.updateGroupTitle(id, val)
}

// --- Context Menu Logic ---
const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const contextMenuItem = ref<NavItem | null>(null)

const handleContextMenu = (e: MouseEvent, item: NavItem) => {
  if (!store.isLogged) return
  
  e.preventDefault()
  contextMenuItem.value = item
  
  // Prevent menu from going off-screen (basic logic)
  const menuWidth = 150
  const menuHeight = 100
  let x = e.clientX
  let y = e.clientY
  
  if (x + menuWidth > window.innerWidth) x -= menuWidth
  if (y + menuHeight > window.innerHeight) y -= menuHeight
  
  contextMenuPosition.value = { x, y }
  showContextMenu.value = true
}

const closeContextMenu = () => {
  showContextMenu.value = false
}

const handleMenuLanOpen = () => {
  const item = contextMenuItem.value
  closeContextMenu()
  
  if (!item || !item.lanUrl) return

  // 内网访问依然需要登录权限
  if (!store.isLogged) {
    showLoginModal.value = true
    return
  }
  
  window.open(item.lanUrl, '_blank')
}

const handleMenuEdit = () => {
  if (contextMenuItem.value) {
    openEditModal(contextMenuItem.value)
  }
  closeContextMenu()
}

const handleMenuDelete = () => {
  const item = contextMenuItem.value
  closeContextMenu()
  if (item) {
    openDeleteConfirm(item.id)
  }
}

// --- Delete Confirmation Logic ---
const showDeleteConfirm = ref(false)
const itemToDelete = ref<string | null>(null)

const openDeleteConfirm = (id: string) => {
  itemToDelete.value = id
  showDeleteConfirm.value = true
}

const confirmDelete = () => {
  if (itemToDelete.value) {
    store.deleteItem(itemToDelete.value)
  }
  showDeleteConfirm.value = false
  itemToDelete.value = null
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
  document.addEventListener('scroll', closeContextMenu, true)
})

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu)
  document.removeEventListener('scroll', closeContextMenu, true)
})

// --- Group Settings ---
const activeGroupId = ref<string | null>(null)

const toggleGroupSettings = (id: string) => {
  activeGroupId.value = id
  showGroupSettingsModal.value = true
}

const checkMove = (evt: any) => {
  return true
}

const getLayoutConfig = (group: any) => {
   const showBg = group.showCardBackground ?? store.appConfig.showCardBackground
   const layout = group.cardLayout || store.appConfig.cardLayout
   const isHorizontal = layout === 'horizontal'
   const isNoBg = showBg === false
   
   const baseGap = group.gridGap || store.appConfig.gridGap
   const gap = isNoBg ? Math.max(4, Math.round(baseGap * 0.6)) : baseGap

   const baseSize = group.cardSize || store.appConfig.cardSize || 120
   const ratio = baseSize / 120
   
   const modeScale = isNoBg ? 0.6 : 1.0
   const finalScale = ratio * modeScale
   
   const v_w = 120 * finalScale
   const v_h = 128 * finalScale
   
   const h_w = 220 * finalScale
   const h_h = 80 * finalScale
   
   // Icon Size Logic
   const customIconSize = group.iconSize || store.appConfig.iconSize
   let v_icon, h_icon
   
   if (customIconSize) {
      // If explicit icon size is set, use it as base, but still apply modeScale (compact mode)
      v_icon = customIconSize * modeScale
      h_icon = (customIconSize * (40/48)) * modeScale 
   } else {
      // Legacy behavior: scale with card size
      v_icon = 48 * finalScale
      h_icon = 40 * finalScale
   }

   return {
     minWidth: isHorizontal ? h_w : v_w,
     height: isHorizontal ? h_h : v_h,
     iconSize: isHorizontal ? h_icon : v_icon,
     gap
   }
 }

// Close settings when clicking outside
// Note: In a real app we might use onClickOutside from @vueuse/core on the menu ref,
// but here we can just rely on the fact that clicking elsewhere (if not stopped) handles it? 
// Actually, a global click listener or backdrop is safer. 
// For now, let's use a simple window click listener or just rely on the toggle.
// Better: Use a transparent fixed inset div when menu is open to catch clicks.


const hitokoto = ref({ hitokoto: '加载中...', from: '' })
const fetchHitokoto = async () => { try { const res = await fetch('https://v1.hitokoto.cn/?c=i&c=d&c=k'); hitokoto.value = await res.json() } catch (e) { hitokoto.value = { hitokoto: '生活原本沉闷，但跑起来就有风。', from: '网络' } } }

// --- 修复 IP 获取报错 ---
const ipInfo = ref({ 
  displayIp: '加载中...', 
  realIp: '', 
  location: '', 
  isProxy: false,
  baiduLatency: '--',
  details: [] as string[] // 用于存储所有检测到的 IP
})

const fetchIp = async () => { 
  ipInfo.value = { displayIp: '检测中...', realIp: '', location: '', isProxy: false, baiduLatency: '...', details: [] }
  
  // 检测百度延迟
  const start = performance.now()
  fetch('https://www.baidu.com', { mode: 'no-cors', cache: 'no-cache' })
    .then(() => {
      const end = performance.now()
      ipInfo.value.baiduLatency = Math.round(end - start) + 'ms'
    })
    .catch(() => {
      ipInfo.value.baiduLatency = 'Error'
    })

  // 定义多个检测源，尽量涵盖国内直连和国外代理
  const sources = [
    { id: 'ipify', url: 'https://api.ipify.org?format=json', type: 'json', field: 'ip', label: 'Global' },
    { id: 'ipapi', url: 'https://ipapi.co/json/', type: 'json', field: 'ip', label: 'Info' },
    { id: 'db-ip', url: 'https://api.db-ip.com/v2/free/self', type: 'json', field: 'ipAddress', label: 'DB-IP' }
  ]

  try {
    // 并行请求所有源
    const results = await Promise.allSettled(sources.map(async (s) => {
      try {
        const res = await fetch(s.url, { cache: 'no-cache' })
        if (!res.ok) throw new Error('Network error')
        let ip = ''
        if (s.type === 'json') {
          const data = await res.json()
          // 支持嵌套字段解析 (例如 data.ip)
          if (s.nestedField && data[s.nestedField]) {
            // @ts-ignore
            ip = data[s.nestedField][s.field]
          } else {
            // @ts-ignore
            ip = data[s.field]
          }
          
          // 特殊处理 ip-api 的地理位置
          if (s.id === 'ipapi' && data.city) {
             ipInfo.value.location = data.city
          }
        } else if (s.type === 'text' && s.regex) {
          const text = await res.text()
          const match = text.match(s.regex)
          if (match) ip = match[1] || ''
        }
        return { id: s.id, ip: ip, label: s.label }
      } catch (e) {
        return null
      }
    }))

    // 收集所有成功的 IP
    const validResults = results
      .filter(r => r.status === 'fulfilled' && r.value && r.value.ip)
      .map(r => (r as PromiseFulfilledResult<any>).value)

    if (validResults.length === 0) throw new Error('All failed')

    // 提取唯一 IP 列表
    const uniqueIps = [...new Set(validResults.map(r => r.ip))]
    ipInfo.value.details = uniqueIps

    // 无论是否相同，都尝试区分显示
    // 假设 ipify (Global) 是代理 IP，国内源 (baidu/toutiao/sohu) 是本地 IP
    const globalRes = validResults.find(r => r.id === 'ipify')
    const cnRes = validResults.find(r => ['baidu', 'toutiao', 'sohu'].includes(r.id))

    // 始终显示两行，除非完全获取不到
    ipInfo.value.isProxy = true // 强制显示两行布局
    
    if (globalRes) {
      ipInfo.value.displayIp = globalRes.ip
    } else if (uniqueIps.length > 0) {
      ipInfo.value.displayIp = uniqueIps[0]
    } else {
      ipInfo.value.displayIp = 'Unknown'
    }

    if (cnRes) {
      ipInfo.value.realIp = cnRes.ip
    } else if (uniqueIps.length > 1) {
      ipInfo.value.realIp = uniqueIps[1]
    } else {
      // 如果没有国内源结果，且只有一个IP，那就两行显示一样的，或者显示为"一致"
      ipInfo.value.realIp = ipInfo.value.displayIp
    }

    if (!ipInfo.value.location) ipInfo.value.location = '位置未知'

  } catch { 
    // 兜底
    ipInfo.value.displayIp = '127.0.0.1' 
    ipInfo.value.realIp = '127.0.0.1'
    ipInfo.value.location = '本地'
  } 
}
// --- 修复结束 ---

onMounted(() => { fetchHitokoto() })

const dateStr = ref(new Date().toLocaleDateString()); const timeStr = ref(new Date().toLocaleTimeString()); const now = new Date(); const dayNum = ref(now.getDate()); const weekDay = ref(['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]); const yearMonth = ref(`${now.getFullYear()}.${now.getMonth() + 1}`); setInterval(() => { const n = new Date(); timeStr.value = n.toLocaleTimeString(); if (n.getDate() !== dayNum.value) { dayNum.value = n.getDate(); weekDay.value = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][n.getDay()] } }, 1000)
</script>

<template>
  <div class="min-h-screen transition-all bg-cover bg-center bg-fixed" :style="{ backgroundImage: store.appConfig.background ? `url(${store.appConfig.background})` : '', backgroundColor: '#f3f4f6', '--group-title-color': store.appConfig.groupTitleColor || '#ffffff', '--card-bg-color': store.appConfig.cardBgColor || 'transparent', '--card-border-color': store.appConfig.cardBorderColor || 'transparent' }">
    <div class="min-h-screen p-8 transition-all pb-20" :class="store.appConfig.background ? 'bg-black/30 backdrop-blur-sm' : ''">
      <div class="max-w-7xl mx-auto">
        
        <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 relative">
          <div class="flex items-center gap-4 flex-shrink-0 z-30 transition-all duration-500" :style="{ order: store.appConfig.titleAlign === 'right' ? 2 : 0 }">
            <h1 class="font-bold transition-all duration-300 whitespace-nowrap" :style="{ fontSize: store.appConfig.titleSize + 'px', color: store.appConfig.titleColor, textShadow: store.appConfig.background ? '0 2px 8px rgba(0,0,0,0.5)' : 'none' }">{{ store.appConfig.customTitle }}</h1>
            <div class="flex items-center bg-white/90 backdrop-blur border border-gray-200 shadow-sm rounded-full p-1 gap-1 h-8">
              <div class="flex items-center gap-2 px-3 h-full rounded-full text-[10px] font-medium cursor-pointer hover:bg-gray-100 transition-all select-none" @click="handleNetworkClick">
                <template v-if="isChecking"><div class="w-2 h-2 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div></template>
                <template v-else><div class="w-1.5 h-1.5 rounded-full" :class="isLanMode ? 'bg-green-500' : 'bg-blue-500'"></div><span :class="isLanMode ? 'text-green-700' : 'text-blue-700'">{{ isLanMode ? '内网' : '外网' }}</span><span class="text-gray-400 border-l pl-2 ml-1">{{ latency }}ms</span></template>
              </div>
              <button @click="handleAuthAction" class="px-3 h-6 rounded-full text-[10px] font-bold transition-all" :class="[store.isLogged ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-500 hover:bg-blue-500 hover:text-white']">{{ store.isLogged ? '退出' : '登录' }}</button>
            </div>
          </div>

          <div v-if="checkVisible(store.widgets.find(w => w.id === 'w5'))" class="w-full md:absolute md:left-1/2 md:-translate-x-1/2 md:max-w-md z-20">
            <div class="mx-auto shadow-lg hover:shadow-xl transition-shadow rounded-full bg-white/90 backdrop-blur-md border border-white/40 flex items-center p-1" :style="{ width: 'calc(60% + 5px)', height: '41px' }">
              <input
                id="main-search-input"
                name="q"
                v-model="searchText"
                @keyup.enter="doSearch"
                type="text"
                role="searchbox"
                aria-label="搜索框"
                autocomplete="off"
                class="h-full pl-6 pr-4 rounded-full bg-transparent border-0 text-gray-900 placeholder-gray-500 outline-none"
                :style="{ width: 'calc(100% - 33.75%)' }"
                :placeholder="(engines.find(e=>e.key===effectiveEngine)?.label || '搜索') + ' 搜索...'"
              />
              <div class="flex items-center justify-end" :style="{ width: '33.75%' }">
                <select v-model="effectiveEngine" aria-label="搜索引擎" class="h-[34px] px-3 py-0 bg-white rounded-full border border-gray-200 focus:border-blue-400 outline-none" :style="{ width: 'calc(100%)', fontSize: '15px' }">
                  <option v-for="e in engines" :key="e.key" :value="e.key">{{ e.label }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex gap-3 flex-shrink-0 z-10 items-center transition-all duration-500" :style="{ order: store.appConfig.titleAlign === 'right' ? 0 : 2 }">
            <MiniPlayer v-if="checkVisible(store.widgets.find(w => w.type === 'player'))" key="mini-player-static" />
            <button @click="openSettings" class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center backdrop-blur transition-all border border-white/20 shadow-sm">⚙️</button>
            <button v-if="store.isLogged" @click="isEditMode = !isEditMode" class="px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm" :class="isEditMode ? 'bg-red-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'">{{ isEditMode ? '完成' : '编辑' }}</button>
          </div>
        </div>

        <VueDraggable v-model="draggableWidgets" :animation="300" :disabled="!isEditMode" class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 text-white select-none grid-flow-dense" style="grid-auto-rows: 140px;" ghostClass="ghost">
           <div v-for="widget in draggableWidgets" :key="widget.id" class="transition-all duration-300 relative" :class="[(widget.colSpan || 1) === 2 ? 'md:col-span-2' : 'md:col-span-1', (widget.rowSpan || (widget.type === 'bookmarks' ? 2 : 1)) === 2 ? 'row-span-2' : 'row-span-1', isEditMode ? 'ring-2 ring-blue-400/50 rounded-2xl cursor-move hover:ring-blue-500' : '']">
              <button v-if="isEditMode" @click.stop="cycleWidgetSize(widget)" class="absolute bottom-2 right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-blue-600 hover:scale-110 transition-all"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg></button>
              <div v-if="widget.type === 'clock'" class="w-full h-full p-6 rounded-2xl bg-black/20 backdrop-blur border border-white/10 flex flex-col items-center justify-center hover:bg-black/30 transition-colors"><div class="text-4xl font-mono font-bold">{{ timeStr }}</div><div class="text-sm opacity-80 mt-1">{{ dateStr }}</div></div>
              <div v-else-if="widget.type === 'weather'" class="w-full h-full p-6 rounded-2xl bg-blue-500/20 backdrop-blur border border-white/10 flex flex-col items-center justify-center hover:bg-blue-500/30 transition-colors"><div class="text-3xl">⛅ 26°C</div><div class="text-sm">多云转晴 · {{ ipInfo.location || '未知位置' }}</div></div>
              <div v-else-if="widget.type === 'calendar'" class="w-full h-full p-4 rounded-2xl bg-red-500/20 backdrop-blur border border-white/10 flex flex-col items-center justify-center relative overflow-hidden group hover:bg-red-500/30 transition-all"><div class="absolute -right-4 -bottom-6 text-9xl font-bold opacity-5 pointer-events-none">{{ dayNum }}</div><div class="text-xs opacity-70 tracking-widest uppercase mb-1">{{ yearMonth }}</div><div class="text-5xl font-bold shadow-text">{{ dayNum }}</div><div class="text-sm mt-1 bg-white/20 px-3 py-0.5 rounded-full backdrop-blur-md">{{ weekDay }}</div></div>
              <div v-else-if="widget.type === 'memo'" class="w-full h-full p-4 rounded-2xl bg-yellow-100/90 backdrop-blur border border-white/10 text-gray-700 relative group"><textarea :readonly="!store.isLogged" v-model="widget.data" class="w-full h-full bg-transparent resize-none outline-none text-sm placeholder-gray-600 font-medium" :placeholder="store.isLogged ? '写点什么...' : '暂无内容'"></textarea></div>
              <TodoWidget v-else-if="widget.type === 'todo'" :widget="widget" />
              <CalculatorWidget v-else-if="widget.type === 'calculator'" />
              <div v-else-if="widget.type === 'ip'" class="w-full h-full p-3 rounded-2xl bg-purple-500/20 backdrop-blur border border-white/10 flex flex-col items-center hover:bg-purple-500/30 transition-colors text-center">
                <div v-if="ipInfo.location" class="text-[22px] font-bold w-full truncate flex-1 flex items-center justify-center -mt-px" :title="ipInfo.location">{{ ipInfo.location }}</div>
                <div class="flex items-center justify-center gap-2 w-full flex-1">
                   <span class="text-[14px] opacity-70 uppercase">IP</span>
                   <span class="text-2xl font-mono font-bold leading-tight">{{ ipInfo.displayIp }}</span>
                </div>
                
                <div class="flex items-center justify-center gap-2 w-full flex-1">
                   <span class="text-[12px] opacity-70 uppercase">PING测试</span>
                   <div class="text-base font-mono font-medium text-purple-100 bg-purple-500/30 px-2 py-0.5 rounded">
                      {{ ipInfo.baiduLatency }}
                   </div>
                   <button @click="fetchIp" class="text-[12px] bg-white/20 px-2.5 py-0.5 rounded hover:bg-white/30 transition-colors">刷新</button>
                </div>
              </div>
              <div v-else-if="widget.type === 'iframe'" class="w-full h-full rounded-2xl bg-white backdrop-blur border border-white/10 overflow-hidden relative group"><iframe v-if="widget.data.url" :src="widget.data.url" class="w-full h-full border-0"></iframe><div v-else class="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">未设置 URL</div><input v-if="store.isLogged" v-model="widget.data.url" class="absolute bottom-2 left-2 right-2 text-xs p-1 rounded bg-white/90 border border-gray-200 opacity-0 group-hover:opacity-100 transition-opacity" placeholder="输入 https:// 网址"></div>
              <BookmarkWidget v-else-if="widget.type === 'bookmarks'" :widget="widget" />
              <HotWidget v-else-if="widget.type === 'hot'" :widget="widget" />
              <ClockWeatherWidget v-else-if="widget.type === 'clockweather'" />
              <RssWidget v-else-if="widget.type === 'rss'" :widget="widget" />
           </div>
        </VueDraggable>

        <VueDraggable 
          v-model="store.groups"
          handle=".group-handle"
          :move="checkMove"
          :animation="300"
          :disabled="!isEditMode"
          class="space-y-8 pb-20"
        >
          <div v-for="group in displayGroups" :key="group.id" class="group-container">
            <div class="flex items-center gap-3 mb-4 group-header relative">
              <div v-if="isEditMode" class="group-handle cursor-move text-white/50 hover:text-white p-1 select-none text-xl">⋮⋮</div>
              <h2 
                class="text-xl font-bold shadow-text px-2 rounded transition-colors outline-none"
                :style="{ color: group.titleColor || store.appConfig.groupTitleColor || 'var(--group-title-color)' }"
              >
                {{ group.title }}
              </h2>

              <div class="flex items-center gap-2">
                <button 
                  v-if="store.isLogged" 
                  @click="openAddModal(group.id)" 
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10" 
                  title="添加卡片"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>

                <button 
                  v-if="store.isLogged"
                  @click.stop="toggleGroupSettings(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="分组设置"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>

                <button 
                  v-if="store.isLogged && isEditMode" 
                  @click="store.deleteGroup(group.id)" 
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500 hover:text-white text-white/50 flex items-center justify-center transition-all shadow-sm border border-white/10" 
                  title="删除分组"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>

              <span v-if="group.preset" class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded border border-yellow-200">预设</span>
            </div>

            <VueDraggable
              v-model="group.items"
              group="apps"
              :animation="200"
              :disabled="!isEditMode"
              class="grid transition-all duration-300 min-h-[100px] rounded-xl"
              :class="isEditMode ? 'bg-white/5 border-2 border-dashed border-white/20 p-4' : ''"
              :style="{ 
                gap: getLayoutConfig(group).gap + 'px', 
                gridTemplateColumns: `repeat(auto-fill, minmax(${getLayoutConfig(group).minWidth}px, 1fr))` 
              }"
              ghostClass="ghost"
            >
              <div v-for="item in group.items" :key="item.id" @click="handleCardClick(item)" @contextmenu="handleContextMenu($event, item)" class="flex items-center justify-center cursor-pointer transition-all select-none relative group overflow-hidden" :class="[isEditMode ? 'animate-pulse cursor-move ring-2 ring-blue-400' : '', (group.cardLayout || store.appConfig.cardLayout) === 'horizontal' ? 'flex-row px-4 py-3 gap-3 justify-start' : 'flex-col justify-center', (group.iconShape || store.appConfig.iconShape) === 'circle' ? 'rounded-2xl' : (group.iconShape || store.appConfig.iconShape) === 'rounded' ? 'rounded-2xl' : (group.iconShape || store.appConfig.iconShape) === 'leaf' ? 'rounded-tl-3xl rounded-br-3xl rounded-tr-md rounded-bl-md' : 'rounded-lg', (group.showCardBackground ?? store.appConfig.showCardBackground) === false ? '' : 'border backdrop-blur-sm']" :style="{ height: getLayoutConfig(group).height + 'px', backgroundColor: (group.showCardBackground ?? store.appConfig.showCardBackground) === false ? 'transparent' : (group.cardBgColor || store.appConfig.cardBgColor || 'var(--card-bg-color)'), borderColor: (group.showCardBackground ?? store.appConfig.showCardBackground) === false ? 'transparent' : 'var(--card-border-color)' }">
                
                <div v-if="isEditMode && item.isPublic" class="absolute bottom-1 right-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 z-10">公开</div>

                <IconShape 
                  :shape="group.iconShape || store.appConfig.iconShape"
                  :size="getLayoutConfig(group).iconSize"
                  :bgClass="(item.color && !item.color.includes('sky') && item.color !== '#000000' && item.color !== 'bg-black') ? item.color : 'bg-white'"
                  :icon="processIcon(item.icon || '')"
                  class="transition-all duration-300"
                />
                <span class="font-medium truncate" :class="(group.cardLayout || store.appConfig.cardLayout) === 'horizontal' ? 'text-left text-sm flex-1' : 'text-center px-2 w-full'" :style="{ color: group.cardTitleColor || store.appConfig.cardTitleColor || '#111827' }">{{ item.title }}</span>
              </div>


            </VueDraggable>
          </div>
        </VueDraggable>

        <Transition name="fade">
          <div v-if="store.isLogged && isEditMode" class="flex justify-center pb-20">
            <button data-testid="add-group-btn" @click="store.addGroup" class="bg-white/10 hover:bg-white/20 text-white backdrop-blur border border-white/20 px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 shadow-lg">
              <span>➕</span> 新建分组
            </button>
          </div>
        </Transition>

      </div>
    </div>

    <div v-if="checkVisible(store.widgets.find(w => w.id === 'w7'))" class="fixed bottom-4 right-4 z-50 text-right max-w-md cursor-pointer hover:opacity-80 transition-opacity select-none" @click="fetchHitokoto" title="点击刷新"><p class="text-base font-serif italic mb-1 opacity-70" :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-600'">“ {{ hitokoto.hitokoto }} ”</p><p class="text-xs opacity-70" :class="store.appConfig.background ? 'text-white/80 shadow-text' : 'text-gray-400'">—— {{ hitokoto.from }}</p></div>
    
    <!-- Group Settings Overlay -->
    <GroupSettingsModal v-model:show="showGroupSettingsModal" :groupId="activeGroupId" />

    <EditModal v-model:show="showEditModal" :data="currentEditItem" :groupId="currentGroupId" @save="handleSave" />
    <SettingsModal v-model:show="showSettingsModal" />
    <LoginModal v-model:show="showLoginModal" />

    <!-- Context Menu -->
    <div 
      v-if="showContextMenu" 
      ref="contextMenuRef"
      class="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[120px] overflow-hidden transform transition-all duration-200 origin-top-left"
      :style="{ top: contextMenuPosition.y + 'px', left: contextMenuPosition.x + 'px' }"
      @click.stop
    >
      <div 
        v-if="contextMenuItem?.lanUrl"
        @click="handleMenuLanOpen"
        class="px-4 py-2 hover:bg-green-50 text-green-700 cursor-pointer flex items-center gap-2 text-sm transition-colors border-b border-gray-100"
      >
        <span>🌐</span> 内网访问
      </div>

      <div 
        @click="handleMenuEdit"
        class="px-4 py-2 hover:bg-blue-50 text-gray-700 cursor-pointer flex items-center gap-2 text-sm transition-colors"
      >
        <span>✎</span> 编辑卡片
      </div>
      <div 
        @click="handleMenuDelete"
        class="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer flex items-center gap-2 text-sm transition-colors border-t border-gray-100"
      >
        <span>✕</span> 删除卡片
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="showDeleteConfirm = false">
      <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm transform transition-all scale-100 border border-gray-100">
        <h3 class="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
          <span class="text-red-500 text-xl">⚠️</span> 删除确认
        </h3>
        <p class="text-gray-600 mb-6">确定要删除这个卡片吗？此操作无法撤销。</p>
        <div class="flex justify-end gap-3">
          <button @click="showDeleteConfirm = false" class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors">取消</button>
          <button @click="confirmDelete" class="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium shadow-sm transition-colors flex items-center gap-1">
            <span>🗑️</span> 删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ghost { opacity: 0.4; background: rgba(255, 255, 255, 0.5); border: 2px dashed #9ca3af; }
.shadow-text { text-shadow: 0 2px 4px rgba(0,0,0,0.6); }
[contenteditable]:focus { background-color: rgba(255,255,255,0.2); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(6px); }

:deep(path[class*="fill-sky-100"]),
:deep(path[class*="fill-blue-100"]),
:deep(path[class*="fill-blue-50"]),
:deep(path[class*="fill-gray-100"]),
:deep(path[class*="fill-purple-100"]),
:deep(path[class*="fill-green-100"]),
:deep(path[class*="fill-red-100"]),
:deep(path[class*="fill-yellow-100"]),
:deep(path[class*="fill-orange-100"]) {
  fill: #ffffff !important;
}
</style>
