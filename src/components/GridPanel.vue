<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { VueDraggable } from "vue-draggable-plus";
import { useStorage } from "@vueuse/core";
import { useMainStore } from "../stores/main";
import type { NavItem, WidgetConfig, NavGroup } from "@/types";
import EditModal from "./EditModal.vue";
import SettingsModal from "./SettingsModal.vue";
import GroupSettingsModal from "./GroupSettingsModal.vue";
import LoginModal from "./LoginModal.vue";
import BookmarkWidget from "./BookmarkWidget.vue";
import MemoWidget from "./MemoWidget.vue";
import TodoWidget from "./TodoWidget.vue";
import CalculatorWidget from "./CalculatorWidget.vue";
import MiniPlayer from "./MiniPlayer.vue";
import HotWidget from "./HotWidget.vue";
import ClockWeatherWidget from "./ClockWeatherWidget.vue";
import RssWidget from "./RssWidget.vue";
import IconShape from "./IconShape.vue";
import IframeWidget from "./IframeWidget.vue";
import SimpleWeatherWidget from "./SimpleWeatherWidget.vue";
import AppSidebar from "./AppSidebar.vue";

import SizeSelector from "./SizeSelector.vue";

const store = useMainStore();

const showEditModal = ref(false);
const showSettingsModal = ref(false);
const showGroupSettingsModal = ref(false);
const showLoginModal = ref(false);
const isEditMode = ref(false);
const activeResizeWidgetId = ref<string | null>(null);
const currentEditItem = ref<NavItem | null>(null);
const currentGroupId = ref<string>("");
const isLanMode = ref(false);
const latency = ref(0);
const isChecking = ref(true);
const forceMode = useStorage<"auto" | "lan" | "wan">("flat-nas-network-mode", "auto");

const sidebarCollapsed = ref(true);
const isSidebarEnabled = computed(() =>
  store.widgets.find((w) => w.type === "sidebar" && w.enable),
);

const toggleForceMode = () => {
  if (forceMode.value === "auto") forceMode.value = "lan";
  else if (forceMode.value === "lan") forceMode.value = "wan";
  else forceMode.value = "auto";
};

const searchEngineStored = useStorage("flat-nas-engine", "google");
const engines = computed(
  () =>
    store.appConfig.searchEngines || [
      {
        id: "google",
        key: "google",
        label: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
      },
      { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
      { id: "baidu", key: "baidu", label: "百度", urlTemplate: "https://www.baidu.com/s?wd={q}" },
    ],
);
const sessionEngine = ref<string | null>(null);
const effectiveEngine = computed({
  get: () =>
    sessionEngine.value ||
    (store.appConfig.rememberLastEngine
      ? searchEngineStored.value
      : store.appConfig.defaultSearchEngine || engines.value[0]?.key || "google"),
  set: (val: string) => {
    sessionEngine.value = val;
    if (store.appConfig.rememberLastEngine) {
      searchEngineStored.value = val;
    }
  },
});
const searchText = ref("");

watch(
  () => store.appConfig.defaultSearchEngine,
  (newVal) => {
    if (newVal) {
      // 当默认搜索引擎改变时，重置会话选择
      sessionEngine.value = null;
      // 如果开启了"记住上次选择"，则同步更新存储的值
      if (store.appConfig.rememberLastEngine) {
        searchEngineStored.value = newVal;
      }
    }
  },
);

// --- 核心修复逻辑开始 ---
// 用于清洗 SVG 代码中的无效颜色类名，强制转为白色
const processIcon = (iconStr: string) => {
  if (!iconStr) return "";
  if (!iconStr.trim().startsWith("<svg")) return iconStr;
  let fixed = iconStr;
  const badColorRegex = /fill-[a-z]+-(50|100|200)/g;
  if (badColorRegex.test(fixed)) {
    fixed = fixed.replace(
      /class="([^"]*)\bfill-[a-z]+-(50|100|200)\b([^"]*)"/g,
      'class="$1 $3" style="fill: #ffffff;"',
    );
  }
  return fixed;
};
// --- 核心修复逻辑结束 ---

const isInternalNetwork = (url: string) => {
  if (!url) return false;
  return url.includes("localhost") || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[0-1]))\./.test(url);
};

const checkVisible = (obj?: WidgetConfig | NavItem) => {
  if (!obj) return false;
  if ("enable" in obj && !obj.enable) return false;
  if (store.isLogged) return true;
  return !!obj.isPublic;
};

const draggableWidgets = computed({
  get: () =>
    store.widgets.filter(
      (w) =>
        checkVisible(w) &&
        w.type !== "player" &&
        w.type !== "search" &&
        w.type !== "quote" &&
        w.type !== "sidebar",
    ),
  set: (newOrder: WidgetConfig[]) => {
    const hiddenWidgets = store.widgets.filter(
      (w) =>
        !checkVisible(w) ||
        w.type === "player" ||
        w.type === "search" ||
        w.type === "quote" ||
        w.type === "sidebar",
    );
    store.widgets = [...newOrder, ...hiddenWidgets];
    store.saveData();
  },
});

const displayGroups = computed(() => {
  // ✨ 性能优化：在编辑模式且无搜索时，直接返回 store.groups 引用
  // 这样 VueDraggable 就能直接操作 store 中的数组，确保拖拽状态实时同步
  if (isEditMode.value && !searchText.value) {
    return store.groups;
  }

  return store.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const isMatch =
          !searchText.value ||
          item.title.toLowerCase().includes(searchText.value.toLowerCase()) ||
          item.url.toLowerCase().includes(searchText.value.toLowerCase());
        const isVisible = checkVisible(item);
        return isMatch && isVisible;
      }),
    }))
    .filter((g) => {
      if (store.isLogged) return true;
      return g.items.length > 0 || !!g.preset;
    });
});

const cycleWidgetSize = (widget: WidgetConfig) => {
  // 统一为所有组件启用 4x4 尺寸选择器
  activeResizeWidgetId.value = activeResizeWidgetId.value === widget.id ? null : widget.id;
};

const handleSizeSelect = (widget: WidgetConfig, size: { colSpan: number; rowSpan: number }) => {
  widget.colSpan = size.colSpan;
  widget.rowSpan = size.rowSpan;
  activeResizeWidgetId.value = null;
  store.saveData();
};

const getWidgetSpanClass = (widget: WidgetConfig) => {
  const col = widget.colSpan || 1;
  const row = widget.rowSpan || (widget.type === "bookmarks" ? 2 : 1);
  const colClass =
    col === 4
      ? "md:col-span-4"
      : col === 3
        ? "md:col-span-3"
        : col === 2
          ? "md:col-span-2"
          : "md:col-span-1";
  const rowClass =
    row === 4 ? "row-span-4" : row === 3 ? "row-span-3" : row === 2 ? "row-span-2" : "row-span-1";
  return `${colClass} ${rowClass}`;
};

const devtoolsClickCount = ref(0);
const devtoolsClickTimer = ref<number | null>(null);

const closeResizeSelector = () => {
  activeResizeWidgetId.value = null;
};

onMounted(() => {
  document.addEventListener("click", closeResizeSelector);
});

onUnmounted(() => {
  document.removeEventListener("click", closeResizeSelector);
});

const toggleDevTools = () => {
  const style = document.getElementById("devtools-hider");
  if (style) {
    style.remove();
  } else {
    const newStyle = document.createElement("style");
    newStyle.id = "devtools-hider";
    newStyle.innerHTML = `
      #vue-devtools-anchor,
      .vue-devtools__anchor,
      .vue-devtools__trigger,
      [data-v-inspector-toggle] {
        display: none !important;
      }
    `;
    document.head.appendChild(newStyle);
  }
};

const handleNetworkClick = async () => {
  checkNetwork();

  const now = Date.now();
  if (!devtoolsClickTimer.value) {
    devtoolsClickTimer.value = now;
    devtoolsClickCount.value = 1;
  } else {
    if (now - devtoolsClickTimer.value > 5000) {
      devtoolsClickTimer.value = now;
      devtoolsClickCount.value = 1;
    } else {
      devtoolsClickCount.value++;
    }
  }

  if (devtoolsClickCount.value >= 10) {
    toggleDevTools();
    devtoolsClickCount.value = 0;
    devtoolsClickTimer.value = null;
  }
};

const checkNetwork = async () => {
  isChecking.value = true;
  const start = performance.now();
  try {
    const pingUrl = `/api/data?ping=${Date.now()}`;
    await fetch(pingUrl, { method: "GET", cache: "no-cache" });
    const end = performance.now();
    latency.value = Math.round(end - start);
    // 判定逻辑优化：只要 Hostname 是内网 IP，或者后端检测到的 Client IP 是内网 IP，都算内网环境
    isLanMode.value =
      isInternalNetwork(window.location.hostname) || isInternalNetwork(ipInfo.value.clientIp);
  } catch {
    isLanMode.value =
      isInternalNetwork(window.location.hostname) || isInternalNetwork(ipInfo.value.clientIp);
  } finally {
    isChecking.value = false;
  }
};

onMounted(() => {
  setTimeout(() => checkNetwork(), 2000);
  fetchIp();
  store.init().then(() => {
    store.cleanInvalidGroups();
  });
});

const doSearch = () => {
  if (!searchText.value) return;
  const eng = engines.value.find((e) => e.key === effectiveEngine.value);
  const template = eng?.urlTemplate || "https://www.google.com/search?q={q}";
  const url = template.replace("{q}", encodeURIComponent(searchText.value));
  window.open(url, "_blank");
  searchText.value = "";
};

const openAddModal = (groupId: string) => {
  currentEditItem.value = null;
  currentGroupId.value = groupId;
  showEditModal.value = true;
};
const openEditModal = (item: NavItem, groupId?: string) => {
  currentEditItem.value = item;
  if (groupId) {
    currentGroupId.value = groupId;
  }
  showEditModal.value = true;
};
const handleSave = (payload: { item: NavItem; groupId?: string }) => {
  if (payload.item.id) store.updateItem(payload.item);
  else if (payload.groupId)
    store.addItem({ ...payload.item, id: Date.now().toString() }, payload.groupId);
};

// const deleteItem = (id: string) => {
//   openDeleteConfirm(id)
// }
const handleCardClick = (item: NavItem) => {
  if (isEditMode.value) return;

  // 逻辑优化：
  // 1. 默认使用外网链接 (item.url)
  // 2. 只有在【已登录】且【处于内网环境】且【配置了内网链接】时，才优先使用内网链接
  // 3. 支持强制切换模式

  let targetUrl = item.url;

  if (forceMode.value === "lan") {
    // 强制内网模式：优先使用内网链接
    if (item.lanUrl) targetUrl = item.lanUrl;
  } else if (forceMode.value === "wan") {
    // 强制外网模式：只使用外网链接
    targetUrl = item.url;
  } else {
    // 自动模式
    if (store.isLogged && isLanMode.value && item.lanUrl) {
      targetUrl = item.lanUrl;
    }
  }

  // 特殊情况：如果解析出的 targetUrl 为空（说明没有外网链接），
  // 但存在内网链接（说明是因为未登录被降级了，或者是压根没配外网链接）
  // 此时如果用户未登录，则拦截并提示登录。
  if (!targetUrl && item.lanUrl && !store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  // 如果确实没有链接可跳，则不做反应
  if (!targetUrl) return;

  window.open(targetUrl, "_blank");
};
const handleAuthAction = () => {
  if (store.isLogged) {
    store.logout();
    isEditMode.value = false;
  } else {
    showLoginModal.value = true;
  }
};
const openSettings = () => {
  if (!store.isLogged) {
    showLoginModal.value = true;
  } else {
    showSettingsModal.value = true;
  }
};

// const updateGroupName = (id: string, e: Event) => {
//   const val = (e.target as HTMLElement).innerText
//   store.updateGroupTitle(id, val)
// }

const onGroupItemsChange = (groupId: string, newItems: NavItem[]) => {
  const group = store.groups.find((g) => g.id === groupId);
  if (group) {
    group.items = newItems;
  }
};

// --- Context Menu Logic ---
const showContextMenu = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuItem = ref<NavItem | null>(null);
const contextMenuGroupId = ref<string | undefined>(undefined);

const handleContextMenu = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;

  e.preventDefault();
  contextMenuItem.value = item;
  contextMenuGroupId.value = groupId;

  // Prevent menu from going off-screen (basic logic)
  const menuWidth = 150;
  const menuHeight = 100;
  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > window.innerWidth) x -= menuWidth;
  if (y + menuHeight > window.innerHeight) y -= menuHeight;

  contextMenuPosition.value = { x, y };
  showContextMenu.value = true;
};

const closeContextMenu = () => {
  showContextMenu.value = false;
};

const handleMenuLanOpen = () => {
  const item = contextMenuItem.value;
  closeContextMenu();

  if (!item || !item.lanUrl) return;

  // 内网访问依然需要登录权限
  if (!store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  window.open(item.lanUrl, "_blank");
};

const handleMenuEdit = () => {
  if (contextMenuItem.value) {
    openEditModal(contextMenuItem.value, contextMenuGroupId.value);
  }
  closeContextMenu();
};

const handleMenuDelete = () => {
  const item = contextMenuItem.value;
  closeContextMenu();
  if (item) {
    openDeleteConfirm(item.id);
  }
};

// --- Delete Confirmation Logic ---
const showDeleteConfirm = ref(false);
const deleteType = ref<"item" | "group">("item");
const itemToDelete = ref<string | null>(null);
const groupToDelete = ref<string | null>(null);

const openDeleteConfirm = (id: string) => {
  deleteType.value = "item";
  itemToDelete.value = id;
  showDeleteConfirm.value = true;
};

const openGroupDeleteConfirm = (id: string) => {
  deleteType.value = "group";
  groupToDelete.value = id;
  showDeleteConfirm.value = true;
};

const confirmDelete = () => {
  if (deleteType.value === "item" && itemToDelete.value) {
    store.deleteItem(itemToDelete.value);
  } else if (deleteType.value === "group" && groupToDelete.value) {
    store.deleteGroup(groupToDelete.value, true);
  }
  showDeleteConfirm.value = false;
  itemToDelete.value = null;
  groupToDelete.value = null;
};

onMounted(() => {
  document.addEventListener("click", closeContextMenu);
  document.addEventListener("scroll", closeContextMenu, true);
});

onUnmounted(() => {
  document.removeEventListener("click", closeContextMenu);
  document.removeEventListener("scroll", closeContextMenu, true);
});

// --- Group Settings ---
const activeGroupId = ref<string | null>(null);

const toggleGroupSettings = (id: string) => {
  activeGroupId.value = id;
  showGroupSettingsModal.value = true;
};

const checkMove = () => {
  return true;
};

const getLayoutConfig = (group: NavGroup) => {
  const showBg = group.showCardBackground ?? store.appConfig.showCardBackground;
  const layout = group.cardLayout || store.appConfig.cardLayout;
  const isHorizontal = layout === "horizontal";
  const isNoBg = showBg === false;

  const baseGap = group.gridGap || store.appConfig.gridGap;
  const gap = isNoBg ? Math.max(4, Math.round(baseGap * 0.6)) : baseGap;

  const baseSize = group.cardSize || store.appConfig.cardSize || 120;
  const ratio = baseSize / 120;

  const modeScale = isNoBg ? 0.6 : 1.0;
  const finalScale = ratio * modeScale;

  // Icon Size Logic
  const customIconSize = group.iconSize || store.appConfig.iconSize;
  let v_icon, h_icon;

  if (customIconSize) {
    // If explicit icon size is set, use it as base
    // Optimization: In vertical mode without card background, use the custom size directly
    if (isNoBg && !isHorizontal) {
      v_icon = customIconSize;
    } else {
      v_icon = customIconSize * modeScale;
    }
    h_icon = customIconSize * (40 / 48) * modeScale;
  } else {
    // Legacy behavior: scale with card size
    v_icon = 48 * finalScale;
    h_icon = 40 * finalScale;
  }

  let v_w = 120 * finalScale;
  let v_h = 128 * finalScale;

  // Optimization: Ensure container fits the icon in vertical no-bg mode
  if (isNoBg && !isHorizontal) {
    if (v_icon > v_w) v_w = v_icon + 8;
    const minH = v_icon + 32; // Icon + Text space
    if (minH > v_h) v_h = minH;
  }

  const h_w = 220 * finalScale;
  const h_h = 80 * finalScale;

  return {
    minWidth: isHorizontal ? h_w : v_w,
    height: isHorizontal ? h_h : v_h,
    iconSize: isHorizontal ? h_icon : v_icon,
    gap,
  };
};

// Close settings when clicking outside
// Note: In a real app we might use onClickOutside from @vueuse/core on the menu ref,
// but here we can just rely on the fact that clicking elsewhere (if not stopped) handles it?
// Actually, a global click listener or backdrop is safer.
// For now, let's use a simple window click listener or just rely on the toggle.
// Better: Use a transparent fixed inset div when menu is open to catch clicks.

const hitokoto = ref({ hitokoto: "加载中...", from: "" });
const fetchHitokoto = async () => {
  try {
    const res = await fetch("https://v1.hitokoto.cn/?c=i&c=d&c=k");
    hitokoto.value = await res.json();
  } catch {
    hitokoto.value = { hitokoto: "生活原本沉闷，但跑起来就有风。", from: "网络" };
  }
};

// --- 修复 IP 获取报错 ---
const ipInfo = ref({
  displayIp: "加载中...",
  realIp: "",
  location: "",
  isProxy: false,
  baiduLatency: "--",
  details: [] as string[], // 用于存储所有检测到的 IP
  clientIp: "",
});

const formattedLocation = computed(() => {
  const loc = ipInfo.value.location;
  if (!loc) return "";
  const parts = loc.split(" ");
  let area = parts[0] || "";
  let isp = parts.length > 1 ? parts[1] : "";

  // Remove Province (e.g., "浙江省")
  area = area.replace(/^.+?省/, "");

  // Remove City if it's not the last part (e.g., "宁波市慈溪市" -> "慈溪市")
  area = area.replace(/^.+?市(?=.+)/, "");

  // Clean ISP (e.g., "电信ADSL" -> "电信")
  if (isp) {
    isp = isp.replace(/ADSL|宽带|光纤/gi, "");
  }

  return `${area} ${isp}`.trim();
});

const fetchIp = async (force = false) => {
  const CACHE_KEY = "flatnas_ip_cache";
  const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in ms

  if (!force) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          ipInfo.value = data;
          // 恢复缓存时也要更新内网状态
          if (data.clientIp && isInternalNetwork(data.clientIp)) {
            isLanMode.value = true;
          }
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to read IP cache", e);
    }
  }

  ipInfo.value = {
    displayIp: "检测中...",
    realIp: "",
    location: "",
    isProxy: false,
    baiduLatency: "...",
    details: [],
    clientIp: "",
  };

  // 检测 223.5.5.5 延迟 (通过后端 /api/ping)
  fetch("/api/ping?target=223.5.5.5")
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        ipInfo.value.baiduLatency = data.latency;
      } else {
        ipInfo.value.baiduLatency = "Timeout";
      }
      updateCache();
    })
    .catch(() => {
      ipInfo.value.baiduLatency = "Error";
      updateCache();
    });

  // 通过后端代理获取 IP (解决 CORS)
  try {
    const res = await fetch("/api/ip");
    const data = await res.json();

    if (data.success) {
      ipInfo.value.displayIp = data.ip;
      ipInfo.value.location = data.location || "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";

      // 获取到 IP 后立即更新内网状态
      if (data.clientIp && isInternalNetwork(data.clientIp)) {
        isLanMode.value = true;
      }
    } else {
      ipInfo.value.displayIp = data.ip || "获取失败";
      ipInfo.value.location = "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";

      if (data.clientIp && isInternalNetwork(data.clientIp)) {
        isLanMode.value = true;
      }
    }
    updateCache();
  } catch (e) {
    console.error("IP Fetch Error", e);
    ipInfo.value.displayIp = "Error";
    updateCache();
  }
};

const updateCache = () => {
  // Only cache if we have some meaningful data
  if (ipInfo.value.displayIp !== "检测中..." && ipInfo.value.baiduLatency !== "...") {
    localStorage.setItem(
      "flatnas_ip_cache",
      JSON.stringify({
        timestamp: Date.now(),
        data: ipInfo.value,
      }),
    );
  }
};

// --- 修复结束 ---

// Visitor Stats
const onlineDuration = ref("00:00:00");
const totalVisitors = ref(0);
const todayVisitors = ref(0);
let onlineTimer: ReturnType<typeof setInterval> | null = null;

const startOnlineTimer = () => {
  const startTime = Date.now();
  if (onlineTimer) clearInterval(onlineTimer);
  onlineTimer = setInterval(() => {
    const diff = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    onlineDuration.value = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }, 1000);
};

const recordVisit = async () => {
  try {
    const res = await fetch("/api/visitor/track", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      totalVisitors.value = data.totalVisitors;
      todayVisitors.value = data.todayVisitors;
    }
  } catch (e) {
    console.error("Failed to record visit", e);
  }
};

watch(
  () => store.appConfig.showFooterStats,
  (val) => {
    if (val) {
      startOnlineTimer();
      recordVisit();
    } else {
      if (onlineTimer) clearInterval(onlineTimer);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchHitokoto();
});

const dateStr = ref(new Date().toLocaleDateString());
const timeStr = ref(new Date().toLocaleTimeString());
const now = new Date();
const dayNum = ref(now.getDate());
const weekDay = ref(["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()]);
const yearMonth = ref(`${now.getFullYear()}.${now.getMonth() + 1}`);
setInterval(() => {
  const n = new Date();
  timeStr.value = n.toLocaleTimeString();
  if (n.getDate() !== dayNum.value) {
    dayNum.value = n.getDate();
    weekDay.value = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][n.getDay()];
  }
}, 1000);
</script>

<template>
  <div class="min-h-screen relative overflow-hidden flex flex-col">
    <!-- ✨ Global Background Layer -->
    <div
      v-if="store.appConfig.background"
      class="fixed inset-0 z-0 pointer-events-none select-none"
    >
      <!-- Image Layer with Blur -->
      <div
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat transition-all duration-300"
        :style="{
          backgroundImage: `url(${store.appConfig.background})`,
          filter: `blur(${store.appConfig.backgroundBlur ?? 0}px)`,
        }"
      ></div>
      <!-- Mask Layer -->
      <div
        class="absolute inset-0 transition-all duration-300"
        :style="{
          backgroundColor: `rgba(0,0,0,${store.appConfig.backgroundMask ?? 0})`,
        }"
      ></div>
    </div>

    <AppSidebar
      v-if="isSidebarEnabled"
      v-model:collapsed="sidebarCollapsed"
      class="fixed left-0 top-0 h-full z-40"
      :onOpenSettings="() => (showSettingsModal = true)"
      :onOpenEdit="() => (isEditMode = !isEditMode)"
    />

    <div
      class="flex-1 w-full p-8 transition-all pb-10 relative z-10"
      :style="{
        backgroundColor: store.appConfig.background ? 'transparent' : '#f3f4f6',
        '--group-title-color': store.appConfig.groupTitleColor || '#ffffff',
        '--card-bg-color': store.appConfig.cardBgColor || 'transparent',
        '--card-border-color': store.appConfig.cardBorderColor || 'transparent',
        paddingLeft: isSidebarEnabled ? (sidebarCollapsed ? '100px' : '288px') : undefined,
      }"
    >
      <div class="max-w-7xl mx-auto">
        <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-6 relative">
          <div
            class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 flex-shrink-0 z-30 transition-all duration-500"
            :style="{ order: store.appConfig.titleAlign === 'right' ? 2 : 0 }"
          >
            <h1
              class="font-bold transition-all duration-300 whitespace-nowrap"
              :style="{
                fontSize: store.appConfig.titleSize + 'px',
                color: store.appConfig.titleColor,
                textShadow: store.appConfig.background ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
              }"
            >
              {{ store.appConfig.customTitle }}
            </h1>
            <div
              class="flex items-center bg-white/90 backdrop-blur border border-gray-200 shadow-sm rounded-full p-1 gap-1 h-8"
            >
              <button
                @click="toggleForceMode"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="{
                  'bg-gray-100 text-gray-400 hover:bg-gray-200': forceMode === 'auto',
                  'bg-green-100 text-green-600 hover:bg-green-200': forceMode === 'lan',
                  'bg-blue-100 text-blue-600 hover:bg-blue-200': forceMode === 'wan',
                }"
              >
                {{ forceMode === "auto" ? "自动" : forceMode === "lan" ? "强制内网" : "强制外网" }}
              </button>
              <div
                class="flex items-center gap-2 px-3 h-full rounded-full text-[10px] font-medium cursor-pointer hover:bg-gray-100 transition-all select-none"
                @click="handleNetworkClick"
              >
                <template v-if="isChecking"
                  ><div
                    class="w-2 h-2 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"
                  ></div
                ></template>
                <template v-else
                  ><div
                    class="w-1.5 h-1.5 rounded-full"
                    :class="isLanMode ? 'bg-green-500' : 'bg-blue-500'"
                  ></div>
                  <span :class="isLanMode ? 'text-green-700' : 'text-blue-700'">{{
                    isLanMode ? "内网" : "外网"
                  }}</span
                  ><span class="text-gray-400 border-l pl-2 ml-1">{{ latency }}ms</span></template
                >
              </div>
              <button
                @click="handleAuthAction"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="[
                  store.isLogged
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-blue-500 hover:text-white',
                ]"
              >
                {{ store.isLogged ? "退出" : "登录" }}
              </button>
            </div>
          </div>

          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w5'))"
            class="w-full md:absolute md:left-1/2 md:-translate-x-1/2 md:w-64 z-20"
          >
            <form
              class="mx-auto shadow-lg hover:shadow-xl transition-shadow rounded-full bg-white/90 backdrop-blur-md border border-white/40 flex items-center p-1"
              :style="{ width: '100%', height: '41px' }"
              @submit.prevent="doSearch"
              action="."
            >
              <input
                id="main-search-input"
                name="q"
                v-model="searchText"
                @keyup.enter="doSearch"
                type="search"
                role="searchbox"
                aria-label="搜索框"
                autocomplete="off"
                class="h-full pl-6 pr-4 rounded-full bg-transparent border-0 text-gray-900 placeholder-gray-500 outline-none"
                :style="{ width: 'calc(100% - 33.75%)' }"
                :placeholder="
                  (engines.find((e) => e.key === effectiveEngine)?.label || '搜索') + ' 搜索...'
                "
              />
              <div class="flex items-center justify-end" :style="{ width: '33.75%' }">
                <select
                  v-model="effectiveEngine"
                  aria-label="搜索引擎"
                  class="h-[34px] px-3 py-0 bg-white rounded-full border border-gray-200 focus:border-blue-400 outline-none"
                  :style="{ width: 'calc(100%)', fontSize: '15px' }"
                  @click.stop
                >
                  <option v-for="e in engines" :key="e.key" :value="e.key">{{ e.label }}</option>
                </select>
              </div>
            </form>
          </div>

          <div
            class="flex gap-3 flex-shrink-0 z-10 items-center transition-all duration-500 flatnas-handshake-signal"
            :style="{ order: store.appConfig.titleAlign === 'right' ? 0 : 2 }"
          >
            <MiniPlayer
              v-if="checkVisible(store.widgets.find((w) => w.type === 'player'))"
              key="mini-player-static"
            />
            <button
              @click="openSettings"
              class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center backdrop-blur transition-all border border-white/20 shadow-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-6 h-6"
              >
                <path
                  fill-rule="evenodd"
                  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
            <button
              v-if="store.isLogged"
              @click="isEditMode = !isEditMode"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm"
              :class="
                isEditMode ? 'bg-red-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              "
            >
              {{ isEditMode ? "完成" : "编辑" }}
            </button>
          </div>
        </div>

        <VueDraggable
          v-model="draggableWidgets"
          :animation="300"
          :disabled="!isEditMode"
          class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 text-white select-none grid-flow-dense"
          style="grid-auto-rows: 140px"
          ghostClass="ghost"
        >
          <div
            v-for="widget in draggableWidgets"
            :key="widget.id"
            class="transition-all duration-300 relative"
            :class="[
              getWidgetSpanClass(widget),
              isEditMode
                ? 'ring-2 ring-blue-400/50 rounded-2xl cursor-move hover:ring-blue-500'
                : '',
            ]"
          >
            <button
              v-if="isEditMode"
              @click.stop="cycleWidgetSize(widget)"
              class="absolute bottom-2 right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-blue-600 hover:scale-110 transition-all"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                ></path>
              </svg>
            </button>
            <SizeSelector
              v-if="isEditMode && activeResizeWidgetId === widget.id"
              :current-col="widget.colSpan || 1"
              :current-row="widget.rowSpan || (widget.type === 'bookmarks' ? 2 : 1)"
              @select="(size) => handleSizeSelect(widget, size)"
            />
            <div
              v-if="widget.type === 'clock'"
              class="w-full h-full p-6 rounded-2xl bg-black/20 backdrop-blur border border-white/10 flex flex-col items-center justify-center hover:bg-black/30 transition-colors"
            >
              <div class="text-4xl font-mono font-bold">{{ timeStr }}</div>
              <div class="text-sm opacity-80 mt-1">{{ dateStr }}</div>
            </div>
            <SimpleWeatherWidget v-else-if="widget.type === 'weather'" :widget="widget" />
            <div
              v-else-if="widget.type === 'calendar'"
              class="w-full h-full p-4 rounded-2xl bg-red-500/20 backdrop-blur border border-white/10 flex flex-col items-center justify-center relative overflow-hidden group hover:bg-red-500/30 transition-all"
            >
              <div
                class="absolute -right-4 -bottom-6 text-9xl font-bold opacity-5 pointer-events-none"
              >
                {{ dayNum }}
              </div>
              <div class="text-xs opacity-70 tracking-widest uppercase mb-1">{{ yearMonth }}</div>
              <div class="text-5xl font-bold shadow-text">{{ dayNum }}</div>
              <div class="text-sm mt-1 bg-white/20 px-3 py-0.5 rounded-full backdrop-blur-md">
                {{ weekDay }}
              </div>
            </div>
            <MemoWidget v-else-if="widget.type === 'memo'" :widget="widget" />
            <TodoWidget v-else-if="widget.type === 'todo'" :widget="widget" />
            <CalculatorWidget v-else-if="widget.type === 'calculator'" />
            <div
              v-else-if="widget.type === 'ip'"
              class="w-full h-full p-3 rounded-2xl bg-purple-500/20 backdrop-blur border border-white/10 flex flex-col items-center hover:bg-purple-500/30 transition-colors text-center"
            >
              <div
                v-if="ipInfo.location"
                class="text-[19px] font-bold w-full truncate flex-1 flex items-center justify-center -mt-px"
                :title="ipInfo.location"
              >
                {{ formattedLocation }}
              </div>
              <div class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[14px] opacity-70 uppercase">IP</span>
                <span class="text-2xl font-mono font-bold leading-tight">{{
                  ipInfo.displayIp
                }}</span>
              </div>

              <div class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[12px] opacity-70 uppercase">PING测试</span>
                <div
                  class="text-base font-mono font-medium text-purple-100 bg-purple-500/30 px-2 py-0.5 rounded"
                >
                  {{ ipInfo.baiduLatency }}
                </div>
                <button
                  @click="fetchIp(true)"
                  class="text-[12px] bg-white/20 px-2.5 py-0.5 rounded hover:bg-white/30 transition-colors"
                >
                  刷新
                </button>
              </div>
            </div>
            <IframeWidget
              v-else-if="widget.type === 'iframe'"
              :widget="widget"
              :is-lan-mode="isLanMode"
            />
            <BookmarkWidget v-else-if="widget.type === 'bookmarks'" :widget="widget" />
            <HotWidget v-else-if="widget.type === 'hot'" :widget="widget" />
            <ClockWeatherWidget v-else-if="widget.type === 'clockweather'" :widget="widget" />
            <RssWidget v-else-if="widget.type === 'rss'" :widget="widget" />
          </div>
        </VueDraggable>

        <Transition name="fade">
          <div v-if="store.isLogged && isEditMode" class="flex justify-center mb-4">
            <button
              data-testid="add-group-btn"
              @click="store.addGroup"
              class="bg-white/10 hover:bg-white/20 text-white backdrop-blur border border-white/20 px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 shadow-lg"
            >
              <span>➕</span> 新建分组
            </button>
          </div>
        </Transition>

        <VueDraggable
          v-model="store.groups"
          handle=".group-handle"
          :move="checkMove"
          :animation="300"
          :disabled="!isEditMode"
          class="pb-20 flex flex-col"
          :style="{ gap: (store.appConfig.groupGap ?? 30) + 'px' }"
        >
          <div v-for="group in displayGroups" :key="group.id" class="group-container">
            <div class="flex items-center gap-3 mb-2 group-header relative">
              <div
                v-if="isEditMode"
                class="group-handle cursor-move text-white/50 hover:text-white p-1 select-none text-xl"
              >
                ⋮⋮
              </div>
              <h2
                class="text-xl font-bold shadow-text px-2 rounded transition-colors outline-none"
                :style="{
                  color:
                    group.titleColor ||
                    store.appConfig.groupTitleColor ||
                    'var(--group-title-color)',
                }"
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged"
                  @click.stop="toggleGroupSettings(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="分组设置"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged && isEditMode"
                  @click="openGroupDeleteConfirm(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500 hover:text-white text-white/50 flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="删除分组"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <span
                v-if="group.preset"
                class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded border border-yellow-200"
                >预设</span
              >
            </div>

            <VueDraggable
              :model-value="group.items"
              @update:model-value="(newItems: NavItem[]) => onGroupItemsChange(group.id, newItems)"
              group="apps"
              :animation="200"
              :disabled="!isEditMode || !!searchText"
              class="grid transition-all duration-300 min-h-[100px] rounded-xl"
              :class="isEditMode ? 'bg-white/5 border-2 border-dashed border-white/20 p-4' : ''"
              :style="{
                gap: getLayoutConfig(group).gap + 'px',
                gridTemplateColumns: `repeat(auto-fill, minmax(${getLayoutConfig(group).minWidth}px, 1fr))`,
              }"
              ghostClass="ghost"
            >
              <div
                v-for="item in group.items"
                :key="item.id"
                @click="handleCardClick(item)"
                @contextmenu="handleContextMenu($event, item, group.id)"
                class="flex items-center justify-center cursor-pointer transition-all select-none relative group overflow-hidden"
                :class="[
                  isEditMode ? 'animate-pulse cursor-move ring-2 ring-blue-400' : '',
                  (group.cardLayout || store.appConfig.cardLayout) === 'horizontal'
                    ? 'flex-row px-4 py-3 gap-3 justify-start'
                    : 'flex-col justify-center',
                  (group.iconShape || store.appConfig.iconShape) === 'circle'
                    ? 'rounded-2xl'
                    : (group.iconShape || store.appConfig.iconShape) === 'rounded'
                      ? 'rounded-2xl'
                      : (group.iconShape || store.appConfig.iconShape) === 'leaf'
                        ? 'rounded-tl-3xl rounded-br-3xl rounded-tr-md rounded-bl-md'
                        : 'rounded-lg',
                  (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                    ? ''
                    : 'border backdrop-blur-sm',
                ]"
                :style="{
                  height: getLayoutConfig(group).height + 'px',
                  backgroundColor:
                    (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                      ? 'transparent'
                      : group.cardBgColor || store.appConfig.cardBgColor || 'var(--card-bg-color)',
                  borderColor:
                    (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                      ? 'transparent'
                      : 'var(--card-border-color)',
                }"
              >
                <!-- ✨ 背景图层 (高斯模糊 + 遮罩) -->
                <div
                  v-if="item.backgroundImage || group.backgroundImage"
                  class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
                >
                  <div
                    class="absolute inset-0 bg-cover bg-center transition-all duration-300"
                    :style="{
                      backgroundImage: `url(${item.backgroundImage || group.backgroundImage})`,
                      filter: `blur(${item.backgroundImage ? (item.backgroundBlur ?? 6) : (group.backgroundBlur ?? 6)}px)`,
                      transform: 'scale(1.1)',
                    }"
                  ></div>
                  <div
                    class="absolute inset-0"
                    :style="{
                      backgroundColor: `rgba(0,0,0,${item.backgroundImage ? (item.backgroundMask ?? 0.3) : (group.backgroundMask ?? 0.3)})`,
                    }"
                  ></div>
                </div>

                <div
                  v-if="isEditMode && item.isPublic"
                  class="absolute bottom-1 right-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 z-20"
                >
                  公开
                </div>

                <IconShape
                  :shape="group.iconShape || store.appConfig.iconShape"
                  :size="getLayoutConfig(group).iconSize"
                  :bgClass="
                    item.color &&
                    !item.color.includes('sky') &&
                    item.color !== '#000000' &&
                    item.color !== 'bg-black'
                      ? item.color
                      : 'bg-white'
                  "
                  :icon="processIcon(item.icon || '')"
                  class="transition-all duration-300 relative z-10"
                  :class="item.backgroundImage || group.backgroundImage ? 'drop-shadow-lg' : ''"
                />

                <!-- Horizontal Mode: 3-Line Custom Text -->
                <div
                  v-if="(group.cardLayout || store.appConfig.cardLayout) === 'horizontal'"
                  class="flex-1 flex flex-col h-full justify-center gap-0.5 overflow-hidden relative z-10"
                >
                  <!-- Line 1 (Top) -->
                  <div
                    class="text-xs truncate font-medium leading-tight"
                    :style="{
                      color:
                        item.titleColor ||
                        (item.backgroundImage || group.backgroundImage
                          ? '#ffffff'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                      opacity: item.description1 ? 1 : 0.5,
                    }"
                  >
                    {{ item.description1 || item.title }}
                  </div>

                  <!-- Line 2 (Middle) -->
                  <div
                    class="text-[10px] truncate leading-tight opacity-80"
                    :style="{
                      color:
                        item.backgroundImage || group.backgroundImage
                          ? '#e5e7eb'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#4b5563',
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    {{ item.description2 || "" }}
                  </div>

                  <!-- Line 3 (Bottom) -->
                  <div
                    class="text-[10px] truncate leading-tight opacity-70"
                    :style="{
                      color:
                        item.backgroundImage || group.backgroundImage
                          ? '#d1d5db'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#6b7280',
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    {{ item.description3 || "" }}
                  </div>
                </div>

                <!-- Vertical Mode: Standard Title -->
                <span
                  v-else
                  class="font-medium truncate relative z-10"
                  :class="'text-center px-2 w-full'"
                  :style="{
                    color:
                      item.titleColor ||
                      (item.backgroundImage || group.backgroundImage
                        ? '#ffffff'
                        : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                    textShadow:
                      item.backgroundImage || group.backgroundImage
                        ? '0 2px 4px rgba(0,0,0,0.8)'
                        : 'none',
                  }"
                  >{{ item.title }}</span
                >
              </div>
            </VueDraggable>
          </div>
        </VueDraggable>
      </div>
    </div>

    <!-- Footer -->
    <footer
      class="w-full z-10 relative shrink-0 px-8 transition-all flex items-center"
      :class="!store.appConfig.footerHeight ? 'py-6' : ''"
      :style="{
        height: store.appConfig.footerHeight ? store.appConfig.footerHeight + 'px' : 'auto',
        marginBottom: (store.appConfig.footerMarginBottom || 0) + 'px',
      }"
    >
      <div
        class="mx-auto flex justify-between items-center w-full"
        :style="{
          maxWidth: (store.appConfig.footerWidth || 1280) + 'px',
          fontSize: (store.appConfig.footerFontSize || 12) + 'px',
        }"
      >
        <!-- Left: Visitor Stats -->
        <div class="flex-1 flex items-center justify-start gap-4">
          <!-- Connection Status -->
          <div
            v-if="false"
            class="flex items-center gap-2 opacity-80 select-none"
            :title="store.isConnected ? '已连接到服务器' : '与服务器断开连接'"
          >
            <div
              class="w-2 h-2 rounded-full transition-colors duration-300"
              :class="
                store.isConnected
                  ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
                  : 'bg-red-500 animate-pulse'
              "
            ></div>
            <span
              class="text-xs font-mono font-bold"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
              >{{ store.isConnected ? "LIVE" : "OFFLINE" }}</span
            >
          </div>

          <div
            v-if="store.appConfig.showFooterStats"
            class="flex gap-4 opacity-60 select-none"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          >
            <div class="flex flex-col gap-1">
              <span>访客记录</span>
              <span class="font-mono">{{ totalVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>今日访客</span>
              <span class="font-mono">{{ todayVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>在线时长</span>
              <span class="font-mono">{{ onlineDuration }}</span>
            </div>
          </div>
        </div>

        <!-- Center: Custom HTML -->
        <div class="flex-1 flex justify-center px-4">
          <div
            v-if="store.appConfig.footerHtml"
            v-html="store.appConfig.footerHtml"
            class="text-center opacity-60"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          ></div>
        </div>

        <!-- Right: Quote -->
        <div class="flex-1 flex justify-end">
          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w7'))"
            class="text-right max-w-md cursor-pointer hover:opacity-80 transition-opacity select-none"
            @click="fetchHitokoto"
            title="点击刷新"
          >
            <p
              class="font-serif italic mb-1 opacity-70"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-600'"
              style="font-size: 1.25em"
            >
              “ {{ hitokoto.hitokoto }} ”
            </p>
            <p
              class="opacity-70"
              :class="store.appConfig.background ? 'text-white/80 shadow-text' : 'text-gray-400'"
            >
              —— {{ hitokoto.from }}
            </p>
          </div>
        </div>
      </div>
    </footer>

    <!-- Group Settings Overlay -->
    <GroupSettingsModal v-model:show="showGroupSettingsModal" :groupId="activeGroupId" />

    <EditModal
      v-model:show="showEditModal"
      :data="currentEditItem"
      :groupId="currentGroupId"
      @save="handleSave"
    />
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
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showDeleteConfirm = false"
    >
      <div
        class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm transform transition-all scale-100 border border-gray-100"
      >
        <h3 class="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
          <span class="text-red-500 text-xl">⚠️</span> 删除确认
        </h3>
        <p class="text-gray-600 mb-6">
          确定要删除这个{{ deleteType === "group" ? "分组" : "卡片" }}吗？此操作无法撤销。
        </p>
        <div class="flex justify-end gap-3">
          <button
            @click="showDeleteConfirm = false"
            class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            class="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium shadow-sm transition-colors flex items-center gap-1"
          >
            <span>🗑️</span> 删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ghost {
  opacity: 0.4;
  background: rgba(255, 255, 255, 0.5);
  border: 2px dashed #9ca3af;
}
.shadow-text {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
[contenteditable]:focus {
  background-color: rgba(255, 255, 255, 0.2);
}
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

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
