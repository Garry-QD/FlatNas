<script setup lang="ts">
import { ref, watch, computed, shallowRef, onMounted, onUnmounted } from "vue";
import type { NavItem } from "@/types";
import { useSmartIconMatch } from "@/composables/useSmartIconMatch";
import { useMainStore } from "../stores/main";
import IconUploader from "./IconUploader.vue";
import IconSelectionModal from "./IconSelectionModal.vue";
import GroupSelector from "./GroupSelector.vue";
import OverlayMotion from "@/components/base/OverlayMotion.vue";
import { VueCropper } from "vue-cropper";
import { toAppUrl } from "@/utils/runtimeUrls";
import "vue-cropper/dist/index.css";

// 接收父组件传来的数据
const props = defineProps<{
  show: boolean;
  data?: NavItem | null;
  // ✨✨✨ 新增关键参数：当前分组ID (必须有这个才能支持分组添加)
  groupId?: string;
  onSave?: (payload: { item: NavItem; groupId?: string }) => Promise<void>;
}>();

const emit = defineEmits(["update:show", "save"]);

const store = useMainStore();

const currentHour = ref(new Date().getHours());
let daylightTimer: number | null = null;
const updateHour = () => {
  currentHour.value = new Date().getHours();
};
const isNightTime = computed(() => currentHour.value >= 18 || currentHour.value < 6);
const isNightDaylightMode = computed(
  () => store.appConfig.daylightModeEnabled && isNightTime.value,
);

onMounted(() => {
  daylightTimer = window.setInterval(updateHour, 60000);
});
onUnmounted(() => {
  if (daylightTimer) clearInterval(daylightTimer);
});

const isVertical = computed(() => {
  const layout = props.groupId
    ? store.groups.find((g) => g.id === props.groupId)?.cardLayout
    : undefined;
  return (layout || store.appConfig.cardLayout) === "vertical";
});

// 合并描述字段的计算属性
const mergedDescription = computed({
  get: () => {
    const d1 = form.value.description1 || "";
    const d2 = form.value.description2 || "";
    const d3 = form.value.description3 || "";
    // 如果有后面行的内容，则保留前面的换行符
    if (d3) return `${d1}\n${d2}\n${d3}`;
    if (d2) return `${d1}\n${d2}`;
    return d1;
  },
  set: (val: string) => {
    const lines = val.split("\n");
    form.value.description1 = lines[0] || "";
    form.value.description2 = lines[1] || "";
    form.value.description3 = lines[2] || "";
  },
});

// 自动调整高度
const autoResize = (event: Event) => {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};

// 搜索相关状态
const showIconSelection = ref(false);
const iconCandidates = shallowRef<string[]>([]);
const searchSource = ref<"local" | "api">("api");

// 辅助函数：从 URL 提取图标名称
const getIconNameFromUrl = (url: string): string => {
  try {
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return url;
    const name = lastPart.split(".")[0] || "";
    return decodeURIComponent(name);
  } catch {
    return url;
  }
};

const localGroupId = ref("");

// 表单数据 (合并管理，比以前分散的 ref 更整洁)
interface EditForm extends Omit<NavItem, "id" | "backupUrls" | "backupLanUrls"> {
  backupUrls: { name: string; url: string }[];
  backupLanUrls: { name: string; url: string }[];
}

const form = ref<EditForm>({
  title: "",
  url: "",
  lanUrl: "",
  backupUrls: [],
  backupLanUrls: [],
  icon: "",
  description1: "",
  description2: "",
  description3: "",
  color: "bg-gray-100 text-gray-700",
  titleColor: "",
  isPublic: false,
  backgroundImage: "",
  backgroundBlur: 6,
  backgroundMask: 0.3,
  iconSize: 100,
});

// 选中图标
const onIconSelect = (icon: string) => {
  form.value.icon = icon;
};

const {
  smartMatchCandidates,
  showSmartMatchModal,
  isSmartMatching,
  smartMatchIcons,
  selectSmartMatchCandidate,
  closeSmartMatchModal,
} = useSmartIconMatch({
  form,
  onSelect: onIconSelect,
});

// 监听弹窗打开，初始化表单
watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      localGroupId.value = props.groupId || "";
      if (props.data) {
        // 编辑模式：回填数据
        form.value = {
          ...props.data,
          backupUrls: props.data.backupUrls
            ? props.data.backupUrls.map((u) =>
                typeof u === "string" ? { name: "", url: u } : { ...u },
              )
            : [],
          backupLanUrls: props.data.backupLanUrls
            ? props.data.backupLanUrls.map((u) =>
                typeof u === "string" ? { name: "", url: u } : { ...u },
              )
            : [],
          description1: props.data.description1 || "",
          description2: props.data.description2 || "",
          description3: props.data.description3 || "",
          titleColor: props.data.titleColor || "",
          backgroundImage: props.data.backgroundImage || "",
          backgroundBlur: props.data.backgroundBlur ?? 6,
          backgroundMask: props.data.backgroundMask ?? 0.3,
          iconSize: props.data.iconSize ?? 100,
        };
      } else {
        // 新增模式：重置表单
        form.value = {
          title: "",
          url: "",
          lanUrl: "",
          backupUrls: [],
          backupLanUrls: [],
          icon: "",
          color: "bg-gray-100 text-gray-700",
          titleColor: "",
          isPublic: false,
          backgroundImage: "",
          backgroundBlur: 6,
          backgroundMask: 0.3,
          iconSize: 100,
        };
      }
    }
  },
  { immediate: true },
);

const addBackupUrl = () => {
  if (!form.value.backupUrls) form.value.backupUrls = [];
  form.value.backupUrls.push({ name: "", url: "" });
};

const removeBackupUrl = (index: number) => {
  if (form.value.backupUrls) {
    form.value.backupUrls.splice(index, 1);
  }
};

const addBackupLanUrl = () => {
  if (!form.value.backupLanUrls) form.value.backupLanUrls = [];
  form.value.backupLanUrls.push({ name: "", url: "" });
};

const removeBackupLanUrl = (index: number) => {
  if (form.value.backupLanUrls) {
    form.value.backupLanUrls.splice(index, 1);
  }
};

const isValidUrl = (url: string) => {
  if (!url) return true; // allow empty for now? No, required if item exists?
  // User said: Address field RFC 3986 validation.
  // Simple regex
  return /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(url);
};

const focusNextInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const parent = target.parentElement?.parentElement;
  if (parent) {
    const inputs = parent.querySelectorAll("input");
    if (inputs.length > 1 && inputs[0] === target && inputs[1]) {
      (inputs[1] as HTMLElement).focus();
      event.preventDefault();
    }
  }
};

const close = () => emit("update:show", false);

// 处理图标加载错误
const iconInputFocused = ref(false);
const isImgError = ref(false);

const processIconError = () => {
  const val = form.value.icon;
  if (
    val &&
    val.startsWith("http") &&
    !val.includes("favicon.ico") &&
    !val.includes("simpleicons.org") &&
    !val.includes("api.afmax.cn") &&
    !val.includes("api.quickso.cn") &&
    !val.includes("favicon.vip") &&
    !val.includes("icon.bqb.cool")
  ) {
    console.log("Icon load failed, trying to fallback to reliable API:", val);
    try {
      const urlObj = new URL(val);
      // 尝试使用 Afmax API，它比直接访问 favicon.ico 更可靠且不会产生 404 错误日志
      form.value.icon = `https://api.afmax.cn/so/ico/index.php?r=https://${urlObj.hostname}`;
      return;
    } catch {
      // ignore
    }
  }
  // 否则直接清空
  form.value.icon = "";
};

const handleIconError = () => {
  isImgError.value = true;
  // 如果正在输入，不要打断用户
  if (iconInputFocused.value) return;
  processIconError();
};

const onIconInputBlur = () => {
  iconInputFocused.value = false;
  // 失去焦点时，如果有错误，尝试修正
  if (isImgError.value) {
    processIconError();
  }
};

const onImgLoad = () => {
  isImgError.value = false;
};

const saveIconToLocal = ref(true);
const isSaving = ref(false);

// Icon upload embedded in preview
const iconFileInput = ref<HTMLInputElement | null>(null);
const showIconCropper = ref(false);
const iconUploadImgUrl = ref("");
const iconCropperRef = ref();
const iconZoom = ref(1);

const triggerIconUpload = () => {
  iconFileInput.value?.click();
};

const onIconFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert("图片太大啦，请上传小于 5MB 的图片");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    iconUploadImgUrl.value = e.target?.result as string;
    iconZoom.value = 1;
    showIconCropper.value = true;
  };
  reader.readAsDataURL(file);
  if (iconFileInput.value) iconFileInput.value.value = "";
};

const onIconZoomChange = (e: Event) => {
  const newVal = parseFloat((e.target as HTMLInputElement).value);
  const diff = newVal - iconZoom.value;
  iconCropperRef.value?.changeScale(diff);
  iconZoom.value = newVal;
};

const confirmIconCrop = () => {
  iconCropperRef.value?.getCropData((data: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 216;
      canvas.height = 216;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, 216, 216);
        form.value.icon = canvas.toDataURL("image/png");
      } else {
        form.value.icon = data;
      }
      showIconCropper.value = false;
    };
    img.src = data;
  });
};

type IconCacheErrorResponse = {
  error?: string | { code?: string; message?: string };
  success?: boolean;
  path?: string;
};

const extractIconCacheError = (data: IconCacheErrorResponse | null): string => {
  if (!data) return "图标缓存失败，请稍后重试";
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") {
    const code = typeof data.error.code === "string" ? data.error.code : "";
    const tips: Record<string, string> = {
      invalid_url: "请使用有效的 http/https 图标地址",
      blocked_host: "该地址属于受限内网地址，建议先上传图标再保存",
      icon_too_large: "图标超过 5MB，建议压缩后重试",
      unsupported_icon_type: "仅支持 png/jpg/webp/gif/svg/ico",
      unsafe_svg: "SVG 含高风险脚本内容，请换一个安全图标",
      fetch_failed: "远程图标拉取失败，请检查网络后重试",
    };
    const tip = code && tips[code] ? `（${tips[code]}）` : "";
    return `${data.error.message}${tip}`;
  }
  return "图标缓存失败，请稍后重试";
};

const cacheIconToLocal = async (icon: string): Promise<{ path: string | null; error: string | null }> => {
  const trimmed = icon.trim();
  if (!trimmed) return { path: null, error: null };
  if (trimmed.startsWith("/icon-cache/")) return { path: trimmed, error: null };

  const iconUrlToDataUrl = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  // Support relative local icon paths (e.g. "icons/foo.png" from local matching).
  const normalizeIconUrl = (value: string) => {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/icons/")) return new URL(toAppUrl(value), window.location.origin).toString();
    if (value.startsWith("icons/")) return new URL(toAppUrl(`/${value}`), window.location.origin).toString();
    return "";
  };

  let payload: { dataUrl?: string; url?: string } | null = null;
  if (trimmed.startsWith("data:")) {
    payload = { dataUrl: trimmed };
  } else {
    const normalized = normalizeIconUrl(trimmed);
    if (normalized) {
      if (trimmed.startsWith("icons/") || trimmed.startsWith("/icons/")) {
        // Convert local static icons to dataUrl to avoid backend private-host blocking.
        const dataUrl = await iconUrlToDataUrl(normalized);
        payload = dataUrl ? { dataUrl } : null;
      } else {
        payload = { url: normalized };
      }
    }
  }

  if (!payload) return { path: null, error: "图标地址格式不支持本地缓存，请改为上传图片或使用 http/https 链接" };

  try {
    const res = await fetch("/api/icon-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { path: null, error: extractIconCacheError(data) };
    if (data && data.success && typeof data.path === "string" && data.path) {
      return { path: data.path, error: null };
    }
    return { path: null, error: extractIconCacheError(data) };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "";
    return { path: null, error: message || "图标缓存请求失败，请稍后重试" };
  }
};

// 提交保存
const submit = async () => {
  if (!form.value.title && !form.value.url) return alert("标题和链接总得写一个吧！");

  isSaving.value = true;
  try {
    if (saveIconToLocal.value) {
      const icon = (form.value.icon || "").trim();
      if (icon && !icon.startsWith("/icon-cache/")) {
        const cached = await cacheIconToLocal(icon);
        if (cached.path) {
          form.value.icon = cached.path;
        } else if (cached.error) {
          alert(`图标本地缓存失败：${cached.error}\n将保留当前图标继续保存。`);
        }
      }
    }

    const payload = {
      item: { ...form.value, id: props.data?.id },
      groupId: localGroupId.value || props.groupId,
    };

    if (props.onSave) {
      await props.onSave(payload);
    } else {
      emit("save", payload);
    }

    close();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "";
    alert(message || "保存失败，请重试");
  } finally {
    isSaving.value = false;
  }
};

</script>

<template>
  <OverlayMotion
    :show="show"
    :z-index="50"
    close-on-overlay
    overlay-class="bg-black/20 backdrop-blur-sm p-4"
    panel-class="max-w-md"
    @close="close"
  >
    <div
      class="rounded-2xl shadow-2xl w-full overflow-hidden"
      :class="isNightDaylightMode ? 'night-settings bg-slate-900/60 backdrop-blur-xl border border-white/10' : 'bg-white'"
    >
      <div
        class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white select-none"
      >
        <h3 class="text-lg font-bold text-gray-800">{{ data ? "修改项目" : "添加新项目" }}</h3>

        <div class="flex items-center gap-2 ml-auto mr-4">
          <GroupSelector v-model="localGroupId" />
          <div class="w-px h-4 bg-gray-200 mx-1"></div>
          <span class="text-xs font-bold text-gray-500">公开</span>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" v-model="form.isPublic" class="sr-only peer" />
            <div
              class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-900"
            ></div>
          </label>
        </div>

        <button @click="close" class="text-gray-400 hover:text-gray-600 text-2xl leading-none">
          &times;
        </button>
      </div>

      <div class="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        <div class="flex gap-3">
          <div class="flex-1">
            <label class="block text-sm font-medium text-gray-600 mb-1"
              >标题 <span class="text-red-500">*</span></label
            >
            <div class="relative">
              <input
                v-model="form.title"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-gray-900 outline-none transition-colors pr-4"
                placeholder="例如：我的博客"
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">标题颜色</label>
            <div class="flex items-center h-[42px] px-2 border border-gray-200 rounded-lg bg-white">
              <input
                v-model="form.titleColor"
                type="color"
                class="w-8 h-8 rounded cursor-pointer border-none p-0 bg-transparent"
                title="选择标题颜色"
              />
              <button
                v-if="form.titleColor"
                @click="form.titleColor = ''"
                class="ml-2 text-xs text-gray-400 hover:text-red-500"
                title="清除颜色"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div v-if="!isVertical">
          <label class="block text-xs font-medium text-gray-500 mb-1"
            >描述 (水平模式显示，每行对应一行文字)</label
          >
          <textarea
            v-model="mergedDescription"
            @input="autoResize"
            class="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-gray-900 outline-none transition-colors text-sm resize-none overflow-hidden"
            placeholder="第一行 (上)
第二行 (中)
第三行 (下)"
            rows="3"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1"
            >外网链接 <span class="text-red-500">*</span>
            <button
              @click="addBackupUrl"
              class="ml-2 text-xs text-gray-500 hover:text-gray-900 hover:underline"
              title="添加备用外网地址"
            >
              + 备用地址
            </button>
          </label>
          <div class="relative">
            <input
              v-model="form.url"
              type="text"
              class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-gray-900 outline-none transition-colors pr-4"
              placeholder="https://example.com"
            />
          </div>
          <!-- Backup URLs -->
          <div v-if="form.backupUrls && form.backupUrls.length > 0" class="space-y-2 mt-2">
            <div
              v-for="(item, index) in form.backupUrls"
              :key="'backup-wan-' + index"
              class="flex flex-col sm:flex-row gap-2 items-start sm:items-center p-2 bg-gray-50 rounded-lg border border-gray-100"
            >
              <!-- Name Field -->
              <div class="relative flex-1 w-full sm:w-auto">
                <input
                  v-model="item.name"
                  type="text"
                  maxlength="50"
                  class="w-full px-3 py-2 rounded-lg border focus:border-gray-900 outline-none transition-colors text-sm pr-8"
                  :class="[
                    form.backupUrls.filter(
                      (i, idx) => i.name && i.name === item.name && idx !== index,
                    ).length > 0
                      ? 'border-red-300'
                      : 'border-gray-200',
                  ]"
                  placeholder="名称"
                  @keydown.enter.prevent
                  @keydown.tab="focusNextInput($event)"
                />
                <button
                  v-if="item.name"
                  @click="item.name = ''"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 rounded-full p-0.5"
                  title="清除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="w-3 h-3"
                  >
                    <path
                      d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                    />
                  </svg>
                </button>
              </div>

              <!-- URL Field -->
              <div class="relative flex-[2] w-full sm:w-auto">
                <input
                  v-model="item.url"
                  type="text"
                  maxlength="500"
                  class="w-full px-3 py-2 rounded-lg border focus:border-gray-900 outline-none transition-colors text-sm pr-8"
                  :class="isValidUrl(item.url) ? 'border-gray-200' : 'border-red-300 bg-red-50'"
                  placeholder="请输入完整URL地址"
                  @keydown.enter.prevent
                />
                <button
                  v-if="item.url"
                  @click="item.url = ''"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 rounded-full p-0.5"
                  title="清除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="w-3 h-3"
                  >
                    <path
                      d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                    />
                  </svg>
                </button>
              </div>

              <button
                @click="removeBackupUrl(index)"
                class="text-gray-400 hover:text-red-500 p-2 sm:p-1 self-end sm:self-center"
                title="删除"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-1"
            >内网链接 <span class="text-gray-400 text-xs">(选填，内网访问时优先跳转)</span>
            <button
              @click="addBackupLanUrl"
              class="ml-2 text-xs text-gray-500 hover:text-gray-900 hover:underline"
              title="添加备用内网地址"
            >
              + 备用地址
            </button>
          </label>
          <input
            v-model="form.lanUrl"
            type="text"
            placeholder="http://192.168.1.x:8080"
            class="w-full px-4 py-2 rounded-lg border border-gray-200 focus:border-gray-900 outline-none transition-colors"
          />
          <!-- Backup LAN URLs -->
          <div v-if="form.backupLanUrls && form.backupLanUrls.length > 0" class="space-y-2 mt-2">
            <div
              v-for="(item, index) in form.backupLanUrls"
              :key="'backup-lan-' + index"
              class="flex flex-col sm:flex-row gap-2 items-start sm:items-center p-2 bg-gray-50 rounded-lg border border-gray-100"
            >
              <!-- Name Field -->
              <div class="relative flex-1 w-full sm:w-auto">
                <input
                  v-model="item.name"
                  type="text"
                  maxlength="50"
                  class="w-full px-3 py-2 rounded-lg border focus:border-gray-900 outline-none transition-colors text-sm pr-8"
                  :class="[
                    form.backupLanUrls.filter(
                      (i, idx) => i.name && i.name === item.name && idx !== index,
                    ).length > 0
                      ? 'border-red-300'
                      : 'border-gray-200',
                  ]"
                  placeholder="名称"
                  @keydown.enter.prevent
                  @keydown.tab="focusNextInput($event)"
                />
                <button
                  v-if="item.name"
                  @click="item.name = ''"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 rounded-full p-0.5"
                  title="清除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="w-3 h-3"
                  >
                    <path
                      d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                    />
                  </svg>
                </button>
              </div>

              <!-- URL Field -->
              <div class="relative flex-[2] w-full sm:w-auto">
                <input
                  v-model="item.url"
                  type="text"
                  maxlength="500"
                  class="w-full px-3 py-2 rounded-lg border focus:border-gray-900 outline-none transition-colors text-sm pr-8"
                  :class="isValidUrl(item.url) ? 'border-gray-200' : 'border-red-300 bg-red-50'"
                  placeholder="请输入完整URL地址"
                  @keydown.enter.prevent
                />
                <button
                  v-if="item.url"
                  @click="item.url = ''"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 rounded-full p-0.5"
                  title="清除"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="w-3 h-3"
                  >
                    <path
                      d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                    />
                  </svg>
                </button>
              </div>

              <button
                @click="removeBackupLanUrl(index)"
                class="text-gray-400 hover:text-red-500 p-2 sm:p-1 self-end sm:self-center"
                title="删除"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-600 mb-3">图标</label>

          <div class="flex items-start gap-4 mb-4">
            <!-- 预览框 -->
            <div
              class="shrink-0 w-20 h-20 rounded-xl border bg-gray-50 flex items-center justify-center overflow-hidden shadow-sm cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all group relative"
              @click="triggerIconUpload"
            >
              <img
                v-if="form.icon"
                :src="store.getAssetUrl(form.icon)"
                class="w-full h-full object-cover transition-transform duration-200"
                :style="{ transform: `scale(${(form.iconSize ?? 100) / 100})` }"
                @error="handleIconError"
                @load="onImgLoad"
              />
              <span v-else class="text-gray-300 text-xs">预览</span>
            </div>

            <!-- 操作区 -->
            <div class="flex-1 flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <button
                  @click="saveIconToLocal = !saveIconToLocal"
                  class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all border"
                  :class="
                    saveIconToLocal
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                  "
                >
                  {{ saveIconToLocal ? "已缓存" : "缓存到本地" }}
                </button>
                <button
                  type="button"
                  @click.prevent="smartMatchIcons"
                  :disabled="isSmartMatching"
                  class="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0"
                  :class="
                    isSmartMatching
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                  "
                >
                  <span
                    v-if="isSmartMatching"
                    class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                  ></span>
                  <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {{ isSmartMatching ? "匹配中..." : "智能匹配" }}
                </button>
              </div>

              <div
                v-if="showSmartMatchModal"
                class="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      v-if="isSmartMatching"
                      class="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0"
                    ></span>
                    <span class="text-xs text-gray-600 truncate">
                      {{
                        isSmartMatching
                          ? "正在抓取图标..."
                          : smartMatchCandidates.length
                            ? "选择一个图标即可应用"
                            : "未找到合适图标"
                      }}
                    </span>
                  </div>
                  <button
                    type="button"
                    @click="closeSmartMatchModal"
                    class="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                    title="收起"
                  >
                    收起
                  </button>
                </div>

                <div
                  v-if="smartMatchCandidates.length > 0"
                  class="mt-2 flex flex-wrap gap-2"
                >
                  <button
                    v-for="candidate in smartMatchCandidates"
                    :key="candidate.url"
                    type="button"
                    @click="selectSmartMatchCandidate(candidate)"
                    :title="candidate.label || getIconNameFromUrl(candidate.url)"
                    class="group w-20 h-20 rounded-xl border border-transparent bg-white/90 hover:border-blue-200 hover:bg-white hover:shadow-sm flex items-center justify-center overflow-hidden transition-all"
                  >
                    <img
                      :src="store.getAssetUrl(candidate.url)"
                      class="w-full h-full object-contain p-2 transition-transform group-hover:scale-110"
                      loading="lazy"
                    />
                  </button>
                </div>

                <div
                  v-else-if="!isSmartMatching"
                  class="mt-2 text-xs text-gray-400"
                >
                  请尝试修改标题、链接，或直接手动上传图标。
                </div>
              </div>

              <!-- 缩放滑块 -->
              <div class="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                <span class="text-xs text-gray-400 whitespace-nowrap">缩放</span>
                <input
                  type="range"
                  v-model.number="form.iconSize"
                  min="20"
                  max="200"
                  step="5"
                  class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                />
                <span class="text-xs text-gray-500 w-8 text-right">{{ form.iconSize }}%</span>
              </div>
            </div>
          </div>

          <!-- 图标 URL 输入 -->
          <div class="relative">
            <input
              v-model="form.icon"
              type="text"
              placeholder="图片 URL 地址..."
              class="w-full px-4 py-2 rounded-lg border border-gray-200 text-sm focus:border-gray-900 outline-none"
              @focus="iconInputFocused = true"
              @blur="onIconInputBlur"
            />
          </div>

          <input
            ref="iconFileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="onIconFileChange"
          />
        </div>

        <div class="pt-4 border-t border-gray-100">
          <label class="block text-sm font-medium text-gray-600 mb-2"
            >卡片背景
            <span class="text-xs text-gray-400 font-normal">(可选，支持模糊和遮罩效果)</span></label
          >
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <input
                v-model="form.backgroundImage"
                type="text"
                placeholder="背景图 URL..."
                class="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm focus:border-gray-900 outline-none"
              />
              <button
                v-if="form.backgroundImage"
                @click="form.backgroundImage = ''"
                class="text-gray-400 hover:text-red-500 px-2"
                title="清除背景"
              >
                ✕
              </button>
            </div>
            <IconUploader
              v-model="form.backgroundImage"
              :crop="false"
              :uploadOnly="true"
              :previewStyle="{
                filter: `blur(${form.backgroundBlur ?? 6}px)`,
                transform: 'scale(1.1)',
              }"
              :overlayStyle="{
                backgroundColor: `rgba(0,0,0,${form.backgroundMask ?? 0.3})`,
              }"
            />

            <div
              v-if="form.backgroundImage"
              class="grid grid-cols-2 gap-4 mt-2 p-3 bg-gray-50 rounded-lg"
            >
              <div>
                <label class="block text-xs text-gray-500 mb-1 flex justify-between">
                  <span>模糊半径</span>
                  <span>{{ form.backgroundBlur }}px</span>
                </label>
                <input
                  type="range"
                  v-model.number="form.backgroundBlur"
                  min="0"
                  max="20"
                  step="1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1 flex justify-between">
                  <span>遮罩浓度</span>
                  <span>{{ Math.round((form.backgroundMask || 0) * 100) }}%</span>
                </label>
                <input
                  type="range"
                  v-model.number="form.backgroundMask"
                  min="0"
                  max="1"
                  step="0.1"
                  class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                />
              </div>
              <div class="col-span-2 text-right">
                <button
                  @click="
                    form.backgroundImage = '';
                    form.backgroundBlur = 6;
                    form.backgroundMask = 0.3;
                  "
                  class="text-xs text-red-500 hover:text-red-700 underline"
                >
                  移除背景
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="px-6 py-4 bg-white flex justify-end gap-3 border-t border-gray-100">
        <button
          @click="close"
          class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors text-sm font-medium"
        >
          取消
        </button>
        <button
          @click="submit"
          :disabled="isSaving"
          class="px-6 py-2 rounded-lg bg-gray-900 text-white hover:bg-black transition-all active:scale-95 text-sm font-medium"
        >
          {{ isSaving ? "保存中..." : data ? "保存修改" : "确认添加" }}
        </button>
      </div>
    </div>

    <IconSelectionModal
      v-model:show="showIconSelection"
      :candidates="iconCandidates"
      :title="form.title"
      :source="searchSource"
      @select="onIconSelect"
      @cancel-link="showIconSelection = false"
    />

    <!-- Icon Cropper Modal -->
    <OverlayMotion
      :show="showIconCropper"
      :z-index="999"
      close-on-overlay
      overlay-class="bg-black/60 backdrop-blur-sm p-4"
      panel-class="max-w-lg"
      @close="showIconCropper = false"
    >
      <div
        class="bg-white w-full rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[500px]"
      >
        <div class="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <h3 class="font-bold text-gray-700">裁剪图标</h3>
          <button @click="showIconCropper = false" class="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>
        <div class="flex-1 bg-gray-900 relative">
          <VueCropper
            ref="iconCropperRef"
            :img="iconUploadImgUrl"
            :autoCrop="true"
            :autoCropWidth="216"
            :autoCropHeight="216"
            :fixed="true"
            :can-move="true"
            :fixedNumber="[1, 1]"
            :centerBox="true"
            outputType="png"
          ></VueCropper>
        </div>
        <div class="px-4 py-2 bg-gray-800 flex items-center gap-3 border-t border-gray-700">
          <span class="text-gray-400 text-xs">🔍</span>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            :value="iconZoom"
            @input="onIconZoomChange"
            class="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-400"
          />
          <span class="text-gray-400 text-xs font-mono w-10 text-right"
            >{{ Math.round(iconZoom * 100) }}%</span
          >
        </div>
        <div class="p-4 bg-gray-50 flex justify-end gap-3">
          <button
            @click="showIconCropper = false"
            class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmIconCrop"
            class="px-6 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
          >
            确认使用
          </button>
        </div>
      </div>
    </OverlayMotion>
  </OverlayMotion>
</template>

<style scoped>
.night-settings {
  color: #f8fafc;
}
.night-settings :deep(.bg-white\/90),
.night-settings :deep(.bg-white\/80),
.night-settings :deep(.bg-white\/70),
.night-settings :deep(.bg-white\/60),
.night-settings :deep(.bg-white),
.night-settings :deep(.bg-gray-50),
.night-settings :deep(.bg-gray-100),
.night-settings :deep(.bg-white\/90):hover,
.night-settings :deep(.bg-white\/80):hover,
.night-settings :deep(.bg-white\/70):hover,
.night-settings :deep(.bg-white\/60):hover,
.night-settings :deep(.bg-white):hover,
.night-settings :deep(.bg-gray-50):hover,
.night-settings :deep(.bg-gray-100):hover {
  background-color: rgba(15, 23, 42, 0.55) !important;
  backdrop-filter: blur(12px);
}
/* 夜间模式：侧栏等使用 hover:bg-gray-50 的按钮悬停时用深色背景，避免与浅色文字同色 */
.night-settings :deep(.hover\:bg-gray-50):hover,
.night-settings :deep(.hover\:bg-gray-100):hover {
  background-color: rgba(15, 23, 42, 0.55) !important;
  backdrop-filter: blur(8px);
}
.night-settings :deep(.text-gray-900),
.night-settings :deep(.text-gray-800),
.night-settings :deep(.text-gray-700),
.night-settings :deep(.text-gray-600),
.night-settings :deep(.text-gray-500),
.night-settings :deep(.text-gray-400) {
  color: #f8fafc !important;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.6);
}
.night-settings :deep(.border-gray-100),
.night-settings :deep(.border-gray-200),
.night-settings :deep(.border-gray-300),
.night-settings :deep(.border-gray-400) {
  border-color: rgba(255, 255, 255, 0.12) !important;
}
.night-settings :deep(input::placeholder),
.night-settings :deep(textarea::placeholder) {
  color: rgba(248, 250, 252, 0.6);
}
</style>
