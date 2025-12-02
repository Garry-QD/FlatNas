import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { NavItem, NavGroup, AppConfig, WidgetConfig, RssFeed, RssCategory } from '../types'

export const useMainStore = defineStore('main', () => {
  const groups = ref<NavGroup[]>([])
  const items = computed(() => groups.value.flatMap((g) => g.items))
  const rssFeeds = ref<RssFeed[]>([])
  const rssCategories = ref<RssCategory[]>([])

  const widgets = ref<WidgetConfig[]>([
    { id: 'w1', type: 'clock', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: 'w2', type: 'weather', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: 'w3', type: 'calendar', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: 'w4', type: 'memo', enable: true, data: '', colSpan: 1, rowSpan: 1, isPublic: false },
    { id: 'w5', type: 'search', enable: true, isPublic: true },
    {
      id: 'w6',
      type: 'bookmarks',
      enable: true,
      data: [],
      colSpan: 1,
      rowSpan: 2,
      isPublic: false,
    },
    { id: 'w7', type: 'quote', enable: true, isPublic: true },
    { id: 'w8', type: 'todo', enable: true, data: [], colSpan: 1, rowSpan: 1, isPublic: false },
    { id: 'w9', type: 'calculator', enable: false, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: 'w10', type: 'ip', enable: false, colSpan: 1, rowSpan: 1, isPublic: false },
    {
      id: 'w11',
      type: 'iframe',
      enable: false,
      data: { url: '' },
      colSpan: 2,
      rowSpan: 2,
      isPublic: true,
    },
    { id: 'player', type: 'player', enable: true, isPublic: true },
    {
      id: 'hot-list',
      type: 'hot',
      enable: true,
      colSpan: 1,
      rowSpan: 2,
      isPublic: true,
      data: { rssUrl: 'https://www.v2ex.com/feed/' },
    },
    {
      id: 'clockweather',
      type: 'clockweather',
      enable: true,
      colSpan: 1,
      rowSpan: 1,
      isPublic: true,
    },
    { id: 'rss-reader', type: 'rss', enable: false, colSpan: 1, rowSpan: 2, isPublic: true },
  ])

  const appConfig = ref<AppConfig>({
    background: '/default-wallpaper.svg',
    customTitle: '我的导航',
    titleAlign: 'left',
    titleSize: 48,
    titleColor: '#ffffff',
    cardLayout: 'vertical',
    cardSize: 120,
    gridGap: 24,
    cardBgColor: 'transparent',
    cardTitleColor: '#111827',
    cardBorderColor: 'transparent',
    showCardBackground: true,
    iconShape: 'rounded',
    searchEngines: [
      {
        id: 'google',
        key: 'google',
        label: 'Google',
        urlTemplate: 'https://www.google.com/search?q={q}',
      },
      { id: 'bing', key: 'bing', label: 'Bing', urlTemplate: 'https://cn.bing.com/search?q={q}' },
      { id: 'baidu', key: 'baidu', label: '百度', urlTemplate: 'https://www.baidu.com/s?wd={q}' },
    ],
    defaultSearchEngine: 'google',
    rememberLastEngine: true,
    groupTitleColor: '#ffffff',
  })

  const password = ref('admin')
  const isLogged = ref(localStorage.getItem('flat-nas-logged') === 'true')

  const init = async () => {
    try {
      const res = await fetch(`/api/data?t=${Date.now()}`)
      const data = await res.json()

      if (data.items && data.items.length > 0 && (!data.groups || data.groups.length === 0)) {
        groups.value = [{ id: Date.now().toString(), title: '默认分组', items: data.items }]
        saveData()
      } else if (data.groups) {
        groups.value = data.groups
        if (groups.value.length === 0) {
          groups.value.push({ id: 'g1', title: '常用', items: [], preset: true })
        }
      } else {
        groups.value = [{ id: 'g1', title: '常用', items: [], preset: true }]
      }

      if (data.widgets) {
        widgets.value = data.widgets
        // Ensure RSS widget exists
        if (!widgets.value.find((w) => w.type === 'rss')) {
          widgets.value.push({
            id: 'rss-reader',
            type: 'rss',
            enable: false,
            colSpan: 1,
            rowSpan: 2,
            isPublic: true,
          })
        }
      }

      if (data.appConfig) appConfig.value = { ...appConfig.value, ...data.appConfig }
      if (!appConfig.value.background) appConfig.value.background = '/default-wallpaper.svg'

      if (!appConfig.value.searchEngines || appConfig.value.searchEngines.length === 0) {
        appConfig.value.searchEngines = [
          {
            id: 'google',
            key: 'google',
            label: 'Google',
            urlTemplate: 'https://www.google.com/search?q={q}',
          },
          {
            id: 'bing',
            key: 'bing',
            label: 'Bing',
            urlTemplate: 'https://cn.bing.com/search?q={q}',
          },
          {
            id: 'baidu',
            key: 'baidu',
            label: '百度',
            urlTemplate: 'https://www.baidu.com/s?wd={q}',
          },
        ]
      }
      if (!appConfig.value.defaultSearchEngine) appConfig.value.defaultSearchEngine = 'google'
      if (typeof appConfig.value.rememberLastEngine !== 'boolean')
        appConfig.value.rememberLastEngine = true

      const cachedShape = localStorage.getItem('flat-nas-icon-shape')
      if (cachedShape) appConfig.value.iconShape = cachedShape as any
      const cachedColor = localStorage.getItem('flat-nas-group-title-color')
      if (cachedColor) appConfig.value.groupTitleColor = cachedColor
      const cachedCardBg = localStorage.getItem('flat-nas-card-bg-color')
      if (cachedCardBg) appConfig.value.cardBgColor = cachedCardBg
      if (data.password) password.value = data.password

      if (data.rssFeeds) rssFeeds.value = data.rssFeeds
      if (data.rssCategories) rssCategories.value = data.rssCategories
    } catch (e) {
      console.error('加载失败', e)
    }
  }

  // ✨✨✨ 关键修复：防抖定时器 ✨✨✨
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const saveData = async () => {
    // 如果有正在等待的保存任务，先取消它
    if (saveTimer) clearTimeout(saveTimer)

    // 延迟 500ms 再执行真正的保存
    // 这样即便 manual 和 watch 同时触发，也只会发送一次请求
    saveTimer = setTimeout(async () => {
      try {
        await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groups: groups.value,
            widgets: widgets.value,
            appConfig: appConfig.value,
            password: password.value,
            rssFeeds: rssFeeds.value,
            rssCategories: rssCategories.value,
          }),
        })
      } catch (e) {
        console.error('保存失败', e)
      }
    }, 500)
  }

  const cleanInvalidGroups = () => {
    const seen = new Set<string>()
    groups.value = groups.value.filter((g) => {
      const validId = typeof g.id === 'string' && g.id.length > 0
      const dup = validId && seen.has(g.id)
      if (validId) seen.add(g.id)
      const hasTitle = typeof g.title === 'string' && g.title.trim().length > 0
      const hasItems = Array.isArray(g.items) && g.items.length > 0
      return validId && (hasTitle || hasItems) && !dup
    })
  }

  const addGroup = () => {
    try {
      const id = Date.now().toString()
      const index = groups.value.length + 1
      const title = `新建分组 ${index}`
      groups.value.push({ id, title, items: [] })
      saveData()
    } catch (e) {
      console.error(e)
    }
  }

  const deleteGroup = (groupId: string, skipConfirm = false) => {
    if (!skipConfirm && !confirm('确定删除？')) return
    groups.value = groups.value.filter((g) => g.id !== groupId)
    saveData()
  }

  const updateGroupTitle = (groupId: string, newTitle: string) => {
    const group = groups.value.find((g) => g.id === groupId)
    if (group) {
      group.title = newTitle
      saveData()
    }
  }

  const updateGroup = (groupId: string, updates: Partial<NavGroup>) => {
    const group = groups.value.find((g) => g.id === groupId)
    if (group) {
      Object.assign(group, updates)
      saveData()
    }
  }

  const addItem = (item: NavItem, groupId: string) => {
    const group = groups.value.find((g) => g.id === groupId)
    if (group) {
      group.items.push({ ...item, isPublic: item.isPublic ?? true })
      saveData()
    }
  }

  const updateItem = (updatedItem: NavItem) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === updatedItem.id)
      if (idx !== -1) {
        group.items[idx] = updatedItem
        saveData()
        return
      }
    }
  }

  const deleteItem = (id: string) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === id)
      if (idx !== -1) {
        group.items.splice(idx, 1)
        saveData()
        return
      }
    }
  }

  const login = (pwd: string) => {
    if (pwd === password.value) {
      isLogged.value = true
      localStorage.setItem('flat-nas-logged', 'true')
      return true
    }
    return false
  }
  const logout = () => {
    isLogged.value = false
    localStorage.removeItem('flat-nas-logged')
  }
  const changePassword = (newPwd: string) => {
    password.value = newPwd
  }

  watch([groups, widgets, appConfig, password, rssFeeds, rssCategories], () => saveData(), {
    deep: true,
  })

  watch(
    () => appConfig.value.iconShape,
    (val) => {
      if (typeof val === 'string') localStorage.setItem('flat-nas-icon-shape', val)
    },
  )
  watch(
    () => appConfig.value.cardBgColor,
    (val) => {
      if (typeof val === 'string') localStorage.setItem('flat-nas-card-bg-color', val)
    },
  )

  return {
    groups,
    items,
    widgets,
    appConfig,
    password,
    isLogged,
    rssFeeds,
    rssCategories,
    init,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    updateGroup,
    addItem,
    updateItem,
    deleteItem,
    login,
    logout,
    changePassword,
    saveData,
    cleanInvalidGroups,
  }
})
