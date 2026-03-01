import { ref, computed, watch, nextTick } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";
import io from "socket.io-client";
import type {
  NavItem,
  NavGroup,
  AppConfig,
  WidgetConfig,
  RssFeed,
  RssCategory,
  LuckyStunData,
} from "@/types";

interface BackupData {
  username?: string;
  items?: NavItem[];
  groups?: NavGroup[];
  widgets?: WidgetConfig[];
  appConfig?: AppConfig;
  rssFeeds?: RssFeed[];
  rssCategories?: RssCategory[];
  systemConfig?: Record<string, unknown>;
  version?: number;
  [key: string]: unknown;
}

export const useMainStore = defineStore("main", () => {
  const socket = io({
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
  });
  const isConnected = ref(false);
  let socketListenersBound = false;
  let isInitializing = false;
  let isFirstConnect = true;
  const NETWORK_HEARTBEAT_INTERVAL = 5000;
  const NETWORK_HEARTBEAT_TIMEOUT = 10000;
  const NETWORK_POLL_INTERVAL = 30000;
  const NETWORK_IDLE_BROADCAST_INTERVAL = 30000;
  const networkSyncMode = ref<"broadcast" | "poll">("broadcast");
  let networkHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let networkHeartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;
  let networkPollTimer: ReturnType<typeof setInterval> | null = null;
  let networkBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastNetworkHeartbeatAt = 0;
  let pendingNetworkMode: string | null = null;
  let isApplyingNetworkMode = false;

  socket.on("connect", async () => {
    console.log("Socket connected:", socket.id);
    isConnected.value = true;
    startNetworkHeartbeat();

    // Skip the mode check on first connection (initial load)
    // The init() function will handle the initial state and config fetching
    if (isFirstConnect) {
      isFirstConnect = false;
      return;
    }

    // Check if system config changed while we were disconnected
    // This handles the case where user switches mode in one tab while another is briefly offline
    const oldMode = systemConfig.value.authMode;
    await fetchSystemConfig();
    if (systemConfig.value.authMode !== oldMode) {
      if (isLogged.value) {
        logout();
      } else {
        init();
      }
    }
  });
  socket.on("disconnect", () => {
    console.log("Socket disconnected");
    isConnected.value = false;
    stopNetworkHeartbeat();
  });

  socket.on("connect_error", (err: unknown) => {
    console.error("Socket connect error:", err);
  });

  // Lucky STUN Data
  const luckyStunData = ref<LuckyStunData | null>(null);
  socket.on("lucky:stun", (data: unknown) => {
    luckyStunData.value = data as LuckyStunData;
  });

  const fetchLuckyStunData = async () => {
    if (import.meta.env.MODE === "test") return;
    // Lazy load stun data only when needed or after app is idle
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const res = await fetch(new URL("/api/lucky/stun", base).toString());
      if (res.ok) {
        luckyStunData.value = await res.json();
      }
    } catch (e) {
      console.error("Failed to fetch lucky stun data", e);
    }
  };

  const fetchSystemConfig = async () => {
    if (import.meta.env.MODE === "test") return;
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const res = await fetch(new URL("/api/system-config", base).toString());
      if (res.ok) {
        systemConfig.value = await res.json();
      }
    } catch (e) {
      console.error("Failed to fetch system config", e);
    }
  };

  const updateSystemConfig = async (newConfig: Partial<typeof systemConfig.value>) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const res = await fetch(new URL("/api/system-config", base).toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        systemConfig.value = await res.json();
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const groups = ref<NavGroup[]>([]);
  const items = computed(() => groups.value.flatMap((g) => g.items));
  const rssFeeds = ref<RssFeed[]>([]);
  const rssCategories = ref<RssCategory[]>([]);
  const systemConfig = ref({ authMode: "single" }); // Default
  const dataVersion = ref(0);

  // Auth State
  const token = ref(localStorage.getItem("flat-nas-token") || "");
  const username = ref(localStorage.getItem("flat-nas-username") || "");
  const isLogged = ref(!!token.value);
  const password = ref(""); // Only used for password change, not auth
  const isExpandedMode = ref(false);
  const activeMusicPlayer = ref<"mini-player" | "music-widget" | null>(null);
  const webPaginationActiveGroupId = ref("");
  const isLanModeInited = ref(false);
  const ipFetchStatus = ref<"success" | "error" | "loading">("loading");
  const isPageUnloading = ref(false);
  const globalDrag = ref({
    active: false,
    isFiles: false,
    point: { x: 0, y: 0 },
    depth: 0,
    scope: "",
  });
  let globalDragBound = false;

  const getHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token.value) {
      headers["Authorization"] = `Bearer ${token.value}`;
    }
    return headers;
  };

  const isValidNetworkMode = (mode: string) =>
    mode === "auto" || mode === "lan" || mode === "wan" || mode === "latency";

  const emitNetworkHeartbeat = () => {
    const t = token.value || localStorage.getItem("flat-nas-token");
    if (!t) return;
    socket.emit("network:heartbeat", { token: t });
  };

  const emitNetworkMode = (mode: string) => {
    if (!isLogged.value) return;
    const t = token.value || localStorage.getItem("flat-nas-token");
    if (!t || !isValidNetworkMode(mode)) return;
    socket.emit("network:mode", { token: t, mode });
  };

  const resetGlobalDrag = () => {
    globalDrag.value.active = false;
    globalDrag.value.isFiles = false;
    globalDrag.value.depth = 0;
    globalDrag.value.scope = "";
  };

  const isFilesDragEvent = (e: DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes("Files");
  };

  const resolveDragScope = (e: DragEvent) => {
    const target = e.target as HTMLElement | null;
    const scopeEl = target?.closest?.("[data-drag-scope]") as HTMLElement | null;
    return scopeEl?.dataset.dragScope || "";
  };

  const initGlobalDrag = () => {
    if (globalDragBound || typeof window === "undefined") return;
    globalDragBound = true;

    const onDragEnter = (e: DragEvent) => {
      if (!isFilesDragEvent(e)) return;
      globalDrag.value.depth += 1;
      globalDrag.value.active = true;
      globalDrag.value.isFiles = true;
      globalDrag.value.point = { x: e.clientX, y: e.clientY };
      globalDrag.value.scope = resolveDragScope(e);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isFilesDragEvent(e)) return;
      e.preventDefault();
      globalDrag.value.active = true;
      globalDrag.value.isFiles = true;
      globalDrag.value.point = { x: e.clientX, y: e.clientY };
      globalDrag.value.scope = resolveDragScope(e);
    };

    const onDragLeave = () => {
      if (!globalDrag.value.active) return;
      globalDrag.value.depth = Math.max(0, globalDrag.value.depth - 1);
      if (globalDrag.value.depth === 0) resetGlobalDrag();
    };

    const onDrop = () => resetGlobalDrag();
    const onDragEnd = () => resetGlobalDrag();
    const onPointerUp = () => resetGlobalDrag();
    const onMouseUp = () => resetGlobalDrag();
    const onBlur = () => resetGlobalDrag();

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("blur", onBlur, true);

  };

  const scheduleNetworkModeBroadcast = (mode: string) => {
    if (!isValidNetworkMode(mode)) return;
    pendingNetworkMode = mode;
    if (networkSyncMode.value === "broadcast") {
      if (networkBroadcastTimer) {
        clearTimeout(networkBroadcastTimer);
        networkBroadcastTimer = null;
      }
      emitNetworkMode(mode);
      return;
    }
    if (networkBroadcastTimer) return;
    networkBroadcastTimer = setTimeout(() => {
      networkBroadcastTimer = null;
      const nextMode = pendingNetworkMode;
      pendingNetworkMode = null;
      if (nextMode) emitNetworkMode(nextMode);
    }, NETWORK_IDLE_BROADCAST_INTERVAL);
  };

  const applyRemoteNetworkMode = (mode: string) => {
    if (!isValidNetworkMode(mode)) return;
    if (appConfig.value.forceNetworkMode === mode) return;
    isApplyingNetworkMode = true;
    appConfig.value.forceNetworkMode = mode;
    Promise.resolve().then(() => {
      isApplyingNetworkMode = false;
    });
  };

  const pollNetworkMode = async () => {
    try {
      const headers: Record<string, string> = {};
      const t = token.value || localStorage.getItem("flat-nas-token");
      if (t) headers["Authorization"] = `Bearer ${t}`;
      const res = await fetch(`/api/data`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      const mode = data?.appConfig?.forceNetworkMode;
      if (typeof mode === "string") {
        applyRemoteNetworkMode(mode);
      }
    } catch (e) {
      console.error("Network mode poll failed", e);
    }
  };

  const updateNetworkSyncMode = (active: boolean) => {
    const nextMode = active ? "broadcast" : "poll";
    if (nextMode === networkSyncMode.value) return;
    networkSyncMode.value = nextMode;
    if (nextMode === "broadcast") {
      if (networkPollTimer) {
        clearInterval(networkPollTimer);
        networkPollTimer = null;
      }
      return;
    }
    if (!networkPollTimer) {
      networkPollTimer = setInterval(pollNetworkMode, NETWORK_POLL_INTERVAL);
    }
    pollNetworkMode();
  };

  const startNetworkHeartbeat = () => {
    if (networkHeartbeatTimer) clearInterval(networkHeartbeatTimer);
    if (networkHeartbeatCheckTimer) clearInterval(networkHeartbeatCheckTimer);
    emitNetworkHeartbeat();
    networkHeartbeatTimer = setInterval(emitNetworkHeartbeat, NETWORK_HEARTBEAT_INTERVAL);
    networkHeartbeatCheckTimer = setInterval(() => {
      const active =
        lastNetworkHeartbeatAt > 0 &&
        Date.now() - lastNetworkHeartbeatAt <= NETWORK_HEARTBEAT_TIMEOUT;
      updateNetworkSyncMode(active);
    }, 1000);
  };

  const stopNetworkHeartbeat = () => {
    if (networkHeartbeatTimer) clearInterval(networkHeartbeatTimer);
    if (networkHeartbeatCheckTimer) clearInterval(networkHeartbeatCheckTimer);
    networkHeartbeatTimer = null;
    networkHeartbeatCheckTimer = null;
    lastNetworkHeartbeatAt = 0;
    updateNetworkSyncMode(false);
  };

  // Version Check
  const currentVersion = "1.1.3dev3";
  const latestVersion = ref("");
  const dockerUpdateAvailable = ref(false);
  const updateCheckLastAt = useStorage<number>("flat-nas-update-check-last-at", 0);
  const UPDATE_CHECK_TTL = 30 * 60 * 1000;

  const hasUpdate = computed(() => {
    if (dockerUpdateAvailable.value) return true;
    if (!latestVersion.value) return false;
    const v1 = currentVersion.replace(/^v/, "");
    const v2 = latestVersion.value.replace(/^v/, "");
    return v1 !== v2;
  });

  const checkUpdate = async (force = false) => {
    try {
      const now = Date.now();
      const shouldCheckRemote =
        force ||
        !updateCheckLastAt.value ||
        now - updateCheckLastAt.value >= UPDATE_CHECK_TTL ||
        !latestVersion.value;

      if (shouldCheckRemote) {
        updateCheckLastAt.value = now;
        // Use Gitee tags API to avoid connection issues in China
        const res = await fetch("https://gitee.com/api/v5/repos/gjx0808/FlatNas/tags");
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            latestVersion.value = data[0].name;
          }
        }
      }
    } catch (e) {
      console.error("Failed to check update", e);
    }

    try {
      const res = await fetch("/api/docker-status");
      if (res.ok) {
        const data = await res.json();
        if (data.hasUpdate) {
          dockerUpdateAvailable.value = true;
        }
      }
    } catch {
      // ignore
    }
  };

  // Resource version for cache busting
  const resourceVersion = useStorage("flat-nas-resource-version", Date.now());

  const refreshResources = () => {
    resourceVersion.value = Date.now();
  };

  /**
   * 为资源 URL 添加时间戳参数，防止缓存（用于同名覆盖场景）
   */
  const getAssetUrl = (url?: string) => {
    if (!url) return "";
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    const connector = url.includes("?") ? "&" : "?";
    // 使用全局资源版本号，避免频繁重绘导致闪屏
    return `${url}${connector}t=${resourceVersion.value}`;
  };

  const widgets = ref<WidgetConfig[]>([]);

  const appConfig = ref<AppConfig>({
    background: "/default-wallpaper.svg",
    mobileBackground: "/default-wallpaper.svg",
    solidBackgroundColor: "",
    enableMobileWallpaper: true,
    fixedWallpaper: false,
    deviceMode: "auto",
    widgetAreaSize: 4,
    widgetAreaCols: 4,
    widgetAreaRows: 4,
    pcRotation: false,
    pcRotationInterval: 30,
    pcRotationMode: "random",
    mobileRotation: false,
    mobileRotationInterval: 30,
    mobileRotationMode: "random",
    backgroundBlur: 0,
    backgroundMask: 0,
    mobileBackgroundBlur: 0,
    mobileBackgroundMask: 0,
    daylightModeEnabled: false,
    daylightMask: 0.5,
    weatherEffectEnabled: false,
    customTitle: "我的导航",
    titleAlign: "left",
    titleSize: 48,
    titleColor: "#ffffff",
    cardLayout: "vertical",
    cardSize: 120,
    gridGap: 24,
    cardBgColor: "transparent",
    cardTitleColor: "#111827",
    cardBorderColor: "transparent",
    showCardBackground: true,
    iconShape: "rounded",
    searchEngines: [
      {
        id: "google",
        key: "google",
        label: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
      },
      { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
      { id: "baidu", key: "baidu", label: "百度", urlTemplate: "https://www.baidu.com/s?wd={q}" },
    ],
    defaultSearchEngine: "google",
    rememberLastEngine: true,
    groupTitleColor: "#ffffff",
    groupGap: 30,
    autoPlayMusic: false,
    showFooterStats: false,
    footerHtml: "",
    footerHeight: 0,
    footerWidth: 1280,
    footerMarginBottom: 0,
    footerFontSize: 12,
    // Wallpaper API defaults
    wallpaperApiPcList: "/api/backgrounds",
    wallpaperApiPcUpload: "/api/backgrounds/upload",
    wallpaperApiPcDeleteBase: "/api/backgrounds",
    wallpaperPcImageBase: "/backgrounds",
    wallpaperApiMobileList: "/api/mobile_backgrounds",
    wallpaperApiMobileUpload: "/api/mobile_backgrounds/upload",
    wallpaperApiMobileDeleteBase: "/api/mobile_backgrounds",
    wallpaperMobileImageBase: "/mobile_backgrounds",
    mobileWallpaperOrder: [],
    sidebarViewMode: "bookmarks",
    webGroupPagination: false,
    webGroupPaginationDisableFlip: false,
    empireMode: false,
    customCss: "",
    customJs: "",
    customJsList: [],
    customJsDisclaimerAgreed: false,
    mouseHoverEffect: "scale",
    forceNetworkMode: "auto",
    latencyThresholdMs: 200,
  });

  const CACHE_KEY = "flat-nas-data-cache";
  const normalizeVersion = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    return 0;
  };
  const CACHE_WRITE_GUARD_MS = 15000;
  const SERVER_SNAPSHOT_RETRY_COUNT = 3;
  const SERVER_SNAPSHOT_RETRY_DELAY_MS = 1000;
  const SERVER_SNAPSHOT_TIMEOUT_MS = 6000;
  const cacheLoadedAt = ref<number | null>(null);
  const hasServerSnapshot = ref(false);
  const deferredSaveRequested = ref(false);

  const saveToCache = (data: Record<string, unknown>) => {
    try {
      const nextVersion = normalizeVersion(data.version ?? dataVersion.value);
      const cacheData = {
        groups: data.groups,
        widgets: data.widgets,
        appConfig: data.appConfig,
        rssFeeds: data.rssFeeds,
        rssCategories: data.rssCategories,
        username: data.username || username.value,
        version: nextVersion,
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (e) {
      console.warn("Cache save failed", e);
    }
  };

  const loadFromCache = () => {
    try {
      const json = localStorage.getItem(CACHE_KEY);
      if (!json) return false;
      const cache = JSON.parse(json);

      // Security check: only load cache if it belongs to current user
      const cachedUser = cache.username || "";
      const currentUser = username.value || "";
      // Allow loading 'admin' cache if current user is empty (guest mode / initial load)
      const isMatch = cachedUser === currentUser || (currentUser === "" && cachedUser === "admin");
      if (!isMatch) return false;

      if (cache.groups) groups.value = cache.groups;
      if (cache.widgets) widgets.value = cache.widgets;
      if (cache.appConfig) appConfig.value = { ...appConfig.value, ...cache.appConfig };
      if (cache.rssFeeds) rssFeeds.value = cache.rssFeeds;
      if (cache.rssCategories) rssCategories.value = cache.rssCategories;
      if (cache.systemConfig) systemConfig.value = cache.systemConfig;
      if (typeof cache.version !== "undefined") {
        dataVersion.value = normalizeVersion(cache.version);
      }

      return true;
    } catch (e) {
      console.warn("Cache load failed", e);
      return false;
    }
  };

  const isCacheWriteGuardActive = () => {
    if (hasServerSnapshot.value) return false;
    if (cacheLoadedAt.value === null) return false;
    return Date.now() - cacheLoadedAt.value < CACHE_WRITE_GUARD_MS;
  };

  const markServerSnapshotReady = () => {
    hasServerSnapshot.value = true;
    cacheLoadedAt.value = null;
    if (deferredSaveRequested.value) {
      deferredSaveRequested.value = false;
      saveData(true);
    }
  };
  const isServerSnapshotReady = computed(() => hasServerSnapshot.value);
  const isClientReady = computed(() => hasServerSnapshot.value || cacheLoadedAt.value !== null);

  const ensureDefaultCommonGroup = () => {
    // 逻辑已移除：允许用户删除所有分组，不再强制恢复默认分组
    /*
    const common = groups.value.find((g) => g.id === "common-group" || g.title === "常用");
    if (!common) {
      if (groups.value.length === 0) {
        groups.value = [makeDefaultCommonGroup()];
      }
      return;
    }

    if (!Array.isArray(common.items)) common.items = [];
    if (common.items.length === 0) {
      common.items = makeDefaultCommonGroup().items;
    }
    if (common.preset !== true) common.preset = true;
    */
  };

  const handleDataUpdate = (data: BackupData) => {
    const tStart = performance.now();
    let tUser = tStart;
    // If we got username back, ensure it matches
    if (data.username && data.username !== username.value) {
      username.value = data.username;
      localStorage.setItem("flat-nas-username", data.username);
    }
    tUser = performance.now();
    if (typeof data.version !== "undefined") {
      dataVersion.value = normalizeVersion(data.version);
    }

    // Fix: Only restore items if groups is undefined (legacy data).
    // If groups is empty array [], it means user deleted all groups, so don't restore.
    if (data.items && data.items.length > 0 && !data.groups) {
      groups.value = [{ id: Date.now().toString(), title: "默认分组", items: data.items }];
      saveData();
    } else if (data.groups) {
      groups.value = data.groups;
    } else {
      groups.value = [];
    }

    ensureDefaultCommonGroup();
    const tGroups = performance.now();

    if (Array.isArray(data.widgets)) {
      widgets.value = data.widgets;

      // 修复潜在的组件类型错乱问题 (例如备忘录被错误标记为 docker)
      const memoW = widgets.value.find((w) => w.id === "memo");
      if (memoW && memoW.type !== "memo") {
        memoW.type = "memo";
      }

      // 强健的 Docker 组件修复逻辑
      // 1. 查找最佳 Docker 组件候选 (优先匹配 ID，其次匹配类型)
      let dockerCandidate = widgets.value.find((w) => w.id === "docker");
      if (!dockerCandidate) {
        dockerCandidate = widgets.value.find((w) => w.type === "docker");
      }

      // 2. 从列表中移除所有相关的组件 (防止重复或 ID 冲突)
      widgets.value = widgets.value.filter((w) => w.id !== "docker" && w.type !== "docker");

      // 3. 准备最终的 Docker 组件
      let finalDockerWidget: WidgetConfig;

      if (dockerCandidate) {
        // 使用现有组件作为基础，但强制 ID 和类型
        finalDockerWidget = dockerCandidate;
        finalDockerWidget.id = "docker";
        finalDockerWidget.type = "docker";
        // 确保关键属性存在，防止渲染错误
        if (typeof finalDockerWidget.colSpan !== "number") finalDockerWidget.colSpan = 1;
        if (typeof finalDockerWidget.rowSpan !== "number") finalDockerWidget.rowSpan = 1;
        if (typeof finalDockerWidget.enable !== "boolean") finalDockerWidget.enable = false;
        if (typeof finalDockerWidget.isPublic !== "boolean") finalDockerWidget.isPublic = true;
      } else {
        // 不存在则创建默认的
        finalDockerWidget = {
          id: "docker",
          type: "docker",
          enable: false,
          isPublic: true,
          colSpan: 1,
          rowSpan: 1,
        };
      }

      // 4. 将规范化后的 Docker 组件添加到列表末尾
      widgets.value.push(finalDockerWidget);

      const fileTransferList = widgets.value.filter((w) => w.type === "file-transfer");
      if (fileTransferList.length > 1) {
        const keep = fileTransferList.find((w) => w.id === "file-transfer") || fileTransferList[0]!;
        widgets.value = widgets.value.filter((w) => w.type !== "file-transfer" || w === keep);
        if (
          keep.id !== "file-transfer" &&
          !widgets.value.some((w) => w.id === "file-transfer" && w.type !== "file-transfer")
        ) {
          keep.id = "file-transfer";
        }
      } else if (
        fileTransferList.length === 1 &&
        fileTransferList[0]!.id !== "file-transfer" &&
        !widgets.value.some((w) => w.id === "file-transfer" && w.type !== "file-transfer")
      ) {
        fileTransferList[0]!.id = "file-transfer";
      }

      if (!widgets.value.find((w) => w.type === "rss")) {
        widgets.value.push({
          id: "rss-reader",
          type: "rss",
          enable: false,
          colSpan: 1,
          rowSpan: 2,
          isPublic: true,
        });
      }
      if (!widgets.value.find((w) => w.type === "sidebar")) {
        widgets.value.push({
          id: "sidebar",
          type: "sidebar",
          enable: false,
          isPublic: true,
        });
      }
      if (!widgets.value.find((w) => w.type === "status-monitor")) {
        widgets.value.push({
          id: "status-monitor",
          type: "status-monitor",
          enable: false,
          colSpan: 1,
          rowSpan: 1,
          isPublic: true,
        });
      }
    } else {
      // Default widgets if empty
      widgets.value = [
        { id: "w1", type: "clock", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "w2", type: "weather", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "w3", type: "calendar", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "w5", type: "search", enable: true, isPublic: true },
        { id: "w7", type: "quote", enable: true, isPublic: true },
        {
          id: "clockweather",
          type: "clockweather",
          enable: true,
          colSpan: 1,
          rowSpan: 1,
          isPublic: true,
        },
        { id: "sidebar", type: "sidebar", enable: false, isPublic: true },
        { id: "memo", type: "memo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "todo", type: "todo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        {
          id: "calculator",
          type: "calculator",
          enable: true,
          colSpan: 1,
          rowSpan: 1,
          isPublic: true,
        },
        { id: "ip", type: "ip", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "hot", type: "hot", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
        { id: "player", type: "player", enable: true, colSpan: 2, rowSpan: 1, isPublic: true },
        {
          id: "status-monitor",
          type: "status-monitor",
          enable: false,
          colSpan: 1,
          rowSpan: 1,
          isPublic: true,
        },
      ];
    }
    const tWidgets = performance.now();

    if (data.appConfig) appConfig.value = { ...appConfig.value, ...data.appConfig };

    // Migration for Custom Scripts List
    if (
      appConfig.value.customCss &&
      (!appConfig.value.customCssList || appConfig.value.customCssList.length === 0)
    ) {
      appConfig.value.customCssList = [
        {
          id: "default-css",
          name: "默认自定义 CSS",
          content: appConfig.value.customCss,
          enable: true,
        },
      ];
    }
    if (!appConfig.value.customCssList) appConfig.value.customCssList = [];

    if (
      appConfig.value.customJs &&
      (!appConfig.value.customJsList || appConfig.value.customJsList.length === 0)
    ) {
      appConfig.value.customJsList = [
        {
          id: "default-js",
          name: "默认自定义 JS",
          content: appConfig.value.customJs,
          enable: true,
        },
      ];
    }
    if (!appConfig.value.customJsList) appConfig.value.customJsList = [];

    if (!appConfig.value.background) appConfig.value.background = "/default-wallpaper.svg";

    if (!appConfig.value.searchEngines || appConfig.value.searchEngines.length === 0) {
      appConfig.value.searchEngines = [
        {
          id: "google",
          key: "google",
          label: "Google",
          urlTemplate: "https://www.google.com/search?q={q}",
        },
        {
          id: "bing",
          key: "bing",
          label: "Bing",
          urlTemplate: "https://cn.bing.com/search?q={q}",
        },
        {
          id: "baidu",
          key: "baidu",
          label: "百度",
          urlTemplate: "https://www.baidu.com/s?wd={q}",
        },
      ];
    }
    if (!appConfig.value.defaultSearchEngine) appConfig.value.defaultSearchEngine = "google";
    if (typeof appConfig.value.rememberLastEngine !== "boolean")
      appConfig.value.rememberLastEngine = true;

    const cachedShape = localStorage.getItem("flat-nas-icon-shape");
    if (cachedShape) appConfig.value.iconShape = cachedShape;
    const cachedColor = localStorage.getItem("flat-nas-group-title-color");
    if (cachedColor) appConfig.value.groupTitleColor = cachedColor;
    const cachedCardBg = localStorage.getItem("flat-nas-card-bg-color");
    if (cachedCardBg) appConfig.value.cardBgColor = cachedCardBg;

    if (typeof appConfig.value.widgetAreaCols !== "number") {
      if (typeof appConfig.value.widgetAreaSize === "number") {
        appConfig.value.widgetAreaCols = appConfig.value.widgetAreaSize;
      } else {
        appConfig.value.widgetAreaCols = 4;
      }
    }
    if (typeof appConfig.value.widgetAreaRows !== "number") {
      if (typeof appConfig.value.widgetAreaSize === "number") {
        appConfig.value.widgetAreaRows = appConfig.value.widgetAreaSize;
      } else {
        appConfig.value.widgetAreaRows = 4;
      }
    }
    const tConfig = performance.now();

    if (data.rssFeeds) rssFeeds.value = data.rssFeeds;
    if (data.rssCategories) rssCategories.value = data.rssCategories;
    const tRss = performance.now();

    // Fetch custom scripts separately
    fetchCustomScripts();

    checkUpdate();
    saveToCache(data);
    const tEnd = performance.now();
    console.log("handleDataUpdate timing", {
      userMs: Math.round(tUser - tStart),
      groupsMs: Math.round(tGroups - tUser),
      widgetsMs: Math.round(tWidgets - tGroups),
      configMs: Math.round(tConfig - tWidgets),
      rssMs: Math.round(tRss - tConfig),
      tailMs: Math.round(tEnd - tRss),
      totalMs: Math.round(tEnd - tStart),
    });
  };

  const fetchCustomScripts = async () => {
    try {
      const headers = getHeaders();
      // Skip if no token (public view might rely on embedded scripts or default config)
      if (!token.value) return;

      const res = await fetch("/api/custom-scripts", { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          isApplyingServerData = true;
          if (Array.isArray(data.css)) appConfig.value.customCssList = data.css;
          if (Array.isArray(data.js)) appConfig.value.customJsList = data.js;
          // Apply immediately（拼合 customCss/customJs 字段，但不触发保存）
          updateCustomScripts(false);
          nextTick(() => {
            isApplyingServerData = false;
          });
        }
      }
    } catch (e) {
      console.error("Failed to fetch custom scripts", e);
    }
  };

  const fetchAndProcessData = async () => {
    try {
      // 记录开始获取时的版本号
      const versionBeforeFetch = dataVersion.value;

      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;

      const res = await fetch(`/api/data`, { headers });
      if (!res.ok) return;
      const data = await res.json();

      // Double check if user has started editing while we were fetching
      if (saveTimer !== null || isSaving.value) {
        return;
      }

      // 版本冲突处理中时，不拉取服务器数据覆盖本地修改
      // 等待冲突重试保存完成后，is409RetryPending 会自动被清除
      if (is409RetryPending) {
        return;
      }

      // 版本保护：只有当获取的数据版本更新时，才应用
      // 如果本地版本已经更新（用户在获取期间修改了数据），则不覆盖
      const fetchedVersion = typeof data.version !== "undefined" ? normalizeVersion(data.version) : 0;
      if (fetchedVersion > 0 && dataVersion.value > versionBeforeFetch) {
        // 本地版本在获取期间已更新（用户修改了数据），不覆盖
        console.log(`Skip fetched data: local version updated during fetch (${versionBeforeFetch} -> ${dataVersion.value})`);
        return;
      }
      isApplyingServerData = true;
      handleDataUpdate(data);
      nextTick(() => {
        isApplyingServerData = false;
      });
      if (!hasServerSnapshot.value) {
        saveToCache(data);
        markServerSnapshotReady();
      }
    } catch (e) {
      console.error("Fetch data failed", e);
    }
  };

  let serverSnapshotRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const fetchWithTimeout = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = SERVER_SNAPSHOT_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const loadServerSnapshot = async () => {
    const snapshotStart = performance.now();
    const fetchStart = performance.now();
    const res = await fetchWithTimeout("/api/data", { headers: getHeaders() });
    const fetchMs = performance.now() - fetchStart;
    if (!res.ok) {
      throw new Error(`Init failed with status ${res.status}`);
    }
    const jsonStart = performance.now();
    const data = await res.json();
    const jsonMs = performance.now() - jsonStart;
    if (data.systemConfig) {
      systemConfig.value = data.systemConfig;
    }

    if (data.username) {
      username.value = data.username;
      localStorage.setItem("flat-nas-username", data.username);
    }

    const handleStart = performance.now();
    handleDataUpdate(data);
    const handleMs = performance.now() - handleStart;
    saveToCache(data);
    markServerSnapshotReady();
    const totalMs = performance.now() - snapshotStart;
    console.log("init snapshot timing", {
      fetchMs: Math.round(fetchMs),
      jsonMs: Math.round(jsonMs),
      handleMs: Math.round(handleMs),
      totalMs: Math.round(totalMs),
    });
  };

  const init = async () => {
    if (isInitializing) return;
    isInitializing = true;

    hasServerSnapshot.value = false;
    cacheLoadedAt.value = null;
    deferredSaveRequested.value = false;

    const cacheLoaded = loadFromCache();
    if (cacheLoaded) {
      cacheLoadedAt.value = Date.now();
    }

    try {
      let serverSnapshotLoaded = false;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < SERVER_SNAPSHOT_RETRY_COUNT; attempt++) {
        try {
          await loadServerSnapshot();
          serverSnapshotLoaded = true;
          setTimeout(() => {
            checkUpdate();
            fetchLuckyStunData();
          }, 2000);
          break;
        } catch (e) {
          lastError = e;
        }
        if (attempt < SERVER_SNAPSHOT_RETRY_COUNT - 1) {
          await new Promise((resolve) => setTimeout(resolve, SERVER_SNAPSHOT_RETRY_DELAY_MS));
        }
      }
      if (!serverSnapshotLoaded) {
        if (lastError) {
          console.error("Init failed", lastError);
        }
        const fallbackLoaded = loadFromCache();
        if (fallbackLoaded && cacheLoadedAt.value === null) {
          cacheLoadedAt.value = Date.now();
        }
        if (!serverSnapshotRetryTimer) {
          serverSnapshotRetryTimer = setTimeout(async () => {
            serverSnapshotRetryTimer = null;
            if (hasServerSnapshot.value) return;
            try {
              await loadServerSnapshot();
              setTimeout(() => {
                checkUpdate();
                fetchLuckyStunData();
              }, 2000);
            } catch (e) {
              console.error("Init retry failed", e);
            }
          }, SERVER_SNAPSHOT_RETRY_DELAY_MS * 3);
        }
      }
    } finally {
      isInitializing = false;
      if (!socketListenersBound) {
        socket.on("memo:updated", ({ widgetId, content }: { widgetId: string; content: WidgetConfig["data"] }) => {
          const w = widgets.value.find((x) => x.id === widgetId);
          if (w) w.data = content;
        });
        socket.on("todo:updated", ({ widgetId, content }: { widgetId: string; content: WidgetConfig["data"] }) => {
          const w = widgets.value.find((x) => x.id === widgetId);
          if (w) w.data = content;
        });
        socket.on(
          "data-updated",
          async ({ username: updatedUser, version }: { username: string; version?: number }) => {
            // 如果有正在进行的保存或等待中的保存，则忽略本次更新，以本地状态为准
            // 避免快速操作时被旧的服务器状态覆盖
            if (saveTimer !== null || isSaving.value) {
              return;
            }

            if (
              updatedUser === username.value ||
              (username.value === "admin" && updatedUser === "admin")
            ) {
              // 版本控制：只有当服务器版本更新时，才从服务器拉取数据
              // 如果本地版本 >= 服务器版本，说明本地有更新的修改（正在等待保存），不覆盖
              if (typeof version !== "undefined") {
                const serverVersion = normalizeVersion(version);
                const localVersion = dataVersion.value;

                // 只有服务器版本更新时才拉取
                if (serverVersion > localVersion) {
                  dataVersion.value = serverVersion;
                  await fetchAndProcessData();
                }
                // 如果 serverVersion <= localVersion，说明：
                // 1. 本地已经有最新数据，或
                // 2. 本地有更新的修改（还在防抖等待保存）
                // 这两种情况都不应该从服务器拉取数据
              } else {
                // 如果没有版本号（旧版本兼容），仍然拉取数据
                await fetchAndProcessData();
              }
            }
          },
        );
        socket.on("network:heartbeat", () => {
          lastNetworkHeartbeatAt = Date.now();
          updateNetworkSyncMode(true);
        });
        socket.on("network:mode", ({ mode, username: updatedUser }: { mode: string; username: string }) => {
          if (!mode) return;
          if (
            updatedUser &&
            updatedUser !== username.value &&
            !(username.value === "admin" && updatedUser === "admin")
          ) {
            return;
          }
          applyRemoteNetworkMode(mode);
        });
        socket.on("connect", () => {
          if (!isInitializing) {
            fetchAndProcessData();
          }
        });
        socketListenersBound = true;
      }
      if (token.value) {
        socket.emit("auth", { token: token.value });
      }
    }
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const isSaving = ref(false);
  let lastSavedJson = "";
  // 409 重试期间置为 true，阻止 fetchAndProcessData 覆盖本地修改
  let is409RetryPending = false;
  // 服务端数据回填期间置为 true，阻止深度监听触发保存（防止死循环）
  let isApplyingServerData = false;

  const conflictState = ref({
    show: false,
    serverVersion: 0,
    clientVersion: 0,
  });

  const saveData = async (immediate = false, force = false) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    const doSave = async () => {
      const shouldSyncAfterConflict = false;
      let shouldRetryAfter409 = false;
      if (isPageUnloading.value) {
        return;
      }
      if (isCacheWriteGuardActive()) {
        deferredSaveRequested.value = true;
        return;
      }

      // 乐观锁：在开始保存时立即增加本地版本号，防止在保存期间被远程数据覆盖
      const versionToSend = dataVersion.value;
      const optimisticVersion = versionToSend + 1;
      dataVersion.value = optimisticVersion;

      isSaving.value = true;
      try {
        if (!isLogged.value) {
          return;
        }

        // Handle force save: adopt server version to bypass conflict check
        if (force && conflictState.value.show) {
          dataVersion.value = normalizeVersion(conflictState.value.serverVersion);
        }

        const body: Record<string, unknown> = {
          groups: groups.value,
          widgets: widgets.value,
          appConfig: appConfig.value,
          rssFeeds: rssFeeds.value,
          rssCategories: rssCategories.value,
          version: versionToSend, // 发送保存前的版本号给后端验证
        };
        if (typeof password.value === "string" && password.value.length > 0) {
          body.password = password.value;
        }
        const json = JSON.stringify(body);

        if (json === lastSavedJson) {
          return;
        }

        // Optimistic cache save to ensure data persistence even if network fails
        saveToCache(body);

        const res = await fetch("/api/save", {
          method: "POST",
          headers: getHeaders(),
          body: json,
        });

        if (res.ok) {
          conflictState.value.show = false;
          const result = await res.json().catch(() => null);
          if (result && typeof (result as { version?: number }).version !== "undefined") {
            dataVersion.value = normalizeVersion((result as { version?: number }).version);
          }
          lastSavedJson = JSON.stringify({ ...body, version: dataVersion.value });
          if (body.password) {
            password.value = "";
          }
        }
        if (res.status === 409) {
          const result = await res.json().catch(() => null);
          const serverVer = (result as { currentVersion?: number } | null)?.currentVersion;
          if (typeof serverVer !== "undefined") {
            const v = normalizeVersion(serverVer);
            conflictState.value = {
              show: true,
              serverVersion: v,
              clientVersion: versionToSend,
            };
            // 同步本地版本号为服务器版本，防止版本号漂移
            dataVersion.value = v;
          }
          // 版本冲突时：采用服务器版本号，设置重试标记
          // 仅在非重试请求（!immediate）时才允许重试，避免死循环
          if (!immediate) {
            shouldRetryAfter409 = true;
          }
          return;
        }

        if (res.status === 401) {
          token.value = "";
          username.value = "";
          isLogged.value = false;
          localStorage.removeItem("flat-nas-token");
          localStorage.removeItem("flat-nas-username");
        }
      } catch (e) {
        if (isPageUnloading.value) {
          return;
        }
        if (e instanceof DOMException && e.name === "AbortError") {
          return;
        }
        console.error("保存失败", e);
        // 保存失败，回滚版本号
        dataVersion.value = versionToSend;
      } finally {
        isSaving.value = false;
        if (shouldSyncAfterConflict) {
          await fetchAndProcessData();
        }
        if (shouldRetryAfter409) {
          // 版本冲突后，用已更新的服务器版本号立即重试一次保存
          // 此时 dataVersion 已同步为服务器版本，重试应能成功
          // immediate=true 传入，下次 409 时不再重试（防止死循环）
          is409RetryPending = true;
          try {
            await saveData(true);
          } finally {
            is409RetryPending = false;
          }
        }
      }
    };

    if (immediate) {
      return doSave();
    }

    saveTimer = setTimeout(() => {
      saveTimer = null;
      doSave();
    }, 500);
  };

  if (typeof window !== "undefined") {
    const markUnloading = () => {
      isPageUnloading.value = true;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    };
    window.addEventListener("beforeunload", markUnloading);
    window.addEventListener("pagehide", markUnloading);
  }

  const cleanInvalidGroups = () => {
    const seen = new Set<string>();
    groups.value = groups.value.filter((g) => {
      const validId = typeof g.id === "string" && g.id.length > 0;
      const dup = validId && seen.has(g.id);
      if (validId) seen.add(g.id);
      const hasTitle = typeof g.title === "string" && g.title.trim().length > 0;
      const hasItems = Array.isArray(g.items) && g.items.length > 0;
      return validId && (hasTitle || hasItems) && !dup;
    });
  };

  const addGroup = () => {
    try {
      const id = Date.now().toString();
      const index = groups.value.length + 1;
      const title = `新建分组 ${index}`;
      groups.value.push({ id, title, items: [] });
      // saveData() 已由 watch 自动触发，无需手动调用
    } catch (e) {
      console.error(e);
    }
  };

  const deleteGroup = (groupId: string, skipConfirm = false) => {
    if (!skipConfirm && !confirm("确定删除？")) return;
    groups.value = groups.value.filter((g) => g.id !== groupId);
    // saveData() 已由 watch 自动触发
  };

  const updateGroupTitle = (groupId: string, newTitle: string) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      group.title = newTitle;
      // saveData() 已由 watch 自动触发
    }
  };

  const updateGroup = (groupId: string, updates: Partial<NavGroup>) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      Object.assign(group, updates);
      // saveData() 已由 watch 自动触发
    }
  };

  const addItem = (item: NavItem, groupId: string) => {
    const group = groups.value.find((g) => g.id === groupId);
    if (group) {
      group.items.push({ ...item, isPublic: item.isPublic ?? true });
      // saveData() 已由 watch 自动触发
    }
  };

  const updateItem = (updatedItem: NavItem) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === updatedItem.id);
      if (idx !== -1) {
        group.items[idx] = updatedItem;
        // saveData() 已由 watch 自动触发
        return;
      }
    }
  };

  const deleteItem = (id: string) => {
    for (const group of groups.value) {
      const idx = group.items.findIndex((i) => i.id === id);
      if (idx !== -1) {
        group.items.splice(idx, 1);
        // saveData() 已由 watch 自动触发
        return;
      }
    }
  };

  const login = async (usr: string, pwd: string) => {
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) {
        const data = await res.json();
        token.value = data.token;
        username.value = data.username;
        isLogged.value = true;

        localStorage.setItem("flat-nas-token", data.token);
        localStorage.setItem("flat-nas-username", data.username);

        // Reload data for the new user
        await init();
        return true;
      }
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    } catch (e: unknown) {
      console.error(e);
      throw e;
    }
  };

  const register = async (usr: string, pwd: string) => {
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Register failed");
    } catch (e: unknown) {
      console.error(e);
      throw e;
    }
  };

  const fetchUsers = async () => {
    try {
      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/users", { headers });
      if (res.ok) {
        const data = await res.json();
        return data.users;
      }
      return [];
    } catch {
      return [];
    }
  };

  const addUser = async (usr: string, pwd: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: usr, password: pwd }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Add user failed");
    } catch (e) {
      throw e;
    }
  };

  const deleteUser = async (usr: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch(`/api/admin/users/${usr}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) return true;
      throw new Error("Delete failed");
    } catch (e) {
      throw e;
    }
  };

  const uploadLicense = async (key: string) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token.value) headers["Authorization"] = `Bearer ${token.value}`;
      const res = await fetch("/api/admin/license", {
        method: "POST",
        headers,
        body: JSON.stringify({ key }),
      });
      if (res.ok) return true;
      const data = await res.json();
      throw new Error(data.error || "Upload license failed");
    } catch (e) {
      throw e;
    }
  };

  const logout = async () => {
    token.value = "";
    username.value = "";
    isLogged.value = false;
    localStorage.removeItem("flat-nas-token");
    localStorage.removeItem("flat-nas-username");
    stopNetworkHeartbeat();

    // Reload to show default/public view
    await init();
  };

  socket.on("auth-mode-changed", (data: { mode: string }) => {
    if (data && data.mode) {
      systemConfig.value.authMode = data.mode;
    }
    if (isLogged.value) {
      // Force logout on other clients when system mode changes
      logout();
    } else {
      // Refresh to update UI state (e.g. login screen vs dashboard)
      init();
    }
  });

  const changePassword = (newPwd: string) => {
    password.value = newPwd;
  };

  const saveWidget = async (id?: string, data?: unknown) => {
    if (typeof id === "string") {
      const w = widgets.value.find((x) => x.id === id);
      if (w) w.data = data as WidgetConfig["data"];
    }
    await saveData();
  };

  watch(
    () => appConfig.value.iconShape,
    (val) => {
      if (typeof val === "string") localStorage.setItem("flat-nas-icon-shape", val);
    },
  );
  watch(
    () => appConfig.value.cardBgColor,
    (val) => {
      if (typeof val === "string") localStorage.setItem("flat-nas-card-bg-color", val);
    },
  );

  watch(
    () => [appConfig.value.widgetAreaCols, appConfig.value.widgetAreaRows] as const,
    ([cols, rows]) => {
      const normalize = (v: unknown, fallback: number) => {
        const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
        return Math.min(16, Math.max(0.5, n));
      };
      const nextCols = normalize(cols, 4);
      const nextRows = normalize(rows, 4);
      if (nextCols !== cols) appConfig.value.widgetAreaCols = nextCols;
      if (nextRows !== rows) appConfig.value.widgetAreaRows = nextRows;
    },
    { immediate: true },
  );

  watch(
    () => appConfig.value.forceNetworkMode,
    (mode, prev) => {
      if (!mode || mode === prev) return;
      if (isApplyingNetworkMode) return;
      scheduleNetworkModeBroadcast(mode);
    },
  );

  // 统一的数据变更监听：合并所有 deep watch 到一个，避免竞态
  watch(
    () => ({
      groups: groups.value,
      appConfig: appConfig.value,
      widgets: widgets.value,
      rssFeeds: rssFeeds.value,
      rssCategories: rssCategories.value,
    }),
    () => {
      if (!isInitializing && !isApplyingNetworkMode && !isApplyingServerData) {
        saveData();
      }
    },
    { deep: true },
  );

  const saveCustomScripts = async () => {
    try {
      if (!isLogged.value) return;
      const res = await fetch("/api/custom-scripts", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          css: appConfig.value.customCssList || [],
          js: appConfig.value.customJsList || [],
        }),
      });
      if (!res.ok) {
        console.error("Failed to save custom scripts");
      }
    } catch (e) {
      console.error("Error saving custom scripts", e);
    }
  };

  const updateCustomScripts = (doSave = true) => {
    if (appConfig.value.customCssList) {
      appConfig.value.customCss = appConfig.value.customCssList
        .filter((item) => item.enable)
        .map((item) => `/* ${item.name} */\n${item.content}`)
        .join("\n\n");
    }
    if (appConfig.value.customJsList) {
      appConfig.value.customJs = appConfig.value.customJsList
        .filter((item) => item.enable)
        .map((item) => `// ${item.name}\n${item.content}`)
        .join("\n\n");
    }
    if (doSave) {
      // saveData() 已由 watch 自动触发，但仍需调用 saveCustomScripts() 保存到独立文件
      saveCustomScripts();
    }
  };

  return {
    groups,
    items,
    widgets,
    appConfig,
    password,
    isLogged,
    token,
    username, // Export username
    getHeaders,
    isExpandedMode,
    activeMusicPlayer,
    webPaginationActiveGroupId,
    isLanModeInited,
    ipFetchStatus,
    globalDrag,
    initGlobalDrag,
    rssFeeds,
    rssCategories,
    init,
    fetchData: fetchAndProcessData,
    addGroup,
    deleteGroup,
    updateGroupTitle,
    updateGroup,
    addItem,
    updateItem,
    deleteItem,
    login,
    register,
    logout,
    changePassword,
    saveWidget,
    saveData,
    cleanInvalidGroups,
    checkUpdate,
    currentVersion,
    latestVersion,
    hasUpdate,
    fetchSystemConfig,
    updateSystemConfig,
    systemConfig,
    isConnected,
    socket,
    fetchUsers,
    addUser,
    deleteUser,
    uploadLicense,
    luckyStunData,
    fetchLuckyStunData,
    getAssetUrl,
    refreshResources,
    resourceVersion,
    updateCustomScripts,
    isServerSnapshotReady,
    isClientReady,
    conflictState,
  };
});
