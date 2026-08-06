import { ref, watch } from "vue";
import { defineStore } from "pinia";
import pako from "pako";
import * as offlineQueue from "@/utils/offlineQueue";
import {
  stripWidgetUiState,
  stripForceNetworkMode,
  normalizeVersion,
  buildServerLayoutMap,
  buildServerLayoutSignature,
} from "@/utils/storeHelpers";
import { useAuthStore } from "./auth";
import { useWidgetsStore } from "./widgets";
import { useGroupsStore } from "./groups";
import { useConfigStore } from "./config";
import { useCacheStore } from "./cache";
import { useNetworkStore } from "./network";

export const useSaveStore = defineStore("save", () => {
  const auth = useAuthStore();
  const widgetsStore = useWidgetsStore();
  const groupsStore = useGroupsStore();
  const configStore = useConfigStore();
  const cacheStore = useCacheStore();
  const networkStore = useNetworkStore();

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const isSaving = ref(false);
  const hasPendingSave = ref(false);
  let lastSavedJson = "";
  const hasUnsavedChanges = ref(false);

  const conflictState = ref({ show: false, serverVersion: 0, clientVersion: 0 });
  const conflictResolving = ref(false);

  const offlineQueueCount = ref(0);
  const offlineQueueConflictState = ref<{
    show: boolean;
    item: { baseVersion: number; data: Record<string, unknown> } | null;
    serverVersion: number;
  }>({ show: false, item: null, serverVersion: 0 });

  const syncConfirmModal = ref({ show: false, serverVersion: 0 });
  let heartbeatLostSinceLastVisible = false;

  const markDirty = () => {
    if (auth.isLogged) hasUnsavedChanges.value = true;
  };

  const saveCustomScripts = async () => {
    try {
      if (!auth.isLogged) return;
      const res = await fetch("/api/custom-scripts", { method: "POST", headers: cacheStore.getHeaders(), body: JSON.stringify({ css: configStore.appConfig.customCssList || [], js: configStore.appConfig.customJsList || [] }) });
      if (!res.ok) console.error("Failed to save custom scripts");
    } catch (e) { console.error("Error saving custom scripts", e); }
  };

  const jsonEqual = (left: unknown, right: unknown) =>
    JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

  // 排序键的 JSON.stringify，避免键序不同导致伪冲突
  const stableStringify = (obj: unknown): string => {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map((k) => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  };

  const saveData = async (
    immediate = false,
    force = false,
    dataVersion: { value: number },
    rssFeeds: { value: unknown[] },
    rssCategories: { value: unknown[] },
    fetchData: () => Promise<void>,
  ): Promise<"saved" | "no_change" | "conflict" | "unauthorized" | "queued"> => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (conflictResolving.value && !force) { hasPendingSave.value = true; return "no_change"; }

    const doSave = async () => {
      if (conflictState.value.show && !force) { hasPendingSave.value = false; return "conflict"; }
      if (configStore.isPageUnloading) return "no_change";
      if (cacheStore.isCacheWriteGuardActive()) { cacheStore.deferredSaveRequested = true; return "no_change"; }
      if (isSaving.value) { hasPendingSave.value = true; return "no_change"; }

      isSaving.value = true;
      hasPendingSave.value = false;

      try {
        if (!auth.isLogged) return "unauthorized";
        if (force && conflictState.value.show) {
          dataVersion.value = normalizeVersion(conflictState.value.serverVersion);
        }

        const body: Record<string, unknown> = {
          groups: groupsStore.groups,
          widgets: widgetsStore.widgets.map((w) => stripWidgetUiState(w)),
          appConfig: stripForceNetworkMode(configStore.appConfig as unknown as Record<string, unknown>),
          rssFeeds: rssFeeds.value,
          rssCategories: rssCategories.value,
          version: dataVersion.value,
        };
        if (typeof auth.password === "string" && auth.password.length > 0) {
          body.password = auth.password;
        }
        const json = JSON.stringify(body);
        if (json === lastSavedJson) return "no_change";

        cacheStore.saveToCache(body);
        const compressed = pako.gzip(json);

        const getSaveTimeout = () => {
          if (configStore.effectiveIsLan) return 15000;
          if (configStore.forceNetworkMode === "latency") return 120000;
          return 60000;
        };

        const MAX_SAVE_RETRIES = 3;
        const SAVE_TIMEOUT_MS = getSaveTimeout();
        let saveAttempt = 0;
        let res: Response | null = null;

        while (saveAttempt < MAX_SAVE_RETRIES) {
          saveAttempt++;
          try {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
            res = await fetch("/api/save", { method: "POST", headers: { ...cacheStore.getHeaders(), "Content-Encoding": "gzip" }, body: compressed, signal: controller.signal }).finally(() => window.clearTimeout(timeout));
            if (res.ok || res.status === 409 || res.status === 401) break;
            if (saveAttempt < MAX_SAVE_RETRIES) {
              const delay = Math.min(1000 * Math.pow(2, saveAttempt - 1), 5000);
              await new Promise((r) => setTimeout(r, delay));
            }
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError" && saveAttempt < MAX_SAVE_RETRIES) {
              const delay = Math.min(1000 * Math.pow(2, saveAttempt - 1), 5000);
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            throw e;
          }
        }

        if (!res) throw new Error(`Save failed after ${MAX_SAVE_RETRIES} retries`);

        if (res.ok) {
          conflictState.value.show = false;
          hasUnsavedChanges.value = false;
          const result = await res.json().catch(() => null);
          if (result && typeof (result as { version?: number }).version !== "undefined") {
            dataVersion.value = normalizeVersion((result as { version?: number }).version);
          }
          lastSavedJson = JSON.stringify({ ...body, version: dataVersion.value });
          widgetsStore.updateLastSavedLayout();
          if (body.password) auth.password = "";
          saveCustomScripts();
          return "saved";
        }

        if (res.status === 409) {
          const result = await res.json().catch(() => null);
          const serverVer = (result as { currentVersion?: number } | null)?.currentVersion;
          if (typeof serverVer !== "undefined") {
            const v = normalizeVersion(serverVer);
            if (conflictState.value.show) return "conflict";
            // Smart conflict check: skip popup if only widget data changed
            try {
              const rd = await (await fetch("/api/data", { headers: cacheStore.getHeaders() })).json();
              const rSig = buildServerLayoutSignature(buildServerLayoutMap(rd.widgets || []));
              const lSig = buildServerLayoutSignature(buildServerLayoutMap(widgetsStore.widgets));
              const rCfg = stripForceNetworkMode((rd.appConfig || {}) as Record<string, unknown>);
              const lCfg = stripForceNetworkMode(configStore.appConfig as unknown as Record<string, unknown>);
              const rssFeedsMatch = jsonEqual(rd.rssFeeds || [], rssFeeds.value);
              const rssCategoriesMatch = jsonEqual(rd.rssCategories || [], rssCategories.value);
              if (
                rSig === lSig &&
                jsonEqual(rd.groups || [], groupsStore.groups) &&
                jsonEqual(rCfg, lCfg) &&
                rssFeedsMatch &&
                rssCategoriesMatch
              ) {
                dataVersion.value = v; await fetchData(); widgetsStore.updateLastSavedLayout(); return "saved";
              }
            } catch (e) { console.warn("Smart conflict check failed", e); }
            // Per-widget LWW 合并：差异仅在个别 widget data 时静默合并
            try {
              const rd = await (await fetch("/api/data", { headers: cacheStore.getHeaders() })).json();
              const serverWidgets = (rd.widgets || []) as any[];
              const localWidgets = widgetsStore.widgets as any[];
              const serverMap = new Map(serverWidgets.map((w: any) => [w.id, w]));
              const localMap = new Map(localWidgets.map((w: any) => [w.id, w]));

              let canAutoMerge = true;
              const mergedWidgets = [...localWidgets];

              for (const [id, sw] of serverMap) {
                const lw = localMap.get(id);
                if (!lw) {
                  // 服务端新增的 widget，直接采用
                  mergedWidgets.push(sw);
                } else if (stableStringify(sw.data) !== stableStringify(lw.data)) {
                  // data 不同 → 检查本端是否修改过
                  let localModified = false;
                  try {
                    const lastSaved = JSON.parse(lastSavedJson || "{}") as { widgets?: any[] };
                    const lastSavedW = (lastSaved.widgets || []).find((w: any) => w.id === id);
                    if (lastSavedW && stableStringify(lastSavedW.data) !== stableStringify(lw.data)) {
                      localModified = true;
                    }
                  } catch { /* lastSavedJson 解析失败视为本端未修改 */ }
                  if (localModified) {
                    canAutoMerge = false;
                    break;
                  }
                  // 本端未修改，采用服务端
                  const idx = mergedWidgets.findIndex((w: any) => w.id === id);
                  if (idx >= 0) mergedWidgets[idx] = sw;
                }
              }

              // 检查服务端删除的 widget（本地有但服务端没有）
              if (canAutoMerge) {
                for (const [id, lw] of localMap) {
                  if (!serverMap.has(id)) {
                    // 检查本端是否修改过该 widget
                    let localModified = false;
                    try {
                      const lastSaved = JSON.parse(lastSavedJson || "{}") as { widgets?: any[] };
                      const lastSavedW = (lastSaved.widgets || []).find((w: any) => w.id === id);
                      if (!lastSavedW || stableStringify(lastSavedW.data) !== stableStringify(lw.data)) {
                        localModified = true;
                      }
                    } catch { localModified = true; }
                    if (localModified) {
                      canAutoMerge = false;
                      break;
                    }
                    // 本端未修改，服务端已删除 → 从合并结果中移除
                    const idx = mergedWidgets.findIndex((w: any) => w.id === id);
                    if (idx >= 0) mergedWidgets.splice(idx, 1);
                  }
                }
              }

              if (canAutoMerge) {
                // 自动合并成功，用合并后的数据重新保存
                const mergedBody = {
                  ...body,
                  widgets: mergedWidgets.map((w: any) => stripWidgetUiState(w)),
                  groups: rd.groups || body.groups,
                  version: v,
                };
                if (rd.appConfig) mergedBody.appConfig = { ...body.appConfig, ...rd.appConfig };
                const mr = await fetch("/api/save", { method: "POST", headers: cacheStore.getHeaders(), body: JSON.stringify(mergedBody) });
                if (mr.ok) {
                  conflictState.value.show = false; hasUnsavedChanges.value = false;
                  const mrd = await mr.json().catch(() => null);
                  dataVersion.value = mrd && typeof (mrd as { version?: number }).version !== "undefined" ? normalizeVersion((mrd as { version?: number }).version) : v + 1;
                  lastSavedJson = JSON.stringify({ ...mergedBody, version: dataVersion.value });
                  widgetsStore.updateLastSavedLayout();
                  if (body.password) auth.password = "";
                  return "saved";
                }
              }
            } catch (e) { console.warn("LWW merge failed", e); }
            // Retry with adopted version
            const rb = { ...body, version: v };
            const retryController = new AbortController();
            const retryTimeout = setTimeout(() => retryController.abort(), 60000);
            const rr = await fetch("/api/save", { method: "POST", headers: cacheStore.getHeaders(), body: JSON.stringify(rb), signal: retryController.signal }).finally(() => clearTimeout(retryTimeout));
            if (rr.ok) {
              conflictState.value.show = false; hasUnsavedChanges.value = false;
              const rrd = await rr.json().catch(() => null);
              dataVersion.value = rrd && typeof (rrd as { version?: number }).version !== "undefined" ? normalizeVersion((rrd as { version?: number }).version) : v + 1;
              lastSavedJson = JSON.stringify({ ...rb, version: dataVersion.value });
              widgetsStore.updateLastSavedLayout();
              if (body.password) auth.password = "";
              return "saved";
            }
            // Show popup only if structure changed
            const cur = buildServerLayoutSignature(buildServerLayoutMap(widgetsStore.widgets));
            const lChg = cur !== widgetsStore.lastSavedLayoutSignature;
            let gUnch = false;
            let rssFeedsUnch = false;
            let rssCategoriesUnch = false;
            try {
              const lb = JSON.parse(lastSavedJson) as {
                groups?: unknown;
                rssFeeds?: unknown;
                rssCategories?: unknown;
              } | null;
              if (lb) {
                gUnch = jsonEqual(groupsStore.groups, lb.groups || []);
                rssFeedsUnch = jsonEqual(rssFeeds.value, lb.rssFeeds || []);
                rssCategoriesUnch = jsonEqual(rssCategories.value, lb.rssCategories || []);
              }
            } catch { }
            if (!lChg && gUnch && rssFeedsUnch && rssCategoriesUnch) {
              dataVersion.value = v; await fetchData(); hasPendingSave.value = false; return "saved";
            }
            conflictState.value = { show: true, serverVersion: v, clientVersion: dataVersion.value };
            hasPendingSave.value = false;
          }
          return "conflict";
        }

        if (res.status === 401) {
          auth.token = ""; auth.username = "";
          localStorage.removeItem("flat-nas-token"); localStorage.removeItem("flat-nas-username");
          return "unauthorized";
        }

        throw new Error("Save failed");
      } catch (e) {
        if (configStore.isPageUnloading) return "no_change";
        console.error("Save failed, enqueueing to offline queue", e);
        try {
          const fallbackBody: Record<string, unknown> = {
            groups: groupsStore.groups,
            widgets: widgetsStore.widgets.map((w) => stripWidgetUiState(w)),
            appConfig: stripForceNetworkMode(configStore.appConfig as unknown as Record<string, unknown>),
            rssFeeds: rssFeeds.value,
            rssCategories: rssCategories.value,
            version: dataVersion.value,
          };
          await offlineQueue.enqueue(fallbackBody, dataVersion.value);
          offlineQueueCount.value = await offlineQueue.size();
          hasPendingSave.value = true;
          return "queued";
        } catch (queueErr) {
          console.error("Failed to enqueue to offline queue", queueErr);
        }
        throw e;
      } finally {
        isSaving.value = false;
        if (hasPendingSave.value) doSave();
      }
    };

    if (immediate) return doSave();
    return new Promise((resolve, reject) => {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        doSave().then(resolve).catch(reject);
      }, 500);
    });
  };

  const resolveConflict = async (
    action: "remote" | "local",
    fetchData: () => Promise<void>,
    saveDataFn: (immediate: boolean, force: boolean) => Promise<string>,
  ) => {
    conflictState.value.show = false;
    conflictResolving.value = true;
    try {
      if (action === "remote") await fetchData();
      else await saveDataFn(true, true);
    } finally {
      conflictResolving.value = false;
    }
  };

  const checkVersionAfterActivation = async (
    isLogged: boolean,
    dataVersion: number,
    fetchVersionOnly: () => Promise<number>,
  ) => {
    if (!isLogged) return;
    heartbeatLostSinceLastVisible = false;
    try {
      const serverVer = await fetchVersionOnly();
      if (serverVer > dataVersion) {
        syncConfirmModal.value = { show: true, serverVersion: serverVer };
      }
    } catch { /* ignore */ }
  };

  const confirmSyncFromServer = async (fetchData: () => Promise<void>) => {
    syncConfirmModal.value = { show: false, serverVersion: 0 };
    await fetchData();
  };

  const dismissSyncConfirm = () => {
    syncConfirmModal.value = { show: false, serverVersion: 0 };
  };

  const resolveOfflineQueueConflict = async (
    action: "force_save" | "discard",
    fetchData: () => Promise<void>,
  ) => {
    if (action === "discard") {
      await offlineQueue.clear();
      offlineQueueCount.value = 0;
      offlineQueueConflictState.value = { show: false, item: null, serverVersion: 0 };
      await fetchData();
      return;
    }
    const items = await offlineQueue.getAll();
    if (items.length === 0) { offlineQueueConflictState.value.show = false; return; }
    const latestItem = items[items.length - 1];
    await offlineQueue.clear();
    offlineQueueConflictState.value.show = false;
    const body = latestItem.data as Record<string, unknown>;
    const json = JSON.stringify(body);
    const compressed = pako.gzip(json);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { ...cacheStore.getHeaders(), "Content-Encoding": "gzip" },
        body: compressed,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (res.ok) {
        const result = await res.json().catch(() => null);
        if (result && typeof (result as { version?: number }).version !== "undefined") {
          // dataVersion updated by caller
        }
        hasUnsavedChanges.value = false;
      }
    } catch (e) {
      console.error("[OfflineQueue] Force save failed:", e);
    }
  };

  const triggerOfflineQueueReplay = async (
    fetchVersionOnly: () => Promise<number>,
    dataVersion: { value: number },
    getHeaders: () => Record<string, string>,
  ) => {
    const qSize = await offlineQueue.size();
    if (qSize === 0) return;
    console.log(`[OfflineQueue] Starting replay of ${qSize} items`);
    await offlineQueue.replay(
      fetchVersionOnly,
      async (data) => {
        try {
          const compressed = pako.gzip(JSON.stringify(data));
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 5000);
          const res = await fetch("/api/save", { method: "POST", headers: { ...getHeaders(), "Content-Encoding": "gzip" }, body: compressed, signal: c.signal }).finally(() => clearTimeout(t));
          if (res.ok) {
            const r = await res.json().catch(() => null);
            if (r && typeof (r as { version?: number }).version !== "undefined") dataVersion.value = normalizeVersion((r as { version?: number }).version);
            return true;
          }
          return false;
        } catch { return false; }
      },
      async (widgetId, data, widgetVersion) => {
        try {
          const body = { ...data, version: dataVersion.value, widgetVersion };
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 5000);
          const res = await fetch(`/api/widgets/${encodeURIComponent(widgetId)}`, { method: "PUT", headers: { ...getHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body), signal: c.signal }).finally(() => clearTimeout(t));
          if (res.ok) {
            const r = await res.json().catch(() => null);
            if (r && typeof (r as { version?: number }).version !== "undefined") dataVersion.value = normalizeVersion((r as { version?: number }).version);
            return true;
          }
          return false;
        } catch { return false; }
      },
      (pendingItem, serverVersion) => {
        offlineQueueConflictState.value = { show: true, item: pendingItem, serverVersion };
      },
      (item, error) => {
        console.error(`[OfflineQueue] Non-recoverable error for ${item.id}:`, error);
        offlineQueueConflictState.value = { show: true, item, serverVersion: 0 };
      },
    );
    offlineQueueCount.value = await offlineQueue.size();
  };

  const discardOfflineQueue = async (fetchData: () => Promise<void>) => {
    await offlineQueue.clear();
    offlineQueueCount.value = 0;
    offlineQueueConflictState.value = { show: false, item: null, serverVersion: 0 };
    await fetchData();
  };

  return {
    saveTimer,
    isSaving,
    hasPendingSave,
    hasUnsavedChanges,
    conflictState,
    conflictResolving,
    offlineQueueCount,
    offlineQueueConflictState,
    syncConfirmModal,
    heartbeatLostSinceLastVisible,
    markDirty,
    saveData,
    resolveConflict,
    checkVersionAfterActivation,
    confirmSyncFromServer,
    dismissSyncConfirm,
    resolveOfflineQueueConflict,
    triggerOfflineQueueReplay,
    discardOfflineQueue,
    saveCustomScripts,
  };
});
