<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useMainStore } from '../stores/main'
import IconUploader from './IconUploader.vue'
import PasswordConfirmModal from './PasswordConfirmModal.vue'
import { VueDraggable } from 'vue-draggable-plus'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits(['update:show'])
const store = useMainStore()

const activeTab = ref('style')
const passwordInput = ref('')
const newPasswordInput = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

// Password Confirm Logic
const showPasswordConfirm = ref(false)
const pendingAction = ref<(() => void) | null>(null)
const confirmTitle = ref('')

const requestAuth = (action: () => void, title: string) => {
  pendingAction.value = action
  confirmTitle.value = title
  showPasswordConfirm.value = true
}

const onAuthSuccess = () => {
  if (pendingAction.value) {
    pendingAction.value()
    pendingAction.value = null
  }
}

const close = () => emit('update:show', false)

const handleLogin = () => {
  if (store.login(passwordInput.value)) {
    alert('登录成功！')
    passwordInput.value = ''
  } else {
    alert('密码错误！')
  }
}
const handleChangePassword = () => {
  if (!newPasswordInput.value || newPasswordInput.value.length < 4) return alert('密码至少4位')
  store.changePassword(newPasswordInput.value)
  alert('密码修改成功')
  newPasswordInput.value = ''
}

const handleExport = () => {
  try {
    const backupData = {
      items: store.items,
      widgets: store.widgets,
      appConfig: store.appConfig,
      password: store.password,
      groups: store.groups,
    }
    const jsonString = JSON.stringify(backupData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flat-nas-backup-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('导出失败')
    console.error('[SettingsModal][Export] failed', e)
  }
}

const triggerImport = () => {
  fileInput.value?.click()
}
const handleFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const content = e.target?.result as string
      const data = JSON.parse(content)
      if (!data.groups && data.items) {
        data.groups = [{ id: Date.now().toString(), title: '默认分组', items: data.items }]
      }
      const r = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!r.ok) throw new Error('import_post_failed:' + r.status)
      alert('✅ 导入成功！')
      window.location.reload()
    } catch (err) {
      alert('❌ 导入失败，请检查文件格式是否为 JSON。')
      console.error('[SettingsModal][Import] failed', err)
    } finally {
      if (fileInput.value) fileInput.value.value = ''
    }
  }
  reader.readAsText(file)
}

const saveDefaultBtnText = ref('💾 设为默认模板')

const handleReset = async () => {
  requestAuth(async () => {
    // 密码验证通过后直接执行
    try {
      const r = await fetch('/api/reset', { method: 'POST' })
      if (!r.ok) throw new Error('reset_failed')
      // 移除成功弹窗，直接刷新
      window.location.reload()
    } catch (e) {
      alert('❌ 恢复失败')
      console.error('[SettingsModal][Reset] failed', e)
    }
  }, '请输入密码以确认恢复初始化')
}

const handleSaveAsDefault = async () => {
  requestAuth(async () => {
    // 密码验证通过后直接执行
    try {
      const r = await fetch('/api/default/save', { method: 'POST' })
      if (!r.ok) throw new Error('save_default_failed')

      // 移除成功弹窗，使用按钮文字反馈
      saveDefaultBtnText.value = '✅ 保存成功！'
      setTimeout(() => {
        saveDefaultBtnText.value = '💾 设为默认模板'
      }, 2000)
    } catch (e) {
      alert('❌ 保存失败')
      console.error('[SettingsModal][SaveDefault] failed', e)
    }
  }, '请输入密码以确认保存默认模板')
}

// 修复：移除 computed 中的副作用，改用 onMounted 初始化
onMounted(() => {
  store.widgets.forEach((w) => {
    if (w.type === 'iframe' && !w.data) {
      w.data = { url: '' }
    }
  })
})

const addSearchEngine = () => {
  const id = Date.now().toString()
  const key = 'custom-' + id
  const label = '新搜索引擎'
  const urlTemplate = 'https://example.com/search?q={q}'

  if (!store.appConfig.searchEngines) {
    store.appConfig.searchEngines = []
  }
  store.appConfig.searchEngines.push({ id, key, label, urlTemplate })
}
const removeSearchEngine = (key: string) => {
  const list = (store.appConfig.searchEngines || []).filter((e) => e.key !== key)
  store.appConfig.searchEngines = list
  if (store.appConfig.defaultSearchEngine === key) {
    store.appConfig.defaultSearchEngine = list[0]?.key || undefined
  }
}

// RSS Logic
const rssForm = ref({
  id: '',
  title: '',
  url: '',
  category: '',
  tags: '',
  enable: true,
  isPublic: true,
})
const editingRss = ref(false)

const editRss = (feed?: any) => {
  if (feed) {
    rssForm.value = { ...feed, tags: (feed.tags || []).join(', ') }
    editingRss.value = true
  } else {
    rssForm.value = {
      id: '',
      title: '',
      url: '',
      category: '',
      tags: '',
      enable: true,
      isPublic: true,
    }
    editingRss.value = true
  }
}

const saveRss = () => {
  if (!rssForm.value.title || !rssForm.value.url) return alert('请填写标题和 URL')

  const tags = rssForm.value.tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t)
  const newItem = {
    id: rssForm.value.id || Date.now().toString(),
    title: rssForm.value.title,
    url: rssForm.value.url,
    category: rssForm.value.category,
    tags,
    enable: rssForm.value.enable,
    isPublic: rssForm.value.isPublic,
  }

  if (!store.rssFeeds) store.rssFeeds = []

  if (rssForm.value.id) {
    const index = store.rssFeeds.findIndex((f) => f.id === rssForm.value.id)
    if (index !== -1) store.rssFeeds[index] = newItem
  } else {
    store.rssFeeds.push(newItem)
  }

  // Auto-add category
  if (rssForm.value.category) {
    if (!store.rssCategories) store.rssCategories = []
    const exists = store.rssCategories.some((c) => c.name === rssForm.value.category)
    if (!exists) {
      store.rssCategories.push({ id: Date.now().toString() + '-cat', name: rssForm.value.category })
    }
  }

  store.saveData() // Trigger save
  editingRss.value = false
}

const deleteRss = (id: string) => {
  if (!confirm('确定删除此订阅源？')) return
  store.rssFeeds = store.rssFeeds.filter((f) => f.id !== id)
}

const rssWidget = computed(() => store.widgets.find((w) => w.type === 'rss'))

// RSS Category Management
const managingCategories = ref(false)
const newCategoryName = ref('')
const editingCategoryId = ref<string | null>(null)
const editCategoryName = ref('')

const addCategory = () => {
  const name = newCategoryName.value.trim()
  if (!name) return
  if (!store.rssCategories) store.rssCategories = []
  if (store.rssCategories.some((c) => c.name === name)) return alert('分类已存在')

  store.rssCategories.push({ id: Date.now().toString() + '-cat', name })
  newCategoryName.value = ''
  store.saveData()
}

const startEditCategory = (cat: { id: string; name: string }) => {
  editingCategoryId.value = cat.id
  editCategoryName.value = cat.name
}

const updateCategory = () => {
  if (!editingCategoryId.value || !editCategoryName.value.trim()) return
  const index = store.rssCategories.findIndex((c) => c.id === editingCategoryId.value)
  if (index !== -1) {
    // Update category name in feeds
    const oldName = store.rssCategories[index].name
    const newName = editCategoryName.value.trim()
    store.rssCategories[index].name = newName

    // Update associated feeds
    if (store.rssFeeds) {
      store.rssFeeds.forEach((f) => {
        if (f.category === oldName) f.category = newName
      })
    }
    store.saveData()
  }
  editingCategoryId.value = null
  editCategoryName.value = ''
}

const deleteCategory = (id: string) => {
  if (!confirm('确定删除该分类？(该分类下的订阅源将变为无分类)')) return
  const cat = store.rssCategories.find((c) => c.id === id)
  if (cat) {
    // Clear category from feeds
    if (store.rssFeeds) {
      store.rssFeeds.forEach((f) => {
        if (f.category === cat.name) f.category = ''
      })
    }
    store.rssCategories = store.rssCategories.filter((c) => c.id !== id)
    store.saveData()
  }
}

// Tag Suggestions
const allTags = computed(() => {
  const tags = new Set<string>()
  store.rssFeeds?.forEach((f) => {
    f.tags?.forEach((t) => tags.add(t))
  })
  return Array.from(tags)
})

const addTagToForm = (tag: string) => {
  const currentTags = rssForm.value.tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t)
  if (!currentTags.includes(tag)) {
    currentTags.push(tag)
    rssForm.value.tags = currentTags.join(', ')
  }
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex h-[480px] relative"
    >
      <button
        @click="close"
        class="absolute top-4 right-4 bg-[#FF0000] hover:bg-red-600 text-white z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div class="w-48 bg-gray-50 border-r border-gray-100 p-4 flex flex-col">
        <h3 class="text-xl font-bold text-gray-800 mb-6 px-2">⚙️ 设置</h3>
        <nav class="space-y-1">
          <button
            @click="activeTab = 'style'"
            :class="
              activeTab === 'style'
                ? 'bg-purple-100 text-purple-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🎨 外观与布局
          </button>
          <button
            @click="activeTab = 'widgets'"
            :class="
              activeTab === 'widgets'
                ? 'bg-green-100 text-green-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🧩 小组件
          </button>
          <button
            @click="activeTab = 'rss'"
            :class="
              activeTab === 'rss'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            📡 RSS 订阅
          </button>
          <button
            @click="activeTab = 'search'"
            :class="
              activeTab === 'search'
                ? 'bg-blue-100 text-blue-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🔎 搜索引擎
          </button>
          <button
            @click="activeTab = 'account'"
            :class="
              activeTab === 'account'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors"
          >
            🔒 账户管理
          </button>
        </nav>

        <div class="mt-auto flex items-center justify-center gap-4 pt-4 border-t border-gray-200">
          <a
            href="https://github.com/Garry-QD/FlatNas"
            target="_blank"
            class="text-gray-400 hover:text-gray-800 transition-colors"
            title="GitHub"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-6 h-6"
            >
              <path
                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
              />
            </svg>
          </a>
          <a
            href="https://hub.docker.com/r/qdnas/flatnas"
            target="_blank"
            class="text-gray-400 hover:text-blue-600 transition-colors"
            title="Docker"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-6 h-6"
            >
              <path
                d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.119a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m-2.955 5.43h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186H8.074a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954 5.43h2.119a.186.186 0 00.186-.186v-1.888a.186.186 0 00-.186-.185H5.12a.185.185 0 00-.185.185v1.888c0 .103.083.186.185.186m2.954 0h2.119a.186.186 0 00.186-.186v-1.888a.186.186 0 00-.186-.185H8.074a.185.185 0 00-.185.185v1.888c0 .103.083.186.185.186m2.955 0h2.119a.186.186 0 00.186-.186v-1.888a.186.186 0 00-.186-.185h-2.119a.185.185 0 00-.185.185v1.888c0 .103.083.186.185.186m2.954 0h2.119a.186.186 0 00.186-.186v-1.888a.186.186 0 00-.186-.185h-2.119a.185.185 0 00-.185.185v1.888c0 .103.083.186.185.186m5.908 0h2.119a.186.186 0 00.186-.186v-1.888a.186.186 0 00-.186-.185h-2.119a.185.185 0 00-.185.185v1.888c0 .103.083.186.185.186m-5.908-5.43h2.119a.186.186 0 00.186-.185V3.574a.186.186 0 00-.186-.185h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m8.861 5.614c-.25-.203-1.963-1.34-4.513-1.34a11.61 11.61 0 00-2.118.223l.03-.03V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185s.185-.083.185-.185V9.19h1.749v1.523c0 .102.083.185.185.185s.185-.083.185-.185V9.19h.23c.31.066.625.144.943.233.033.009.068.014.102.014.171 0 .326-.107.382-.276.061-.182-.034-.384-.211-.455a12.71 12.71 0 00-3.174-.39c-1.58 0-3.086.273-4.5.754-.16.055-.247.226-.198.387.05.161.221.25.388.201 1.349-.459 2.789-.719 4.31-.719.304 0 .606.01.906.03v1.737c0 .102.083.185.185.185s.185-.083.185-.185V9.472c2.456.123 3.983 1.166 4.096 1.257.076.061.12.152.12.248 0 .003 0 .007-.001.01v2.515c0 .102-.083.185-.185.185H2.563a.186.186 0 00-.186.185v3.292c0 2.02 1.642 3.662 3.662 3.662h11.62c2.02 0 3.662-1.642 3.662-3.662v-3.292a.186.186 0 00-.186-.185z"
              />
            </svg>
          </a>
        </div>
      </div>

      <div class="flex-1 flex flex-col bg-white overflow-hidden">
        <div class="flex-1 p-4 overflow-y-auto">
          <div v-if="activeTab === 'style'" class="space-y-4">
            <div>
              <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-blue-500 pl-2">
                基础信息
              </h4>
              <div class="space-y-2">
                <div>
                  <label class="text-sm font-bold text-gray-600 mb-1 block">网站标题</label>
                  <input
                    v-model="store.appConfig.customTitle"
                    type="text"
                    class="w-full px-2 py-2 border border-gray-200 rounded-xl focus:border-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label class="text-sm font-bold text-gray-600 mb-1 block">背景图片</label>
                  <div class="border border-gray-200 rounded-xl p-2 bg-gray-50">
                    <IconUploader v-model="store.appConfig.background" />
                    <button
                      v-if="store.appConfig.background"
                      @click="store.appConfig.background = ''"
                      class="mt-2 text-xs text-red-500 hover:underline"
                    >
                      清除背景
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-100"></div>

            <div>
              <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-purple-500 pl-2">
                布局与排版
              </h4>
              <div class="mb-2">
                <h5 class="text-sm font-bold text-gray-600 mb-2">顶部栏布局</h5>
                <div class="flex gap-2">
                  <button
                    @click="store.appConfig.titleAlign = 'left'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2"
                    :class="
                      store.appConfig.titleAlign === 'left'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    "
                  >
                    <span>⬅️</span><span class="text-sm font-bold">标准布局</span>
                  </button>
                  <button
                    @click="store.appConfig.titleAlign = 'right'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2"
                    :class="
                      store.appConfig.titleAlign === 'right'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    "
                  >
                    <span class="text-sm font-bold">反转布局</span><span>➡️</span>
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <h4 class="text-sm font-bold text-gray-600 mb-1">标题大小</h4>
                  <input
                    type="range"
                    v-model.number="store.appConfig.titleSize"
                    min="20"
                    max="80"
                    class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                </div>
                <div>
                  <h4 class="text-sm font-bold text-gray-600 mb-1">标题颜色</h4>
                  <input
                    type="color"
                    v-model="store.appConfig.titleColor"
                    class="w-10 h-10 rounded cursor-pointer border-0 p-0"
                  />
                </div>
              </div>

              <div
                class="flex items-center justify-between mt-4 bg-purple-50 p-3 rounded-xl border border-purple-100"
              >
                <div class="flex items-center gap-2">
                  <span class="text-lg">🎵</span>
                  <span class="text-sm font-bold text-gray-700">自动播放随机音乐</span>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    v-model="store.appConfig.autoPlayMusic"
                    class="sr-only peer"
                  />
                  <div
                    class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"
                  ></div>
                </label>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'widgets'" class="space-y-4">
            <div class="flex items-center justify-between mb-4 mr-8">
              <h4 class="text-lg font-bold text-gray-800 border-l-4 border-green-500 pl-3">
                桌面小组件
              </h4>
              <div class="flex items-center gap-3 text-xs mr-[10px]">
                <div class="flex items-center gap-1">
                  <div class="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                  <span class="text-gray-500">公开</span>
                </div>
                <div class="flex items-center gap-1">
                  <div class="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                  <span class="text-gray-500">启用</span>
                </div>
              </div>
            </div>

            <!-- Normal Widgets Grid -->
            <div class="grid grid-cols-4 gap-4">
              <template v-for="w in store.widgets" :key="w.id">
                <div
                  v-if="w.type !== 'iframe'"
                  class="flex flex-col items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all aspect-square"
                >
                  <div class="flex flex-col items-center gap-1 flex-1 justify-center scale-90">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                    >
                      {{
                        w.type === 'clock'
                          ? '⏰'
                          : w.type === 'weather'
                            ? '🌦️'
                            : w.type === 'clockweather'
                              ? '🕒🌦️'
                              : w.type === 'calendar'
                                ? '📅'
                                : w.type === 'memo'
                                  ? '📝'
                                  : w.type === 'search'
                                    ? '🔍'
                                    : w.type === 'quote'
                                      ? '💬'
                                      : w.type === 'bookmarks'
                                        ? '📑'
                                        : w.type === 'todo'
                                          ? '✅'
                                          : w.type === 'calculator'
                                            ? '🧮'
                                            : w.type === 'ip'
                                              ? '🌐'
                                              : w.type === 'player'
                                                ? '🎵'
                                                : w.type === 'hot'
                                                  ? '🔥'
                                                  : w.type === 'rss'
                                                    ? '📡'
                                                    : '🖥️'
                      }}
                    </div>
                    <span class="font-bold text-gray-700 text-xs text-center truncate w-full px-1">
                      {{
                        w.type === 'clock'
                          ? '时钟'
                          : w.type === 'weather'
                            ? '天气'
                            : w.type === 'clockweather'
                              ? '时钟+天气'
                              : w.type === 'calendar'
                                ? '日历'
                                : w.type === 'memo'
                                  ? '备忘录'
                                  : w.type === 'search'
                                    ? '聚合搜索'
                                    : w.type === 'quote'
                                      ? '每日一言'
                                      : w.type === 'bookmarks'
                                        ? '收藏夹'
                                        : w.type === 'todo'
                                          ? '待办事项'
                                          : w.type === 'calculator'
                                            ? '计算器'
                                            : w.type === 'ip'
                                              ? 'IP 信息'
                                              : w.type === 'player'
                                                ? '随机音乐'
                                                : w.type === 'hot'
                                                  ? '全网热搜'
                                                  : w.type === 'rss'
                                                    ? 'RSS 阅读器'
                                                    : w.type === 'iframe'
                                                      ? '万能窗口'
                                                      : '未知组件'
                      }}
                    </span>
                  </div>
                  <div class="flex items-center justify-around w-full mt-1">
                    <div class="flex flex-col items-center gap-0.5">
                      <span class="text-[10px] text-gray-400 scale-90">公开</span>
                      <label class="relative inline-flex items-center cursor-pointer" title="公开"
                        ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" />
                        <div
                          class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-center gap-0.5">
                      <span class="text-[10px] text-gray-400 scale-90">启用</span>
                      <label class="relative inline-flex items-center cursor-pointer" title="启用"
                        ><input type="checkbox" v-model="w.enable" class="sr-only peer" />
                        <div
                          class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <!-- Universal Window (Iframe) Widgets -->
            <template v-for="w in store.widgets" :key="'iframe-' + w.id">
              <div
                v-if="w.type === 'iframe'"
                class="flex flex-col gap-3 p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                    >
                      🖥️
                    </div>
                    <span class="font-bold text-gray-700">万能窗口</span>
                  </div>
                  <div class="flex items-center gap-6">
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">公开</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input type="checkbox" v-model="w.enable" class="sr-only peer" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="w-full bg-white p-3 rounded-lg border border-gray-100">
                  <label class="block text-xs font-bold text-gray-600 mb-2">嵌入网址 (URL)</label>
                  <input
                    v-model="w.data.url"
                    type="url"
                    placeholder="例如：https://example.com 或内网地址"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none"
                  />
                  <p class="text-[10px] text-gray-400 mt-1">
                    保存后桌面将以窗口显示该网页；设置为公开可让未登录用户可见。
                  </p>
                </div>
              </div>
            </template>
          </div>

          <div v-if="activeTab === 'rss'" class="space-y-6">
            <div
              class="flex items-center justify-between border-l-4 border-orange-500 pl-3 mb-4 mr-8"
            >
              <h4 class="text-lg font-bold text-gray-800">RSS 订阅管理</h4>
              <span
                class="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100 flex items-center gap-1 mr-[10px]"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                云端同步已开启
              </span>
            </div>

            <!-- RSS Widget Master Switch -->
            <div
              v-if="rssWidget"
              class="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
            >
              <div class="flex items-center gap-4">
                <div
                  class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                >
                  📡
                </div>
                <div>
                  <h5 class="font-bold text-gray-700">RSS 阅读器组件</h5>
                  <p class="text-xs text-gray-400">桌面组件总开关</p>
                </div>
              </div>
              <div class="flex items-center gap-6">
                <div class="flex flex-col items-end gap-1">
                  <span class="text-[10px] text-gray-400 font-medium">公开</span
                  ><label class="relative inline-flex items-center cursor-pointer"
                    ><input type="checkbox" v-model="rssWidget.isPublic" class="sr-only peer" />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                    ></div
                  ></label>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <span class="text-[10px] text-gray-400 font-medium">启用</span
                  ><label class="relative inline-flex items-center cursor-pointer"
                    ><input type="checkbox" v-model="rssWidget.enable" class="sr-only peer" />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                    ></div
                  ></label>
                </div>
              </div>
            </div>

            <!-- Add/Edit Form -->
            <div
              v-if="editingRss"
              class="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6 animate-fade-in"
            >
              <h5 class="text-sm font-bold text-orange-800 mb-3">
                {{ rssForm.id ? '编辑订阅源' : '新增订阅源' }}
              </h5>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">标题</label>
                  <input
                    v-model="rssForm.title"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                    placeholder="例如：少数派"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">RSS 地址</label>
                  <input
                    v-model="rssForm.url"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                    placeholder="https://..."
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">分类</label>
                    <input
                      v-model="rssForm.category"
                      list="rss-categories"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                      placeholder="选择或输入分类"
                    />
                    <datalist id="rss-categories">
                      <option v-for="c in store.rssCategories" :key="c.id" :value="c.name"></option>
                    </datalist>
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1"
                      >标签 (逗号分隔)</label
                    >
                    <input
                      v-model="rssForm.tags"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                      placeholder="科技, 设计"
                    />
                    <div v-if="allTags.length > 0" class="mt-2 flex flex-wrap gap-2">
                      <span class="text-[10px] text-gray-400">常用标签：</span>
                      <button
                        v-for="tag in allTags"
                        :key="tag"
                        @click="addTagToForm(tag)"
                        class="text-[10px] px-1.5 py-0.5 bg-gray-100 hover:bg-orange-100 text-gray-500 hover:text-orange-600 rounded transition-colors"
                      >
                        {{ tag }}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-6 pt-2">
                  <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" v-model="rssForm.enable" class="accent-orange-500" />
                    启用
                  </label>
                  <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" v-model="rssForm.isPublic" class="accent-orange-500" />
                    公开
                  </label>
                </div>
                <div class="flex justify-end gap-3 mt-2">
                  <button
                    @click="editingRss = false"
                    class="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm font-bold"
                  >
                    取消
                  </button>
                  <button
                    @click="saveRss"
                    class="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>

            <!-- RSS List / Category Management -->
            <div v-if="!editingRss">
              <div class="flex gap-3 mb-4">
                <button
                  @click="editRss()"
                  class="flex-1 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition-all text-sm font-bold flex items-center justify-center gap-2"
                >
                  <span>+</span> 新增订阅源
                </button>
                <button
                  @click="managingCategories = !managingCategories"
                  :class="
                    managingCategories
                      ? 'bg-orange-100 text-orange-600 border-orange-200'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  "
                  class="px-4 py-3 border rounded-xl text-sm font-bold transition-all"
                >
                  {{ managingCategories ? '返回订阅列表' : '🗂️ 管理分类' }}
                </button>
              </div>

              <!-- Category Management View -->
              <div v-if="managingCategories" class="space-y-4 animate-fade-in">
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <h5 class="text-sm font-bold text-gray-700 mb-3">添加新分类</h5>
                  <div class="flex gap-2">
                    <input
                      v-model="newCategoryName"
                      @keyup.enter="addCategory"
                      placeholder="输入分类名称..."
                      class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-orange-500"
                    />
                    <button
                      @click="addCategory"
                      class="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600"
                    >
                      添加
                    </button>
                  </div>
                </div>

                <div class="space-y-2">
                  <div
                    v-for="cat in store.rssCategories"
                    :key="cat.id"
                    class="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm"
                  >
                    <div v-if="editingCategoryId === cat.id" class="flex-1 flex gap-2 mr-4">
                      <input
                        v-model="editCategoryName"
                        class="flex-1 px-2 py-1 border border-orange-300 rounded text-sm outline-none"
                      />
                      <button @click="updateCategory" class="text-green-600 text-xs font-bold">
                        保存
                      </button>
                      <button @click="editingCategoryId = null" class="text-gray-400 text-xs">
                        取消
                      </button>
                    </div>
                    <div v-else class="flex items-center gap-3">
                      <span class="text-xl">📁</span>
                      <span class="text-sm font-bold text-gray-700">{{ cat.name }}</span>
                      <span class="text-xs text-gray-400"
                        >({{
                          store.rssFeeds?.filter((f) => f.category === cat.name).length || 0
                        }})</span
                      >
                    </div>

                    <div v-if="editingCategoryId !== cat.id" class="flex items-center gap-2">
                      <button
                        @click="startEditCategory(cat)"
                        class="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded"
                      >
                        ✏️
                      </button>
                      <button
                        @click="deleteCategory(cat.id)"
                        class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div
                    v-if="!store.rssCategories || store.rssCategories.length === 0"
                    class="text-center py-8 text-gray-400 text-sm"
                  >
                    暂无分类
                  </div>
                </div>
              </div>

              <!-- RSS Feed List -->
              <div v-else class="space-y-3 animate-fade-in">
                <div
                  v-if="!store.rssFeeds || store.rssFeeds.length === 0"
                  class="text-center py-8 text-gray-400 text-sm"
                >
                  暂无订阅源，点击上方按钮添加
                </div>

                <div
                  v-for="feed in store.rssFeeds"
                  :key="feed.id"
                  class="p-4 border border-gray-100 rounded-xl bg-white hover:shadow-md transition-all group"
                >
                  <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg"
                      >
                        {{ feed.title.substring(0, 1) }}
                      </div>
                      <div>
                        <h5 class="font-bold text-gray-800">{{ feed.title }}</h5>
                        <div class="flex items-center gap-2 mt-1">
                          <span
                            v-if="feed.category"
                            class="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-500"
                            >{{ feed.category }}</span
                          >
                          <span class="text-[10px] text-gray-400 truncate max-w-[200px]">{{
                            feed.url
                          }}</span>
                        </div>
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <button
                        @click="editRss(feed)"
                        class="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                      >
                        ✏️
                      </button>
                      <button
                        @click="deleteRss(feed.id)"
                        class="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center justify-between pt-2 border-t border-gray-50 mt-2">
                    <div class="flex gap-2">
                      <span v-for="tag in feed.tags" :key="tag" class="text-[10px] text-orange-400"
                        >#{{ tag }}</span
                      >
                    </div>
                    <div class="flex gap-3">
                      <span
                        :class="feed.enable ? 'text-green-500' : 'text-gray-300'"
                        class="text-xs font-bold"
                        >{{ feed.enable ? '已启用' : '已禁用' }}</span
                      >
                      <span
                        :class="feed.isPublic ? 'text-blue-500' : 'text-gray-300'"
                        class="text-xs font-bold"
                        >{{ feed.isPublic ? '公开' : '私有' }}</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'search'" class="space-y-6">
            <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-blue-500 pl-3">
              搜索引擎设置
            </h4>
            <div class="text-xs text-gray-500 mb-2">
              拖拽调整优先级；设置默认或开启“记住上次选择”。
            </div>
            <VueDraggable
              v-model="store.appConfig.searchEngines"
              :animation="300"
              handle=".drag-handle"
              class="space-y-3"
            >
              <div
                v-for="e in store.appConfig.searchEngines"
                :key="e.id"
                class="p-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-white transition-all flex flex-col gap-2"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 flex-1">
                    <div
                      class="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="9" cy="12" r="1" />
                        <circle cx="9" cy="5" r="1" />
                        <circle cx="9" cy="19" r="1" />
                        <circle cx="15" cy="12" r="1" />
                        <circle cx="15" cy="5" r="1" />
                        <circle cx="15" cy="19" r="1" />
                      </svg>
                    </div>
                    <input
                      v-model="e.label"
                      class="text-sm font-bold text-gray-700 bg-transparent border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-1 py-0.5 outline-none transition-all w-32"
                      placeholder="名称"
                    />
                    <span class="text-[10px] text-gray-400 font-mono">{{ e.key }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-[10px] text-gray-500">设为默认</label>
                    <input
                      type="radio"
                      :value="e.key"
                      v-model="store.appConfig.defaultSearchEngine"
                    />
                    <button
                      class="text-xs text-red-500 hover:underline"
                      @click="removeSearchEngine(e.key)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <label class="text-[10px] text-gray-500">URL 模板</label>
                  <input
                    v-model="e.urlTemplate"
                    class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none"
                    placeholder="例如：https://example.com/search?q={q}"
                  />
                </div>
              </div>
            </VueDraggable>
            <div class="flex items-center gap-3">
              <button
                @click="addSearchEngine"
                class="flex-1 p-2 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-sm font-bold"
              >
                + 添加搜索引擎
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'account'" class="h-full flex flex-col justify-center">
            <div v-if="!store.isLogged" class="text-center">
              <h4 class="text-xl font-bold mb-6 text-gray-800">管理员登录</h4>
              <input
                v-model="passwordInput"
                type="password"
                placeholder="密码..."
                class="w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl mb-4 mx-auto text-center"
                @keyup.enter="handleLogin"
              />
              <button
                @click="handleLogin"
                class="bg-orange-500 text-white px-10 py-3 rounded-xl font-bold"
              >
                登 录
              </button>
            </div>
            <div v-else class="max-w-sm mx-auto w-full">
              <div class="bg-blue-50 p-5 rounded-xl border border-blue-100 mb-6">
                <h5 class="text-sm font-bold text-blue-800 mb-3">📦 备份与恢复</h5>
                <div class="grid grid-cols-2 gap-3">
                  <button
                    @click="handleExport"
                    class="bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-lg text-sm font-bold"
                  >
                    📤 导出配置
                  </button>
                  <button
                    @click="triggerImport"
                    class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
                  >
                    📥 导入配置
                  </button>
                  <button
                    @click="handleReset"
                    class="col-span-2 bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
                  >
                    🧹 恢复初始化
                  </button>
                  <button
                    @click="handleSaveAsDefault"
                    class="col-span-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-900 transition-all"
                  >
                    {{ saveDefaultBtnText }}
                  </button>
                  <input
                    ref="fileInput"
                    type="file"
                    accept=".navbak,.json"
                    class="hidden"
                    @change="handleFileChange"
                  />
                </div>
              </div>
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                <h5 class="text-sm font-bold text-gray-700 mb-3">🔑 修改密码</h5>
                <div class="flex gap-2">
                  <input
                    v-model="newPasswordInput"
                    type="password"
                    placeholder="新密码..."
                    class="flex-1 px-3 py-2 rounded-lg border border-gray-300"
                  /><button
                    @click="handleChangePassword"
                    class="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm"
                  >
                    修改
                  </button>
                </div>
              </div>
              <button
                @click="store.logout"
                class="w-full bg-red-50 text-red-600 py-3 rounded-xl font-bold border border-red-100"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <PasswordConfirmModal
    v-model:show="showPasswordConfirm"
    :title="confirmTitle"
    :on-success="onAuthSuccess"
  />
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
