<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useMainStore } from "../stores/main";
import { VueDraggable } from "vue-draggable-plus";

defineProps<{
  show: boolean;
  title?: string;
}>();

const emit = defineEmits(["update:show", "select"]);
const store = useMainStore();

const activeTab = ref<"pc" | "mobile" | "api">("pc");
const wallpapers = ref<string[]>([]);
const mobileWallpapers = ref<string[]>([]);
const loading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// Confirm Modal State
const showConfirmModal = ref(false);
const confirmMessage = ref("");
const confirmAction = ref<() => void>(() => {});

const closeConfirmModal = () => {
  showConfirmModal.value = false;
};

const handleConfirm = () => {
  confirmAction.value();
  closeConfirmModal();
};

const pcListEndpoint = computed(() => store.appConfig.wallpaperApiPcList || "/api/backgrounds");
const mobileListEndpoint = computed(
  () => store.appConfig.wallpaperApiMobileList || "/api/mobile_backgrounds",
);

const fetchWallpapers = async () => {
  loading.value = true;
  try {
    const res = await fetch(pcListEndpoint.value);
    if (res.ok) {
      wallpapers.value = await res.json();
    }
    const resMobile = await fetch(mobileListEndpoint.value);
    if (resMobile.ok) {
      mobileWallpapers.value = await resMobile.json();
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
};

const getUrl = (name: string, type: "pc" | "mobile") => {
  const base =
    type === "pc"
      ? store.appConfig.wallpaperPcImageBase || "/backgrounds"
      : store.appConfig.wallpaperMobileImageBase || "/mobile_backgrounds";
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}/${encodeURIComponent(name)}`;
};

const selectWallpaper = (name: string, type: "pc" | "mobile") => {
  if (setWallpaper(name, type)) {
    const url = getUrl(name, type);
    emit("select", { url, type });
    emit("update:show", false);
  }
};

const setWallpaper = (name: string, type: "pc" | "mobile") => {
  const url = getUrl(name, type);
  if (type === "pc") {
    store.appConfig.background = url;
  } else {
    store.appConfig.mobileBackground = url;
  }
  return true;
};

const draggableList = computed({
  get() {
    const list = activeTab.value === "pc" ? [...wallpapers.value] : [...mobileWallpapers.value];
    const currentBg =
      activeTab.value === "pc" ? store.appConfig.background : store.appConfig.mobileBackground;

    const type: "pc" | "mobile" = activeTab.value === "pc" ? "pc" : "mobile";
    const index = list.findIndex((name) => getUrl(name, type) === currentBg);
    if (index > -1) {
      const [item] = list.splice(index, 1);
      if (item) list.unshift(item);
    }
    return list;
  },
  set(val) {
    if (activeTab.value === "pc") {
      wallpapers.value = val;
    } else {
      mobileWallpapers.value = val;
    }

    const first = val[0];
    if (first) {
      const type: "pc" | "mobile" = activeTab.value === "pc" ? "pc" : "mobile";
      const currentBg =
        type === "pc" ? store.appConfig.background : store.appConfig.mobileBackground;
      const firstUrl = getUrl(first, type);

      if (firstUrl !== currentBg) {
        setWallpaper(first, type);
      }
    }
  },
});

const triggerUpload = () => {
  fileInput.value?.click();
};

const pendingFiles = ref<File[]>([]);

const handleUpload = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  pendingFiles.value = Array.from(input.files);

  // Check file size
  const hasLargeFile = pendingFiles.value.some((f) => f.size > 10 * 1024 * 1024);

  if (hasLargeFile) {
    confirmMessage.value = "检测到文件超过 10MB，可能导致内存占用过高，是否继续上传？";
    confirmAction.value = executeUpload;
    showConfirmModal.value = true;
  } else {
    executeUpload();
  }

  // Clear input so same file can be selected again
  input.value = "";
};

const executeUpload = async () => {
  if (pendingFiles.value.length === 0) return;

  uploading.value = true;
  const formData = new FormData();
  pendingFiles.value.forEach((file) => {
    formData.append("files", file);
  });

  // Determine endpoint based on active tab
  const endpoint =
    activeTab.value === "pc"
      ? store.appConfig.wallpaperApiPcUpload || "/api/backgrounds/upload"
      : store.appConfig.wallpaperApiMobileUpload || "/api/mobile_backgrounds/upload";

  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: formData,
    });

    if (res.ok) {
      await fetchWallpapers();
    } else {
      alert("上传失败");
    }
  } catch (e) {
    console.error(e);
    alert("上传出错");
  } finally {
    uploading.value = false;
    pendingFiles.value = [];
  }
};

const handleDelete = (name: string, type: "pc" | "mobile") => {
  confirmMessage.value = "确定要删除这张壁纸吗？";
  confirmAction.value = () => executeDelete(name, type);
  showConfirmModal.value = true;
};

const executeDelete = async (name: string, type: "pc" | "mobile") => {
  const base =
    type === "pc"
      ? store.appConfig.wallpaperApiPcDeleteBase || "/api/backgrounds"
      : store.appConfig.wallpaperApiMobileDeleteBase || "/api/mobile_backgrounds";
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const endpoint = `${trimmed}/${encodeURIComponent(name)}`;

  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(endpoint, {
      method: "DELETE",
      headers,
    });

    if (res.ok) {
      if (type === "pc") {
        wallpapers.value = wallpapers.value.filter((w) => w !== name);
      } else {
        mobileWallpapers.value = mobileWallpapers.value.filter((w) => w !== name);
      }
    } else {
      alert("删除失败");
    }
  } catch (e) {
    console.error(e);
  }
};

// Rotation Logic Helpers
const currentRotationEnabled = computed({
  get: () =>
    activeTab.value === "pc" ? store.appConfig.pcRotation : store.appConfig.mobileRotation,
  set: (val) => {
    if (activeTab.value === "pc") store.appConfig.pcRotation = val;
    else store.appConfig.mobileRotation = val;
  },
});

const currentRotationInterval = computed({
  get: () =>
    activeTab.value === "pc"
      ? (store.appConfig.pcRotationInterval ?? 30)
      : (store.appConfig.mobileRotationInterval ?? 30),
  set: (val) => {
    if (activeTab.value === "pc") store.appConfig.pcRotationInterval = val;
    else store.appConfig.mobileRotationInterval = val;
  },
});

const currentRotationMode = computed({
  get: () =>
    activeTab.value === "pc"
      ? (store.appConfig.pcRotationMode ?? "random")
      : (store.appConfig.mobileRotationMode ?? "random"),
  set: (val) => {
    if (activeTab.value === "pc") store.appConfig.pcRotationMode = val;
    else store.appConfig.mobileRotationMode = val;
  },
});

const toggleRotation = () => {
  currentRotationEnabled.value = !currentRotationEnabled.value;
};

const togglePlayMode = () => {
  currentRotationMode.value = currentRotationMode.value === "random" ? "sequential" : "random";
};

onMounted(() => {
  fetchWallpapers();
});
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    @click.self="$emit('update:show', false)"
  >
    <div
      class="bg-white md:rounded-2xl shadow-2xl w-full md:max-w-5xl h-full md:h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200"
    >
      <!-- Header -->
      <div
        class="px-4 py-3 md:px-6 md:py-4 border-b border-gray-100 flex justify-between items-center bg-white"
      >
        <div class="flex items-center gap-4">
          <h3 class="text-lg font-bold text-gray-800">
            {{ title || "壁纸库" }}
          </h3>

          <div class="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              @click="activeTab = 'pc'"
              class="px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2"
              :class="
                activeTab === 'pc'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              "
            >
              PC 壁纸
              <span class="px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[10px]">{{
                wallpapers.length
              }}</span>
            </button>
            <button
              @click="activeTab = 'mobile'"
              class="px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2"
              :class="
                activeTab === 'mobile'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              "
            >
              手机壁纸
              <span class="px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[10px]">{{
                mobileWallpapers.length
              }}</span>
            </button>
            <button
              @click="activeTab = 'api'"
              class="px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2"
              :class="
                activeTab === 'api'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              "
            >
              API 接口
            </button>
          </div>
        </div>

        <button
          @click="$emit('update:show', false)"
          class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
        >
          ✕
        </button>
      </div>

      <!-- Toolbar -->
      <div
        class="px-4 py-3 md:px-6 bg-white border-b border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-0"
      >
        <div class="text-xs text-gray-400 hidden md:block">请拖动选择</div>
        <div class="flex flex-wrap gap-2 md:gap-3 items-center w-full md:w-auto">
          <!-- Rotation Controls -->
          <div
            class="flex items-center gap-2 mr-2 bg-gray-50 p-1 rounded-lg border border-gray-100"
          >
            <button
              @click="togglePlayMode"
              class="px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1"
              :class="
                currentRotationMode === 'random'
                  ? 'text-purple-600 bg-purple-50'
                  : 'text-blue-600 bg-blue-50'
              "
              :title="currentRotationMode === 'random' ? '当前：随机播放' : '当前：顺序播放'"
            >
              <span>{{ currentRotationMode === "random" ? "随机" : "顺播" }}</span>
            </button>
            <div class="h-4 w-px bg-gray-300"></div>
            <div class="flex items-center gap-1 px-1">
              <button
                @click="toggleRotation"
                class="text-xs font-medium transition-colors flex items-center gap-1 px-2 py-1 rounded"
                :class="
                  currentRotationEnabled
                    ? 'bg-green-100 text-green-700'
                    : 'text-gray-600 hover:bg-white'
                "
              >
                <span>{{ currentRotationEnabled ? "轮播中" : "点击轮播" }}</span>
              </button>
              <input
                v-if="!currentRotationEnabled"
                type="number"
                v-model="currentRotationInterval"
                min="5"
                class="w-10 text-xs border border-gray-200 rounded px-1 py-0.5 text-center outline-none focus:border-blue-500"
                title="轮播间隔(分钟)"
              />
              <span v-if="!currentRotationEnabled" class="text-[10px] text-gray-400">分</span>
            </div>
          </div>

          <!-- Fixed Background Button -->
          <button
            v-if="!currentRotationEnabled"
            @click="store.appConfig.fixedWallpaper = !store.appConfig.fixedWallpaper"
            class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm"
            :class="
              store.appConfig.fixedWallpaper
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            "
            title="固定当前壁纸，不参与轮播"
          >
            <span>{{ store.appConfig.fixedWallpaper ? "已固定" : "固定" }}</span>
          </button>

          <div
            v-if="activeTab === 'pc'"
            class="flex items-center gap-2 mr-2 bg-gray-50 p-1 rounded-lg border border-gray-100"
          >
            <div class="flex items-center gap-1 px-1">
              <span class="text-[10px] text-gray-500">模糊</span>
              <input
                type="range"
                v-model.number="store.appConfig.backgroundBlur"
                min="0"
                max="20"
                step="1"
                class="w-16 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title="模糊半径"
              />
            </div>
            <div class="w-px h-3 bg-gray-300"></div>
            <div class="flex items-center gap-1 px-1">
              <span class="text-[10px] text-gray-500">遮罩</span>
              <input
                type="range"
                v-model.number="store.appConfig.backgroundMask"
                min="0"
                max="1"
                step="0.1"
                class="w-16 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title="遮罩浓度"
              />
            </div>
          </div>

          <div
            v-if="activeTab === 'mobile'"
            class="flex items-center gap-2 mr-2 bg-gray-50 p-1 rounded-lg border border-gray-100"
          >
            <div class="flex items-center gap-1 px-1">
              <span class="text-[10px] text-gray-500">模糊</span>
              <input
                type="range"
                v-model.number="store.appConfig.mobileBackgroundBlur"
                min="0"
                max="20"
                step="1"
                class="w-16 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title="模糊半径"
              />
            </div>
            <div class="w-px h-3 bg-gray-300"></div>
            <div class="flex items-center gap-1 px-1">
              <span class="text-[10px] text-gray-500">遮罩</span>
              <input
                type="range"
                v-model.number="store.appConfig.mobileBackgroundMask"
                min="0"
                max="1"
                step="0.1"
                class="w-16 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title="遮罩浓度"
              />
            </div>
          </div>

          <button
            v-if="activeTab === 'mobile'"
            @click="store.appConfig.enableMobileWallpaper = !store.appConfig.enableMobileWallpaper"
            class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm"
            :class="
              store.appConfig.enableMobileWallpaper
                ? 'bg-green-500 text-white hover:bg-green-600 shadow-green-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            "
            title="开启后，手机端将优先使用手机壁纸；关闭后，手机端将使用 PC 端壁纸"
          >
            <span>{{
              store.appConfig.enableMobileWallpaper ? "已启用手机壁纸" : "启用手机壁纸"
            }}</span>
          </button>

          <button
            @click="fetchWallpapers"
            class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-1"
          >
            刷新
          </button>
          <button
            @click="triggerUpload"
            class="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-200 transition-all flex items-center gap-1"
            :disabled="uploading"
          >
            <span v-if="uploading">上传中...</span>
            <span v-else>上传壁纸</span>
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            @change="handleUpload"
          />
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div v-if="loading" class="h-full flex flex-col items-center justify-center text-gray-400">
          <div
            class="w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mb-2"
          ></div>
          <span class="text-xs">加载中...</span>
        </div>

        <div
          v-else-if="
            (activeTab === 'pc' && wallpapers.length === 0) ||
            (activeTab === 'mobile' && mobileWallpapers.length === 0)
          "
          class="h-full flex flex-col items-center justify-center text-gray-400"
        >
          <span class="text-4xl mb-2">🖼️</span>
          <span class="text-sm">暂无壁纸，请先上传</span>
        </div>

        <VueDraggable
          v-else-if="activeTab !== 'api'"
          v-model="draggableList"
          class="grid gap-2 md:gap-4"
          :class="
            activeTab === 'pc'
              ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
          "
          :animation="150"
        >
          <div
            v-for="(img, index) in draggableList"
            :key="img"
            class="group relative rounded-xl overflow-hidden cursor-grab border-2 border-transparent hover:border-blue-500 transition-all shadow-sm hover:shadow-md bg-white"
            :class="activeTab === 'pc' ? 'aspect-video' : 'aspect-[9/16]'"
          >
            <img
              :src="getUrl(img, activeTab === 'pc' ? 'pc' : 'mobile')"
              class="w-full h-full object-cover transition-all duration-300 group-hover:scale-110"
              loading="lazy"
            />

            <!-- Mask Overlay for index 0 (Removed for better preview clarity) -->
            <!-- <div
              v-if="index === 0"
              class="absolute inset-0 transition-all duration-300 pointer-events-none"
              :style="{
                backgroundColor: `rgba(0,0,0,${
                  activeTab === 'pc'
                    ? (store.appConfig.backgroundMask ?? 0)
                    : (store.appConfig.mobileBackgroundMask ?? 0)
                })`,
              }"
            ></div> -->

            <!-- Current Wallpaper Badge -->
            <div
              v-if="index === 0"
              class="absolute top-2 left-2 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm z-10 flex items-center gap-1"
            >
              <span>默认壁纸</span>
            </div>

            <!-- Hover Overlay -->
            <div
              class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"
            ></div>

            <!-- Set as Default Overlay -->
            <div
              class="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-bold opacity-0 group-hover:opacity-100 transition-opacity z-10"
              @click="selectWallpaper(img, activeTab === 'pc' ? 'pc' : 'mobile')"
            >
              设为默认壁纸
            </div>

            <!-- Delete Button -->
            <button
              @click.stop="handleDelete(img, activeTab === 'pc' ? 'pc' : 'mobile')"
              class="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-sm z-20"
              title="删除"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </VueDraggable>

        <!-- API Management -->
        <div v-if="activeTab === 'api'" class="space-y-6">
          <div class="border border-gray-200 rounded-xl bg-white p-4">
            <h4 class="text-sm font-bold text-gray-800 mb-3">PC 端接口</h4>
            <div class="space-y-2">
              <label class="block text-[12px] text-gray-600">列表接口</label>
              <input
                v-model="store.appConfig.wallpaperApiPcList"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/backgrounds，返回文件名数组"
              />
              <label class="block text-[12px] text-gray-600 mt-2">上传接口</label>
              <input
                v-model="store.appConfig.wallpaperApiPcUpload"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/backgrounds/upload (支持FormData: files)"
              />
              <label class="block text-[12px] text-gray-600 mt-2">删除接口基础路径</label>
              <input
                v-model="store.appConfig.wallpaperApiPcDeleteBase"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/backgrounds，最终为 /base/{name}"
              />
              <label class="block text-[12px] text-gray-600 mt-2">图片访问前缀</label>
              <input
                v-model="store.appConfig.wallpaperPcImageBase"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /backgrounds，最终为 /prefix/{name}"
              />
            </div>
          </div>

          <div class="border border-gray-200 rounded-xl bg-white p-4">
            <h4 class="text-sm font-bold text-gray-800 mb-3">手机端接口</h4>
            <div class="space-y-2">
              <label class="block text-[12px] text-gray-600">列表接口</label>
              <input
                v-model="store.appConfig.wallpaperApiMobileList"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/mobile_backgrounds，返回文件名数组"
              />
              <label class="block text-[12px] text-gray-600 mt-2">上传接口</label>
              <input
                v-model="store.appConfig.wallpaperApiMobileUpload"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/mobile_backgrounds/upload (支持FormData: files)"
              />
              <label class="block text-[12px] text-gray-600 mt-2">删除接口基础路径</label>
              <input
                v-model="store.appConfig.wallpaperApiMobileDeleteBase"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /api/mobile_backgrounds，最终为 /base/{name}"
              />
              <label class="block text-[12px] text-gray-600 mt-2">图片访问前缀</label>
              <input
                v-model="store.appConfig.wallpaperMobileImageBase"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                placeholder="默认 /mobile_backgrounds，最终为 /prefix/{name}"
              />
            </div>
          </div>

          <div class="flex items-center justify-end gap-3">
            <button
              @click="
                () => {
                  store.saveData(true);
                  fetchWallpapers();
                }
              "
              class="px-4 py-2 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
            >
              保存并测试列表
            </button>
            <button
              @click="
                () => {
                  store.appConfig.wallpaperApiPcList = '/api/backgrounds';
                  store.appConfig.wallpaperApiPcUpload = '/api/backgrounds/upload';
                  store.appConfig.wallpaperApiPcDeleteBase = '/api/backgrounds';
                  store.appConfig.wallpaperPcImageBase = '/backgrounds';
                  store.appConfig.wallpaperApiMobileList = '/api/mobile_backgrounds';
                  store.appConfig.wallpaperApiMobileUpload = '/api/mobile_backgrounds/upload';
                  store.appConfig.wallpaperApiMobileDeleteBase = '/api/mobile_backgrounds';
                  store.appConfig.wallpaperMobileImageBase = '/mobile_backgrounds';
                  store.saveData(true);
                }
              "
              class="px-4 py-2 rounded-lg text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200"
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- Custom Confirm Modal -->
  <Teleport to="body">
    <div
      v-if="showConfirmModal"
      class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="closeConfirmModal"
    >
      <div
        class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-100 animate-in fade-in zoom-in duration-200"
      >
        <div class="flex items-start gap-4 mb-4">
          <div class="p-2 bg-yellow-100 rounded-full text-yellow-600 shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-bold text-gray-900 mb-2">提示</h3>
            <p class="text-sm text-gray-600 leading-relaxed">{{ confirmMessage }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button
            @click="closeConfirmModal"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            @click="handleConfirm"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
