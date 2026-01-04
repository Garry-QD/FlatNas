<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { io, type Socket } from "socket.io-client";
import { useStorage } from "@vueuse/core";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "@/stores/main";
import { useDevice } from "@/composables/useDevice";

type TransferItem =
  | { id: string; type: "text"; timestamp: number; content: string }
  | {
      id: string;
      type: "file";
      timestamp: number;
      file: { name: string; size: number; type: string; ext?: string; url: string };
    };

type UploadStatus = "queued" | "uploading" | "paused" | "failed" | "completed";

type UploadQueueItem = {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  abort?: AbortController;
};

type LinkifiedPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();
const socket = ref<Socket | null>(null);
const { isMobile } = useDevice(toRef(store.appConfig, "deviceMode"));
const isSmallLayout = computed(() => props.widget.w === 1 && props.widget.h === 2);

const activeTab = useStorage<"chat" | "files" | "photos">(
  `flatnas-transfer-tab-${props.widget.id}`,
  "chat",
);
const loading = ref(false);
const error = ref<string | null>(null);
const items = ref<TransferItem[]>([]);
const scrollContainerRef = ref<HTMLDivElement | null>(null);

const scrollToBottom = async () => {
  await nextTick();
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = scrollContainerRef.value.scrollHeight;
  }
};

const composerText = ref("");
const composerRef = ref<HTMLTextAreaElement | null>(null);

const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const dragDepth = ref(0);
const multiSelectMode = ref(false);
const contextMenuOpen = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuTargetId = ref<string | null>(null);

const queue = ref<UploadQueueItem[]>([]);
const uploadingCount = ref(0);
const MAX_CONCURRENCY = 2;
const LARGE_DOWNLOAD_CONFIRM_BYTES = 50 * 1024 * 1024;

const previewOpen = ref(false);
const previewItem = ref<TransferItem | null>(null);
const blobUrlById = ref<Record<string, string>>({});

const sortedChatItems = computed(() =>
  [...items.value].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
);

const CHAT_GROUP_MS = 30 * 60 * 1000;

type ChatGroup = { key: string; timestamp: number; items: TransferItem[] };

const groupedChatItems = computed<ChatGroup[]>(() => {
  const list = sortedChatItems.value;
  const groups: ChatGroup[] = [];
  let lastTs = -1;
  for (const it of list) {
    const ts = Number(it.timestamp) || 0;
    const last = groups[groups.length - 1];
    if (!last || (lastTs >= 0 && ts - lastTs > CHAT_GROUP_MS)) {
      groups.push({ key: it.id, timestamp: ts, items: [it] });
    } else {
      last.items.push(it);
    }
    lastTs = ts;
  }
  return groups;
});

const selectedIds = ref<Record<string, boolean>>({});
const selectedCount = computed(() => Object.values(selectedIds.value).filter(Boolean).length);

const setSelected = (id: string, v: boolean) => {
  const next = { ...selectedIds.value };
  if (v) next[id] = true;
  else delete next[id];
  selectedIds.value = next;
};

const toggleSelected = (id: string) => setSelected(id, !selectedIds.value[id]);

const authHeaderOnly = () => {
  const token = store.token || localStorage.getItem("flat-nas-token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

const formatBytes = (bytes: number) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

const formatTime = (ts: number) => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
};

const formatGroupTime = (ts: number) => {
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const toLinkifiedParts = (raw: string): LinkifiedPart[] => {
  const text = String(raw ?? "");
  if (!text) return [{ kind: "text", text: "" }];

  const urlRe = /https?:\/\/[^\s<>"'`]+/g;
  const parts: LinkifiedPart[] = [];
  let lastIndex = 0;

  for (const m of text.matchAll(urlRe)) {
    const match = m[0] || "";
    const index = m.index ?? -1;
    if (!match || index < 0) continue;

    if (index > lastIndex) parts.push({ kind: "text", text: text.slice(lastIndex, index) });

    let url = match;
    let trailing = "";
    while (url && /[)\]}\.,!?;:]+$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }

    if (url && url !== "http://" && url !== "https://") {
      parts.push({ kind: "link", text: url, href: url });
    } else {
      parts.push({ kind: "text", text: match });
    }

    if (trailing) parts.push({ kind: "text", text: trailing });
    lastIndex = index + match.length;
  }

  if (lastIndex < text.length) parts.push({ kind: "text", text: text.slice(lastIndex) });
  return parts.length ? parts : [{ kind: "text", text }];
};

const fileKeyFor = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

const handleScrollIsolation = (e: WheelEvent) => {
  const el = e.currentTarget as HTMLDivElement;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const delta = e.deltaY;

  const isAtTop = scrollTop <= 0;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  if ((isAtTop && delta < 0) || (isAtBottom && delta > 0)) {
    e.preventDefault();
    e.stopPropagation();
  }
};

const onTransferUpdate = (event: { type: "add" | "delete"; item?: TransferItem; id?: string }) => {
  if (event.type === "add" && event.item) {
    if (!items.value.some((x) => x.id === event.item!.id)) {
      items.value = [event.item, ...items.value].slice(0, 1000);
    }
  } else if (event.type === "delete" && event.id) {
    items.value = items.value.filter((x) => x.id !== event.id);
    if (selectedIds.value[event.id]) {
      const next = { ...selectedIds.value };
      delete next[event.id];
      selectedIds.value = next;
    }
    if (previewItem.value?.id === event.id) closePreview();
  }
};

const fetchItems = async () => {
  if (!store.isLogged) return;
  loading.value = true;
  error.value = null;
  try {
    const type =
      activeTab.value === "photos" ? "photo" : activeTab.value === "files" ? "file" : "all";
    const headers = authHeaderOnly();
    const res = await fetch(`/api/transfer/items?type=${encodeURIComponent(type)}&limit=1000`, {
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    items.value = Array.isArray(data.items) ? (data.items as TransferItem[]) : [];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    error.value = msg || "加载失败";
  } finally {
    loading.value = false;
  }
};

const openFilePicker = () => fileInputRef.value?.click();

const enqueueFiles = (files: File[]) => {
  if (!store.isLogged) return;
  const list = files.filter((f) => f && f.size > 0);
  if (!list.length) return;
  for (const f of list) {
    queue.value.push({
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      status: "queued",
      progress: 0,
    });
  }
  startNextUploads();
};

const onFileInputChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  enqueueFiles(files);
  if (input) input.value = "";
};

const onDrop = (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
  dragDepth.value = 0;
  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  enqueueFiles(files);
};

const isFilesDragEvent = (e: DragEvent) => {
  const types = Array.from(e.dataTransfer?.types || []);
  return types.includes("Files");
};

const onDragEnter = (e: DragEvent) => {
  if (!isFilesDragEvent(e)) return;
  dragDepth.value += 1;
  isDragOver.value = true;
};

const onDragOver = (e: DragEvent) => {
  if (!isFilesDragEvent(e)) return;
  e.preventDefault();
  isDragOver.value = true;
};

const onDragLeave = () => {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) isDragOver.value = false;
};

const findItemById = (id: string) => items.value.find((x) => x.id === id) || null;

const closeContextMenu = () => {
  contextMenuOpen.value = false;
  contextMenuTargetId.value = null;
};

const openContextMenuAt = (x: number, y: number, targetId: string | null) => {
  const w = 196;
  const h = 220;
  contextMenuX.value = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  contextMenuY.value = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  contextMenuTargetId.value = targetId;
  contextMenuOpen.value = true;
};

const onListContextMenu = (e: MouseEvent) => {
  if (!store.isLogged) return;
  e.preventDefault();
  const target = e.target as HTMLElement | null;
  const row = target?.closest?.("[data-transfer-id]") as HTMLElement | null;
  openContextMenuAt(e.clientX, e.clientY, row?.dataset.transferId || null);
};

const onChatItemClick = (it: TransferItem) => {
  if (skipNextChatClickId === it.id) {
    skipNextChatClickId = null;
    return;
  }
  if (multiSelectMode.value) {
    toggleSelected(it.id);
    return;
  }
  if (it.type === "file") openPreview(it);
};

const hasTouch = computed(() => {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { msMaxTouchPoints?: number };
  const maxPoints = Math.max(0, n.maxTouchPoints || 0, n.msMaxTouchPoints || 0);
  if (maxPoints > 0) return true;
  return typeof window !== "undefined" && "ontouchstart" in window;
});
const enableLongPressContextMenu = computed(() => hasTouch.value);
let longPressTimer: number | null = null;
let longPressStartX = 0;
let longPressStartY = 0;
let longPressTargetId: string | null = null;
let skipNextChatClickId: string | null = null;
let longPressSource: "touch" | "pointer" | null = null;

const clearLongPress = () => {
  if (longPressTimer) window.clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressTargetId = null;
  longPressSource = null;
};

const onChatItemTouchStart = (e: TouchEvent, id: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (contextMenuOpen.value) return;
  if (longPressSource === "pointer") return;

  const t = e.touches && e.touches[0];
  if (!t) return;

  clearLongPress();
  longPressSource = "touch";
  longPressStartX = t.clientX;
  longPressStartY = t.clientY;
  longPressTargetId = id;
  longPressTimer = window.setTimeout(() => {
    if (!longPressTargetId) return;
    skipNextChatClickId = longPressTargetId;
    openContextMenuAt(longPressStartX, longPressStartY, longPressTargetId);
    clearLongPress();
  }, 520);
};

const onChatItemTouchMove = (e: TouchEvent) => {
  if (!longPressTimer) return;
  if (longPressSource !== "touch") return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dx = t.clientX - longPressStartX;
  const dy = t.clientY - longPressStartY;
  if (dx * dx + dy * dy > 256) clearLongPress();
};

const onChatItemTouchEnd = () => {
  clearLongPress();
};

const onChatItemPointerDown = (e: PointerEvent, id: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (contextMenuOpen.value) return;
  if (e.pointerType !== "touch") return;

  clearLongPress();
  longPressSource = "pointer";
  longPressStartX = e.clientX;
  longPressStartY = e.clientY;
  longPressTargetId = id;
  longPressTimer = window.setTimeout(() => {
    if (!longPressTargetId) return;
    skipNextChatClickId = longPressTargetId;
    openContextMenuAt(longPressStartX, longPressStartY, longPressTargetId);
    clearLongPress();
  }, 520);
};

const onChatItemPointerMove = (e: PointerEvent) => {
  if (!longPressTimer) return;
  if (longPressSource !== "pointer") return;
  if (e.pointerType !== "touch") return;
  const dx = e.clientX - longPressStartX;
  const dy = e.clientY - longPressStartY;
  if (dx * dx + dy * dy > 256) clearLongPress();
};

const onChatItemPointerUp = () => {
  clearLongPress();
};

const clearSelection = () => {
  selectedIds.value = {};
};

const toggleMultiSelectMode = () => {
  multiSelectMode.value = !multiSelectMode.value;
  if (!multiSelectMode.value) clearSelection();
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.error("Copy failed", e);
  }
};

const onDocKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape") closeContextMenu();
};

const onDocPointerDownCapture = (e: PointerEvent) => {
  if (!contextMenuOpen.value) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-transfer-context-menu]")) return;
  closeContextMenu();
};

const onPaste = (e: ClipboardEvent) => {
  const dt = e.clipboardData;
  if (!dt) return;
  const files: File[] = [];
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    enqueueFiles(files);
    e.preventDefault();
  }
};

const startNextUploads = () => {
  if (!store.isLogged) return;
  while (uploadingCount.value < MAX_CONCURRENCY) {
    const next = queue.value.find((x) => x.status === "queued");
    if (!next) break;
    uploadQueueItem(next);
  }
};

const pauseUpload = (q: UploadQueueItem) => {
  if (q.abort) q.abort.abort();
  q.abort = undefined;
  if (q.status === "uploading") q.status = "paused";
};

const resumeUpload = (q: UploadQueueItem) => {
  if (q.status !== "paused" && q.status !== "failed") return;
  q.status = "queued";
  q.error = undefined;
  startNextUploads();
};

const removeQueueItem = (q: UploadQueueItem) => {
  pauseUpload(q);
  queue.value = queue.value.filter((x) => x.id !== q.id);
};

const uploadQueueItem = async (q: UploadQueueItem) => {
  uploadingCount.value += 1;
  q.status = "uploading";
  q.progress = Math.max(0, Math.min(1, q.progress || 0));
  q.error = undefined;

  const controller = new AbortController();
  q.abort = controller;

  try {
    const chunkSize = 5 * 1024 * 1024;
    const initRes = await fetch("/api/transfer/upload/init", {
      method: "POST",
      headers: store.getHeaders(),
      body: JSON.stringify({
        fileName: q.file.name,
        size: q.file.size,
        mime: q.file.type || "",
        fileKey: fileKeyFor(q.file),
        chunkSize,
      }),
      signal: controller.signal,
    });
    const initData = await initRes.json().catch(() => ({}));
    if (!initRes.ok || !initData.success) {
      throw new Error(initData.error || `HTTP ${initRes.status}`);
    }

    const uploadId = String(initData.uploadId || "");
    const effectiveChunkSize = Number(initData.chunkSize || chunkSize);
    const totalChunks = Number(initData.totalChunks || 0);
    const uploaded = new Set<number>(
      Array.isArray(initData.uploaded) ? initData.uploaded.map((n: unknown) => Number(n)) : [],
    );

    if (!uploadId || !Number.isFinite(totalChunks) || totalChunks <= 0) {
      throw new Error("上传初始化失败");
    }

    let doneBytes = 0;
    if (uploaded.size) {
      doneBytes = Math.min(q.file.size, uploaded.size * effectiveChunkSize);
      q.progress = doneBytes / q.file.size;
    }

    for (let i = 0; i < totalChunks; i++) {
      if (uploaded.has(i)) continue;
      const start = i * effectiveChunkSize;
      const end = Math.min(q.file.size, start + effectiveChunkSize);
      const blob = q.file.slice(start, end);

      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          const form = new FormData();
          form.append("uploadId", uploadId);
          form.append("index", String(i));
          form.append("chunk", blob, `${q.file.name}.part`);

          const r = await fetch("/api/transfer/upload/chunk", {
            method: "POST",
            headers: authHeaderOnly(),
            body: form,
            signal: controller.signal,
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.success) throw new Error(d.error || `HTTP ${r.status}`);
          doneBytes += blob.size;
          q.progress = Math.max(0, Math.min(1, doneBytes / q.file.size));
          break;
        } catch (e: unknown) {
          if (controller.signal.aborted) throw e;
          if (attempt >= 3) throw e;
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        }
      }
    }

    const completeRes = await fetch("/api/transfer/upload/complete", {
      method: "POST",
      headers: store.getHeaders(),
      body: JSON.stringify({ uploadId }),
      signal: controller.signal,
    });
    const completeData = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok || !completeData.success) {
      throw new Error(completeData.error || `HTTP ${completeRes.status}`);
    }

    q.status = "completed";
    q.progress = 1;
    const newItem = completeData.item as TransferItem | undefined;
    if (newItem) {
      if (!items.value.some((x) => x.id === newItem.id)) {
        items.value = [newItem, ...items.value].slice(0, 200);
      }
    } else {
      await fetchItems();
    }

    queue.value = queue.value.filter((x) => x.id !== q.id);
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      if (q.status === "uploading") q.status = "paused";
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      q.status = "failed";
      q.error = msg || "上传失败";
    }
  } finally {
    if (q.abort === controller) q.abort = undefined;
    uploadingCount.value = Math.max(0, uploadingCount.value - 1);
    startNextUploads();
  }
};

const sendText = async () => {
  if (!store.isLogged) return;
  const text = composerText.value.trim();
  if (!text) return;
  composerText.value = "";
  await nextTick();
  try {
    const res = await fetch("/api/transfer/text", {
      method: "POST",
      headers: store.getHeaders(),
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    const item = data.item as TransferItem;
    if (item && !items.value.some((x) => x.id === item.id)) {
      items.value = [item, ...items.value].slice(0, 200);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    error.value = msg || "发送失败";
  } finally {
    composerRef.value?.focus();
  }
};

const openPreview = async (item: TransferItem) => {
  previewItem.value = item;
  previewOpen.value = true;
  if (item.type === "file") {
    await ensureBlobUrl(item.id, item.file.url);
  }
};

const closePreview = () => {
  previewOpen.value = false;
  previewItem.value = null;
};

const ensureBlobUrl = async (id: string, url: string) => {
  if (blobUrlById.value[id]) return blobUrlById.value[id]!;
  const headers = authHeaderOnly();
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  blobUrlById.value = { ...blobUrlById.value, [id]: objectUrl };
  return objectUrl;
};

const downloadItem = async (item?: TransferItem | null) => {
  if (!item || item.type !== "file") return;
  if (isMobile.value && item.file.size >= LARGE_DOWNLOAD_CONFIRM_BYTES) {
    const ok = confirm(
      `检测到文件较大（${formatBytes(item.file.size)}），可能耗时且占用较多流量/内存，是否继续下载？`,
    );
    if (!ok) return;
  }

  try {
    const tokenRes = await fetch("/api/transfer/download-token", {
      method: "POST",
      headers: store.getHeaders(),
      body: JSON.stringify({ url: item.file.url }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (tokenRes.ok && tokenData.success && typeof tokenData.token === "string") {
      const a = document.createElement("a");
      a.href = `${item.file.url}?download=1&token=${encodeURIComponent(tokenData.token)}`;
      a.download = item.file.name || "download";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
  } catch {
    // ignore and fallback
  }

  const headers = authHeaderOnly();
  const res = await fetch(`${item.file.url}?download=1`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = item.file.name || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const deleteItem = async (id: string) => {
  if (!store.isLogged) return;
  try {
    const headers = authHeaderOnly();
    const res = await fetch(`/api/transfer/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
    items.value = items.value.filter((x) => x.id !== id);
    selectedIds.value = Object.fromEntries(
      Object.entries(selectedIds.value).filter(([k]) => k !== id),
    );
    const url = blobUrlById.value[id];
    if (url) {
      URL.revokeObjectURL(url);
      const next = { ...blobUrlById.value };
      delete next[id];
      blobUrlById.value = next;
    }
    if (previewItem.value?.id === id) closePreview();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    error.value = msg || "删除失败";
  }
};

const deleteSelected = async () => {
  const ids = Object.entries(selectedIds.value)
    .filter(([, v]) => v)
    .map(([k]) => k);
  for (const id of ids) {
    await deleteItem(id);
  }
};

watch(
  () => [store.isLogged, activeTab.value],
  async () => {
    selectedIds.value = {};
    if (store.isLogged) {
      await fetchItems();
      if (activeTab.value === "chat") {
        scrollToBottom();
      }
    }
  },
  { immediate: true },
);

watch(
  () => [activeTab.value, items.value],
  async ([tab]) => {
    if (!store.isLogged) return;
    if (tab !== "photos" && tab !== "chat" && tab !== "files") return;
    await nextTick();
    const photoItems = items.value.filter(
      (x): x is Extract<TransferItem, { type: "file" }> =>
        x.type === "file" && String(x.file.type || "").startsWith("image/"),
    );
    for (const it of photoItems) {
      try {
        await ensureBlobUrl(it.id, it.file.url);
      } catch {
        // ignore
      }
    }
  },
);

onMounted(() => {
  document.addEventListener("paste", onPaste);
  document.addEventListener("keydown", onDocKeyDown);
  document.addEventListener("pointerdown", onDocPointerDownCapture, true);

  socket.value = io();
  socket.value.on("transfer:update", onTransferUpdate);
});

onBeforeUnmount(() => {
  document.removeEventListener("paste", onPaste);
  document.removeEventListener("keydown", onDocKeyDown);
  document.removeEventListener("pointerdown", onDocPointerDownCapture, true);

  if (socket.value) {
    socket.value.off("transfer:update", onTransferUpdate);
    socket.value.close();
  }

  queue.value.forEach((q) => pauseUpload(q));
  for (const url of Object.values(blobUrlById.value)) URL.revokeObjectURL(url);
});
</script>

<template>
  <div
    class="w-full h-full rounded-2xl backdrop-blur border border-white/10 overflow-hidden flex flex-col text-white relative transition-shadow"
    :class="isDragOver ? 'shadow-[0_0_0_2px_rgba(96,165,250,0.55)]' : ''"
    :style="{
      backgroundColor: `rgba(0,0,0,${Math.min(0.85, Math.max(0.15, widget.opacity ?? 0.35))})`,
      color: '#fff',
    }"
    @drop="onDrop"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
  >
    <div
      v-if="isDragOver"
      class="absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
    >
      <div
        class="w-[92%] h-[92%] rounded-2xl border-2 border-dashed border-blue-300/70 bg-blue-500/10 backdrop-blur-sm flex items-center justify-center"
      >
        <div class="text-sm font-bold text-white/90">松开鼠标即可上传</div>
      </div>
    </div>

    <div v-if="!isSmallLayout" class="border-b border-white/10 px-3 py-2">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-tight">
        <div class="text-sm font-bold text-white">文件传输助手</div>
        <div class="text-[11px] text-white/70">支持拖拽、多选、断点续传</div>
      </div>

      <div class="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-1 bg-white/10 rounded-xl p-1 border border-white/10">
          <button
            @click="activeTab = 'chat'"
            class="px-2.5 py-1 text-xs rounded-lg font-medium"
            :class="activeTab === 'chat' ? 'bg-white/20 text-white shadow-sm' : 'text-white/70'"
          >
            聊天
          </button>
          <button
            @click="activeTab = 'files'"
            class="px-2.5 py-1 text-xs rounded-lg font-medium"
            :class="activeTab === 'files' ? 'bg-white/20 text-white shadow-sm' : 'text-white/70'"
          >
            文件
          </button>
          <button
            @click="activeTab = 'photos'"
            class="px-2.5 py-1 text-xs rounded-lg font-medium"
            :class="activeTab === 'photos' ? 'bg-white/20 text-white shadow-sm' : 'text-white/70'"
          >
            图片
          </button>
        </div>

        <div class="flex items-center gap-2">
          <input
            ref="fileInputRef"
            type="file"
            multiple
            class="hidden"
            @change="onFileInputChange"
          />
          <button
            class="px-3 py-1.5 text-xs font-bold rounded-lg transition-colors"
            :class="
              store.isLogged
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-white/10 text-white/40 cursor-not-allowed'
            "
            :disabled="!store.isLogged"
            @click="openFilePicker"
          >
            添加文件
          </button>
          <button
            v-if="activeTab === 'files' && selectedCount > 0"
            class="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500/20 text-red-100 hover:bg-red-500/30"
            @click="deleteSelected"
          >
            删除选中 ({{ selectedCount }})
          </button>
        </div>
      </div>
    </div>

    <div v-if="queue.length" class="px-3 py-2 border-b border-white/10 space-y-2">
      <div
        v-for="q in queue"
        :key="q.id"
        class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-white truncate">
              {{ q.file.name }}
            </div>
            <div class="text-[11px] text-white/60 shrink-0">
              {{ formatBytes(q.file.size) }}
            </div>
          </div>
          <div class="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              class="h-full bg-blue-500 rounded-full transition-[width]"
              :style="{ width: `${Math.round((q.progress || 0) * 100)}%` }"
            ></div>
          </div>
          <div class="mt-1 flex items-center justify-between">
            <div class="text-[11px] text-white/60">
              {{
                q.status === "uploading"
                  ? "上传中"
                  : q.status === "paused"
                    ? "已暂停"
                    : q.status === "failed"
                      ? "失败"
                      : q.status === "completed"
                        ? "完成"
                        : "等待中"
              }}
              <span v-if="q.error" class="text-red-200 ml-2">{{ q.error }}</span>
            </div>
            <div class="flex items-center gap-1">
              <button
                v-if="q.status === 'uploading'"
                class="px-2 py-1 text-[11px] rounded-lg bg-white/10 text-white hover:bg-white/15"
                @click="pauseUpload(q)"
              >
                暂停
              </button>
              <button
                v-if="q.status === 'paused' || q.status === 'failed'"
                class="px-2 py-1 text-[11px] rounded-lg bg-blue-500/20 text-blue-100 hover:bg-blue-500/30"
                @click="resumeUpload(q)"
              >
                继续
              </button>
              <button
                class="px-2 py-1 text-[11px] rounded-lg bg-red-500/20 text-red-100 hover:bg-red-500/30"
                @click="removeQueueItem(q)"
              >
                移除
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <teleport to="body">
      <div
        v-if="contextMenuOpen"
        data-transfer-context-menu
        class="fixed z-[10001] w-48 rounded-xl border border-white/10 bg-black/70 backdrop-blur shadow-xl overflow-hidden"
        :style="{ left: `${contextMenuX}px`, top: `${contextMenuY}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          v-if="contextMenuTargetId && findItemById(contextMenuTargetId)?.type === 'text'"
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            async () => {
              const id = contextMenuTargetId;
              const it = id ? findItemById(id) : null;
              closeContextMenu();
              if (it && it.type === 'text') {
                await copyToClipboard(it.content);
              }
            }
          "
        >
          复制
        </button>
        <button
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors"
          :class="store.isLogged ? 'text-white' : 'text-white/40 cursor-not-allowed'"
          :disabled="!store.isLogged"
          @click="
            () => {
              closeContextMenu();
              openFilePicker();
            }
          "
        >
          添加文件
        </button>
        <button
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            () => {
              closeContextMenu();
              toggleMultiSelectMode();
            }
          "
        >
          {{ multiSelectMode ? "退出多选" : "多选" }}
        </button>
        <button
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors"
          :class="selectedCount > 0 ? 'text-white' : 'text-white/40 cursor-not-allowed'"
          :disabled="selectedCount === 0"
          @click="
            async () => {
              closeContextMenu();
              await deleteSelected();
            }
          "
        >
          删除选中 ({{ selectedCount }})
        </button>
        <button
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors"
          :class="selectedCount > 0 ? 'text-white' : 'text-white/40 cursor-not-allowed'"
          :disabled="selectedCount === 0"
          @click="
            () => {
              closeContextMenu();
              clearSelection();
            }
          "
        >
          清空选择
        </button>

        <div v-if="contextMenuTargetId" class="h-px bg-white/10"></div>

        <button
          v-if="contextMenuTargetId"
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            () => {
              const id = contextMenuTargetId;
              closeContextMenu();
              if (id) toggleSelected(id);
            }
          "
        >
          {{ contextMenuTargetId && selectedIds[contextMenuTargetId] ? "取消选择" : "选择" }}
        </button>
        <button
          v-if="contextMenuTargetId"
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            async () => {
              const id = contextMenuTargetId;
              closeContextMenu();
              if (id) await deleteItem(id);
            }
          "
        >
          删除此条
        </button>
        <button
          v-if="contextMenuTargetId && findItemById(contextMenuTargetId)?.type === 'file'"
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            async () => {
              const id = contextMenuTargetId;
              const it = id ? findItemById(id) : null;
              closeContextMenu();
              if (it && it.type === 'file') openPreview(it);
            }
          "
        >
          预览
        </button>
        <button
          v-if="contextMenuTargetId && findItemById(contextMenuTargetId)?.type === 'file'"
          class="w-full text-left px-2.5 py-1.5 text-[13px] hover:bg-white/10 transition-colors text-white"
          @click="
            async () => {
              const id = contextMenuTargetId;
              const it = id ? findItemById(id) : null;
              closeContextMenu();
              if (it && it.type === 'file') await downloadItem(it);
            }
          "
        >
          下载
        </button>
      </div>
    </teleport>

    <div class="flex-1 min-h-0 overflow-hidden">
      <div v-if="!store.isLogged" class="h-full flex items-center justify-center text-white/70">
        <div class="text-center px-6">
          <div class="text-3xl mb-2">🔒</div>
          <div class="text-sm font-bold text-white">登录后使用文件传输助手</div>
          <div class="text-xs text-white/60 mt-1">
            数据将持久化存储在服务端 `server/doc/transfer/`
          </div>
        </div>
      </div>

      <div v-else class="h-full flex flex-col">
        <div
          v-if="error"
          class="px-3 py-2 text-xs text-red-100 bg-red-500/20 border-b border-red-500/20"
        >
          {{ error }}
        </div>

        <div v-if="loading" class="px-3 py-2 text-xs text-white/60">加载中...</div>

        <div
          v-else
          ref="scrollContainerRef"
          class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 scrollbar-glass"
          @wheel="handleScrollIsolation"
          @contextmenu.prevent.stop="onListContextMenu"
        >
          <template v-if="activeTab === 'chat'">
            <div v-if="!groupedChatItems.length" class="text-center text-white/70 text-sm py-10">
              <div class="text-3xl mb-2">💬</div>
              <div class="font-bold text-white">把文件和文字发到这里</div>
              <div class="text-xs text-white/60 mt-1">支持拖拽上传；支持复制粘贴图片/文件</div>
            </div>

            <div v-else class="space-y-2">
              <div v-for="g in groupedChatItems" :key="g.key" class="space-y-1.5">
                <div class="flex justify-center">
                  <div
                    class="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[10px] text-white/60"
                  >
                    {{ formatGroupTime(g.timestamp) }}
                  </div>
                </div>

                <div v-for="it in g.items" :key="it.id" class="flex">
                  <div
                    v-if="it.type === 'text'"
                    class="max-w-[90%] rounded-xl bg-white/10 text-white border border-white/10 transition-shadow select-text"
                    :class="[
                      selectedIds[it.id] ? 'shadow-[0_0_0_2px_rgba(96,165,250,0.55)]' : '',
                      isSmallLayout ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm',
                    ]"
                    :data-transfer-id="it.id"
                    @click="onChatItemClick(it)"
                    @contextmenu.prevent.stop="
                      (e) => openContextMenuAt(e.clientX, e.clientY, it.id)
                    "
                    @pointerdown="(e) => onChatItemPointerDown(e, it.id)"
                    @pointermove="onChatItemPointerMove"
                    @pointerup="onChatItemPointerUp"
                    @pointercancel="onChatItemPointerUp"
                    @touchstart="(e) => onChatItemTouchStart(e, it.id)"
                    @touchmove="onChatItemTouchMove"
                    @touchend="onChatItemTouchEnd"
                    @touchcancel="onChatItemTouchEnd"
                  >
                    <div class="whitespace-pre-wrap break-words">
                      <template v-for="(p, idx) in toLinkifiedParts(it.content)" :key="idx">
                        <a
                          v-if="p.kind === 'link'"
                          :href="p.href"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-blue-200 underline underline-offset-2 hover:text-blue-100"
                          @click.stop
                          >{{ p.text }}</a
                        >
                        <span v-else>{{ p.text }}</span>
                      </template>
                    </div>
                  </div>

                  <button
                    v-else
                    class="max-w-[90%] text-left rounded-xl bg-white/10 hover:bg-white/15 transition-colors border border-white/10 transition-shadow select-none"
                    :class="[
                      selectedIds[it.id] ? 'shadow-[0_0_0_2px_rgba(96,165,250,0.55)]' : '',
                      isSmallLayout ? 'px-2 py-1.5' : 'px-3 py-2',
                    ]"
                    :data-transfer-id="it.id"
                    style="-webkit-touch-callout: none"
                    @click="onChatItemClick(it)"
                    @contextmenu.prevent.stop="
                      (e) => openContextMenuAt(e.clientX, e.clientY, it.id)
                    "
                    @pointerdown="(e) => onChatItemPointerDown(e, it.id)"
                    @pointermove="onChatItemPointerMove"
                    @pointerup="onChatItemPointerUp"
                    @pointercancel="onChatItemPointerUp"
                    @touchstart="(e) => onChatItemTouchStart(e, it.id)"
                    @touchmove="onChatItemTouchMove"
                    @touchend="onChatItemTouchEnd"
                    @touchcancel="onChatItemTouchEnd"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/10 overflow-hidden"
                      >
                        <img
                          v-if="
                            String(it.file.type || '').startsWith('image/') && blobUrlById[it.id]
                          "
                          :src="blobUrlById[it.id]"
                          class="w-full h-full object-cover"
                        />
                        <span v-else>
                          {{ String(it.file.type || "").startsWith("image/") ? "🖼️" : "📄" }}
                        </span>
                      </div>
                      <div class="min-w-0">
                        <div
                          class="font-bold text-white truncate"
                          :class="isSmallLayout ? 'text-xs' : 'text-sm'"
                        >
                          {{ it.file.name }}
                        </div>
                        <div class="text-[11px] text-white/60">{{ formatBytes(it.file.size) }}</div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="activeTab === 'files'">
            <div v-if="!items.length" class="text-center text-white/70 text-sm py-10">
              <div class="text-3xl mb-2">📁</div>
              <div class="font-bold text-white">暂无文件</div>
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="it in items"
                :key="it.id"
                class="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors px-3 py-2 flex items-center gap-3"
              >
                <input
                  v-if="it.type === 'file'"
                  type="checkbox"
                  class="accent-blue-600"
                  :checked="!!selectedIds[it.id]"
                  @change="
                    (e) => {
                      selectedIds[it.id] = (e.target as HTMLInputElement).checked;
                    }
                  "
                />
                <div
                  class="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden"
                >
                  <img
                    v-if="
                      it.type === 'file' &&
                      String(it.file.type || '').startsWith('image/') &&
                      blobUrlById[it.id]
                    "
                    :src="blobUrlById[it.id]"
                    class="w-full h-full object-cover"
                  />
                  <span
                    v-else-if="
                      it.type === 'file' && String(it.file.type || '').startsWith('image/')
                    "
                    >🖼️</span
                  >
                  <span v-else>📄</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-bold text-white truncate">
                    {{ it.type === "file" ? it.file.name : "" }}
                  </div>
                  <div class="text-[11px] text-white/60">
                    {{ it.type === "file" ? formatBytes(it.file.size) : "" }} ·
                    {{ formatTime(it.timestamp) }}
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    v-if="it.type === 'file'"
                    class="px-2 py-1 text-[11px] rounded-lg bg-white/10 text-white hover:bg-white/15"
                    @click="openPreview(it)"
                  >
                    预览
                  </button>
                  <button
                    v-if="it.type === 'file'"
                    class="px-2 py-1 text-[11px] rounded-lg bg-white/10 text-white hover:bg-white/15"
                    @click="
                      async () => {
                        try {
                          await downloadItem(it);
                        } catch (e) {
                          error = (e as Error).message || '下载失败';
                        }
                      }
                    "
                  >
                    下载
                  </button>
                  <button
                    class="px-2 py-1 text-[11px] rounded-lg bg-red-500/20 text-red-100 hover:bg-red-500/30"
                    @click="deleteItem(it.id)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-if="!items.length" class="text-center text-white/70 text-sm py-10">
              <div class="text-3xl mb-2">🖼️</div>
              <div class="font-bold text-white">暂无图片</div>
            </div>

            <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-2">
              <button
                v-for="it in items"
                :key="it.id"
                class="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 overflow-hidden aspect-square flex items-center justify-center"
                @click="openPreview(it)"
              >
                <img
                  v-if="it.type === 'file' && blobUrlById[it.id]"
                  :src="blobUrlById[it.id]"
                  class="w-full h-full object-cover"
                  :alt="it.file.name"
                />
                <div v-else class="text-white/60 text-sm">加载中...</div>
              </button>
            </div>
          </template>
        </div>

        <div
          v-if="activeTab === 'chat'"
          class="border-t border-white/10"
          :class="isSmallLayout ? 'p-1' : 'p-3'"
        >
          <div :class="isSmallLayout ? 'relative block' : 'flex items-end gap-2'">
            <textarea
              ref="composerRef"
              v-model="composerText"
              rows="1"
              :placeholder="isSmallLayout ? '粘贴/拖入 (Shift+Enter)' : 'Shift+Enter 换行'"
              class="resize-none rounded-xl border border-white/20 bg-white/10 outline-none text-white placeholder-white/50 focus:border-blue-400"
              :class="
                isSmallLayout
                  ? 'w-full pr-8 pl-2 py-1 text-xs scrollbar-hide'
                  : 'flex-1 px-3 py-2 text-sm'
              "
              @keydown.enter.prevent="
                (e) => {
                  if ((e as KeyboardEvent).shiftKey) {
                    composerText += '\n';
                    return;
                  }
                  sendText();
                }
              "
            ></textarea>
            <button
              v-if="isSmallLayout"
              class="absolute right-1 bottom-1 p-1 text-blue-400 hover:text-blue-300 transition-colors"
              @click="sendText"
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
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
            <button
              v-else
              class="px-3 py-2 text-xs font-bold rounded-xl bg-blue-500 text-white hover:bg-blue-600"
              @click="sendText"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="previewOpen && previewItem"
        class="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        @click="closePreview"
      >
        <div
          class="w-full max-w-3xl rounded-2xl bg-black/50 backdrop-blur border border-white/10 shadow-xl overflow-hidden text-white"
          @click.stop
        >
          <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div class="min-w-0">
              <div class="text-sm font-bold text-white truncate">
                {{ previewItem.type === "file" ? previewItem.file.name : "预览" }}
              </div>
              <div v-if="previewItem.type === 'file'" class="text-[11px] text-white/60">
                {{ formatBytes(previewItem.file.size) }} · {{ previewItem.file.type || "unknown" }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="previewItem.type === 'file'"
                class="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/15"
                @click="
                  async () => {
                    try {
                      await downloadItem(previewItem);
                    } catch (e) {
                      error = (e as Error).message || '下载失败';
                    }
                  }
                "
              >
                下载
              </button>
              <button
                class="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500/20 text-red-100 hover:bg-red-500/30"
                @click="
                  async () => {
                    await deleteItem(previewItem!.id);
                  }
                "
              >
                删除
              </button>
              <button
                class="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-500 text-white hover:bg-blue-600"
                @click="closePreview"
              >
                关闭
              </button>
            </div>
          </div>

          <div class="p-4">
            <div v-if="previewItem.type === 'file'">
              <img
                v-if="
                  String(previewItem.file.type || '').startsWith('image/') &&
                  blobUrlById[previewItem.id]
                "
                :src="blobUrlById[previewItem.id]"
                class="max-h-[70vh] w-full object-contain rounded-xl bg-white/5 border border-white/10"
                :alt="previewItem.file.name"
              />
              <div
                v-else
                class="rounded-xl bg-white/5 border border-white/10 p-4 text-sm text-white/80"
              >
                该文件类型暂不支持直接预览，请使用“下载”。
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
