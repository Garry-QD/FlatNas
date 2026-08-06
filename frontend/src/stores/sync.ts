import { ref, computed, watch } from "vue";
import { defineStore } from "pinia";
import { useWebSocket } from "@vueuse/core";
import { normalizeVersion } from "@/utils/storeHelpers";
import type { LuckyStunData } from "@/types";
import { useAuthStore } from "./auth";
import { useWidgetsStore } from "./widgets";
import { useGroupsStore } from "./groups";
import { useConfigStore } from "./config";
import { useCacheStore } from "./cache";
import { useSaveStore } from "./save";
import { useNetworkStore } from "./network";
import { toWsUrl } from "@/utils/runtimeUrls";

export const useSyncStore = defineStore("sync", () => {
  const auth = useAuthStore();
  const widgetsStore = useWidgetsStore();
  const groupsStore = useGroupsStore();
  const configStore = useConfigStore();
  const cacheStore = useCacheStore();
  const saveStore = useSaveStore();
  const networkStore = useNetworkStore();

  // ---- WebSocket ----
  const lastWsUrl = ref("");
  const wsUrl = computed(() => {
    if (typeof window === "undefined") return "";
    // In dev mode, connect directly to backend WS port to avoid Vite proxy issues
    if (import.meta.env.DEV) {
      const backend = import.meta.env.VITE_BACKEND || "http://127.0.0.1:3000";
      const url = new URL(backend);
      const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      return `${wsProtocol}//${url.hostname}:${port}/ws`;
    }
    return toWsUrl("/ws");
  });

  const trackWsUrlChange = (url: string) => {
    if (url && url !== lastWsUrl.value) {
      lastWsUrl.value = url;
    }
  };

  const { status, data: wsRawData, send: wsSendRaw, open: wsOpen, close: wsClose } = useWebSocket(
    () => wsUrl.value,
    {
      autoReconnect: {
        retries: Infinity,
        delay: (attempt: number) => {
          if (attempt <= 3) return 500 * (attempt + 1);
          const base = Math.min(1000 * Math.pow(2, Math.min(attempt, 15)), 30000);
          const jitter = base * 0.2 * (Math.random() * 2 - 1);
          return base + jitter;
        },
        onFailed: () => {
          console.warn("[WS] Auto-reconnect exhausted, marking network as stale");
          networkStore.markStale();
        },
      },
      immediate: false,
      heartbeat: {
        message: JSON.stringify({ type: "ping" }),
        interval: 15000,
        pongTimeout: 8000,
      },
      onConnected: (ws) => {
        if (ws?.url) trackWsUrlChange(ws.url);
        wsContinuousFailures = 0;
        rapidDisconnectCount = 0;
        networkStore.markFresh();
      },
      onDisconnected: () => {
        wsContinuousFailures++;
        // Rapid failure detection: if 3+ disconnects within 5s, WS is likely blocked by proxy
        const now = Date.now();
        if (now - lastDisconnectTime < 5000) {
          rapidDisconnectCount++;
          if (rapidDisconnectCount >= 3 && auth.isLogged && !isHttpPollingActive) {
            console.warn("[WS] Rapid failures detected (proxy env?), starting HTTP polling immediately");
            startHttpPolling();
          }
        } else {
          rapidDisconnectCount = 1;
        }
        lastDisconnectTime = now;
        if (wsContinuousFailures > 6) {
          console.warn(`[WS] ${wsContinuousFailures} consecutive disconnections, scheduling immediate sync`);
          setTimeout(() => fetchAndProcessData(), 0);
        }
      },
    },
  );

  // Rapid failure detection for proxy environments where WS upgrade is unsupported
  let rapidDisconnectCount = 0;
  let lastDisconnectTime = 0;

  let wsHealthCheckTimer: ReturnType<typeof setInterval> | null = null;

  const startWsHealthCheck = () => {
    if (wsHealthCheckTimer) return;
    wsHealthCheckTimer = setInterval(() => {
      if (!auth.isLogged || status.value !== "OPEN") return;
      if (networkStore.isStale(30000)) {
        const elapsed = Date.now() - networkStore.lastPingAt;
        console.warn(`[WS] Health check: pong stale for ${elapsed}ms, forcing reconnect`);
        forceWsReconnect();
      }
    }, 10000);
  };

  const stopWsHealthCheck = () => {
    if (wsHealthCheckTimer) {
      clearInterval(wsHealthCheckTimer);
      wsHealthCheckTimer = null;
    }
  };

  const forceWsReconnect = () => {
    if (!auth.isLogged) return;
    const currentUrl = wsUrl.value;
    if (!currentUrl) return;
    console.log(`[WS] Force reconnect: currentUrl=${currentUrl}`);
    lastWsUrl.value = currentUrl;
    stopWsHealthCheck();
    networkStore.markStale();
    wsClose();
    setTimeout(() => {
      if (auth.isLogged) {
        wsOpen();
        startWsHealthCheck();
      }
    }, 2000);
  };

  const getWsNetworkSignature = (): { url: string; hostname: string; isDev: boolean } => {
    const current = wsUrl.value;
    try {
      const parsed = new URL(current);
      return { url: current, hostname: parsed.hostname, isDev: import.meta.env.DEV };
    } catch {
      return { url: current, hostname: "", isDev: import.meta.env.DEV };
    }
  };

  const wsSend = (message: Record<string, unknown>) => {
    if (status.value === "OPEN") wsSendRaw(JSON.stringify(message));
  };

  const isConnected = computed(() => status.value === "OPEN");

  // ---- Data state ----
  const dataVersion = ref(0);
  const pendingServerVersion = ref(0);
  const rssFeeds = ref([]);
  const rssCategories = ref([]);
  const luckyStunData = ref<LuckyStunData | null>(null);

  // ---- State flags ----
  let wsMessageHandlerBound = false;
  let visibilityVersionCheckBound = false;
  let isInitializing = false;
  let isFirstConnect = true;
  let wsWasConnectedBefore = false;
  let wsContinuousFailures = 0;
  let isApplyingServerData = false;
  const initCompleted = ref(false);
  const WS_FALLBACK_THRESHOLD = 5;
  let isHttpPollingActive = false;
  const isHttpPollingActiveRef = computed(() => isHttpPollingActive);
  let httpPollTimer: ReturnType<typeof setInterval> | null = null;
  let activePollAbortController: AbortController | null = null;

  // ---- Guest/Auth dual state tree isolation ----
  // Tracks the source role of the current active layout state
  let activeStateRole: "auth" | "guest" | "unknown" = "unknown";
  // True if the current active layout contains non-public widgets/groups
  let hasNonPublicLayout = false;

  const detectHasNonPublicLayout = (): boolean => {
    const widgets = widgetsStore.widgets;
    const hasNonPublicWidget = widgets.some((w: any) => w.isPublic !== true);
    const groups = groupsStore.groups;
    const hasNonPublicGroup = (groups || []).some((g: any) => g.isPublic !== true);
    return hasNonPublicWidget || hasNonPublicGroup;
  };

  const detectResponseRole = (data: Record<string, unknown>): "auth" | "guest" => {
    if (data.username && data.version !== undefined) return "auth";
    if (Array.isArray(data.widgets)) {
      const allPublic = (data.widgets as any[]).every((w: any) => w.isPublic === true);
      if (allPublic && (data.widgets as any[]).length > 0) return "guest";
    }
    return "auth";
  };

  const syncUsernameFromServer = (data: Record<string, unknown>, responseRole: "auth" | "guest") => {
    if (!auth.isLogged || responseRole !== "auth") return;
    const incomingSystemConfig = data.systemConfig as Record<string, unknown> | undefined;
    const authMode = incomingSystemConfig?.authMode === "single" || configStore.systemConfig.authMode === "single"
      ? "single"
      : "multi";
    const nextUsername = authMode === "single"
      ? "admin"
      : typeof data.username === "string"
        ? data.username.trim()
        : "";
    if (!nextUsername || nextUsername === auth.username) return;
    auth.username = nextUsername;
    localStorage.setItem("flat-nas-username", nextUsername);
  };

  // ---- HTTP Polling ----
  const fetchVersionOnly = async (): Promise<number> => {
    if (!auth.isLogged) return dataVersion.value;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      activePollAbortController = controller;
      const res = await fetch("/api/version", { method: "GET", headers: networkStore.getHeaders(), signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) { const data = await res.json(); return normalizeVersion(data?.version); }
    } catch { /* ignore */ }
    return dataVersion.value;
  };

  const stopHttpPolling = () => {
    if (!isHttpPollingActive) return;
    isHttpPollingActive = false;
    if (httpPollTimer) { clearInterval(httpPollTimer); httpPollTimer = null; }
    if (activePollAbortController) { activePollAbortController.abort(); activePollAbortController = null; }
    console.log("[HTTP polling] Stopped");
  };

  const buildCacheSnapshot = (data: Record<string, unknown>) => ({
    ...data,
    groups: groupsStore.groups,
    widgets: widgetsStore.widgets,
    appConfig: configStore.appConfig,
    rssFeeds: rssFeeds.value,
    rssCategories: rssCategories.value,
    systemConfig: data.systemConfig ?? configStore.systemConfig,
    username: typeof data.username === "string" ? data.username : auth.username,
    version: typeof data.version !== "undefined" ? data.version : dataVersion.value,
  });

  const startHttpPolling = () => {
    if (isHttpPollingActive || status.value === "OPEN") return;
    isHttpPollingActive = true;
    console.log("[HTTP polling] Started (15s interval)");
    httpPollTimer = setInterval(async () => {
      if (!isHttpPollingActive || document.visibilityState === "hidden") return;
      try {
        const version = await fetchVersionOnly();
        if (version > dataVersion.value) await fetchAndProcessData();
      } catch (e) { console.warn("[HTTP polling] Poll failed:", e); }
    }, 15000);
  };

  // ---- handleDataUpdate ----
  const handleDataUpdate = (data: Record<string, unknown>) => {
    isApplyingServerData = true;
    // Route by role: guest responses must never overwrite auth state layout
    const responseRole = detectResponseRole(data);
    const shouldApply = responseRole === "auth"
      ? auth.isLogged
      : true; // guest data can always update guest state

    if (!shouldApply && responseRole === "guest" && activeStateRole === "auth") {
      console.warn("[DualState] Dropping guest data while auth state is active");
      isApplyingServerData = false;
      return;
    }

    if (data.systemConfig) {
      configStore.systemConfig = {
        ...configStore.systemConfig,
        ...(data.systemConfig as typeof configStore.systemConfig),
      };
    }
    syncUsernameFromServer(data, responseRole);
    if (typeof data.version !== "undefined") dataVersion.value = normalizeVersion(data.version);

    if (data.groups) groupsStore.groups = data.groups as any;
    else groupsStore.groups = [];

    const normalizedWidgets = widgetsStore.normalizeIncomingWidgets(data.widgets as any, auth.isLogged);
    widgetsStore.applyServerWidgets(normalizedWidgets, auth.isLogged, widgetsStore.layoutEditInProgress);

    if (data.appConfig) {
      const incomingConfig = data.appConfig as Record<string, unknown>;
      const mergedConfig = { ...configStore.appConfig, ...incomingConfig } as Record<string, unknown>;
      delete (mergedConfig as Record<string, unknown>).forceNetworkMode;
      configStore.appConfig = mergedConfig as typeof configStore.appConfig;
    }
    // Migrations
    const ac = configStore.appConfig;
    if (ac.customCss && !ac.customCssList?.length) ac.customCssList = [{ id: "default-css", name: "默认自定义 CSS", content: ac.customCss, enable: true }];
    if (!ac.customCssList) ac.customCssList = [];
    if (ac.customJs && !ac.customJsList?.length) ac.customJsList = [{ id: "default-js", name: "默认自定义 JS", content: ac.customJs, enable: true }];
    if (!ac.customJsList) ac.customJsList = [];
    const stripTransientWallpaperParams = (value: unknown) => {
      if (typeof value !== "string" || !value) return value;
      if (value.startsWith("blob:") || value.startsWith("data:")) return value;
      try {
        const parsed = new URL(value, window.location.origin);
        parsed.searchParams.delete("t");
        parsed.searchParams.delete("v");
        if (/^https?:\/\//.test(value)) {
          return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch {
        return value.replace(/([?&])(t|v)=\d+/g, "$1").replace(/[?&]$/, "");
      }
    };
    configStore.appConfig.background = (stripTransientWallpaperParams(
      configStore.appConfig.background,
    ) as string) || "/default-wallpaper.svg";
    if (configStore.appConfig.mobileBackground) {
      configStore.appConfig.mobileBackground = stripTransientWallpaperParams(
        configStore.appConfig.mobileBackground,
      ) as string;
    }
    if (!configStore.appConfig.searchEngines?.length) {
      configStore.appConfig.searchEngines = [
        { id: "google", key: "google", label: "Google", urlTemplate: "https://www.google.com/search?q={q}" },
        { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
        { id: "baidu", key: "baidu", label: "百度", urlTemplate: "https://www.baidu.com/s?wd={q}" },
      ];
    }
    if (!configStore.appConfig.defaultSearchEngine) configStore.appConfig.defaultSearchEngine = "google";
    if (typeof configStore.appConfig.rememberLastEngine !== "boolean") configStore.appConfig.rememberLastEngine = true;
    if (typeof configStore.appConfig.widgetAreaCols !== "number") {
      configStore.appConfig.widgetAreaCols = typeof configStore.appConfig.widgetAreaSize === "number" ? configStore.appConfig.widgetAreaSize : 4;
    }
    if (typeof configStore.appConfig.widgetAreaRows !== "number") {
      configStore.appConfig.widgetAreaRows = typeof configStore.appConfig.widgetAreaSize === "number" ? configStore.appConfig.widgetAreaSize : 4;
    }
    if (data.rssFeeds) rssFeeds.value = data.rssFeeds as any;
    if (data.rssCategories) rssCategories.value = data.rssCategories as any;

    // Update dual state tree role tracking
    activeStateRole = responseRole;
    hasNonPublicLayout = detectHasNonPublicLayout();

    networkStore.fetchCustomScripts();
    widgetsStore.updateLastSavedLayout();
    cacheStore.saveToCache(buildCacheSnapshot(data));
    saveStore.hasUnsavedChanges = false;
    isApplyingServerData = false;
  };

  // ---- fetchAndProcessData ----
  const fetchAndProcessData = async () => {
    if (cacheStore.isFetchingData) return;
    cacheStore.isFetchingData = true;
    try {
      const headers: Record<string, string> = {};
      if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
      const res = await fetch(`/api/data`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (configStore.isServerSyncLocked && saveStore.hasUnsavedChanges) return;
      if (saveStore.saveTimer !== null || saveStore.isSaving) return;
      if (widgetsStore.layoutDirty) {
        if (!confirm("检测到云端数据更新，但您当前有未保存的布局修改。\n是否放弃本地修改并使用云端版本覆盖？")) return;
      }
      handleDataUpdate(data);
      widgetsStore.updateLastSavedLayout();
      if (!cacheStore.hasServerSnapshot) {
        cacheStore.markServerSnapshotReady();
      }
    } catch (e) { console.error("Fetch data failed", e); }
    finally { cacheStore.isFetchingData = false; }
  };

  // ---- 增量合并：批量拉取变化的 widget ----
  const fetchAndMergeWidgets = async (changedIds: string[], deletedIds: string[]) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
      const res = await fetch("/api/widgets/batch", {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: changedIds }),
      });
      if (!res.ok) throw new Error(`Batch fetch failed: ${res.status}`);
      const result = await res.json() as { success?: boolean; widgets?: any[] };
      if (!result.success || !Array.isArray(result.widgets)) throw new Error("Invalid batch response");

      isApplyingServerData = true;
      // 合并变化的 widget
      for (const sw of result.widgets) {
        const idx = widgetsStore.widgets.findIndex((x: any) => x.id === sw.id);
        if (idx >= 0) {
          widgetsStore.widgets[idx] = { ...widgetsStore.widgets[idx], ...sw };
        } else {
          widgetsStore.widgets.push(sw);
        }
      }
      // 删除已移除的 widget
      if (deletedIds.length > 0) {
        const delSet = new Set(deletedIds);
        widgetsStore.widgets = widgetsStore.widgets.filter((w: any) => !delSet.has(w.id));
      }
      isApplyingServerData = false;
      cacheStore.saveToCache(buildCacheSnapshot({}));
    } catch (e) {
      // 增量失败，降级全量
      console.warn("[DeltaPush] Incremental failed, fallback to full sync", e);
      isApplyingServerData = false;
      await fetchAndProcessData();
    }
  };

  // ---- WebSocket connect watch ----
  watch(status, async (newStatus) => {
    if (newStatus === "OPEN") {
      console.log("WS connected");
      stopHttpPolling();
      wsContinuousFailures = 0;
      const isReconnect = wsWasConnectedBefore;
      if (!isReconnect) isFirstConnect = false;
      wsWasConnectedBefore = true;
      if (auth.isLogged && auth.token) wsSend({ type: "auth", payload: { token: auth.token } });
      networkStore.startNetworkHeartbeat(wsSend);
      startWsHealthCheck();
      startVersionCheck();
      if (isFirstConnect) return;
      try {
        const serverVersion = await fetchVersionOnly();
        if (serverVersion > dataVersion.value) await fetchAndProcessData();
        if (saveStore.hasUnsavedChanges) { saveStore.hasPendingSave = true; setTimeout(() => saveData(), 2000); }
        try {
          import("@/utils/offlineQueue").then(async (oq) => {
            const qSize = await oq.size();
            if (qSize > 0) { saveStore.offlineQueueCount = qSize; setTimeout(() => saveStore.triggerOfflineQueueReplay(fetchVersionOnly, dataVersion, networkStore.getHeaders), 3000); }
          });
        } catch { /* ignore */ }
      } catch (e) { console.warn("[WS reconnect] Failed to check server version:", e); }
      const oldMode = configStore.systemConfig.authMode;
      await networkStore.fetchSystemConfig();
      if (configStore.systemConfig.authMode !== oldMode) {
        setTimeout(async () => {
          await networkStore.fetchSystemConfig();
          if (configStore.systemConfig.authMode !== oldMode) { if (auth.isLogged) doLogout(); else init(); }
        }, 500);
      }
    } else if (newStatus === "CLOSED") {
      if (newStatus === "CLOSED") { console.log("WS disconnected"); wsContinuousFailures++; }
      networkStore.stopNetworkHeartbeat();
      stopVersionCheck();
      // Only trigger HTTP polling fallback when authenticated; guests use HTTP-only mode
      if (auth.isLogged && wsContinuousFailures >= WS_FALLBACK_THRESHOLD && !isHttpPollingActive) startHttpPolling();
    }
  });

  // ---- WebSocket message watch ----
  watch(wsRawData, (rawMsg) => {
    if (!rawMsg || !wsMessageHandlerBound) return;
    let msg: { type?: string; payload?: Record<string, unknown> };
    try { msg = JSON.parse(rawMsg); } catch { return; }
    if (!msg?.type) return;
    switch (msg.type) {
      case "auth_success": break;
      case "memo_updated": case "todo_updated": case "bookmarks_updated": {
        const p = msg.payload || {};
        if (p.username !== auth.username) return;
        if (p.widgetId) {
          const w = widgetsStore.widgets.find((x) => x.id === p.widgetId);
          if (w) {
            isApplyingServerData = true;
            w.data = p.content;
            isApplyingServerData = false;
          }
        }
        break;
      }
      case "data_updated": {
        const p = msg.payload || {};
        if (p.username !== auth.username && !(auth.username === "admin" && p.username === "admin")) return;
        const sv = typeof p.version !== "undefined" ? normalizeVersion(p.version) : 0;
        if (sv <= dataVersion.value) break;
        if (saveStore.hasUnsavedChanges || saveStore.saveTimer !== null || saveStore.isSaving) {
          if (sv > pendingServerVersion.value) pendingServerVersion.value = sv; return;
        }
        dataVersion.value = sv;

        const structureChanged = p.structureChanged === true;
        const changedWidgets = (p.changedWidgets || []) as string[];
        const deletedWidgets = (p.deletedWidgets || []) as string[];

        if (!structureChanged && changedWidgets.length > 0 && changedWidgets.length <= 5) {
          // 增量路径：批量拉取变化的 widget
          fetchAndMergeWidgets(changedWidgets, deletedWidgets);
        } else {
          // 全量路径（含向后兼容：老后端无 changedWidgets 字段时走此分支）
          fetchAndProcessData();
        }
        break;
      }
      case "network_heartbeat": networkStore.lastNetworkHeartbeatAt = Date.now(); networkStore.isNetworkSyncActive = true; break;
      case "lucky:stun": luckyStunData.value = (msg.payload || {}) as LuckyStunData; break;
      case "ping": networkStore.lastPingAt = Date.now(); break;
    }
  });

  // ---- BroadcastChannel: 同浏览器多 Tab 即时同步 ----
  let bc: BroadcastChannel | null = null;
  let bcInited = false;

  const initBroadcastChannel = () => {
    if (bcInited || typeof BroadcastChannel === "undefined") return;
    bcInited = true;
    bc = new BroadcastChannel("flatnas-sync");
    bc.onmessage = (event) => {
      const msg = event.data;
      if (!msg?.type) return;
      switch (msg.type) {
        case "saved": {
          const sv = normalizeVersion(msg.version);
          if (sv > dataVersion.value && !isApplyingServerData) {
            console.log(`[BC] Tab saved v${sv}, syncing...`);
            dataVersion.value = sv;
            // jitter 防止多 Tab 同时请求（惊群效应）
            setTimeout(() => fetchAndProcessData(), Math.random() * 500);
          }
          break;
        }
        case "logout": {
          if (auth.isLogged) doLogout();
          break;
        }
      }
    };
    window.addEventListener("beforeunload", () => { bc?.close(); });
  };

  const broadcastSaved = (version: number) => {
    bc?.postMessage({ type: "saved", version });
  };

  // ---- 心跳版本校验（WS 在线时的安全网） ----
  let versionCheckTimer: ReturnType<typeof setInterval> | null = null;
  const VERSION_CHECK_INTERVAL = 60000; // 60s

  const startVersionCheck = () => {
    if (versionCheckTimer) return;
    versionCheckTimer = setInterval(async () => {
      if (status.value !== "OPEN" || !auth.isLogged) return;
      if (document.visibilityState === "hidden") return;
      if (saveStore.isSaving || isApplyingServerData) return;
      try {
        const serverVer = await fetchVersionOnly();
        if (serverVer > dataVersion.value) {
          console.log(`[VersionCheck] Server v${serverVer} > local v${dataVersion.value}, syncing...`);
          await fetchAndProcessData();
        }
      } catch { /* ignore */ }
    }, VERSION_CHECK_INTERVAL);
  };

  const stopVersionCheck = () => {
    if (versionCheckTimer) { clearInterval(versionCheckTimer); versionCheckTimer = null; }
  };

  // ---- init ----
  const init = async () => {
    if (isInitializing) return;
    isInitializing = true;
    initCompleted.value = false;
    initBroadcastChannel();
    // Only open WS when authenticated; avoid meaningless guest reconnect loops
    if (typeof window !== "undefined" && auth.isLogged && status.value !== "OPEN") wsOpen();
    cacheStore.hasServerSnapshot = false;
    cacheStore.cacheLoadedAt = null;
    cacheStore.deferredSaveRequested = false;

    const cacheLoaded = cacheStore.loadFromCache(rssFeeds, rssCategories, dataVersion);
    if (cacheLoaded) cacheStore.cacheLoadedAt = Date.now();

    try {
      let serverSnapshotLoaded = false;
      let lastError: unknown = null;
      const loadSnap = () => cacheStore.loadServerSnapshot(handleDataUpdate, widgetsStore.updateLastSavedLayout, saveStore.markDirty);
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await loadSnap(); serverSnapshotLoaded = true; setTimeout(() => { configStore.checkUpdate(); networkStore.fetchLuckyStunData(); }, 2000); break; }
        catch (e) { lastError = e; }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }
      if (!serverSnapshotLoaded) {
        if (lastError) console.error("Init failed", lastError);
        cacheStore.loadFromCache(rssFeeds, rssCategories, dataVersion);
        if (cacheStore.cacheLoadedAt === null) cacheStore.cacheLoadedAt = Date.now();
        if (!cacheStore.serverSnapshotRetryTimer) {
          cacheStore.serverSnapshotRetryTimer = setTimeout(async () => {
            cacheStore.serverSnapshotRetryTimer = null;
            if (cacheStore.hasServerSnapshot) return;
            try { await loadSnap(); setTimeout(() => { configStore.checkUpdate(); networkStore.fetchLuckyStunData(); }, 2000); }
            catch (e) { console.error("Init retry failed", e); }
          }, 3000);
        }
      }
    } finally {
      isInitializing = false;
      initCompleted.value = true;
      if (!wsMessageHandlerBound) {
        wsMessageHandlerBound = true;
        if (typeof document !== "undefined" && !visibilityVersionCheckBound) {
          visibilityVersionCheckBound = true;

          const onWakeUp = () => {
            if (!auth.isLogged) return;
            // 延迟 500ms 给移动端网络层恢复时间
            setTimeout(async () => {
              if (!auth.isLogged) return;
              try {
                const serverVer = await fetchVersionOnly();
                if (serverVer > dataVersion.value) {
                  console.log(`[WakeUp] Server v${serverVer} > local v${dataVersion.value}, syncing...`);
                  dataVersion.value = serverVer;
                  await fetchAndProcessData();
                }
              } catch { /* ignore */ }
              // WS 断了就重连
              if (status.value !== "OPEN" && status.value !== "CONNECTING") {
                console.log("[WakeUp] WS not connected, reopening...");
                wsOpen();
              }
            }, 500);
          };

          // 自动检测：触屏设备使用更激进的唤醒策略
          const isTouchDevice = typeof window !== "undefined"
            && window.matchMedia("(pointer: coarse)").matches;

          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") onWakeUp();
          });

          if (isTouchDevice) {
            window.addEventListener("pageshow", (e) => {
              if ((e as PageTransitionEvent).persisted) onWakeUp();
            });
            window.addEventListener("focus", onWakeUp);
          }
        }
      }
    }
  };

  // ---- Logout ----
  const doLogout = async () => {
    // Explicitly close WS to stop reconnect storms
    if (status.value === "OPEN") wsClose();
    networkStore.stopNetworkHeartbeat();
    stopHttpPolling();
    stopPingCheck();
    stopVersionCheck();
    bc?.postMessage({ type: "logout" });
    auth.token = "";
    auth.username = "";
    localStorage.removeItem("flat-nas-token");
    localStorage.removeItem("flat-nas-username");
    localStorage.removeItem("flat-nas-data-cache");
    await init();
  };

  // ---- saveData wrapper ----
  const saveData = async (immediate = false, force = false) => {
    const result = await saveStore.saveData(immediate, force, dataVersion, rssFeeds, rssCategories, fetchAndProcessData);
    if (result === "saved") {
      broadcastSaved(dataVersion.value);
      if (pendingServerVersion.value > 0 && pendingServerVersion.value > dataVersion.value) {
        const psv = pendingServerVersion.value;
        pendingServerVersion.value = 0;
        dataVersion.value = psv;
        await fetchAndProcessData();
      }
    }
    return result;
  };

  const resolveConflict = (action: "remote" | "local") =>
    saveStore.resolveConflict(action, fetchAndProcessData, saveData);

  const confirmSyncFromServer = () => saveStore.confirmSyncFromServer(fetchAndProcessData);
  const dismissSyncConfirm = () => saveStore.dismissSyncConfirm();
  const discardOfflineQueue = () => saveStore.discardOfflineQueue(fetchAndProcessData);
  const resolveOfflineQueueConflict = (action: "force_save" | "discard") =>
    saveStore.resolveOfflineQueueConflict(action, fetchAndProcessData);

  // ---- Init event bindings ----
  if (typeof window !== "undefined") {
    networkStore.initEventBindings(
      wsOpen,
      wsClose,
      () => status.value,
      () => saveStore.triggerOfflineQueueReplay(fetchVersionOnly, dataVersion, networkStore.getHeaders),
    );
  }

  // ---- Ping Timeout Detection ----
  const WS_PING_TIMEOUT_MS = 25000;
  let pingCheckTimer: ReturnType<typeof setInterval> | null = null;
  const startPingCheck = () => {
    if (pingCheckTimer) clearInterval(pingCheckTimer);
    pingCheckTimer = setInterval(() => {
      if (status.value !== "OPEN") return;
      const elapsed = Date.now() - networkStore.lastPingAt;
      if (networkStore.lastPingAt > 0 && elapsed > WS_PING_TIMEOUT_MS) {
        console.warn(`[Ping timeout] No server ping for ${elapsed}ms, reconnecting...`);
        wsContinuousFailures++;
        wsClose();
      }
    }, 5000);
  };
  const stopPingCheck = () => { if (pingCheckTimer) clearInterval(pingCheckTimer); pingCheckTimer = null; };

  // ---- Watches ----
  watch(() => configStore.forceNetworkMode, (mode, prev) => {
    if (!mode || mode === prev) return;
    const ok = ["auto", "lan", "wan", "latency"].includes(mode);
    if (!ok) return;
    if (isConnected.value) { networkStore.stopNetworkHeartbeat(); networkStore.startNetworkHeartbeat(wsSend); }
  });

  // Gate WS lifecycle on auth state changes to prevent guest reconnect storms
  watch(() => auth.isLogged, (logged) => {
    if (logged) {
      if (typeof window !== "undefined" && status.value !== "OPEN") wsOpen();
      stopHttpPolling();
      fetchAndProcessData();
    } else {
      // Guest mode: stop WS, polling, and ping checks to avoid reconnect storms
      if (status.value === "OPEN") wsClose();
      stopHttpPolling();
      stopPingCheck();
    }
  });
  const markDirtyIfActive = () => { if (!isInitializing && !isApplyingServerData) saveStore.markDirty(); };
  watch(configStore.appConfig, markDirtyIfActive, { deep: true });
  watch(widgetsStore.widgets, markDirtyIfActive, { deep: true });
  watch(rssFeeds, markDirtyIfActive, { deep: true });
  watch(rssCategories, markDirtyIfActive, { deep: true });
  watch(() => saveStore.hasUnsavedChanges, (dirty, wasDirty) => {
    if (wasDirty && !dirty && pendingServerVersion.value > 0 && pendingServerVersion.value > dataVersion.value && !saveStore.isSaving) {
      const psv = pendingServerVersion.value;
      pendingServerVersion.value = 0;
      dataVersion.value = psv;
      fetchAndProcessData();
    }
  });
  watch(status, (newStatus) => { if (newStatus === "OPEN") { networkStore.lastPingAt = Date.now(); startPingCheck(); } else { stopPingCheck(); stopWsHealthCheck(); } });

  watch(wsUrl, (newUrl, oldUrl) => {
    if (!newUrl || !oldUrl || newUrl === oldUrl) return;
    if (!auth.isLogged) return;
    const wasConnected = status.value === "OPEN";
    console.log(`[WS] URL changed: ${oldUrl} -> ${newUrl}, wasConnected=${wasConnected}`);
    if (wasConnected) {
      forceWsReconnect();
    }
  });

  return {
    status, wsRawData, wsSend, wsSendRaw, wsOpen, isConnected, forceWsReconnect,
    dataVersion, pendingServerVersion, rssFeeds, rssCategories, luckyStunData,
    isSaving: saveStore.isSaving, hasPendingSave: saveStore.hasPendingSave, hasUnsavedChanges: saveStore.hasUnsavedChanges,
    markDirty: saveStore.markDirty, saveData, resolveConflict,
    conflictState: saveStore.conflictState,
    isServerSnapshotReady: cacheStore.isServerSnapshotReady, isClientReady: computed(() => cacheStore.isClientReady || initCompleted.value),
    cacheLoadedAt: cacheStore.cacheLoadedAt, hasServerSnapshot: cacheStore.hasServerSnapshot,
    offlineQueueCount: saveStore.offlineQueueCount, offlineQueueConflictState: saveStore.offlineQueueConflictState,
    resolveOfflineQueueConflict, discardOfflineQueue,
    init, fetchData: fetchAndProcessData, fetchVersionOnly,
    doLogout,
    syncConfirmModal: saveStore.syncConfirmModal, confirmSyncFromServer, dismissSyncConfirm,
    lastPingAt: networkStore.lastPingAt, isNetworkSyncActive: networkStore.isNetworkSyncActive,
    startNetworkHeartbeat: () => networkStore.startNetworkHeartbeat(wsSend), stopNetworkHeartbeat: networkStore.stopNetworkHeartbeat,
    detectWeatherNetworkStatus: networkStore.detectWeatherNetworkStatus,
    registerDashboardPulse: networkStore.registerDashboardPulse, unregisterDashboardPulse: networkStore.unregisterDashboardPulse,
    startDashboardPulse: networkStore.startDashboardPulse, stopDashboardPulse: networkStore.stopDashboardPulse,
    lockServerSync: configStore.lockServerSync, unlockServerSync: configStore.unlockServerSync, isServerSyncLocked: configStore.isServerSyncLocked,
    wallpaperListPc: networkStore.wallpaperListPc, wallpaperListMobile: networkStore.wallpaperListMobile,
    fetchWallpaperLists: networkStore.fetchWallpaperLists,
    globalDrag: networkStore.globalDrag, initGlobalDrag: networkStore.initGlobalDrag,
    fetchSystemConfig: networkStore.fetchSystemConfig, fetchLuckyStunData: networkStore.fetchLuckyStunData,
    layoutDirty: widgetsStore.layoutDirty, layoutEditInProgress: widgetsStore.layoutEditInProgress,
    lastSavedLayoutSignature: widgetsStore.lastSavedLayoutSignature,
    undoLayout: () => widgetsStore.undoLayout(saveData),
    isHttpPollingActive: isHttpPollingActiveRef,
  };
});
