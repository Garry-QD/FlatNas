<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, toRef } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";
import { useDevice } from "@/composables/useDevice";
import MemoEditor from "./Memo/MemoEditor.vue";
import MemoToolbar from "./Memo/MemoToolbar.vue";
import { useMemoPersistence, type MemoVersion } from "./Memo/useMemoPersistence";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();
const { isMobile } = useDevice(toRef(store.appConfig, "deviceMode"));

// --- Configuration ---
const CONFIG = {
  INPUT_COOLDOWN: 2000,
  ACTIVE_INPUT_WINDOW: 3000,
  POLL_ACTIVE_INTERVAL: 5000,
  POLL_SILENT_INTERVAL: 10000,
  POLL_IDLE_INTERVAL: 15000, // Background/Hidden
  POLL_WEAK_NETWORK: 20000,
  BROADCAST_THROTTLE: 200,
  BROADCAST_RETRY_LIMIT: 3,
  CONFLICT_PROMPT_COOLDOWN: 8000,
  TUNNEL_FORWARD_BASELINE_MS: 300,
  SAVE_TIMEOUT_MS: 15000,
  SAVE_TIMEOUT_RETRY_MS: 25000,
  POLL_TIMEOUT_MS: 8000,
  SAVE_RETRY_LIMIT: 3,
  SAVE_RETRY_BASE_DELAY_MS: 600,
};

// --- Sync State ---
const isNetworkOnline = ref(navigator.onLine);
const userActivityState = ref<'active' | 'silent'>('active');
const syncState = ref<'idle' | 'inputting' | 'cooldown' | 'broadcasting' | 'offline' | 'conflict'>('idle');

// State
const mode = ref<"simple" | "rich">("simple");
const localData = ref(""); // Stores HTML for rich mode or text for simple mode
const editorRef = ref<InstanceType<typeof MemoEditor> | null>(null);
const isEditing = ref(false);
const isSaving = ref(false); // Fix Risk 3: Track saving status
const pendingSave = ref(false); // Track if a save was requested while saving
const conflictState = ref<{ hasConflict: boolean; remoteData: WidgetConfig["data"] | null }>({
  hasConflict: false,
  remoteData: null,
});
const serverTs = ref(0);
const lastInputAt = ref(0);
const isBroadcasting = ref(false);
const isPageVisible = ref(document.visibilityState === "visible");

// Persistence
const { saveToIndexedDB, loadFromIndexedDB, status, saveVersionSnapshot, loadVersions, deleteVersion } =
  useMemoPersistence(
  props.widget.id,
  localData,
  mode
);

// Toast State
const showToast = ref(false);
const toastMessage = ref("");
const versionMenuOpen = ref(false);
const historyVersions = ref<MemoVersion[]>([]);
const selectedVersionId = ref("new");
const activeVersionIndex = ref(0);
const versionWrapperRef = ref<HTMLDivElement | null>(null);
const autoSaveDelay = computed(() => {
  if (!store.isLanModeInited || store.effectiveIsLan) return 800;
  return Math.max(900, CONFIG.TUNNEL_FORWARD_BASELINE_MS * 3);
});
const preferSocketSync = computed(() => store.isLanModeInited && store.effectiveIsLan);

type VersionOption = {
  id: string;
  label: string;
  kind: "new" | "history";
  version?: MemoVersion;
};

const versionOptions = computed<VersionOption[]>(() => {
  const options: VersionOption[] = [{ id: "new", label: "新建备忘", kind: "new" }];
  historyVersions.value.forEach((v) => {
    options.push({
      id: v.id,
      label: extractPreviewLabel(v.content),
      kind: "history",
      version: v,
    });
  });
  return options;
});

const selectedVersionLabel = computed(() => {
  if (selectedVersionId.value === "new" && historyVersions.value.length > 0) {
    return "版本管理";
  }
  const found = versionOptions.value.find((opt) => opt.id === selectedVersionId.value);
  return found?.label || "新建备忘";
});

// Computed Styles
const containerStyle = computed(() => ({
  backgroundColor: `rgba(254, 249, 195, ${props.widget.opacity ?? 0.9})`,
  color: props.widget.textColor || "#374151",
}));

// Methods
const handleCommand = (cmd: string, val?: string) => {
  editorRef.value?.execCommand(cmd, val);
};

const syncLocalFromEditorIfRich = () => {
  if (mode.value !== "rich") return;
  const root = (editorRef.value as unknown as { editorRef?: HTMLDivElement | null })?.editorRef;
  if (!root) return;
  const html = root.innerHTML || "";
  if (html !== localData.value) {
    localData.value = html;
  }
};

const triggerSave = async () => {
  syncLocalFromEditorIfRich();
  await saveVersionSnapshot(true);
  await saveToIndexedDB();
  await refreshVersions();
  if (status.value === "success") {
    // Triple Feedback 2: Toast
    toastMessage.value = "已保存，刷新不丢失";  // 已本地化
    showToast.value = true;
    setTimeout(() => (showToast.value = false), 3000);
  }
  await saveToServer(true);
};

const toggleMode = () => {
  if (mode.value === "rich") {
    // rich → simple: strip HTML tags, keep plain text
    const tmp = document.createElement("div");
    tmp.innerHTML = localData.value;
    localData.value = tmp.textContent || tmp.innerText || "";
  } else {
    // simple → rich: wrap plain text lines in <p> tags if not already HTML
    const text = localData.value;
    if (text && !/<[a-z][\s\S]*>/i.test(text)) {
      localData.value = text.split("\n").map((line) => `<p>${line || "<br>"}</p>`).join("");
    }
  }
  mode.value = mode.value === "simple" ? "rich" : "simple";
  saveToServer(true);
};

const parsePayload = (payload: unknown) => {
  let content = "";
  let nextServerTs = 0;
  let nextMode: "simple" | "rich" | "" = "";

  if (typeof payload === "string") {
    content = payload;
  } else if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (typeof data.content === "string") {
      content = data.content;
    } else if (typeof data.rich === "string") {
      content = data.rich;
    } else if (typeof data.simple === "string") {
      content = data.simple;
    }
    if (typeof data.server_ts === "number") {
      nextServerTs = data.server_ts;
    } else if (typeof data.updatedAt === "number") {
      nextServerTs = data.updatedAt;
    }
    if (data.mode === "simple" || data.mode === "rich") {
      nextMode = data.mode;
    }
  }

  return { content, serverTs: nextServerTs, mode: nextMode };
};

const buildPayload = () => ({
  content: localData.value,
  server_ts: serverTs.value,
  mode: mode.value,
});

const buildConflictSignature = (content: string, serverTs: number, nextMode: string) =>
  `${serverTs}|${nextMode}|${content.length}|${content.slice(0, 64)}`;

let serverSaveTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let conflictRetryTimer: ReturnType<typeof setTimeout> | null = null;
let saveRetryTimer: ReturnType<typeof setTimeout> | null = null;
let saveRetryCount = 0;
let saveRequestSeq = 0;
const conflictCooldownUntil = ref(0);
const lastConflictSignature = ref("");
const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const createSaveRequestID = (id: string, payload: ReturnType<typeof buildPayload>) => {
  saveRequestSeq = (saveRequestSeq + 1) % 1000000000;
  return `${id}:${payload.server_ts}:${Date.now()}:${saveRequestSeq}`;
};

const isAbortLikeError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("aborted") || msg.includes("abort");
  }
  return false;
};

const isRetryableTransportError = (error: unknown) => {
  if (isAbortLikeError(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("failed to fetch") || msg.includes("network");
  }
  return false;
};

const requestMemoSave = async (
  id: string,
  payload: ReturnType<typeof buildPayload>,
  keepalive: boolean,
  requestID: string,
) => {
  let lastError: unknown = null;
  const attempts = keepalive
    ? [{ timeoutMs: CONFIG.SAVE_TIMEOUT_MS, delayMs: 0 }]
    : [
        { timeoutMs: CONFIG.SAVE_TIMEOUT_MS, delayMs: 0 },
        { timeoutMs: CONFIG.SAVE_TIMEOUT_RETRY_MS, delayMs: CONFIG.SAVE_RETRY_BASE_DELAY_MS },
        { timeoutMs: CONFIG.SAVE_TIMEOUT_RETRY_MS, delayMs: Math.min(CONFIG.SAVE_RETRY_BASE_DELAY_MS * 2, 2000) },
      ];
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (index > 0 && attempt.delayMs > 0) {
      const jitter = Math.floor(Math.random() * Math.min(CONFIG.TUNNEL_FORWARD_BASELINE_MS, 200));
      await sleep(attempt.delayMs + jitter);
    }
    try {
      return await fetchWithTimeout(
        `/api/memo/${id}`,
        {
          method: "PUT",
          headers: {
            ...store.getHeaders(),
            "Content-Type": "application/json",
            "X-Idempotency-Key": requestID,
          },
          body: JSON.stringify({
            ...payload,
            client_request_id: requestID,
          }),
          keepalive,
        },
        attempt.timeoutMs,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransportError(error) || keepalive) {
        throw error;
      }
    }
  }
  throw lastError;
};

const parseJsonBody = async (res: Response) => {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { isJson: false, data: null as unknown };
  }
  const data = await res.json().catch(() => null);
  return { isJson: true, data };
};

const scheduleSaveRetry = () => {
  if (saveRetryTimer || saveRetryCount >= CONFIG.SAVE_RETRY_LIMIT) return;
  pendingSave.value = true;
  const delay = Math.min(CONFIG.SAVE_RETRY_BASE_DELAY_MS * Math.pow(2, saveRetryCount), 8000);
  saveRetryCount++;
  saveRetryTimer = setTimeout(() => {
    saveRetryTimer = null;
    if (store.isLogged) {
      void saveToServer(true);
    }
  }, delay);
};

const markSaveError = (message: string, allowRetry = true) => {
  toastMessage.value = message;
  showToast.value = true;
  syncState.value = "cooldown";
  if (allowRetry) {
    scheduleSaveRetry();
  }
};

const saveToServer = async (immediate = false, keepalive = false) => {
  if (!store.isLogged) return;
  // If conflict is active, block further auto-saves until resolved
  if (conflictState.value.hasConflict && !immediate) return;
  if (!immediate && Date.now() < conflictCooldownUntil.value) {
    if (conflictRetryTimer) clearTimeout(conflictRetryTimer);
    const wait = Math.max(0, conflictCooldownUntil.value - Date.now()) + 50;
    conflictRetryTimer = setTimeout(() => {
      conflictRetryTimer = null;
      if (!conflictState.value.hasConflict) {
        void saveToServer(true);
      }
    }, wait);
    return;
  }

  const id = props.widget.id;
  if (!id) return;
  const doSave = async () => {
    syncLocalFromEditorIfRich();
    if (isSaving.value) {
      pendingSave.value = true;
      return;
    }
    
    isSaving.value = true;
    pendingSave.value = false;

    const payload = buildPayload();
    const requestID = createSaveRequestID(id, payload);
    try {
      const res = await requestMemoSave(id, payload, keepalive, requestID);
      const parsedBody = await parseJsonBody(res);
      if (!parsedBody.isJson) {
        markSaveError("保存失败：服务返回异常页面");
        return;
      }
      const data = parsedBody.data as { data?: WidgetConfig["data"] } | null;
      if (res.status === 409) {
        if (!data?.data) {
          markSaveError("保存失败：版本冲突数据无效", false);
          return;
        }
        const remotePayload = data.data as WidgetConfig["data"];
        const remoteParsed = parsePayload(remotePayload);
        const sameContent = remoteParsed.content === localData.value;
        const sameMode = !remoteParsed.mode || remoteParsed.mode === mode.value;

        if (sameContent && sameMode) {
          if (remoteParsed.serverTs) {
            serverTs.value = remoteParsed.serverTs;
          }
          conflictState.value = { hasConflict: false, remoteData: null };
          syncState.value = "idle";
          showToast.value = false;
          saveRetryCount = 0;
          return;
        }

        if (remoteParsed.serverTs) {
          serverTs.value = remoteParsed.serverTs;
          const retryPayload = buildPayload();
          const retryRequestID = createSaveRequestID(id, retryPayload);
          const retryRes = await requestMemoSave(id, retryPayload, keepalive, retryRequestID);
          const retryParsedBody = await parseJsonBody(retryRes);
          const retryData = retryParsedBody.isJson
            ? (retryParsedBody.data as { data?: WidgetConfig["data"] } | null)
            : null;
          if (retryRes.ok && retryParsedBody.isJson) {
            if (retryData?.data) {
              applyRemotePayload(retryData.data);
            }
            conflictState.value = { hasConflict: false, remoteData: null };
            syncState.value = "idle";
            showToast.value = false;
            saveRetryCount = 0;
            return;
          }
          if (!retryParsedBody.isJson) {
            markSaveError("保存失败：服务返回异常页面");
            return;
          }
        }

        const signature = buildConflictSignature(
          remoteParsed.content,
          remoteParsed.serverTs,
          remoteParsed.mode || mode.value,
        );
        const now = Date.now();
        if (
          signature === lastConflictSignature.value &&
          now < conflictCooldownUntil.value
        ) {
          syncState.value = "cooldown";
          if (conflictRetryTimer) clearTimeout(conflictRetryTimer);
          const wait = Math.max(0, conflictCooldownUntil.value - now) + 50;
          conflictRetryTimer = setTimeout(() => {
            conflictRetryTimer = null;
            if (!conflictState.value.hasConflict) {
              void saveToServer(true);
            }
          }, wait);
          return;
        }

        lastConflictSignature.value = signature;
        conflictCooldownUntil.value = now + CONFIG.CONFLICT_PROMPT_COOLDOWN;

        conflictState.value = {
          hasConflict: true,
          remoteData: remotePayload,
        };
        syncState.value = "conflict";
        toastMessage.value = "检测到版本冲突，请选择解决方案";
        showToast.value = true;
        return;
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          markSaveError("保存失败：登录状态无效", false);
          return;
        }
        markSaveError(`保存失败：服务异常(${res.status})`);
        return;
      }
      if (data?.data) {
        applyRemotePayload(data.data);
      }
      saveRetryCount = 0;
      if (saveRetryTimer) {
        clearTimeout(saveRetryTimer);
        saveRetryTimer = null;
      }
    } catch {
      markSaveError("保存失败：网络异常，正在重试");
    } finally {
      isSaving.value = false;
      if (pendingSave.value) {
        saveToServer(true);
      }
    }
  };

  if (immediate) {
    await doSave();
    return;
  }

  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    serverSaveTimer = null;
    void doSave();
  }, 800);
};

const resolveConflict = (action: 'local' | 'remote') => {
  if (!conflictState.value.hasConflict || !conflictState.value.remoteData) return;
  const remote = conflictState.value.remoteData;
  const remoteParsed = parsePayload(remote);
  lastConflictSignature.value = buildConflictSignature(
    remoteParsed.content,
    remoteParsed.serverTs,
    remoteParsed.mode || mode.value,
  );
  conflictCooldownUntil.value = Date.now() + CONFIG.CONFLICT_PROMPT_COOLDOWN;
  if (conflictRetryTimer) {
    clearTimeout(conflictRetryTimer);
    conflictRetryTimer = null;
  }
  if (action === 'local') {
    // Keep local content, but update serverTs to allow overwrite
    serverTs.value = remote.server_ts;
    // Trigger save immediately
    saveToServer(true);
  } else {
    // Use remote content
    applyRemotePayload(remote, true);
  }
  // Clear conflict state
  conflictState.value = { hasConflict: false, remoteData: null };
  syncState.value = 'idle';
  showToast.value = false;
};

const applyRemotePayload = (payload: WidgetConfig["data"], force = false) => {
  const parsed = parsePayload(payload);
  if (!force && parsed.serverTs && parsed.serverTs <= serverTs.value) return;
  if (conflictState.value.hasConflict && !force) return; // Block remote updates during conflict
  
  if (isEditing.value) {
    if (parsed.serverTs) {
      serverTs.value = parsed.serverTs;
    }
    return;
  }
  if (parsed.content !== localData.value || parsed.serverTs !== serverTs.value) {
    localData.value = parsed.content;
    serverTs.value = parsed.serverTs;
  }
  if (parsed.mode === "simple" || parsed.mode === "rich") {
    mode.value = parsed.mode;
  }
};

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let idleCheckTimer: ReturnType<typeof setInterval> | null = null;
let currentPollInterval = CONFIG.POLL_ACTIVE_INTERVAL;
let pollRetryCount = 0;

const pollRemote = async (force = false) => {
  // Fix Risk 3: Check isSaving to avoid race condition
  // 外网/隧道场景下 socket.io 可能不稳定，但 HTTP `/api/memo/:id` 仍可用。
  // 因此只要用户已登录且组件状态允许，就继续用 HTTP 轮询兜底。
  if (!store.isLogged || isEditing.value || isSaving.value || syncState.value !== "idle") return;
  const id = props.widget.id;
  if (!id) return;
  
  // Fix Risk 2: Skip polling if WebSocket is connected and healthy
  if (preferSocketSync.value && store.isConnected && !force) {
    scheduleNextPoll();
    return;
  }

  if (import.meta.env.MODE === "test") return;
  try {
    const res = await fetchWithTimeout(
      `/api/memo/${id}`,
      { headers: store.getHeaders() },
      CONFIG.POLL_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(res.statusText);
    const parsedBody = await parseJsonBody(res);
    if (!parsedBody.isJson) {
      throw new Error("invalid_content_type");
    }
    const data = parsedBody.data as { success?: boolean; data?: WidgetConfig["data"] } | null;
    if (data?.success && data?.data) {
      applyRemotePayload(data.data);
    }
    pollRetryCount = 0; // Success reset
  } catch {
    pollRetryCount++;
  } finally {
    scheduleNextPoll();
  }
};

const scheduleNextPoll = () => {
  if (pollTimer) clearTimeout(pollTimer);
  
  if (syncState.value !== "idle") return;

  let interval = CONFIG.POLL_IDLE_INTERVAL;
  if (isPageVisible.value) {
     interval = userActivityState.value === "active" 
        ? CONFIG.POLL_ACTIVE_INTERVAL 
        : CONFIG.POLL_SILENT_INTERVAL;
  }
  
  // Backoff strategy
  if (pollRetryCount > 0) {
    const backoff = Math.min(5000 * Math.pow(2, pollRetryCount), 30000);
    interval = Math.max(interval, backoff);
  }
  
  pollTimer = setTimeout(pollRemote, interval);
  currentPollInterval = interval;
};

let lastBroadcastTime = 0;
let broadcastRetryCount = 0;

const performBroadcast = () => {
  if (!store.isLogged || !preferSocketSync.value || !store.isConnected) return;
  const payload = buildPayload();

  try {
    store.wsSend({
      type: "memo_update",
      payload: {
        token: store.token || localStorage.getItem("flat-nas-token"),
        widgetId: props.widget.id,
        content: payload,
      },
    });
    broadcastRetryCount = 0;
  } catch {
    if (broadcastRetryCount < CONFIG.BROADCAST_RETRY_LIMIT) {
      broadcastRetryCount++;
      setTimeout(performBroadcast, 1000 * Math.pow(2, broadcastRetryCount));
    }
  }
};

const scheduleBroadcast = () => {
  if (!isBroadcasting.value || !store.isLogged) return;
  
  const now = Date.now();
  const remaining = CONFIG.BROADCAST_THROTTLE - (now - lastBroadcastTime);
  
  if (remaining <= 0) {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    performBroadcast();
    lastBroadcastTime = now;
  } else if (!broadcastTimer) {
    broadcastTimer = setTimeout(() => {
      performBroadcast();
      lastBroadcastTime = Date.now();
      broadcastTimer = null;
    }, remaining);
  }
};

const updateSyncMode = () => {
  // If in conflict, stay in conflict state until resolved
  if (conflictState.value.hasConflict) {
    syncState.value = "conflict";
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    return;
  }

  if (!isNetworkOnline.value) {
    syncState.value = "offline";
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    return;
  }

  const now = Date.now();
  const timeSinceInput = now - lastInputAt.value;
  if (isEditing.value) {
    const isInputActive = timeSinceInput <= CONFIG.ACTIVE_INPUT_WINDOW;
    syncState.value = isInputActive ? "inputting" : "cooldown";
    isBroadcasting.value = isInputActive;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    return;
  }

  const isInCooldown = timeSinceInput <= (CONFIG.ACTIVE_INPUT_WINDOW + CONFIG.INPUT_COOLDOWN);
  if (isInCooldown) {
    syncState.value = "cooldown";
    isBroadcasting.value = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  } else {
    syncState.value = "idle";
    isBroadcasting.value = false;
    
    if (!pollTimer) {
      scheduleNextPoll();
    } else {
      // If we switched from silent to active, we restart timer to react faster
      if (userActivityState.value === "active" && currentPollInterval > CONFIG.POLL_ACTIVE_INTERVAL) {
         clearTimeout(pollTimer);
         pollTimer = setTimeout(pollRemote, 0); 
      }
    }
  }
};

const handleVisibilityChange = () => {
  isPageVisible.value = document.visibilityState === "visible";
  updateSyncMode();
  if (isPageVisible.value && pendingSave.value) {
    void saveToServer(true);
  }
};

// --- Monitoring ---
let activityTimer: ReturnType<typeof setTimeout> | null = null;
const handleUserActivity = () => {
  if (userActivityState.value === "silent") {
    userActivityState.value = "active";
    updateSyncMode();
  }
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    userActivityState.value = "silent";
    updateSyncMode();
  }, 30000); // 30s silent -> active
};

const handleOnline = () => {
  isNetworkOnline.value = true;
  updateSyncMode();
  if (pendingSave.value || syncState.value === "cooldown") {
    void saveToServer(true);
  }
};

const handleOffline = () => {
  isNetworkOnline.value = false;
  updateSyncMode();
};

const handleFocus = () => {
  isEditing.value = true;
  lastInputAt.value = Date.now();
  updateSyncMode();
};

const handleBlur = () => {
  isEditing.value = false;
  updateSyncMode();
  saveToServer(true);
};

const handleInputActivity = () => {
  lastInputAt.value = Date.now();
  handleUserActivity(); // Also trigger activity
  updateSyncMode();
  scheduleBroadcast();
};

const handleInnerWheel = (e: WheelEvent) => {
  const target = e.currentTarget as HTMLElement | null;
  if (!target) return;
  const scrollHeight = target.scrollHeight;
  const clientHeight = target.clientHeight;
  const canScroll = scrollHeight > clientHeight + 1;
  if (!canScroll) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const delta = e.deltaY;
  const scrollTop = target.scrollTop;
  const atTop = scrollTop <= 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
  if ((atTop && delta < 0) || (atBottom && delta > 0)) {
    e.preventDefault();
  }
  e.stopPropagation();
};

const extractPreviewLabel = (value: string) => {
  const text = value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "空白备忘";
  const limit = 10;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const refreshVersions = async () => {
  historyVersions.value = await loadVersions();
};

const openVersionMenu = async () => {
  versionMenuOpen.value = true;
  await nextTick();
  const idx = versionOptions.value.findIndex((opt) => opt.id === selectedVersionId.value);
  activeVersionIndex.value = idx >= 0 ? idx : 0;
};

const closeVersionMenu = () => {
  versionMenuOpen.value = false;
};

const toggleVersionMenu = () => {
  if (versionMenuOpen.value) {
    closeVersionMenu();
  } else {
    openVersionMenu();
  }
};

const createNewMemo = async () => {
  localData.value = "";
  await saveToIndexedDB();
  saveToServer(true);
};

const applyVersion = async (version: MemoVersion) => {
  localData.value = version.content;
  mode.value = version.mode;
  await saveToIndexedDB();
  saveToServer(true);
};

const selectVersionOption = async (option: VersionOption, index: number) => {
  activeVersionIndex.value = index;
  if (option.kind === "new") {
    selectedVersionId.value = "new";
    await createNewMemo();
  } else if (option.version) {
    selectedVersionId.value = option.id;
    await applyVersion(option.version);
  }
  closeVersionMenu();
};

const deleteVersionEntry = async (option: VersionOption) => {
  if (option.kind !== "history") return;
  if (!option.version) return;
  await deleteVersion(option.id);
  await refreshVersions();
  if (selectedVersionId.value === option.id) {
    selectedVersionId.value = "new";
  }
};

const handleVersionKeydown = (e: KeyboardEvent) => {
  const options = versionOptions.value;
  if (!options.length) return;
  if (!versionMenuOpen.value) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openVersionMenu();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeVersionIndex.value = (activeVersionIndex.value + 1) % options.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    activeVersionIndex.value =
      (activeVersionIndex.value - 1 + options.length) % options.length;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const option = options[activeVersionIndex.value];
    if (option) selectVersionOption(option, activeVersionIndex.value);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeVersionMenu();
  }
};

const handleDocPointerDown = (e: PointerEvent) => {
  if (!versionMenuOpen.value) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (versionWrapperRef.value && !versionWrapperRef.value.contains(target)) {
    closeVersionMenu();
  }
};

const handleBeforeUnload = () => {
  if (serverSaveTimer) {
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
  }
  // Try to persist locally as well (fire and forget)
  saveToIndexedDB();
  saveToServer(true, true);
};

// Initial Load
loadFromIndexedDB().then(async () => {
  if (!localData.value && props.widget.data) {
     if (typeof props.widget.data === "string") {
        localData.value = props.widget.data;
     } else {
        const d = props.widget.data as { rich?: string; simple?: string; mode?: "simple" | "rich"; server_ts?: number; updatedAt?: number };
        localData.value = d.rich || d.simple || "";
        // Auto-detect mode: use saved mode if present, otherwise infer from content shape
        const looksLikeHtml = localData.value && /<[a-z][\s\S]*>/i.test(localData.value);
        if (d.mode === "rich") {
          mode.value = "rich";
        } else if (d.mode === "simple" && looksLikeHtml) {
          // Dirty data fix: mode says simple but content is HTML (from old toggleMode bug)
          // Switch to rich to render properly instead of showing raw tags
          mode.value = "rich";
        } else if (!d.mode && looksLikeHtml) {
          mode.value = "rich";
        } else {
          mode.value = "simple";
        }
        serverTs.value = typeof d.server_ts === "number" ? d.server_ts : (typeof d.updatedAt === "number" ? d.updatedAt : 0);
     }
  }
  // Dirty data fix: if IndexedDB or widget.data loaded HTML content with mode="simple",
  // auto-correct to "rich" so the contenteditable renders it instead of showing raw tags
  if (mode.value === "simple" && localData.value && /<[a-z][\s\S]*>/i.test(localData.value)) {
    mode.value = "rich";
  }
  await refreshVersions();
});

// Auto-save wrapper (optional, but requested "Persistent Button" behavior implies manual action is the focus, 
// but user data usually needs autosave. The prompt emphasizes the "Persistent Button" feedback.)
// I will keep manual save for the "Persistent Button" requirement demo, and maybe autosave silently.
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
watch([localData, mode], () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveToIndexedDB();
    saveToServer();
  }, autoSaveDelay.value);
});

watch(historyVersions, () => {
  if (selectedVersionId.value === "new") return;
  const exists = historyVersions.value.some((v) => v.id === selectedVersionId.value);
  if (!exists) selectedVersionId.value = "new";
});

watch(
  () => props.widget.data,
  (nextData) => {
    if (!nextData) return;
    applyRemotePayload(nextData as WidgetConfig["data"]);
  },
);

// Socket 监听已迁移到 store
let memoSocketBound = false;
const bindMemoSocketListeners = () => {
  memoSocketBound = true;
};
const unbindMemoSocketListeners = () => {
  memoSocketBound = false;
};

watch(
  [() => store.isLogged, preferSocketSync],
  ([isLogged, useSocket]) => {
    if (!isLogged) {
      unbindMemoSocketListeners();
      return;
    }
    if (useSocket) {
      bindMemoSocketListeners();
    } else {
      unbindMemoSocketListeners();
    }
    void pollRemote(true);
  },
  { immediate: true },
);

onMounted(() => {
  updateSyncMode();
  idleCheckTimer = setInterval(updateSyncMode, 1000);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pointerdown", handleDocPointerDown);
  
  // Monitoring
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("mousemove", handleUserActivity);
  document.addEventListener("keydown", handleUserActivity);
  document.addEventListener("touchstart", handleUserActivity);
  window.addEventListener("beforeunload", handleBeforeUnload);
  handleUserActivity(); // Init

  refreshVersions();
});

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
  if (idleCheckTimer) clearInterval(idleCheckTimer);
  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (broadcastTimer) clearTimeout(broadcastTimer);
  if (conflictRetryTimer) clearTimeout(conflictRetryTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  document.removeEventListener("pointerdown", handleDocPointerDown);
  
  // Cleanup monitoring
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  document.removeEventListener("mousemove", handleUserActivity);
  document.removeEventListener("keydown", handleUserActivity);
  document.removeEventListener("touchstart", handleUserActivity);
  window.removeEventListener("beforeunload", handleBeforeUnload);

  unbindMemoSocketListeners();

  if (activityTimer) clearTimeout(activityTimer);
  saveToServer(true, true);
});



</script>

<template>
  <div
    class="w-full h-full rounded-2xl backdrop-blur border border-white/10 relative group flex flex-col transition-colors duration-300 overflow-hidden"
    :class="mode === 'simple' ? 'p-0' : 'p-4'"
    :style="containerStyle"
  >
    <!-- Page Curl Toggle -->
    <div 
      class="absolute top-0 left-0 w-3 h-3 cursor-pointer z-50 overflow-hidden group/curl"
      @click="toggleMode"
      title="切换模式"
    >
      <!-- The shadow of the curl -->
      <div class="absolute top-0 left-0 w-0 h-0 border-t-[12px] border-r-[12px] border-t-white/0 border-r-black/20 transform translate-x-0.5 translate-y-0.5 blur-[1px] transition-all duration-300 group-hover/curl:scale-105"></div>
      <!-- The curled part -->
      <div class="absolute top-0 left-0 w-0 h-0 border-t-[12px] border-r-[12px] border-t-white/90 border-r-transparent shadow-sm transition-all duration-300 group-hover/curl:border-t-white group-hover/curl:scale-105"></div>
    </div>

    <!-- Header / Controls -->
    <div v-if="mode === 'rich'" class="flex items-center justify-end gap-2 mb-2 z-10 -mt-4 -mr-4">
      <div
        ref="versionWrapperRef"
        class="relative"
        tabindex="0"
        @keydown="handleVersionKeydown"
      >
        <button
          type="button"
          class="flex items-center justify-between gap-2 px-2 h-7 w-[120px] rounded-md text-xs font-medium text-gray-700 bg-white/40 border border-white/20 hover:bg-white/60 transition-colors"
          :aria-expanded="versionMenuOpen"
          @click="toggleVersionMenu"
        >
          <span class="truncate max-w-[80px]">{{ selectedVersionLabel }}</span>
          <svg
            class="w-3 h-3 transition-transform duration-200"
            :class="versionMenuOpen ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
              clip-rule="evenodd"
            />
          </svg>
        </button>

        <div
          v-if="versionMenuOpen && !isMobile"
          class="absolute right-0 top-full mt-1 z-40 w-[128px] max-h-[200px] overflow-y-auto no-scrollbar rounded-lg border border-white/20 bg-white/80 backdrop-blur shadow-lg p-1"
          @wheel="handleInnerWheel"
        >
          <div
            v-for="(option, index) in versionOptions"
            :key="option.id"
            class="flex items-center gap-1 rounded-md transition-colors"
            :class="[
              activeVersionIndex === index ? 'bg-[#0052D9]/10 text-[#0052D9]' : 'text-gray-700 hover:bg-white/60',
              selectedVersionId === option.id ? 'bg-[#0052D9]/20 text-[#0052D9]' : ''
            ]"
          >
            <button
              type="button"
              class="flex-1 text-left px-2 py-2 text-xs truncate"
              @click="selectVersionOption(option, index)"
            >
              {{ option.label }}
            </button>
            <button
              v-if="option.kind === 'history'"
              type="button"
              class="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-white/60"
              aria-label="删除版本"
              @click.stop="deleteVersionEntry(option)"
            >
              <svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M6.28 5.22a.75.75 0 0 1 1.06 0L10 7.94l2.66-2.72a.75.75 0 1 1 1.08 1.04L11.06 9l2.68 2.76a.75.75 0 1 1-1.08 1.04L10 10.06l-2.66 2.72a.75.75 0 1 1-1.08-1.04L8.94 9 6.28 6.26a.75.75 0 0 1 0-1.04Z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Persistent Save Button -->
      <!-- Triple Feedback 1: Button Pulse Animation -->
      <button
        v-if="mode === 'rich'"
        @click="triggerSave"
        class="
          flex items-center justify-center gap-1 px-2 h-7 w-[72px] rounded-md text-xs font-medium text-white transition-all duration-300
          focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#0052D9] border border-white/10 border-t-0 border-r-0
        "
        :class="[
          status === 'success' ? 'bg-green-500 animate-pulse' : 'bg-[#0052D9] hover:brightness-110',
          status === 'saving' ? 'opacity-70 cursor-wait' : ''
        ]"
        :disabled="status === 'saving'"
        title="保存"
      >
        <svg v-if="status === 'success'" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <svg v-else class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        <span>{{ status === 'success' ? '已保存' : '保存' }}</span>
      </button>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 relative">
      <Transition name="page-tear" mode="out-in">
        <div :key="mode" class="w-full h-full">
          <textarea
            v-if="mode === 'simple'"
            v-model="localData"
            class="w-full h-full bg-transparent resize-none outline-none text-sm placeholder-gray-600 font-medium p-4 pt-4"
            :placeholder="store.isLogged ? '写点什么...' : '请先登录'"
            :readonly="!store.isLogged"
            @focus="handleFocus"
            @blur="handleBlur"
            @input="handleInputActivity"
            @wheel="handleInnerWheel"
          ></textarea>
          
          <MemoEditor
            v-else
            ref="editorRef"
            v-model:content="localData"
            :editable="store.isLogged"
            :placeholder="store.isLogged ? '在此输入内容...' : '请先登录'"
            @focus="handleFocus"
            @blur="handleBlur"
            @input="handleInputActivity"
            @wheel="handleInnerWheel"
          />
        </div>
      </Transition>
    </div>

    <!-- Conflict Resolution Overlay -->
    <div
      v-if="conflictState.hasConflict"
      class="absolute inset-x-0 bottom-0 z-40 bg-red-50/95 border-t border-red-200 p-2 sm:p-3 backdrop-blur-sm flex flex-col gap-2 shadow-lg"
    >
      <div class="text-xs text-red-600 font-bold flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>检测到版本冲突 (Version Conflict)</span>
      </div>
      <p class="text-[11px] text-red-500 leading-tight">
        云端存在更新的版本。请选择保留您的本地更改(将覆盖云端)，还是放弃本地更改使用云端版本。
      </p>
      <div class="flex gap-2 mt-1">
        <button
          @click="resolveConflict('local')"
          class="flex-1 px-3 py-2 min-h-[44px] bg-white border border-red-200 text-red-600 text-xs font-medium rounded hover:bg-red-50 transition-colors"
        >
          保留本地 (Overwrite Remote)
        </button>
        <button
          @click="resolveConflict('remote')"
          class="flex-1 px-3 py-2 min-h-[44px] bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors"
        >
          使用云端 (Discard Local)
        </button>
      </div>
    </div>

    <!-- Toolbar (Rich Mode Only) -->
    <MemoToolbar v-if="mode === 'rich'" @command="handleCommand" />

    <div
      v-if="versionMenuOpen && isMobile"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      @click="closeVersionMenu"
    >
      <div
        class="absolute inset-0 bg-white/95 text-gray-800 flex flex-col"
        @click.stop
      >
        <div class="flex items-center justify-between p-4 border-b border-gray-200/60">
          <span class="text-sm font-semibold">选择版本</span>
          <button
            type="button"
            class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100"
            @click="closeVersionMenu"
          >
            关闭
          </button>
        </div>
        <div class="flex-1 overflow-y-auto no-scrollbar p-3 space-y-1" @wheel="handleInnerWheel">
          <div
            v-for="(option, index) in versionOptions"
            :key="option.id"
            class="flex items-center gap-2 rounded-md transition-colors"
            :class="[
              activeVersionIndex === index ? 'bg-[#0052D9]/10 text-[#0052D9]' : 'text-gray-700 hover:bg-gray-100',
              selectedVersionId === option.id ? 'bg-[#0052D9]/20 text-[#0052D9]' : ''
            ]"
          >
            <button
              type="button"
              class="flex-1 text-left px-3 py-3 text-sm truncate"
              @click="selectVersionOption(option, index)"
            >
              {{ option.label }}
            </button>
            <button
              v-if="option.kind === 'history'"
              type="button"
              class="shrink-0 mr-2 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100"
              aria-label="删除版本"
              @click.stop="deleteVersionEntry(option)"
            >
              <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M6.28 5.22a.75.75 0 0 1 1.06 0L10 7.94l2.66-2.72a.75.75 0 1 1 1.08 1.04L11.06 9l2.68 2.76a.75.75 0 1 1-1.08 1.04L10 10.06l-2.66 2.72a.75.75 0 1 1-1.08-1.04L8.94 9 6.28 6.26a.75.75 0 0 1 0-1.04Z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Triple Feedback 2: Toast (Overlay) -->
    <Transition
      enter-active-class="transition ease-out duration-300"
      enter-from-class="transform opacity-0 translate-y-2"
      enter-to-class="transform opacity-100 translate-y-0"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="transform opacity-100 translate-y-0"
      leave-to-class="transform opacity-0 translate-y-2"
    >
      <div 
        v-if="showToast"
        class="absolute top-12 right-4 z-30 bg-gray-800 text-white text-xs px-3 py-1.5 rounded shadow-lg flex items-center gap-2"
      >
        <svg class="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {{ toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Scrollbar styling if needed */
textarea::-webkit-scrollbar,
div::-webkit-scrollbar {
  width: 6px;
}
textarea::-webkit-scrollbar-thumb,
div::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Page Tear Animation */
.page-tear-leave-active {
  animation: tear-off 0.6s ease-in forwards;
  transform-origin: top left;
  position: absolute; /* Prevent layout shift */
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: none; /* Prevent clicks during animation */
}

.page-tear-enter-active {
  animation: fade-in 0.6s ease-out;
}

@keyframes tear-off {
  0% {
    transform: rotate(0deg) translateY(0);
    opacity: 1;
    mask-image: linear-gradient(to bottom, black 100%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 100%, transparent 100%);
  }
  100% {
    transform: rotate(-10deg) translateY(120%) translateX(-20px);
    opacity: 0;
    mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
  }
}

@keyframes fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
</style>
