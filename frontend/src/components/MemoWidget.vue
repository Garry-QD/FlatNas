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

// State
const mode = ref<"simple" | "rich">("simple");
const localData = ref(""); // Stores HTML for rich mode or text for simple mode
const editorRef = ref<InstanceType<typeof MemoEditor> | null>(null);
const isEditing = ref(false);
const localUpdatedAt = ref(0);
const lastInputAt = ref(0);
const isSaving = ref(false); // 保存中标志，防止数据被覆盖

// Persistence
const { saveToIndexedDB, loadFromIndexedDB, status, progress, saveVersionSnapshot, loadVersions, deleteVersion } =
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

const triggerSave = async () => {
  await saveVersionSnapshot(true);
  await saveToIndexedDB();
  await refreshVersions();
  if (status.value === "success") {
    // Triple Feedback 2: Toast
    toastMessage.value = "已保存，刷新不丢失";
    showToast.value = true;
    setTimeout(() => (showToast.value = false), 3000);
  }
  saveToServer(true);
};

const toggleMode = () => {
  mode.value = mode.value === "simple" ? "rich" : "simple";
  const payload = buildPayload();
  localUpdatedAt.value = payload.updatedAt;
  saveToServer(true);
  if (store.isLogged) {
    store.socket?.emit("memo:update", {
      token: store.token || localStorage.getItem("flat-nas-token"),
      widgetId: props.widget.id,
      content: payload,
    });
  }
};

const parsePayload = (payload: WidgetConfig["data"]) => {
  let content = "";
  let payloadMode: "simple" | "rich" = mode.value;
  let updatedAt = 0;

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
    if (data.mode === "simple" || data.mode === "rich") {
      payloadMode = data.mode;
    }
    if (typeof data.updatedAt === "number") {
      updatedAt = data.updatedAt;
    }
  }

  return { content, mode: payloadMode, updatedAt };
};

const buildPayload = () => ({
  content: localData.value,
  mode: mode.value,
  updatedAt: Date.now(),
});

let serverSaveTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

const saveToServer = (immediate = false) => {
  if (!store.isLogged) return;
  const doSave = async () => {
    isSaving.value = true;
    const payload = buildPayload();
    localUpdatedAt.value = payload.updatedAt;
    try {
      // 使用新的版本控制API（Last-Write-Wins模式）
      const response = await fetch(`/api/widgets/v2/${props.widget.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          data: payload,
          version: 0, // Last-Write-Wins：版本号不重要
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // 通过 Socket.IO 通知其他设备
        if (store.socket) {
          store.socket.emit("memo:update", {
            token: store.token || localStorage.getItem("flat-nas-token"),
            widgetId: props.widget.id,
            content: payload,
          });
        }
      }
    } catch (error) {
      console.error('保存失败:', error);
    } finally {
      setTimeout(() => {
        isSaving.value = false;
      }, 500);
    }
  };

  if (immediate) {
    doSave();
    return;
  }

  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    serverSaveTimer = null;
    doSave();
  }, 800);
};

// Socket.IO 监听远程更新
const applyRemotePayload = (payload: WidgetConfig["data"]) => {
  const parsed = parsePayload(payload);
  if (!parsed.content) return;

  // 如果正在保存，忽略远程更新
  if (isSaving.value) return;

  // 如果正在编辑，忽略远程更新（避免打断用户）
  if (isEditing.value) return;

  // 如果内容相同，不更新
  if (parsed.content === localData.value && parsed.mode === mode.value) return;

  // 应用远程更新
  localData.value = parsed.content;
  mode.value = parsed.mode;
  localUpdatedAt.value = parsed.updatedAt || Date.now();
};

const handleInputActivity = () => {
  lastInputAt.value = Date.now();
  // 用户输入时，通过Socket.IO广播更新
  if (store.isLogged && store.socket) {
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      const payload = buildPayload();
      store.socket?.emit("memo:update", {
        token: store.token || localStorage.getItem("flat-nas-token"),
        widgetId: props.widget.id,
        content: payload,
      });
    }, 300);
  }
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
  localUpdatedAt.value = Date.now();
  await saveToIndexedDB();
  saveToServer(true);
};

const applyVersion = async (version: MemoVersion) => {
  localData.value = version.content;
  mode.value = version.mode;
  localUpdatedAt.value = Date.now();
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

// Initial Load
loadFromIndexedDB().then(async () => {
  if (!localData.value && props.widget.data) {
     // Fallback to widget prop data if IDB is empty
     if (typeof props.widget.data === 'string') {
        localData.value = props.widget.data;
     } else {
        const d = props.widget.data as { rich?: string; simple?: string; mode?: "simple" | "rich" };
        localData.value = d.rich || d.simple || "";
        mode.value = d.mode || "simple";
     }
     localUpdatedAt.value = Date.now();
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
  }, 800);
});

watch(
  () => props.widget.data,
  (data) => {
    if (!data) return;
    applyRemotePayload(data);
  }
);

watch(historyVersions, () => {
  if (selectedVersionId.value === "new") return;
  const exists = historyVersions.value.some((v) => v.id === selectedVersionId.value);
  if (!exists) selectedVersionId.value = "new";
});

onMounted(() => {
  document.addEventListener("pointerdown", handleDocPointerDown);
  refreshVersions();
});

onUnmounted(() => {
  if (serverSaveTimer) clearTimeout(serverSaveTimer);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (broadcastTimer) clearTimeout(broadcastTimer);
  document.removeEventListener("pointerdown", handleDocPointerDown);
});

const handleFocus = () => {
  isEditing.value = true;
};

const handleBlur = () => {
  isEditing.value = false;
};

</script>

<template>
  <div
    class="w-full h-full rounded-2xl backdrop-blur border border-white/10 relative group flex flex-col transition-colors duration-300 overflow-hidden"
    :class="mode === 'simple' ? 'p-0' : 'p-4'"
    :style="containerStyle"
  >
    <!-- Triple Feedback 3: Top Progress Bar -->
    <div 
      v-if="progress > 0" 
      class="absolute top-0 left-0 h-1 bg-[#0052D9] transition-all duration-300 rounded-t-2xl z-20"
      :style="{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }"
    ></div>

    <!-- Page Curl Toggle -->
    <div 
      class="absolute top-0 left-0 w-3 h-3 cursor-pointer z-50 overflow-hidden group/curl"
      @click="toggleMode"
      title="切换模式 (Switch Mode)"
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
        title="保存 (Save)"
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
