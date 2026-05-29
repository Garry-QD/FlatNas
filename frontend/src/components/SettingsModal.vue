<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { useMainStore } from "../stores/main";
import type { WidgetConfig, NavGroup, NavItem } from "@/types";
import IconUploader from "./IconUploader.vue";
import WallpaperLibrary from "./WallpaperLibrary.vue";
import PasswordConfirmModal from "./PasswordConfirmModal.vue";
import DockerWidget from "./DockerWidget.vue";
import ProxyToggle from "./ProxyToggle.vue";
import SystemStatusWidget from "./SystemStatusWidget.vue";
import RssSettings from "./RssSettings.vue";
import SearchSettings from "./SearchSettings.vue";
import ScriptManager from "./ScriptManager.vue";
import OverlayMotion from "@/components/base/OverlayMotion.vue";
import { DEFAULT_NETWORK_RULES, NETWORK_PRESET_RULES } from "@/utils/network";
import { createDefaultWidgetList } from "@/utils/widgetUtils";
import { toApiUrl } from "@/utils/runtimeUrls";
import daoliyuLogo from "@/assets/daoliyu.svg";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits(["update:show"]);
const store = useMainStore();

// 自动保存所有设置修改
watch(
  [() => store.widgets, () => store.appConfig],
  () => {
    if (props.show) {
      store.saveData();
    }
  },
  { deep: true }
);

onMounted(() => {
  store.lockServerSync();
});
onUnmounted(() => {
  store.unlockServerSync();
});

const DEFAULT_LATENCY_THRESHOLD_MS = 200;
const latencyThresholdDraft = ref("");
const latencyThresholdTouched = ref(false);
const latencyThresholdAppliedToast = ref("");
let latencyThresholdToastTimer: number | null = null;
const latencyThresholdValidation = computed(() => {
  const raw = latencyThresholdDraft.value.trim();
  if (!raw) return { ok: false, value: null as number | null, error: "请输入阈值（20–30000）" };
  if (!/^\d+$/.test(raw)) return { ok: false, value: null as number | null, error: "仅支持正整数" };
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return { ok: false, value: null as number | null, error: "数值无效" };
  if (n < 20 || n > 30000) return { ok: false, value: n, error: "范围需在 20–30000 ms" };
  return { ok: true, value: n, error: "" };
});
const whitelistLatencyEnabled = computed(() => {
  return store.appConfig.whitelistLatencyMode === true;
});
const toggleWhitelistLatency = () => {
  store.appConfig.whitelistLatencyMode = !store.appConfig.whitelistLatencyMode;
  store.markDirty();
};
const syncLatencyThresholdDraft = () => {
  const v = store.appConfig.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS;
  latencyThresholdDraft.value = String(v);
  latencyThresholdTouched.value = false;
};
watch(
  () => store.forceNetworkMode,
  (mode) => {
    if (mode === "latency") syncLatencyThresholdDraft();
  },
  { immediate: true },
);
watch(
  () => store.appConfig.latencyThresholdMs,
  () => {
    if (!latencyThresholdTouched.value) syncLatencyThresholdDraft();
  },
);
const onLatencyThresholdInput = (e: Event) => {
  latencyThresholdTouched.value = true;
  const raw = (e.target as HTMLInputElement).value ?? "";
  const digits = raw.replace(/[^\d]/g, "");
  latencyThresholdDraft.value = digits;
};
const applyLatencyThreshold = async () => {
  const v = latencyThresholdValidation.value;
  if (!v.ok || typeof v.value !== "number") return;
  store.appConfig.latencyThresholdMs = v.value;
  latencyThresholdTouched.value = false;
  store.markDirty();
  latencyThresholdAppliedToast.value = `已生效：${v.value} ms`;
  if (latencyThresholdToastTimer) window.clearTimeout(latencyThresholdToastTimer);
  latencyThresholdToastTimer = window.setTimeout(() => {
    latencyThresholdAppliedToast.value = "";
    latencyThresholdToastTimer = null;
  }, 1200);
};
const onLatencyThresholdBlur = async () => {
  if (!latencyThresholdTouched.value) return;
  const v = latencyThresholdValidation.value;
  if (!v.ok || typeof v.value !== "number") {
    syncLatencyThresholdDraft();
    return;
  }
  await applyLatencyThreshold();
};
const resetLatencyThreshold = async () => {
  store.appConfig.latencyThresholdMs = DEFAULT_LATENCY_THRESHOLD_MS;
  syncLatencyThresholdDraft();
  store.markDirty();
  latencyThresholdAppliedToast.value = `已重置：${DEFAULT_LATENCY_THRESHOLD_MS} ms`;
  if (latencyThresholdToastTimer) window.clearTimeout(latencyThresholdToastTimer);
  latencyThresholdToastTimer = window.setTimeout(() => {
    latencyThresholdAppliedToast.value = "";
    latencyThresholdToastTimer = null;
  }, 1200);
};

const mergeLegacyInternalDomainsToRules = () => {
  const legacy = String(store.appConfig.internalDomains || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const existing = String(store.appConfig.networkRules || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (legacy.length === 0) return;

  const mapped = legacy.map((line) => {
    if (line.includes(":")) return line;
    if (/^\d{1,3}(\.\d{1,3}){0,3}\.?$/.test(line)) return `ip:${line}`;
    return `domain_suffix:${line}`;
  });

  const merged = Array.from(new Set([...existing, ...mapped]));
  store.appConfig.networkRules = merged.join("\n");
};

const applyDefaultNetworkRules = async () => {
  mergeLegacyInternalDomainsToRules();
  const existing = String(store.appConfig.networkRules || "").trim();
  store.appConfig.networkRules = existing
    ? `${existing}\n${DEFAULT_NETWORK_RULES}`
    : DEFAULT_NETWORK_RULES;
  store.markDirty();
};

const resetNetworkRules = async () => {
  store.appConfig.networkRules = DEFAULT_NETWORK_RULES;
  store.markDirty();
};

const toggleWhitelistLatencyMode = async () => {
  store.forceNetworkMode = store.forceNetworkMode === "latency" ? "auto" : "latency";
};

const ensureNetworkPresets = () => {
  if (!store.appConfig.networkPresets) {
    store.appConfig.networkPresets = {
      tailscale: false,
      zerotier: false,
      frp: false,
      cloudflareTunnel: false,
      ngrok: false,
    };
  }
};

const presetMeta: Record<string, { label: string; desc: string }> = {
  tailscale: { label: "Tailscale", desc: "自动识别 .ts.net 与 100.64.x.x" },
  zerotier: { label: "ZeroTier", desc: "自动识别 .zerotier.net" },
  frp: { label: "FRP", desc: "启用后可叠加你的自定义 FRP 域名规则" },
  cloudflareTunnel: { label: "Cloudflare Tunnel", desc: "识别 trycloudflare 域名" },
  ngrok: { label: "ngrok", desc: "识别 ngrok 域名" },
};

const presetKeys = Object.keys(NETWORK_PRESET_RULES);

const toggleNetworkPreset = async (key: string) => {
  ensureNetworkPresets();
  const current = !!store.appConfig.networkPresets?.[key as keyof NonNullable<typeof store.appConfig.networkPresets>];
  store.appConfig.networkPresets![key as keyof NonNullable<typeof store.appConfig.networkPresets>] = !current;
  store.markDirty();
};

const showWallpaperLibrary = ref(false);
const currentHour = ref(new Date().getHours());
let daylightTimer: number | null = null;
const updateHour = () => {
  currentHour.value = new Date().getHours();
};
const isNightTime = computed(() => currentHour.value >= 18 || currentHour.value < 6);
const isNightDaylightMode = computed(
  () => store.appConfig.daylightModeEnabled && isNightTime.value,
);
const daylightMaskPercent = computed({
  get: () => Math.round((store.appConfig.daylightMask ?? 0.5) * 100),
  set: (val: number) => {
    const v = Number.isFinite(val) ? val : 50;
    const clamped = Math.min(100, Math.max(0, v));
    store.appConfig.daylightMask = clamped / 100;
    store.markDirty();
  },
});
const musicVolume = useStorage<number>("flat-nas-music-volume", 0.7);
const musicVolumePercent = computed({
  get: () => Math.round((musicVolume.value ?? 0.7) * 100),
  set: (val: number) => {
    const v = Number.isFinite(val) ? val : 70;
    musicVolume.value = Math.min(1, Math.max(0, v / 100));
  },
});
const cardBorderHoverPreview = computed(() =>
  store.appConfig.cardBorderColor && store.appConfig.cardBorderColor !== "transparent"
    ? store.appConfig.cardBorderColor
    : store.appConfig.background || store.appConfig.solidBackgroundColor
      ? "rgba(255, 255, 255, 0.35)"
      : "rgba(15, 23, 42, 0.12)",
);
const styleVariableRows = computed(() => [
  {
    name: "--group-title-color",
    desc: "分组标题文字颜色",
    value: store.appConfig.groupTitleColor || "#ffffff",
  },
  {
    name: "--card-bg-color",
    desc: "卡片背景颜色",
    value: store.appConfig.cardBgColor || "transparent",
  },
  {
    name: "--card-border-color",
    desc: "卡片边框颜色",
    value: store.appConfig.cardBorderColor || "transparent",
  },
  {
    name: "--card-border-hover-color",
    desc: "卡片边框悬停颜色",
    value: cardBorderHoverPreview.value,
  },
  {
    name: "--card-title-color",
    desc: "卡片标题文字颜色",
    value: store.appConfig.cardTitleColor || "#111827",
  },
]);
const styleVariableStatus = {
  contrast: "待校验",
  visual: "未配置",
};
const solidBackgroundColorProxy = computed({
  get: () => store.appConfig.solidBackgroundColor || "#f3f4f6",
  set: (val: string) => {
    store.appConfig.solidBackgroundColor = val;
    store.markDirty();
  },
});

const setSolidColorAsWallpaper = () => {
  const color = store.appConfig.solidBackgroundColor || "#f3f4f6";
  if (!color) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const dataUrl = canvas.toDataURL("image/png");
    store.appConfig.background = dataUrl;
    store.appConfig.solidBackgroundColor = "";
    store.markDirty();
  }
};

const handleWallpaperSelect = (payload: { url: string; type: string } | string) => {
  const url = typeof payload === "string" ? payload : payload.url;
  const type = typeof payload === "string" ? "pc" : payload.type;

  if (type === "mobile") {
    store.appConfig.mobileBackground = url;
  } else {
    store.appConfig.background = url;
  }
  store.markDirty();
};

const activeTab = ref("style");
const handleNavWheel = (e: WheelEvent) => {
  if (window.innerWidth < 768) {
    const container = e.currentTarget as HTMLElement;
    container.scrollLeft += e.deltaY;
  }
};

const dockerWidget = computed(() => store.widgets.find((w) => w.type === "docker"));
const systemStatusWidget = computed(() => store.widgets.find((w) => w.type === "system-status"));
const musicWidget = computed(() => store.widgets.find((w) => w.type === "music"));
const multiOpenWidgetTypes = ["iframe", "countdown", "countup", "amap-weather"];
const dedicatedWidgetTypes = ["docker"];
const isSingleOpenWidget = (type: string) =>
  !multiOpenWidgetTypes.includes(type) && !dedicatedWidgetTypes.includes(type);
const isDockerComponentCreated = computed(() => !!dockerWidget.value);
const isDockerComponentEnabled = computed(() => !!dockerWidget.value && dockerWidget.value.enable);
const sortedWidgets = computed(() => {
  const list = [...store.widgets];
  const playerIndex = list.findIndex((w) => w.type === "player");
  if (playerIndex > -1) {
    const [player] = list.splice(playerIndex, 1);
    if (player) {
      list.unshift(player);
    }
  }
  return list;
});
const singleOpenWidgets = computed(() =>
  sortedWidgets.value.filter((w) => isSingleOpenWidget(w.type)),
);
const shouldShowSingleWidgetDiagnostic = computed(() => singleOpenWidgets.value.length <= 2);
const singleWidgetDiagnosticTypes = computed(() =>
  singleOpenWidgets.value.map((w) => w.type).join("、") || "无",
);

// Debug Active Tab
watch(activeTab, (val) => {
  console.log("Active Tab Changed:", val);
});

const iconSrc = ref("/ICON.PNG");

// Ensure Docker Widget Exists
onMounted(async () => {
  if (import.meta.env.MODE === "test") return;

  // 移除强制恢复逻辑，避免覆盖用户配置
  // const hasDocker = store.widgets.some((w) => w.type === "docker");
  // if (!hasDocker) { ... }
  updateHour();
  if (daylightTimer) window.clearInterval(daylightTimer);
  daylightTimer = window.setInterval(updateHour, 60 * 1000);
});

onUnmounted(() => {
  if (daylightTimer) window.clearInterval(daylightTimer);
  daylightTimer = null;
});

const testWeatherResult = ref<{ success: boolean; message: string } | null>(null);
const isTestingWeather = ref(false);

const tempInputs = ref<Record<string, string>>({});

const updateTempInput = (key: string, value: string) => {
  tempInputs.value[key] = value;
};

const confirmTempInput = (w: WidgetConfig, field: string, key: string) => {
  if (tempInputs.value[key] !== undefined) {
    if (!w.data) w.data = {};
    w.data[field] = tempInputs.value[key];
    store.markDirty();
    // Clear temp input so it falls back to the saved value
    delete tempInputs.value[key];
  }
};

const testMusicAuthResult = ref<{ success: boolean; message: string } | null>(null);
const isTestingMusicAuth = ref(false);

const selectedMusicSize = ref({ cols: 1, rows: 1 });

watch(
  () => [musicWidget.value?.colSpan, musicWidget.value?.rowSpan],
  ([cols, rows]) => {
    if (cols && rows) {
      selectedMusicSize.value = { cols: Number(cols), rows: Number(rows) };
    }
  },
  { immediate: true },
);

const scrollToMusicSettings = () => {
  activeTab.value = "lucky-stun";
  setTimeout(() => {
    const el = document.getElementById("music-settings");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 100);
};

const setMusicSize = (cols: number, rows: number) => {
  const index = store.widgets.findIndex((w) => w.type === "music");
  if (index !== -1) {
    const oldWidget = store.widgets[index];
    if (!oldWidget) return;

    const newLayouts = oldWidget.layouts ? JSON.parse(JSON.stringify(oldWidget.layouts)) : {};

    // Update desktop layout if it exists to ensure GridPanel picks up the change
    if (newLayouts.desktop) {
      newLayouts.desktop.w = cols;
      newLayouts.desktop.h = rows;
    }

    store.widgets[index] = {
      ...oldWidget,
      id: oldWidget.id || "",
      type: oldWidget.type || "music",
      enable: oldWidget.enable ?? true,
      colSpan: cols,
      rowSpan: rows,
      w: cols,
      h: rows,
      layouts: newLayouts,
    };
    store.widgets = [...store.widgets]; // Force reactivity for GridPanel watcher
    store.markDirty();
  }
};

const getApiBase = (url?: string) => {
  let base = url || "/api";
  base = base.replace(/\/$/, "");
  if (!/\/api(\/v\d+)?$/.test(base)) base += "/api";
  return base;
};

const testMusicAuth = async () => {
  if (!musicWidget.value) return;

  const username = musicWidget.value.data.username;
  const password = musicWidget.value.data.password;

  if (!username || !password) {
    testMusicAuthResult.value = { success: false, message: "请输入用户名和密码" };
    return;
  }

  isTestingMusicAuth.value = true;
  testMusicAuthResult.value = null;

  try {
    const apiBase = getApiBase(musicWidget.value.data.apiUrl);
    const res = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        musicWidget.value.data.token = data.token;

        // Fetch User Profile
        try {
          const profileRes = await fetch(`${apiBase}/auth/profile`, {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            musicWidget.value.data.userProfile = profile;
          }
        } catch (e) {
          console.error("Failed to fetch profile", e);
        }

        store.markDirty();
        testMusicAuthResult.value = { success: true, message: "登录成功" };
      } else {
        testMusicAuthResult.value = { success: false, message: "登录失败：未获取到 Token" };
      }
    } else {
      const errText = await res.text();
      testMusicAuthResult.value = {
        success: false,
        message: `登录失败 (${res.status}): ${errText}`,
      };
    }
  } catch (e: unknown) {
    console.error("Auth test error:", e);
    testMusicAuthResult.value = { success: false, message: `请求错误: ${(e as Error).message}` };
  } finally {
    isTestingMusicAuth.value = false;
  }
};

const isUpdatingProfile = ref(false);
const showRenameModal = ref(false);
const newDisplayName = ref("");

const openRenameModal = () => {
  if (!musicWidget.value || !musicWidget.value.data?.token) return;
  newDisplayName.value =
    musicWidget.value.data.userProfile?.displayName || musicWidget.value.data.username || "";
  showRenameModal.value = true;
};

const updateDisplayName = async () => {
  if (!musicWidget.value || !musicWidget.value.data?.token) return;
  const nextName = newDisplayName.value.trim();
  if (!nextName) return;

  isUpdatingProfile.value = true;
  try {
    const apiBase = getApiBase(musicWidget.value.data.apiUrl);
    const res = await fetch(`${apiBase}/auth/myprofile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${musicWidget.value.data.token}`,
      },
      body: JSON.stringify({ displayName: nextName }),
    });

    if (res.ok) {
      const updated = await res.json();
      // Update local profile
      if (!musicWidget.value.data.userProfile) musicWidget.value.data.userProfile = updated;
      musicWidget.value.data.userProfile.displayName = updated.displayName || nextName;
      store.markDirty();
      // alert("昵称修改成功");
      showRenameModal.value = false;
    } else {
      alert("修改失败: " + (await res.text()));
    }
  } catch (e: unknown) {
    alert("请求错误: " + (e as Error).message);
  } finally {
    isUpdatingProfile.value = false;
  }
};

const getMusicAvatarUrl = (path?: string) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const apiBase = getApiBase(musicWidget.value?.data?.apiUrl);
  // If it's a relative path like /static/..., prepend API base
  const url = path.startsWith("/") ? `${apiBase}${path}` : `${apiBase}/${path}`;
  return store.getAssetUrl(url);
};

const testWeatherConnection = async (sourceOverride?: string) => {
  isTestingWeather.value = true;
  testWeatherResult.value = null;

  const source = sourceOverride || store.appConfig.weatherSource || "uapi";
  // Use "Shanghai" as a safe default for testing connectivity
  const city = "Shanghai";
  
  let url = "";
  if (source === "qweather") {
    const projectId = store.appConfig.qweatherProjectId || "";
    const keyId = store.appConfig.qweatherKeyId || "";
    const privateKey = store.appConfig.qweatherPrivateKey || "";
    url = `/api/weather?city=${encodeURIComponent(city)}&source=qweather&projectId=${encodeURIComponent(projectId)}&keyId=${encodeURIComponent(keyId)}&privateKey=${encodeURIComponent(privateKey)}`;
  } else if (source === "amap") {
    const key = store.appConfig.amapKey || "";
    url = `/api/weather?city=${encodeURIComponent(city)}&source=amap&key=${encodeURIComponent(key)}`;
  } else {
    // Default / UAPI (OpenMeteo)
    url = `/api/weather?city=${encodeURIComponent(city)}&source=uapi`;
  }

  try {
    const res = await fetch(url);
    const j = await res.json();
    if (res.ok && j.success && j.data) {
      testWeatherResult.value = {
        success: true,
        message: `连接成功！已获取 ${j.data.city} 天气：${j.data.text} ${j.data.temp}°C`,
      };
    } else {
      testWeatherResult.value = {
        success: false,
        message: `连接失败: ${j.error || "未知错误"}`,
      };
    }
  } catch (e) {
    testWeatherResult.value = {
      success: false,
      message: `请求异常: ${(e as Error).message || String(e)}`,
    };
  } finally {
    isTestingWeather.value = false;
  }
};

const passwordInput = ref("");
const newPasswordInput = ref("");
const hasAdminAccess = computed(
  () => store.isLogged && (store.systemConfig.authMode === "single" || store.username === "admin"),
);
const canManageUsers = computed(() => hasAdminAccess.value && store.systemConfig.authMode === "multi");
const isDockerSystemEnabled = computed(() => Boolean(store.systemConfig.enableDocker));
const isUpdatingDockerSystem = ref(false);

const toggleDockerSystemEnabled = async (checked: boolean) => {
  if (isUpdatingDockerSystem.value) return;
  const current = Boolean(store.systemConfig.enableDocker);
  if (current === checked) return;

  isUpdatingDockerSystem.value = true;
  try {
    const success = await store.updateSystemConfig({ enableDocker: checked });
    if (!success) {
      alert("Docker 服务切换失败，请确认当前账号具有管理员权限。");
    }
  } finally {
    isUpdatingDockerSystem.value = false;
  }
};

const toggleDockerMock = (checked: boolean) => {
  const w = dockerWidget.value;
  if (w) {
    if (!w.data) w.data = {};
    w.data.useMock = checked;
    store.markDirty();
  }
};

// Delete Confirmation Logic
const showDeleteWidgetConfirm = ref(false);
const widgetToDeleteId = ref("");
const editingOpacityId = ref<string | null>(null);

const confirmRemoveWidget = () => {
  const index = store.widgets.findIndex((w) => w.id === widgetToDeleteId.value);
  if (index > -1) {
    store.widgets.splice(index, 1);
    store.markDirty();
  }
  showDeleteWidgetConfirm.value = false;
  widgetToDeleteId.value = "";
};
const fileInput = ref<HTMLInputElement | null>(null);
const uploadStatus = ref("");
const musicManagerOpen = ref(false);
const isMusicListLoading = ref(false);
const musicFiles = ref<string[]>([]);
const musicManagerStatus = ref("");

const fetchMusicFiles = async () => {
  isMusicListLoading.value = true;
  musicManagerStatus.value = "";
  try {
    const res = await fetch("/api/music-list");
    if (!res.ok) throw new Error(String(res.status));
    const list = (await res.json()) as unknown;
    musicFiles.value = Array.isArray(list) ? list.map((x) => String(x)) : [];
  } catch {
    musicFiles.value = [];
    musicManagerStatus.value = "获取失败";
  } finally {
    isMusicListLoading.value = false;
  }
};

const toggleMusicManager = async () => {
  musicManagerOpen.value = !musicManagerOpen.value;
  if (musicManagerOpen.value) {
    await fetchMusicFiles();
  }
};

const deleteMusicFile = async (filePath: string) => {
  if (!filePath) return;
  // Removed native confirm as per user request for cleaner UI
  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/music", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || String(res.status));
    }
    await fetchMusicFiles();
  } catch (e: unknown) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    alert("删除失败: " + msg);
  }
};

const uploadMusic = async (event: Event) => {
  const files = (event.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file) {
      formData.append("files", file);
    }
  }

  uploadStatus.value = `正在上传 ${files.length} 个文件...`;
  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/music/upload", {
      method: "POST",
      headers,
      body: formData,
    });
    const data = await res.json();
    if (data.success) {
      uploadStatus.value = `成功上传 ${data.count} 个文件！`;
      if (musicManagerOpen.value) {
        await fetchMusicFiles();
      }
      setTimeout(() => {
        uploadStatus.value = "";
      }, 3000);
    } else {
      uploadStatus.value = "上传失败: " + (data.error || "未知错误");
    }
  } catch (e) {
    console.error(e);
    uploadStatus.value = "上传出错";
  }
};

const formatDockerConnectionError = (error: string, socketPath?: string) => {
  const lower = error.toLowerCase();
  if (lower.includes("docker is disabled")) {
    return "Docker 服务已关闭。\n请先打开“Docker 服务”总开关，再进行连接测试。";
  }
  if (lower.includes("docker not available")) {
    return `Docker 未启用或未配置连接地址。\n容器部署请挂载 /var/run/docker.sock 并设置 dockerHost=unix:///var/run/docker.sock\nSocket: ${socketPath || "-"}`;
  }
  if (lower.includes("docker.sock") || lower.includes("unix:///var/run/docker.sock")) {
    return `无法连接 Docker Socket，请确认宿主机 Docker 已启动，并在容器中挂载 /var/run/docker.sock\nSocket: ${socketPath || "-"}`;
  }
  return `连接失败: ${error}\nSocket: ${socketPath || "-"}`;
};

const checkDockerConnection = async () => {
  if (!isDockerSystemEnabled.value) {
    alert("Docker 服务当前已关闭。\n开启总开关后才会尝试连接 Docker Engine。");
    return;
  }
  try {
    const headers = store.getHeaders();
    const res = await fetch("/api/docker/info", { headers });
    const data = await res.json();
    if (data.success && data.state === "ready") {
      alert(
        `连接成功!\n\nSocket: ${data.socketPath}\n版本: ${data.version.Version}\n系统: ${data.info.OSType} / ${data.info.Architecture}\n容器: ${data.info.Containers}\n名称: ${data.info.Name}`,
      );
    } else if (data.state === "disabled") {
      alert("Docker 服务已关闭。\n请先打开“Docker 服务”总开关。");
    } else {
      alert(formatDockerConnectionError(data.error || "Docker 不可用", data.socketPath));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    alert("网络错误: " + msg);
  }
};

const isExportingDockerLogs = ref(false);
const exportDockerLogs = async () => {
  if (isExportingDockerLogs.value) return;
  if (!isDockerSystemEnabled.value) {
    alert("Docker 服务当前已关闭，已停止日志导出请求。");
    return;
  }
  try {
    isExportingDockerLogs.value = true;
    const headers = store.getHeaders();
    const res = await fetch("/api/docker/export-logs", { headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || String(res.status));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `docker-logs-${ts}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    alert("导出失败: " + msg);
  } finally {
    isExportingDockerLogs.value = false;
  }
};

// Password Confirm Logic
const showPasswordConfirm = ref(false);
const showMultiUserWarning = ref(false);
const pendingAction = ref<(() => void | Promise<void>) | null>(null);
const confirmTitle = ref("");

const requestAuth = (action: () => void | Promise<void>, title: string) => {
  pendingAction.value = action;
  confirmTitle.value = title;
  showPasswordConfirm.value = true;
};

const onAuthSuccess = async () => {
  const action = pendingAction.value;
  pendingAction.value = null;
  if (!action) return;
  await action();
};

const close = () => emit("update:show", false);

const showPassword = ref(false);

const handleLogin = async () => {
  try {
    const success = await store.login("admin", passwordInput.value);
    if (success) {
      alert("登录成功！");
      passwordInput.value = "";
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "密码错误！";
    alert(msg);
  }
};
const handleChangePassword = () => {
  if (!newPasswordInput.value || newPasswordInput.value.length < 4) return alert("密码至少4位");
  requestAuth(async () => {
    store.changePassword(newPasswordInput.value);
    store.markDirty();
    await store.saveData(true);
    alert("密码修改成功，请使用新密码重新登录验证");
    newPasswordInput.value = "";
  }, "请输入当前密码以确认修改");
};

const onMobileDockerDisplayChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement | null)?.checked ?? false;
  const w = dockerWidget.value;
  if (w) {
    w.hideOnMobile = !checked;
    store.markDirty();
  }
};

const handleUltrawideChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    alert(
      "温馨提示：\n1. 分辨率比例判定依据是显示器的物理分辨率或浏览器窗口大小。\n2. 开启此功能后，在分屏显示（如左右并排）时，布局效果可能会变差。\n3. 此模式最适合多屏用户，或将 FlatNas 作为主力办公面板使用的用户。",
    );
  }
};

// Admin User Management
const userList = ref<string[]>([]);
const newUser = ref("");
const newPwd = ref("");
const licenseKey = ref("");

const loadUsers = async () => {
  if (!canManageUsers.value) {
    userList.value = [];
    return;
  }
  const users = await store.fetchUsers();
  if (Array.isArray(users)) {
    userList.value = users;
  }
};

const handleAddUser = async () => {
  if (!newUser.value || !newPwd.value) return alert("请输入用户名和密码");
  try {
    await store.addUser(newUser.value, newPwd.value);
    alert("添加成功");
    newUser.value = "";
    newPwd.value = "";
    loadUsers();
  } catch (e: unknown) {
    alert((e as Error).message || "添加失败");
  }
};

const handleDeleteUser = async (u: string) => {
  if (!confirm(`确定删除用户 ${u} 吗？`)) return;
  try {
    await store.deleteUser(u);
    alert("删除成功");
    loadUsers();
  } catch {
    alert("删除失败");
  }
};

const handleUploadLicense = async () => {
  if (!licenseKey.value) return alert("请输入密钥");
  try {
    await store.uploadLicense(licenseKey.value);
    alert("密钥导入成功，限制已解除");
    licenseKey.value = "";
  } catch (e: unknown) {
    alert((e as Error).message || "导入失败");
  }
};

// Watch for tab change to load users
watch(
  activeTab,
  (val) => {
    if (val === "account" && canManageUsers.value) {
      loadUsers();
    }
  },
  { immediate: true },
);

const toggleAuthMode = async () => {
  const currentMode = store.systemConfig.authMode;
  const newMode = currentMode === "single" ? "multi" : "single";

  if (newMode === "single") {
    if (!confirm("确定要切换到单用户模式吗？\n切换后将隐藏注册入口，默认登录 Admin 账户。")) return;
    requestAuth(() => performAuthModeSwitch(newMode), "请输入管理员密码以确认切换");
  } else {
    // Show custom warning for multi-user mode switch
    showMultiUserWarning.value = true;
  }
};

const performAuthModeSwitch = async (newMode: string) => {
  const success = await store.updateSystemConfig({ authMode: newMode });
  if (success) {
    close();
    store.logout();
  } else {
    alert("切换失败，请检查权限");
  }
};

onMounted(() => {
  store.checkUpdate();
});

// 单用户模式：配置版本管理
const versionLabel = ref("");
const versions = ref<{ id: string; label: string; createdAt: number; size: number }[]>([]);
const loadingVersions = ref(false);
const isImporting = ref(false);
/** 上传阶段 | 导入完成后后台补图标 */
const importOverlayMode = ref<"upload" | "icons">("upload");
const importProgress = ref(0);
const importTotal = ref(0);

const findNavItemByIdInStore = (id: string): NavItem | null => {
  for (const g of store.groups) {
    const found = g.items.find((it) => it.id === id);
    if (found) return found;
  }
  return null;
};

// 文件传输：缩略图管理
const isRegeneratingThumbs = ref(false);
const thumbRegenerationStats = ref<{ processed: number; generated: number; errors: string[] } | null>(null);

const regenerateAllThumbs = async () => {
  if (!confirm("确定要重新生成所有缺失的缩略图吗？\n这可能需要一些时间。")) return;
  
  isRegeneratingThumbs.value = true;
  thumbRegenerationStats.value = null;
  
  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    
    const response = await fetch("/api/transfer/regenerate-thumbs", {
      method: "POST",
      headers,
    });
    
    if (response.ok) {
      const stats = await response.json();
      thumbRegenerationStats.value = {
        processed: stats.processed || 0,
        generated: stats.generated || 0,
        errors: stats.errors || [],
      };
    } else {
      alert("缩略图重新生成失败");
    }
  } catch (err) {
    console.error("Failed to regenerate thumbnails:", err);
    alert("缩略图重新生成失败");
  } finally {
    isRegeneratingThumbs.value = false;
  }
};

const fetchVersions = async () => {
  try {
    loadingVersions.value = true;
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch("/api/config-versions", { headers });
    if (!r.ok) return;
    const j = await r.json();
    versions.value = j.versions || [];
  } finally {
    loadingVersions.value = false;
  }
};

const saveVersion = async () => {
  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch("/api/config-versions", {
      method: "POST",
      headers,
      body: JSON.stringify({ label: versionLabel.value.trim() }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert("保存版本失败: " + (d.error || r.status));
      return;
    }
    versionLabel.value = "";
    await fetchVersions();
  } catch (e) {
    console.error("[SettingsModal][SaveVersion]", e);
  }
};

const restoreVersion = async (id: string) => {
  try {
    if (!confirm("确认恢复该版本？当前配置将被覆盖（密码不变）")) return;
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch("/api/config-versions/restore", {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert("恢复失败: " + (d.error || r.status));
      return;
    }
    window.location.reload();
  } catch (e) {
    console.error("[SettingsModal][RestoreVersion]", e);
  }
};

const deleteVersion = async (id: string) => {
  try {
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch(`/api/config-versions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert("删除失败: " + (d.error || r.status));
      return;
    }
    await fetchVersions();
  } catch (e) {
    console.error("[SettingsModal][DeleteVersion]", e);
  }
};

onMounted(() => {
  if (hasAdminAccess.value && store.systemConfig.authMode === "single") {
    fetchVersions();
  } else if (store.isLogged) {
    // 非单用户模式下，也允许查看自己的版本
    fetchVersions();
  }
});

const getWebhookUrl = () => {
  return toApiUrl("/api/webhook/lucky/stun");
};

const browserHelperHandshakeLink = computed(() => {
  if (typeof window === "undefined") return "";
  const token = localStorage.getItem("flat-nas-token") || "";
  if (!token) return "";

  const origin = window.location.origin;
  const url = new URL(`${origin}/`);
  const params = new URLSearchParams();
  params.set("flatnas-helper-handshake", "1");
  params.set("origin", origin);
  params.set("token", token);
  params.set("source", "open-center");
  url.hash = params.toString();
  return url.toString();
});

const copyBrowserHelperHandshakeLink = async () => {
  const link = browserHelperHandshakeLink.value;
  if (!link) {
    alert("请先登录 FlatNas，再生成浏览器助手握手链接。");
    return;
  }
  await navigator.clipboard.writeText(link);
  alert("已复制浏览器助手握手链接");
};

const openBrowserHelperHandshakeLink = () => {
  const link = browserHelperHandshakeLink.value;
  if (!link) {
    alert("请先登录 FlatNas，再生成浏览器助手握手链接。");
    return;
  }
  window.open(link, "_blank", "noopener,noreferrer");
};

const copyWebhookUrl = () => {
  navigator.clipboard.writeText(getWebhookUrl()).then(() => {
    alert("已复制 Webhook 地址");
  });
};

const formatTime = (ts?: number) => {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
};

onMounted(() => {
  store.fetchLuckyStunData();
});

const isUnknownWidget = (type: string) => {
  const knownTypes = [
    "clock",
    "weather",
    "clockweather",
    "calendar",
    "memo",
    "search",
    "quote",
    "bookmarks",
    "todo",
    "calculator",
    "ip",
    "player",
    "hot",
    "rss",
    "sidebar",
    "iframe",
    "countdown",
    "countup",
    "amap-weather",
    "docker",
    "system-status",
    "status-monitor",
    "file-transfer",
    "music",
  ];

  return !knownTypes.includes(type);
};

const restoreMissingWidgets = () => {
  const defaultWidgets = createDefaultWidgetList(store.isLogged);

  let addedCount = 0;
  defaultWidgets.forEach((def) => {
    const exists = store.widgets.some((w) => w.type === def.type);
    if (!exists) {
      store.widgets.push(def);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    store.markDirty();
    alert(`已恢复 ${addedCount} 个缺失的组件`);
  } else {
    alert("未发现缺失的核心组件");
  }
};

const addCustomCssWidget = () => {
  const newId = "custom-css-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "custom-css",
    enable: true,
    data: {
      title: "自定义组件",
      html: '<div class="my-custom-component">\n  <h3>自定义组件</h3>\n  <p>点击右上角编辑按钮修改内容</p>\n</div>',
      css: ".my-custom-component {\n  padding: 10px;\n  background: linear-gradient(to right, #e0eafc, #cfdef3);\n  border-radius: 8px;\n  text-align: center;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n}\n.my-custom-component h3 {\n  margin: 0 0 5px 0;\n  color: #333;\n}",
    },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.markDirty();
};

const addAmapWeatherWidget = () => {
  const newId = "amap-weather-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "amap-weather",
    enable: true,
    data: { city: "110101", apiKey: "" },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.markDirty();
  alert("已添加高德天气组件，请在组件上配置 API Key");
};

const addMusicWidget = () => {
  const newId = "music-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "music",
    enable: true,
    data: { title: "道理鱼音乐", apiUrl: "", username: "", password: "" },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.markDirty();
};

const enableDockerWidget = () => {
  const def: WidgetConfig = {
    id: "docker",
    type: "docker",
    enable: true,
    isPublic: true,
    colSpan: 1,
    rowSpan: 1,
    data: { useMock: false },
  };
  const exists = store.widgets.find((w) => w.type === "docker");
  if (!exists) {
    store.widgets.push(def);
    store.markDirty();
  } else {
    exists.enable = true;
    store.markDirty();
  }
};

const toggleSystemStatusMock = (checked: boolean) => {
  const w = systemStatusWidget.value;
  if (w) {
    if (!w.data) w.data = {};
    w.data.useMock = checked;
    store.markDirty();
  }
};

const enableSystemStatusWidget = () => {
  const def: WidgetConfig = {
    id: "system-status",
    type: "system-status",
    enable: true,
    isPublic: true,
    colSpan: 1,
    rowSpan: 1,
    data: { useMock: false },
  };
  const exists = store.widgets.find((w) => w.type === "system-status");
  if (!exists) {
    store.widgets.push(def);
    store.markDirty();
  } else {
    exists.enable = true;
    store.markDirty();
  }
};

const onMobileSystemStatusDisplayChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement | null)?.checked ?? false;
  const w = systemStatusWidget.value;
  if (w) {
    w.hideOnMobile = !checked;
    store.markDirty();
  }
};

const handleExport = async () => {
  try {
    // 强制立即保存，确保后端数据也是最新的
    store.markDirty();

    const backupData = {
      items: store.items,
      widgets: store.widgets,
      appConfig: store.appConfig,
      groups: store.groups,
      rssFeeds: store.rssFeeds,
      rssCategories: store.rssCategories,
    };
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flat-nas-backup-${new Date().toISOString().substring(0, 10).replace(/-/g, "")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("导出失败");
    console.error("[SettingsModal][Export] failed", e);
  }
};

const triggerImport = () => {
  fileInput.value?.click();
};

const AUTO_ICON_CHECK_TIMEOUT_MS = 1500;
const autoIconCache = new Map<string, Promise<string>>();

const checkImage = (url: string, timeoutMs = AUTO_ICON_CHECK_TIMEOUT_MS): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finalize = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      // Stop any pending image work once we already know the result.
      img.src = "";
      resolve(ok);
    };
    const timer = window.setTimeout(() => finalize(false), timeoutMs);
    img.onload = () => finalize(true);
    img.onerror = () => finalize(false);
    img.src = url;
  });
};

const getAutoIcon = async (url: string) => {
  if (!url) return "";
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const cacheKey = hostname || url;
    let task = autoIconCache.get(cacheKey);

    if (!task) {
      task = (async () => {
        const candidates = [
          `https://www.favicon.vip/get.php?url=${encodeURIComponent(url)}`,
          `https://icon.bqb.cool?url=${encodeURIComponent(url)}`,
          `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
          `${urlObj.origin}/favicon.ico`,
        ];
        for (const src of candidates) {
          if (await checkImage(src)) return src;
        }
        return "";
      })();
      autoIconCache.set(cacheKey, task);
    }

    return await task;
  } catch {
    // ignore
  }
  return "";
};

const handleFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e: ProgressEvent<FileReader>) => {
    let sunPanelItemsNeedingIcons: NavItem[] = [];
    try {
      const content = e.target?.result as string;
      let data = JSON.parse(content);

      // SunPanel format support
      if (Array.isArray(data.icons)) {
        const newGroups: NavGroup[] = data.icons.map(
          (
            g: {
              title?: string;
              children?: {
                title?: string;
                url?: string;
                lanUrl?: string;
                description?: string;
                openMethod?: number;
                icon?: { src?: string };
              }[];
            },
            gIdx: number,
          ) => ({
            id: Date.now().toString() + "_" + gIdx,
            title: g.title || "New Group",
            items: (g.children || []).map(
              (
                c: {
                  title?: string;
                  url?: string;
                  lanUrl?: string;
                  description?: string;
                  openMethod?: number;
                  icon?: { src?: string };
                },
                cIdx: number,
              ) => {
                let icon = c.icon?.src || "";
                // Only keep absolute URLs (http/https), discard relative paths (server-local)
                if (!icon.startsWith("http")) {
                  icon = "";
                }

                return {
                  id: Date.now().toString() + "_" + gIdx + "_" + cIdx,
                  title: c.title || "New Item",
                  url: c.url || "",
                  lanUrl: c.lanUrl || "",
                  icon: icon,
                  description1: c.description || "",
                  // SunPanel: 2 usually means new tab
                  openInNewTab: c.openMethod === 2,
                  isPublic: true,
                };
              },
            ),
          }),
        );

        // SunPanel：先快速导入；图标在「导入成功」后于后台抓取并单独保存（见下方 POST 之后逻辑）
        const allItems = newGroups.flatMap((g) => g.items);
        sunPanelItemsNeedingIcons = allItems.filter((it) => !it.icon && !!(it.url || it.lanUrl));

        // Preserve existing config, append new groups
        const existingGroups = store.groups;
        const finalGroups = [...existingGroups, ...newGroups];

        data = {
          groups: finalGroups,
          items: finalGroups.flatMap((g) => g.items),
          widgets: store.widgets,
          appConfig: store.appConfig,
        };
      } else if ((!data.groups || data.groups.length === 0) && data.items) {
        const items = data.items.map((item: NavItem) => ({
          ...item,
          isPublic: item.isPublic ?? true,
        }));
        data.groups = [{ id: Date.now().toString(), title: "默认分组", items: items }];
      }
      if ("password" in data) {
        delete data.password;
      }

      isImporting.value = true;
      importOverlayMode.value = "upload";
      importProgress.value = 0;
      importTotal.value = 0;

      const token = localStorage.getItem("flat-nas-token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch("/api/data/import", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("import_post_failed:" + r.status);

      await store.fetchData();

      if (sunPanelItemsNeedingIcons.length > 0) {
        importOverlayMode.value = "icons";
        importTotal.value = sunPanelItemsNeedingIcons.length;
        importProgress.value = 0;

        const batchSize = 10;
        for (let i = 0; i < sunPanelItemsNeedingIcons.length; i += batchSize) {
          const batch = sunPanelItemsNeedingIcons.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (refItem) => {
              try {
                const live = findNavItemByIdInStore(refItem.id);
                if (!live || live.icon) return;
                const targetUrl = live.url || live.lanUrl;
                if (targetUrl) {
                  const icon = await getAutoIcon(targetUrl);
                  if (icon) live.icon = icon;
                }
              } finally {
                importProgress.value++;
              }
            }),
          );
        }

        const saveResult = await store.saveData(true, true);
        if (saveResult !== "saved" && saveResult !== "no_change") {
          console.warn("[SettingsModal][Import] post-icon saveData:", saveResult);
          if (saveResult === "conflict") {
            alert("配置已导入且图标已尽量抓取，但保存时出现版本冲突，请刷新页面后再试。");
            return;
          }
        }
      }

      alert("导入成功！");
    } catch (err) {
      alert("导入失败，请检查文件格式是否为 JSON。");
      console.error("[SettingsModal][Import] failed", err);
    } finally {
      if (fileInput.value) fileInput.value.value = "";
      isImporting.value = false;
      importOverlayMode.value = "upload";
      importProgress.value = 0;
      importTotal.value = 0;
    }
  };
  reader.readAsText(file);
};

const saveDefaultBtnText = ref("设为默认模板");

const handleReset = async () => {
  requestAuth(async () => {
    // 密码验证通过后直接执行
    try {
      const token = localStorage.getItem("flat-nas-token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch("/api/reset", {
        method: "POST",
        headers,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "reset_failed");
      }
      // 移除成功弹窗，直接刷新
      window.location.reload();
    } catch (e: unknown) {
      const err = e as Error;
      alert("恢复失败: " + (err.message || "未知错误"));
      console.error("[SettingsModal][Reset] failed", e);
    }
  }, "请输入密码以确认恢复初始化");
};

const handleSaveAsDefault = async () => {
  requestAuth(async () => {
    // 密码验证通过后直接执行
    try {
      const token = localStorage.getItem("flat-nas-token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch("/api/default/save", {
        method: "POST",
        headers,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || "save_default_failed");
      }

      // 移除成功弹窗，使用按钮文字反馈
      saveDefaultBtnText.value = "保存成功！";
      setTimeout(() => {
        saveDefaultBtnText.value = "设为默认模板";
      }, 2000);
    } catch (e: unknown) {
      const err = e as Error;
      alert("保存失败: " + (err.message || "未知错误"));
      console.error("[SettingsModal][SaveDefault] failed", e);
    }
  }, "请输入密码以确认保存默认模板");
};

const normalizeFileTransferWidgets = () => {
  const list = store.widgets;
  const all = list.filter((w) => w.type === "file-transfer");
  if (all.length === 0) return;

  const keep = all.find((w) => w.id === "file-transfer") || all[0]!;
  let changed = false;

  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    if (w && w.type === "file-transfer" && w.id !== keep.id) {
      list.splice(i, 1);
      changed = true;
    }
  }

  if (
    keep.id !== "file-transfer" &&
    !list.some((w) => w.id === "file-transfer" && w.type !== "file-transfer")
  ) {
    keep.id = "file-transfer";
    changed = true;
  }

  if (changed) store.markDirty();
};

// 修复：移除 computed 中的副作用，改用 onMounted 初始化
onMounted(() => {
  store.widgets.forEach((w: WidgetConfig) => {
    if (w.type === "iframe" && !w.data) {
      w.data = { url: "" };
    }
  });
  normalizeFileTransferWidgets();
});

const addIframeWidget = () => {
  const newId = "w-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "iframe",
    enable: true,
    data: { url: "" },
    colSpan: 2,
    rowSpan: 2,
    isPublic: true,
  });
  store.markDirty();
};

const addCountdownWidget = () => {
  const newId = "w-cd-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "countdown",
    enable: true,
    data: {
      targetDate: "",
      title: "重要时刻",
      style: "card",
    },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.markDirty();
};

const addCountUpWidget = () => {
  const newId = "w-cup-" + Date.now();
  store.widgets.push({
    id: newId,
    type: "countup",
    enable: true,
    data: {
      startTime: new Date().toISOString().slice(0, 16),
      title: "正计时",
      style: "card",
      isRunning: false,
      totalPauseDuration: 0,
      pauseStartTime: null,
    },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.markDirty();
};

const removeWidget = (id: string) => {
  widgetToDeleteId.value = id;
  showDeleteWidgetConfirm.value = true;
};

const deleteWidget = (id: string) => {
  removeWidget(id);
};

// Wallpaper Library Logic
// Wallpaper logic moved to WallpaperLibrary.vue
// Keeping minimal code if needed, or remove completely if unused.
// Since we removed the UI that uses these functions, we can remove the functions too.
// However, to be safe and clean, I will remove the unused refs and functions.

/* Removed: wallpapers, loadingWallpapers, fetchWallpapers, deleteWallpaper, uploadWallpaperInput, triggerWallpaperUpload, handleWallpaperUpload */
/* Removed: mobileWallpapers, loadingMobileWallpapers, fetchMobileWallpapers, deleteMobileWallpaper, uploadMobileWallpaperInput, triggerMobileWallpaperUpload, handleMobileWallpaperUpload */

onMounted(() => {
  // Removed wallpaper fetches
});

// Dragging Logic
const modalPosition = ref({ x: 0, y: 0 });
const isDragging = ref(false);
const dragStart = { x: 0, y: 0 };
const initialModalPosition = { x: 0, y: 0 };

const onMouseDown = (e: MouseEvent) => {
  // Prevent dragging if clicking on interactive elements
  if ((e.target as HTMLElement).closest("button, input, textarea, a, .no-drag")) return;

  isDragging.value = true;
  dragStart.x = e.clientX;
  dragStart.y = e.clientY;
  initialModalPosition.x = modalPosition.value.x;
  initialModalPosition.y = modalPosition.value.y;

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
};

const onMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  modalPosition.value.x = initialModalPosition.x + dx;
  modalPosition.value.y = initialModalPosition.y + dy;
};

const onMouseUp = () => {
  isDragging.value = false;
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
};

// Nav Dragging Logic
const navRef = ref<HTMLElement | null>(null);
const isNavDragging = ref(false);
const navStartX = ref(0);
const navScrollLeft = ref(0);

const onNavMouseDown = (e: MouseEvent) => {
  if (!navRef.value) return;
  isNavDragging.value = true;
  navStartX.value = e.pageX - navRef.value.offsetLeft;
  navScrollLeft.value = navRef.value.scrollLeft;
};

const onNavMouseMove = (e: MouseEvent) => {
  if (!isNavDragging.value || !navRef.value) return;
  e.preventDefault();
  const x = e.pageX - navRef.value.offsetLeft;
  const walk = (x - navStartX.value) * 2;
  navRef.value.scrollLeft = navScrollLeft.value - walk;
};

const onNavMouseUp = () => {
  isNavDragging.value = false;
};

watch(
  () => props.show,
  (val) => {
    if (val && activeTab.value === "account" && store.isLogged) {
      if (canManageUsers.value) {
        loadUsers();
      }
      if (store.systemConfig.authMode === "single" || !canManageUsers.value) {
        fetchVersions();
      }
    }
  },
);

watch(activeTab, (val) => {
  if (val === "account" && store.isLogged && (store.systemConfig.authMode === "single" || !canManageUsers.value)) {
    fetchVersions();
  }
});
</script>

<template>
  <OverlayMotion
    :show="show"
    :z-index="50"
    overlay-class="bg-black/30 backdrop-blur-sm p-3"
    panel-class="w-full max-w-3xl"
  >
    <div
      v-if="isImporting"
      class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center"
    >
      <div class="bg-white rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4 text-center space-y-4">
        <div
          class="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto"
        ></div>
        <div>
          <h3 class="text-lg font-bold text-gray-900">
            {{ importOverlayMode === "upload" ? "正在导入配置…" : "正在后台抓取图标…" }}
          </h3>
          <p class="text-sm text-gray-500 mt-1">
            <template v-if="importOverlayMode === 'upload'">
              正在保存到服务器，请稍候（完成后若需补图标会继续显示进度）
            </template>
            <template v-else>
              配置已保存。正在从网络获取网站图标，完成后会自动写入配置。若某个站点较慢会短暂停顿，属于正常现象。
            </template>
          </p>
        </div>
        <div v-if="importOverlayMode === 'icons' && importTotal > 0" class="space-y-1">
          <div class="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div
              class="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
              :style="{ width: `${(importProgress / importTotal) * 100}%` }"
            ></div>
          </div>
          <p class="text-xs text-gray-400">图标进度：{{ importProgress }} / {{ importTotal }}</p>
        </div>
      </div>
    </div>

    <div
      class="backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col md:flex-row h-[600px] md:h-[480px] relative"
      :class="isNightDaylightMode ? 'night-settings bg-slate-900/60 text-slate-100 border border-white/10' : 'bg-white/90'"
      :style="{ transform: `translate(${modalPosition.x}px, ${modalPosition.y}px)` }"
      @wheel.stop
    >
      <button
        @click="close"
        class="absolute top-4 right-4 bg-red-100 hover:bg-red-200 text-red-500 hover:text-red-900 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div
        class="w-full md:w-1/4 bg-transparent border-b md:border-b-0 md:border-r border-gray-100 p-3 flex flex-col md:flex-col shrink-0 cursor-move glass-panel"
        @mousedown="onMouseDown"
      >
        <h3 class="text-xl font-bold text-gray-900 mb-3 md:mb-4 px-2">设置</h3>
        <nav
          ref="navRef"
          class="flex flex-row md:flex-col gap-1 md:gap-0 md:space-y-0.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0 no-drag cursor-grab active:cursor-grabbing overscroll-contain"
          @mousedown="onNavMouseDown"
          @mousemove="onNavMouseMove"
          @mouseup="onNavMouseUp"
          @mouseleave="onNavMouseUp"
          @wheel.stop.passive="handleNavWheel"
        >
          <button
            @click="activeTab = 'style'"
            :class="
              activeTab === 'style'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            外观布局
          </button>
          <button
            @click="activeTab = 'widgets'"
            :class="
              activeTab === 'widgets'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            单开组件
          </button>

          <button
            @click="activeTab = 'universal-window'"
            :class="
              activeTab === 'universal-window'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            多开组件
          </button>
          <button
            @click="activeTab = 'docker'"
            :class="
              activeTab === 'docker'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            Docker 管理
          </button>
          <button
            @click="activeTab = 'account'"
            :class="
              activeTab === 'account'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            账户管理
          </button>
          <button
            @click="activeTab = 'network'"
            :class="[
              'px-3 py-1.5 text-sm transition-colors text-left flex items-center gap-1.5',
              activeTab === 'network'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50',
            ]"
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 rounded-lg"
          >
            网络判定
          </button>
          <button
            @click="activeTab = 'lucky-stun'"
            :class="
              activeTab === 'lucky-stun'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            开放中心
          </button>
          <button
            @click="activeTab = 'about'"
            :class="
              activeTab === 'about'
                ? 'selected-outline text-gray-900'
                : 'border border-transparent text-red-500 hover:bg-red-50 font-medium'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            关于
          </button>
        </nav>
        <div v-if="iconSrc" class="mt-auto px-3 pb-3 hidden md:flex justify-center">
          <img :src="iconSrc" class="w-1/4 h-auto rounded-lg shadow-sm" alt="Custom Icon" />
        </div>
      </div>

      <div class="flex-1 flex flex-col bg-transparent overflow-hidden glass-panel">
        <div class="flex-1 p-3 overflow-y-auto overscroll-contain" @wheel.stop>
          <div v-if="activeTab === 'style'" class="space-y-4">
            <div class="bg-white/60 border border-gray-100 rounded-xl p-4">
              <h4 class="text-base font-bold mb-4 text-gray-900">基础信息</h4>
              <div class="space-y-2">
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block">网站标题</label>
                  <input
                    v-model="store.appConfig.customTitle"
                    type="text"
                    class="w-full px-2 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                  />
                </div>
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block">背景图片</label>
                  <div class="border border-gray-200 rounded-xl p-2 bg-white/60">
                    <IconUploader
                      v-model="store.appConfig.background"
                      @update:modelValue="store.markDirty()"
                      :crop="false"
                      :previewStyle="{
                        filter: `blur(${store.appConfig.backgroundBlur ?? 0}px)`,
                        transform: 'scale(1.1)',
                      }"
                      :overlayStyle="{
                        backgroundColor: `rgba(0,0,0,${store.appConfig.backgroundMask ?? 0})`,
                      }"
                    />
                    <div class="mt-2 flex justify-between items-center">
                      <button
                        v-if="store.appConfig.background"
                        @click="
                          store.appConfig.background = '';
                          store.markDirty();
                        "
                        class="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded bg-red-50 hover:bg-red-100 transition-colors"
                      >
                        清除背景
                      </button>
                      <button
                        @click="showWallpaperLibrary = true"
                        class="text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 ml-auto px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 transition-colors"
                      >
                        管理壁纸库
                      </button>
                    </div>
                  </div>
                </div>
                <div class="space-y-2">
                  <div class="flex items-center justify-between rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
                    <div class="flex flex-col">
                      <span class="text-sm font-medium text-gray-700">白昼模式</span>
                      <span class="text-[11px] text-gray-400"
                        >白天 6:00-18:00，夜间 18:00-6:00 自动调整遮罩为
                        {{ daylightMaskPercent }}%</span
                      >
                    </div>
                    <div class="flex items-center gap-2">
                      <div
                        class="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white/80 text-gray-700"
                      >
                        <input
                          v-model.number="daylightMaskPercent"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          class="w-12 text-xs bg-transparent outline-none"
                        />
                        <span class="text-xs">%</span>
                      </div>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          class="sr-only peer"
                          :checked="store.appConfig.daylightModeEnabled"
                          @change="
                            (e) => {
                              store.appConfig.daylightModeEnabled = (
                                e.target as HTMLInputElement
                              ).checked;
                              store.markDirty();
                            }
                          "
                        />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-400"
                        ></div>
                      </label>
                    </div>
                  </div>
                  <div class="flex items-center justify-between rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
                    <div class="flex flex-col">
                      <span class="text-sm font-medium text-gray-700">环境天气效果</span>
                      <span class="text-[11px] text-gray-400">雨天自动开启背景雨效</span>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        class="sr-only peer"
                        :checked="store.appConfig.weatherEffectEnabled"
                        @change="
                          (e) => {
                            store.appConfig.weatherEffectEnabled = (
                              e.target as HTMLInputElement
                            ).checked;
                            store.markDirty();
                          }
                        "
                      />
                      <div
                        class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                      ></div>
                    </label>
                  </div>
                </div>
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block">纯色背景</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      v-model="solidBackgroundColorProxy"
                      class="w-10 h-10 rounded cursor-pointer border-0 p-0"
                    />
                    <input
                      v-model="store.appConfig.solidBackgroundColor"
                      @change="store.markDirty()"
                      type="text"
                      placeholder="#f3f4f6"
                      class="flex-1 px-2 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                    />
                    <button
                      @click="
                        store.appConfig.solidBackgroundColor = '';
                        store.markDirty();
                      "
                      class="px-3 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-500 transition-colors text-xs font-medium"
                      title="清除纯色背景"
                    >
                      重置
                    </button>
                    <button
                      @click="setSolidColorAsWallpaper"
                      class="px-3 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 flex items-center justify-center text-blue-600 transition-colors text-xs font-medium"
                      title="设为壁纸"
                    >
                      设为壁纸
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <WallpaperLibrary v-model:show="showWallpaperLibrary" @select="handleWallpaperSelect" />

            <div class="bg-white/60 border border-gray-100 rounded-xl p-4">
              <h4 class="text-base font-bold mb-4 text-gray-900">布局与排版</h4>
              <div class="mb-2">
                <h5 class="text-sm font-medium text-gray-700 mb-2">顶部栏布局</h5>
                <div class="flex gap-2">
                  <button
                    @click="store.appConfig.titleAlign = 'left'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2 transition-colors"
                    :class="
                      store.appConfig.titleAlign === 'left'
                        ? 'selected-outline text-gray-900'
                        : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'
                    "
                  >
                    <span class="text-sm">标准布局</span>
                  </button>
                  <button
                    @click="store.appConfig.titleAlign = 'right'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2 transition-colors"
                    :class="
                      store.appConfig.titleAlign === 'right'
                        ? 'selected-outline text-gray-900'
                        : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'
                    "
                  >
                    <span class="text-sm">反转布局</span>
                  </button>
                  <button
                    @click="
                      store.appConfig.hideHeaderOnMobile = !store.appConfig.hideHeaderOnMobile
                    "
                    class="flex flex-1 p-2 border-2 rounded-xl items-center justify-center gap-2 transition-colors"
                    :class="
                      store.appConfig.hideHeaderOnMobile
                        ? 'selected-outline text-gray-900'
                        : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'
                    "
                  >
                    <span class="text-sm">手机隐藏顶部</span>
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-2">
                <div>
                  <h4 class="text-sm font-medium text-gray-700 mb-1">标题大小</h4>
                  <input
                    type="range"
                    v-model.number="store.appConfig.titleSize"
                    min="20"
                    max="80"
                    class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                  />
                </div>
                <div>
                  <h4 class="text-sm font-medium text-gray-700 mb-1">标题颜色</h4>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      v-model="store.appConfig.titleColor"
                      class="w-10 h-10 rounded cursor-pointer border-0 p-0"
                    />
                    <button
                      @click="store.appConfig.titleColor = '#ffffff'"
                      class="px-3 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-500 transition-colors text-xs font-medium"
                      title="重置颜色"
                    >
                      重置
                    </button>
                  </div>
                </div>
              </div>
              <div class="mb-2">
                <h5 class="text-sm font-medium text-gray-700 mb-2">WEB端布局</h5>
                <div
                  class="flex items-center justify-between border border-gray-200 rounded-xl p-3"
                >
                  <span class="text-sm font-bold text-gray-900">展现方式</span>
                  <div class="flex items-center gap-2">
                    <div
                      class="relative h-9 w-[180px] rounded-full bg-gray-100/90 p-1 flex items-center select-none shadow-inner focus-within:ring-2 focus-within:ring-green-300/60 focus-within:ring-offset-2 focus-within:ring-offset-white/60"
                    >
                      <div
                        class="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-green-500 shadow-sm shadow-green-500/25 transition-transform duration-200"
                        :class="
                          store.appConfig.webGroupPagination
                            ? 'translate-x-[calc(100%+4px)]'
                            : 'translate-x-0'
                        "
                      ></div>
                      <button
                        type="button"
                        class="relative z-10 w-1/2 h-full text-xs font-bold rounded-full transition-colors focus-visible:outline-none"
                        :class="
                          store.appConfig.webGroupPagination
                            ? 'text-gray-600 hover:text-gray-800'
                            : 'text-white'
                        "
                        @click="store.appConfig.webGroupPagination = false"
                      >
                        一栏页
                      </button>
                      <button
                        type="button"
                        class="relative z-10 w-1/2 h-full text-xs font-bold rounded-full transition-colors focus-visible:outline-none"
                        :class="
                          store.appConfig.webGroupPagination
                            ? 'text-white'
                            : 'text-gray-600 hover:text-gray-800'
                        "
                        @click="store.appConfig.webGroupPagination = true"
                      >
                        按组分页
                      </button>
                    </div>
                    <button
                      type="button"
                      class="h-9 px-3 rounded-xl text-xs font-bold border transition-colors focus-visible:outline-none"
                      :disabled="!store.appConfig.webGroupPagination"
                      :class="
                        !store.appConfig.webGroupPagination
                          ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                          : store.appConfig.webGroupPaginationDisableFlip
                            ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      "
                      @click="
                        store.appConfig.webGroupPaginationDisableFlip =
                          !store.appConfig.webGroupPaginationDisableFlip
                      "
                    >
                      禁止翻页
                    </button>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <h4 class="text-sm font-medium text-gray-700 mb-1">组件区整区尺寸</h4>
                  <div class="flex items-center gap-2">
                    <input
                      type="number"
                      v-model.number="store.appConfig.widgetAreaCols"
                      min="0.5"
                      step="0.5"
                      max="16"
                      class="w-20 px-2 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm bg-white"
                    />
                    <span class="text-xs text-gray-400 select-none">×</span>
                    <input
                      type="number"
                      v-model.number="store.appConfig.widgetAreaRows"
                      min="0.5"
                      step="0.5"
                      max="16"
                      class="w-20 px-2 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm bg-white"
                    />
                    <span class="ml-auto text-xs text-gray-500 w-14 text-right"
                      >{{ store.appConfig.widgetAreaCols ?? 4 }}×{{
                        store.appConfig.widgetAreaRows ?? 4
                      }}</span
                    >
                  </div>
                </div>
                <div>
                  <h4 class="text-sm font-medium text-gray-700 mb-1">分组垂直间距</h4>
                  <div class="flex items-center gap-2">
                    <input
                      type="range"
                      v-model.number="store.appConfig.groupGap"
                      min="0"
                      max="100"
                      step="5"
                      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                    />
                    <span class="text-xs text-gray-500 w-6">{{
                      store.appConfig.groupGap ?? 30
                    }}</span>
                  </div>
                </div>
                <div>
                  <h4 class="text-sm font-medium text-gray-700 mb-1">鼠标悬停效果</h4>
                  <select
                    v-model="store.appConfig.mouseHoverEffect"
                    class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm bg-white"
                  >
                    <option value="scale">缩放 (默认)</option>
                    <option value="lift">上浮</option>
                    <option value="glow">发光</option>
                    <option value="none">无</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="bg-white/60 border border-gray-100 rounded-xl p-4">
              <h4 class="text-base font-bold mb-4 text-gray-900">页脚设置</h4>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-medium text-gray-700">显示访客统计</label>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      v-model="store.appConfig.showFooterStats"
                      class="sr-only peer"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-medium text-gray-700 mb-1 block"
                      >页脚高度 (px)</label
                    >
                    <div class="text-xs text-gray-500 mb-1">0 为自适应</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerHeight"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label class="text-sm font-medium text-gray-700 mb-1 block"
                      >页脚内容宽度 (px)</label
                    >
                    <div class="text-xs text-gray-500 mb-1">默认 1280</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerWidth"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                      placeholder="1280"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-medium text-gray-700 mb-1 block"
                      >页脚距底部 (px)</label
                    >
                    <div class="text-xs text-gray-500 mb-1">调整页脚垂直位置</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerMarginBottom"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label class="text-sm font-medium text-gray-700 mb-1 block"
                      >页脚字体大小 (px)</label
                    >
                    <div class="text-xs text-gray-500 mb-1">默认 12px</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerFontSize"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                      placeholder="12"
                    />
                  </div>
                </div>
                <div>
                  <label class="text-sm font-medium text-gray-700 mb-1 block"
                    >自定义页脚内容 (HTML)</label
                  >
                  <textarea
                    v-model="store.appConfig.footerHtml"
                    rows="3"
                    placeholder="可输入备案号等信息，支持 HTML 标签"
                    class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm font-mono"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'widgets'" class="space-y-4">
            <div class="flex items-center justify-between mb-4 mr-8">
              <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                桌面组件
              </h4>
              <div class="flex items-center gap-3 text-xs mr-[10px]">
                <button
                  @click="restoreMissingWidgets"
                  class="text-gray-600 hover:text-gray-900 underline mr-2"
                >
                  恢复默认组件
                </button>
                <button
                  @click="addCustomCssWidget"
                  class="text-gray-600 hover:text-gray-900 underline mr-2"
                >
                  + 自定义组件
                </button>
              </div>
            </div>

            <div
              v-if="shouldShowSingleWidgetDiagnostic"
              class="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900"
            >
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="space-y-1">
                  <div class="font-bold">单开组件数量异常偏少</div>
                  <p class="text-xs leading-relaxed text-amber-800">
                    当前只检测到 {{ singleOpenWidgets.length }} 个单开组件（总组件
                    {{ store.widgets.length }} 个）：{{ singleWidgetDiagnosticTypes }}。如果刷新、登录或云端同步后组件突然变少，可能是缓存或远端快照覆盖了本地组件列表。
                  </p>
                </div>
                <button
                  type="button"
                  @click="restoreMissingWidgets"
                  class="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700"
                >
                  恢复默认组件
                </button>
              </div>
            </div>

            <!-- Normal Widgets Grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <template v-for="w in singleOpenWidgets" :key="w.id">
                <div
                  :class="[
                    'border border-gray-100 rounded-xl bg-white/60 hover:shadow-md transition-all relative',
                    w.type === 'player'
                      ? 'col-span-2 md:col-span-4 flex flex-col gap-3 p-4 md:grid md:grid-cols-[auto_1fr_auto] md:items-center md:gap-4'
                      : 'flex flex-col items-stretch gap-2 p-3',
                  ]"
                >
                  <button
                    v-if="isUnknownWidget(w.type)"
                    @click="deleteWidget(w.id)"
                    class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full text-xs transition-colors z-20"
                    title="删除组件"
                  >
                    ✕
                  </button>
                  <template v-if="w.type === 'player'">
                    <div class="flex items-center gap-3 flex-shrink-0">
                      <div
                        class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                      >
                        音
                      </div>
                      <span class="font-bold text-gray-700 text-sm">随机音乐</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <label
                        class="px-3 py-1.5 text-gray-700 text-xs rounded-lg cursor-pointer transition-colors flex items-center gap-1 whitespace-nowrap glass-chip selectable-outline"
                      >
                        <span>上传音乐</span>
                        <input
                          type="file"
                          accept="audio/*"
                          class="hidden"
                          multiple
                          @change="uploadMusic"
                        />
                      </label>
                      <button
                        type="button"
                        @click="toggleMusicManager"
                        class="px-3 py-1.5 text-gray-700 text-xs rounded-lg cursor-pointer transition-colors flex items-center gap-1 whitespace-nowrap glass-chip selectable-outline"
                      >
                        {{ musicManagerOpen ? "收起文件" : "文件管理" }} ({{ musicFiles.length }})
                      </button>
                      <span
                        v-if="uploadStatus"
                        class="text-xs"
                        :class="uploadStatus.includes('失败') ? 'text-red-500' : 'text-green-500'"
                        >{{ uploadStatus }}</span
                      >
                    </div>
                    <div class="flex flex-col items-stretch gap-2 md:items-end">
                      <div class="flex items-center gap-2 justify-end">
                        <span class="text-xs text-gray-500 whitespace-nowrap">音量</span>
                        <input
                          v-model.number="musicVolumePercent"
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          class="w-28 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>
                      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div class="flex flex-col items-center gap-0.5">
                          <span class="text-[10px] text-gray-400 scale-90">公开</span>
                          <label
                            class="relative inline-flex items-center cursor-pointer"
                            title="公开"
                            ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" @change="store.saveData()" />
                            <div
                              class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"
                            ></div
                          ></label>
                        </div>
                        <div class="flex flex-col items-center gap-0.5">
                          <span class="text-[10px] text-gray-400 scale-90">启用</span>
                          <label
                            class="relative inline-flex items-center cursor-pointer"
                            title="启用"
                            ><input type="checkbox" v-model="w.enable" class="sr-only peer" @change="store.saveData()" />
                            <div
                              class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500"
                            ></div
                          ></label>
                        </div>
                        <div class="flex flex-col items-center gap-0.5">
                          <span class="text-[10px] text-gray-400 scale-90">手机</span>
                          <label
                            class="relative inline-flex items-center cursor-pointer"
                            title="手机"
                            ><input
                              type="checkbox"
                              :checked="!w.hideOnMobile"
                              class="sr-only peer"
                              @change="
                                (e) => {
                                  w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                                  store.markDirty();
                                }
                              " />
                            <div
                              class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-500"
                            ></div
                          ></label>
                        </div>
                        <div class="flex flex-col items-center gap-0.5">
                          <span class="text-[10px] text-gray-400 scale-90">自动</span>
                          <label
                            class="relative inline-flex items-center cursor-pointer"
                            title="自动播放"
                            ><input
                              type="checkbox"
                              v-model="store.appConfig.autoPlayMusic"
                              @change="store.markDirty()"
                              class="sr-only peer" />
                            <div
                              class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"
                            ></div
                          ></label>
                        </div>
                      </div>
                    </div>
                    <div v-if="musicManagerOpen" class="md:col-start-1 md:col-span-3 space-y-2">
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          @click="fetchMusicFiles"
                          class="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-1 whitespace-nowrap"
                          :disabled="isMusicListLoading"
                        >
                          {{ isMusicListLoading ? "刷新中..." : "刷新列表" }}
                        </button>
                        <span v-if="musicManagerStatus" class="text-xs text-red-500">{{
                          musicManagerStatus
                        }}</span>
                        <span v-else class="text-xs text-gray-500"
                          >共 {{ musicFiles.length }} 个文件</span
                        >
                      </div>
                      <div
                        class="border border-gray-100 rounded-xl bg-gray-50 p-3 max-h-44 overflow-auto"
                      >
                        <div v-if="isMusicListLoading" class="text-xs text-gray-500">加载中...</div>
                        <div v-else-if="musicFiles.length === 0" class="text-xs text-gray-500">
                          暂无音乐文件
                        </div>
                        <div v-else class="space-y-1">
                          <div
                            v-for="f in musicFiles"
                            :key="f"
                            class="flex items-center gap-2 text-xs"
                          >
                            <span class="flex-1 truncate text-gray-700" :title="f">{{ f }}</span>
                            <button
                              type="button"
                              class="px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                              @click="deleteMusicFile(f)"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div
                      class="flex flex-col items-center gap-1.5 scale-100 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors w-full py-1"
                      @click="
                        w.type === 'music'
                          ? scrollToMusicSettings()
                          : w.type === 'system-status'
                            ? (activeTab = 'docker')
                            : (editingOpacityId = w.id)
                      "
                      :title="
                        w.type === 'music' || w.type === 'system-status'
                          ? '点击进入设置'
                          : '点击调整样式'
                      "
                    >
                      <template v-if="editingOpacityId === w.id">
                        <div class="w-full px-2" @click.stop>
                          <label class="text-[10px] text-gray-500 block mb-1"
                            >透明度
                            {{
                              Math.round((w.opacity ?? (w.type === "search" ? 0.9 : 1)) * 100)
                            }}%</label
                          >
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.1"
                            :value="w.opacity ?? (w.type === 'search' ? 0.9 : 1)"
                            @input="
                              (e) => {
                                w.opacity = parseFloat((e.target as HTMLInputElement).value);
                                store.markDirty();
                              }
                            "
                            class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-400"
                          />
                          <div class="flex items-center justify-between mt-2 gap-2">
                            <label class="text-[10px] text-gray-500">文字颜色</label>
                            <div class="flex items-center gap-2">
                              <input
                                type="color"
                                :value="
                                  w.textColor || (w.type === 'search' ? '#111827' : '#374151')
                                "
                                @input="
                                  (e) => {
                                    w.textColor = (e.target as HTMLInputElement).value;
                                    store.markDirty();
                                  }
                                "
                                @change="store.markDirty()"
                                class="w-5 h-5 p-0 border-0 rounded-full cursor-pointer overflow-hidden shadow-sm"
                                title="选择颜色"
                              />
                              <button
                                v-if="w.textColor"
                                @click.stop="
                                  w.textColor = undefined;
                                  store.markDirty();
                                "
                                class="text-[10px] text-red-400 hover:text-red-600"
                                title="重置颜色"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <button
                            @click.stop="editingOpacityId = null"
                            class="mt-2 text-xs text-gray-600 hover:text-gray-900 w-full text-center border-t border-gray-100 pt-1"
                          >
                            完成
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <div
                          class="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center text-xs font-medium text-gray-700 shadow-sm"
                        >
                          <img
                            v-if="w.type === 'music'"
                            :src="daoliyuLogo"
                            class="w-6 h-6 object-contain"
                          />
                          <template v-else>
                            {{
                              w.type === "clock"
                                ? "时"
                                : w.type === "weather"
                                  ? "天"
                                  : w.type === "clockweather"
                                    ? "合"
                                    : w.type === "calendar"
                                      ? "日"
                                      : w.type === "memo"
                                        ? "备"
                                        : w.type === "search"
                                          ? "搜"
                                          : w.type === "quote"
                                            ? "言"
                                            : w.type === "bookmarks"
                                              ? "藏"
                                              : w.type === "file-transfer"
                                                ? "传"
                                                : w.type === "todo"
                                                  ? "待"
                                                  : w.type === "calculator"
                                                    ? "算"
                                                    : w.type === "ip"
                                                      ? "IP"
                                                      : w.type === "player"
                                                        ? "音"
                                                        : w.type === "hot"
                                                          ? "热"
                                                          : w.type === "rss"
                                                            ? "阅"
                                                            : w.type === "sidebar"
                                                              ? "侧"
                                                              : w.type === "status-monitor"
                                                                ? "监"
                                                                : w.type === "custom-css"
                                                                  ? "自"
                                                                  : "组"
                            }}
                          </template>
                        </div>
                        <span
                          class="font-bold text-gray-700 text-xs leading-snug text-center truncate w-full px-1"
                        >
                          {{
                            w.type === "clock"
                              ? "时钟"
                              : w.type === "weather"
                                ? "天气"
                                : w.type === "clockweather"
                                  ? "时钟+天气"
                                  : w.type === "sidebar"
                                    ? "侧边栏"
                                    : w.type === "calendar"
                                      ? "日历"
                                      : w.type === "memo"
                                        ? "备忘录"
                                        : w.type === "search"
                                          ? "聚合搜索"
                                          : w.type === "quote"
                                            ? "每日一言"
                                            : w.type === "bookmarks"
                                              ? "收藏夹"
                                              : w.type === "file-transfer"
                                                ? "文件传输助手"
                                                : w.type === "todo"
                                                  ? "待办事项"
                                                  : w.type === "calculator"
                                                    ? "计算器"
                                                    : w.type === "ip"
                                                      ? "IP 信息"
                                                      : w.type === "player"
                                                        ? "随机音乐"
                                                        : w.type === "hot"
                                                          ? "全网热搜"
                                                          : w.type === "rss"
                                                            ? "RSS 阅读器"
                                                            : w.type === "system-status"
                                                              ? "宿主机状态"
                                                                : w.type === "status-monitor"
                                                                ? "状态监控"
                                                                : w.type === "iframe"
                                                                  ? "万能窗口"
                                                                  : w.type === "countdown"
                                                                    ? "倒计时"
                                                                    : w.type === "countup"
                                                                      ? "正计时"
                                                                      : w.type === "docker"
                                                                        ? "Docker 管理"
                                                                        : w.type === "custom-css"
                                                                          ? w.data?.title || "自定义组件"
                                                                          : w.type === "music"
                                                                            ? "道理鱼音乐"
                                                                            : w.type === "amap-weather"
                                                                              ? "高德天气"
                                                                              : `未知组件 (${w.type})`
                          }}
                        </span>
                      </template>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5 w-full mt-1">
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">公开</span>
                        <label class="relative inline-flex items-center cursor-pointer" title="公开"
                          ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" @change="store.saveData()" />
                          <div
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"
                          ></div
                        ></label>
                      </div>
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">启用</span>
                        <label class="relative inline-flex items-center cursor-pointer" title="启用"
                          ><input type="checkbox" v-model="w.enable" class="sr-only peer" @change="store.saveData()" />
                          <div
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500"
                          ></div
                        ></label>
                      </div>
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">手机</span>
                        <label class="relative inline-flex items-center cursor-pointer" title="手机"
                          ><input
                            type="checkbox"
                            :checked="!w.hideOnMobile"
                            class="sr-only peer"
                            @change="
                              (e) => {
                                w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                                store.markDirty();
                              }
                            " />
                          <div
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-500"
                          ></div
                        ></label>
                      </div>
                      <div v-if="w.type === 'player'" class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">自动</span>
                        <label
                          class="relative inline-flex items-center cursor-pointer"
                          title="自动播放"
                          ><input
                            type="checkbox"
                            v-model="store.appConfig.autoPlayMusic"
                            @change="store.markDirty()"
                            class="sr-only peer" />
                          <div
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"
                          ></div
                        ></label>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </div>

            <div class="border-2 border-gray-900 rounded-xl p-4 mt-6 bg-white">
              <h4 class="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                高级组件配置
              </h4>
              <div class="space-y-8">
                <RssSettings />
                <div class="border-t border-gray-200"></div>
                <SearchSettings />
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'docker'" class="space-y-4">
            <div class="flex items-center justify-between mb-4 mr-8">
              <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                Docker 管理 (内测中)
              </h4>
              <div
                v-if="dockerWidget || isDockerSystemEnabled"
                class="flex items-center gap-3 text-xs mr-[10px]"
              >
                <button
                  @click="exportDockerLogs"
                  :disabled="isExportingDockerLogs || !isDockerSystemEnabled"
                  class="text-gray-900 px-3 py-1 rounded-lg transition-colors font-bold disabled:opacity-60 glass-chip selectable-outline"
                >
                  {{ isExportingDockerLogs ? "导出中" : "导出日志" }}
                </button>
                <button
                  @click="checkDockerConnection"
                  :disabled="!isDockerSystemEnabled || isUpdatingDockerSystem"
                  class="text-gray-900 px-3 py-1 rounded-lg transition-colors font-bold disabled:opacity-50 glass-chip selectable-outline"
                >
                  测试连接
                </button>
              </div>
            </div>

            <div class="space-y-3 mb-6 pb-6 border-b border-gray-100">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-bold text-gray-900">Docker 服务</div>
                  <p class="mt-1 text-xs text-gray-500">
                    控制后端是否访问 Docker Engine。Windows 默认使用
                    <code>npipe:////./pipe/docker_engine</code>，Linux/macOS 默认使用
                    <code>unix:///var/run/docker.sock</code>。
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    :checked="isDockerSystemEnabled"
                    :disabled="isUpdatingDockerSystem || !hasAdminAccess"
                    aria-label="Docker 服务启用"
                    @change="(e) => toggleDockerSystemEnabled((e.target as HTMLInputElement).checked)"
                    class="sr-only peer"
                  />
                  <div
                    class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white peer-disabled:opacity-50 after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500 shrink-0"
                  ></div>
                  <span class="text-sm text-gray-700 ml-3 whitespace-nowrap">
                    {{ isUpdatingDockerSystem ? "切换中" : isDockerSystemEnabled ? "已启用" : "已关闭" }}
                  </span>
                </label>
              </div>

              <div
                class="rounded-xl border px-3 py-2 text-xs"
                :class="
                  isDockerSystemEnabled
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
                    : 'border-amber-200 bg-amber-50/70 text-amber-700'
                "
              >
                <p>
                  {{
                    isDockerSystemEnabled
                      ? "当前会允许 Docker 管理、连接检测、容器状态读取和组件预览。"
                      : "当前已停止 Docker 探测与接口轮询；下方组件设置仅控制展示，不会触发后端访问。"
                  }}
                </p>
                <p class="mt-1 text-[11px] opacity-80">
                  “Docker 服务”是系统级总开关，“显示 Docker 组件”只影响首页卡片显示，“模拟数据”只影响组件展示数据来源。
                </p>
                <p v-if="!hasAdminAccess" class="mt-1 text-[11px] opacity-80">
                  当前账号没有系统配置权限，仅可查看状态，不能切换 Docker 服务总开关。
                </p>
              </div>
            </div>

            <!-- Host Status Widget Section -->
            <div class="space-y-3 mb-6 pb-6 border-b border-gray-100">
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold text-gray-900">宿主机状态组件</span>
                <div class="flex items-center gap-4">
                  <div
                    v-if="systemStatusWidget && systemStatusWidget.enable"
                    class="flex items-center gap-2 animate-fade-in"
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-gray-700 font-medium">公开访问</span>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          v-model="systemStatusWidget.isPublic"
                          class="sr-only peer"
                        />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div>
                      </label>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-gray-700 font-medium">手机端显示</span>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          :checked="!systemStatusWidget.hideOnMobile"
                          @change="onMobileSystemStatusDisplayChange"
                          class="sr-only peer"
                        />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                        ></div>
                      </label>
                    </div>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      :checked="systemStatusWidget?.enable"
                      aria-label="启用"
                      @change="
                        (e) => {
                          if ((e.target as HTMLInputElement).checked) enableSystemStatusWidget();
                          else if (systemStatusWidget) {
                            systemStatusWidget.enable = false;
                            store.markDirty();
                          }
                        }
                      "
                      class="sr-only peer"
                    />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                    ></div>
                    <span class="text-sm text-gray-700 ml-3">启用</span>
                  </label>
                </div>
              </div>

              <div
                v-if="systemStatusWidget && systemStatusWidget.enable"
                class="animate-fade-in space-y-3"
              >
                <div class="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500">使用模拟数据</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        :checked="!!systemStatusWidget.data?.useMock"
                        @change="
                          (e) => toggleSystemStatusMock((e.target as HTMLInputElement).checked)
                        "
                        class="sr-only peer"
                      />
                      <div
                        class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                  </div>
                </div>
                <div class="h-40 w-full max-w-sm">
                  <SystemStatusWidget :widget="systemStatusWidget" />
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <!-- 未启用时的提示 -->
              <template v-if="!isDockerComponentCreated">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-bold text-gray-900">容器管理</span>
                  <button
                    @click="enableDockerWidget"
                    class="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors shadow-sm text-sm"
                  >
                    启用容器管理
                  </button>
                </div>
              </template>

              <!-- 已启用后的管理区 -->
              <template v-else>
                <!-- 主控制区 -->
                <div class="flex items-center justify-between">
                  <span class="text-sm font-bold text-gray-900">容器管理</span>
                  <div class="flex items-center gap-4">
                    <div class="flex items-center gap-4 animate-fade-in">
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-700 font-medium">公开访问</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" v-model="dockerWidget.isPublic" class="sr-only peer" />
                          <div
                            class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                          ></div>
                        </label>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-700 font-medium">手机端显示</span>
                        <label class="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" :checked="!dockerWidget.hideOnMobile" @change="onMobileDockerDisplayChange" class="sr-only peer" />
                          <div
                            class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                          ></div>
                        </label>
                      </div>
                    </div>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" v-model="dockerWidget.enable" aria-label="容器管理组件" class="sr-only peer" />
                      <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                      <span class="text-sm text-gray-700 ml-3">容器管理组件</span>
                    </label>
                  </div>
                </div>

                <!-- 功能配置区 -->
                <div class="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
                  <!-- 模拟数据 -->
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500">模拟数据</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        :checked="!!dockerWidget.data?.useMock"
                        @change="(e) => toggleDockerMock((e.target as HTMLInputElement).checked)"
                        class="sr-only peer"
                      />
                      <div
                        class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                  </div>

                  <!-- 自动升级 -->
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500">自动升级</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        :checked="!!dockerWidget.data?.autoUpdate"
                        @change="
                          (e) => {
                            if (!dockerWidget.data) dockerWidget.data = {};
                            dockerWidget.data.autoUpdate = (e.target as HTMLInputElement).checked;
                            store.markDirty();
                          }
                        "
                        class="sr-only peer"
                      />
                      <div
                        class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                  </div>

                  <!-- 升级配置 -->
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-500">保留版本</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      :disabled="!dockerWidget?.data?.autoUpdate"
                      :value="dockerWidget?.data?.autoUpdateKeepImages ?? 2"
                      @change="
                        (e) => {
                          if (!dockerWidget.data) dockerWidget.data = {};
                          dockerWidget.data.autoUpdateKeepImages = Math.max(
                            1,
                            Math.min(20, Number((e.target as HTMLInputElement).value || 2)),
                          );
                          store.markDirty();
                        }
                      "
                      class="w-16 px-2 py-1 border border-gray-200 rounded text-xs focus:border-gray-900 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <span class="text-[10px] text-gray-500">个</span>
                  </div>

                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-500">磁盘阈值</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      :disabled="!dockerWidget?.data?.autoUpdate"
                      :value="dockerWidget?.data?.autoUpdateMinFreeGB ?? 5"
                      @change="
                        (e) => {
                          if (!dockerWidget.data) dockerWidget.data = {};
                          dockerWidget.data.autoUpdateMinFreeGB = Math.max(
                            0,
                            Number((e.target as HTMLInputElement).value || 5),
                          );
                          store.markDirty();
                        }
                      "
                      class="w-20 px-2 py-1 border border-gray-200 rounded text-xs focus:border-gray-900 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <span class="text-[10px] text-gray-500">GB</span>
                  </div>

                  <!-- 内网主机 -->
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-700 font-medium">内网主机</span>
                    <input
                      :value="dockerWidget?.data?.lanHost"
                      @change="
                        (e) => {
                          if (!dockerWidget.data) dockerWidget.data = {};
                          dockerWidget.data.lanHost = (e.target as HTMLInputElement).value;
                          store.markDirty();
                        }
                      "
                      type="text"
                      placeholder="例如：192.168.1.10"
                      class="px-2 py-1 border border-gray-200 rounded text-xs focus:border-gray-900 outline-none"
                    />
                  </div>
                </div>

                <!-- 容器预览（始终可见） -->
                <div class="border-t border-gray-100 pt-3">
                  <div
                    v-if="isDockerSystemEnabled"
                    class="h-[500px]"
                  >
                    <DockerWidget :widget="dockerWidget" :compact="true" />
                  </div>
                  <div
                    v-else
                    class="h-[160px] rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 flex items-center justify-center text-center px-6"
                  >
                    <div class="text-sm text-gray-500 space-y-2">
                      <p>Docker 服务总开关已关闭，请在上方"Docker 服务"区域开启。</p>
                      <p class="text-xs text-gray-400">
                        关闭系统级总开关后，不会继续自动探测 Docker 或轮询容器状态。
                      </p>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <div v-if="activeTab === 'universal-window'" class="flatnas-handshake-signal space-y-4">
            <!-- Universal Window Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  万能窗口
                </h4>
                <span class="text-xs text-gray-500 px-2 py-1 rounded-full glass-chip selected-outline">可多开</span>
                <button
                  @click="addIframeWidget"
                  class="px-3 py-1.5 text-xs font-medium text-gray-900 rounded-lg transition-colors flex items-center gap-1 ml-2 glass-chip selectable-outline"
                >
                  <span class="text-base leading-none">+</span> 新增窗口
                </button>
              </div>
            </div>

            <template v-for="w in store.widgets" :key="'iframe-' + w.id">
              <div
                v-if="w.type === 'iframe'"
                class="flatnas-handshake-signal flex flex-col gap-3 p-4 border border-gray-100 rounded-xl hover:shadow-md transition-all glass-card"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                    >
                      窗
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-700">万能窗口</span>
                      <span class="text-[10px] text-gray-400 font-mono">ID: {{ w.id }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <button
                      @click="removeWidget(w.id)"
                      class="text-red-400 hover:text-red-600 text-xs underline px-2"
                      title="删除此窗口"
                    >
                      删除
                    </button>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">公开</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.isPublic"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">手机</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          :checked="!w.hideOnMobile"
                          class="sr-only peer"
                          @change="
                            (e) => {
                              w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                              store.markDirty();
                            }
                          " />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.enable"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="w-full bg-white/60 p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <label class="block text-xs font-bold text-gray-600"
                        >外网/默认地址 (URL)</label
                      >
                      <ProxyToggle v-model="w.data.useProxy" @update:model-value="store.markDirty()" />
                    </div>
                    <div class="flex gap-2">
                      <input
                        :value="tempInputs[`${w.id}-url`] ?? w.data.url"
                        @input="
                          (e: Event) =>
                            updateTempInput(`${w.id}-url`, (e.target as HTMLInputElement).value)
                        "
                        type="url"
                        placeholder="例如：https://example.com"
                        class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                        @keydown.enter="confirmTempInput(w, 'url', `${w.id}-url`)"
                      />
                      <button
                        @click="confirmTempInput(w, 'url', `${w.id}-url`)"
                        class="px-3 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 transition-colors whitespace-nowrap"
                      >
                        确定
                      </button>
                    </div>
                  </div>
                  <div>
                    <label
                      class="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-1"
                    >
                      <span>内网地址 (LAN URL)</span>
                      <span class="text-[10px] font-normal text-gray-400 px-1.5 rounded glass-chip selected-outline"
                        >内网优先</span
                      >
                    </label>
                    <div class="flex gap-2">
                      <input
                        :value="tempInputs[`${w.id}-lanUrl`] ?? w.data.lanUrl"
                        @input="
                          (e: Event) =>
                            updateTempInput(`${w.id}-lanUrl`, (e.target as HTMLInputElement).value)
                        "
                        type="url"
                        placeholder="例如：http://192.168.x.x"
                        class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                        @keydown.enter="confirmTempInput(w, 'lanUrl', `${w.id}-lanUrl`)"
                      />
                      <button
                        @click="confirmTempInput(w, 'lanUrl', `${w.id}-lanUrl`)"
                        class="px-3 py-2 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 transition-colors whitespace-nowrap"
                      >
                        确定
                      </button>
                    </div>
                  </div>
                  <p class="text-[10px] text-gray-500 mt-1">
                    点击<a
                      href="/flatnas-helper.zip"
                      download="flatnas-helper.zip"
                      target="_blank"
                      class="text-blue-500 underline mx-1"
                      >下载浏览器插件</a
                    >解除限制
                  </p>
                  <p class="text-[10px] text-gray-400 mt-1">
                    系统将根据当前网络环境自动切换：内网环境优先使用内网地址，外网环境使用默认地址。
                  </p>
                </div>
              </div>
            </template>

            <!-- Amap Weather Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4 mt-8">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  高德天气
                </h4>
                <span class="text-xs text-gray-500 px-2 py-1 rounded-full glass-chip selected-outline">可多开</span>
                <button
                  @click="addAmapWeatherWidget"
                  class="px-3 py-1.5 text-xs font-medium text-gray-900 rounded-lg transition-colors flex items-center gap-1 ml-2 glass-chip selectable-outline"
                >
                  <span class="text-base leading-none">+</span> 新增天气
                </button>
              </div>
            </div>

            <template v-for="w in store.widgets" :key="'amap-' + w.id">
              <div
                v-if="w.type === 'amap-weather'"
                class="flatnas-handshake-signal flex flex-col gap-3 p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                    >
                      天
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-700">高德天气</span>
                      <span class="text-[10px] text-gray-400 font-mono">ID: {{ w.id }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <button
                      @click="removeWidget(w.id)"
                      class="text-gray-400 hover:text-gray-900 text-xs underline px-2"
                      title="删除此组件"
                    >
                      删除
                    </button>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">公开</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.isPublic"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">手机</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          :checked="!w.hideOnMobile"
                          class="sr-only peer"
                          @change="
                            (e) => {
                              w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                              store.markDirty();
                            }
                          " />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.enable"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Countdown Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4 mt-8">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  倒计时
                </h4>
                <span class="text-xs text-gray-500 px-2 py-1 rounded-full glass-chip selected-outline">可多开</span>
                <button
                  @click="addCountdownWidget"
                  class="px-3 py-1.5 text-xs font-medium text-gray-900 rounded-lg transition-colors flex items-center gap-1 ml-2 glass-chip selectable-outline"
                >
                  <span class="text-base leading-none">+</span> 新增倒计时
                </button>
              </div>
            </div>

            <template v-for="w in store.widgets" :key="'cd-' + w.id">
              <div
                v-if="w.type === 'countdown'"
                class="flatnas-handshake-signal flex flex-col gap-3 p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                    >
                      计
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-700">倒计时</span>
                      <span class="text-[10px] text-gray-400 font-mono">ID: {{ w.id }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <button
                      @click="removeWidget(w.id)"
                      class="text-gray-400 hover:text-gray-900 text-xs underline px-2"
                      title="删除此组件"
                    >
                      删除
                    </button>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">公开</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.isPublic"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">手机</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          :checked="!w.hideOnMobile"
                          class="sr-only peer"
                          @change="
                            (e) => {
                              w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                              store.markDirty();
                            }
                          " />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.enable"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="w-full bg-white/60 p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">标题</label>
                    <input
                      v-model="w.data.title"
                      type="text"
                      placeholder="例如：春节"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">目标时间</label>
                    <input
                      v-model="w.data.targetDate"
                      type="datetime-local"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                    />
                  </div>
                </div>
              </div>
            </template>

            <!-- CountUp Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4 mt-8">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  正计时
                </h4>
                <span class="text-xs text-gray-500 px-2 py-1 rounded-full glass-chip selected-outline">可多开</span>
                <button
                  @click="addCountUpWidget"
                  class="px-3 py-1.5 text-xs font-medium text-gray-900 rounded-lg transition-colors flex items-center gap-1 ml-2 glass-chip selectable-outline"
                >
                  <span class="text-base leading-none">+</span> 新增正计时
                </button>
              </div>
            </div>

            <template v-for="w in store.widgets" :key="'cup-' + w.id">
              <div
                v-if="w.type === 'countup'"
                class="flatnas-handshake-signal flex flex-col gap-3 p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                    <div
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                    >
                      正
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-700">正计时</span>
                      <span class="text-[10px] text-gray-400 font-mono">ID: {{ w.id }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <button
                      @click="removeWidget(w.id)"
                      class="text-gray-400 hover:text-gray-900 text-xs underline px-2"
                      title="删除此组件"
                    >
                      删除
                    </button>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">公开</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.isPublic"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">手机</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          :checked="!w.hideOnMobile"
                          class="sr-only peer"
                          @change="
                            (e) => {
                              w.hideOnMobile = !(e.target as HTMLInputElement).checked;
                              store.markDirty();
                            }
                          " />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input
                          type="checkbox"
                          v-model="w.enable"
                          class="sr-only peer"
                          @change="store.markDirty()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="w-full bg-white/60 p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">标题</label>
                    <input
                      v-model="w.data.title"
                      type="text"
                      placeholder="例如：工作时长"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">开始时间</label>
                    <input
                      v-model="w.data.startTime"
                      type="datetime-local"
                      step="1"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-if="activeTab === 'network'" class="p-4 space-y-4">
            <div class="flex items-center gap-3 mb-4">
              <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                网络环境判定设置
              </h4>
            </div>

            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
              <div class="flex items-start gap-2">
                <span
                  class="text-xs text-gray-500 font-medium border border-gray-200 rounded px-1.5 py-0.5 mt-0.5"
                  >注</span
                >
                <p class="text-xs text-gray-600 leading-relaxed">
                  这里可以配置域名白名单、内网探测地址和游客是否可拿到内网地址。
                  默认情况下，游客响应里不会返回任何 `lanUrl` / 备用内网地址，只有显式开启后才会返回。
                </p>
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">域名白名单</label>
                <textarea
                  v-model="store.appConfig.internalDomains"
                  @change="store.markDirty()"
                  rows="5"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none font-mono"
                  placeholder="每行一个域名（如 hp.fnos996.top 或 fnos996.top）"
                ></textarea>
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">内网探测地址 / 网关</label>
                <input
                  v-model="store.appConfig.lanProbeTarget"
                  @change="store.markDirty()"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none font-mono"
                  placeholder="例如：192.168.1.1、nas.local 或 https://nas.local/"
                />
                <p class="text-[11px] text-gray-500">
                  浏览器会直接尝试访问这个地址；当前客户端能访问成功时，优先判定为内网。留空则关闭这条判定。
                </p>
              </div>

              <div class="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white px-3 py-3">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-gray-700">游客访问内网地址</div>
                  <p class="mt-1 text-[11px] leading-relaxed text-gray-500">
                    关闭时，未登录用户拿不到任何 `lanUrl` / 备用内网地址；开启后，游客也会收到公开项目的内网地址并可直接访问。
                  </p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    v-model="store.appConfig.allowGuestLanAccess"
                    type="checkbox"
                    class="sr-only peer"
                    @change="store.markDirty()"
                  />
                  <div
                    class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-gray-300 after:rounded-full after:h-5 after:w-5 after:transition-all"
                  ></div>
                </label>
              </div>
            </div>

            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <h5 class="text-sm font-medium text-gray-700 mb-3">白名单+延迟判定</h5>
              <div class="flex items-center gap-3 mb-3">
                <button
                  type="button"
                  @click="toggleWhitelistLatency"
                  class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border whitespace-nowrap"
                  :class="
                    whitelistLatencyEnabled
                      ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  "
                >
                  {{ whitelistLatencyEnabled ? '已启用' : '启用白名单+延迟判定' }}
                </button>
                <span class="text-[11px] text-gray-500">
                  {{ whitelistLatencyEnabled ? '白名单域名将根据延迟判定内外网' : '白名单域名默认判定为外网' }}
                </span>
              </div>
              <div v-if="whitelistLatencyEnabled" class="flex items-center gap-2">
                <input
                  :value="latencyThresholdDraft"
                  inputmode="numeric"
                  @input="onLatencyThresholdInput"
                  @blur="onLatencyThresholdBlur"
                  @keydown.enter.prevent="applyLatencyThreshold"
                  placeholder="20–30000"
                  class="w-32 px-3 py-2 border rounded-lg text-xs outline-none font-mono focus:border-gray-900"
                  :class="
                    latencyThresholdTouched && !latencyThresholdValidation.ok
                      ? 'border-red-300'
                      : 'border-gray-200'
                  "
                />
                <span class="text-xs text-gray-500">ms</span>
                <button
                  type="button"
                  @click="applyLatencyThreshold"
                  :disabled="!latencyThresholdValidation.ok"
                  class="px-3 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                  :class="
                    latencyThresholdValidation.ok
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  "
                >
                  确认
                </button>
                <button
                  type="button"
                  @click="resetLatencyThreshold"
                  class="px-3 py-2 bg-white text-gray-600 border border-gray-200 rounded-lg text-xs font-bold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  重置
                </button>
                <div class="text-[10px] text-gray-400">
                  默认 {{ DEFAULT_LATENCY_THRESHOLD_MS }} ms
                </div>
              </div>
              <p
                v-if="latencyThresholdTouched && !latencyThresholdValidation.ok"
                class="mt-2 text-[11px] text-red-600"
              >
                {{ latencyThresholdValidation.error }}
              </p>
              <p v-else-if="latencyThresholdAppliedToast" class="mt-2 text-[11px] text-green-600">
                {{ latencyThresholdAppliedToast }}
              </p>
              <p v-else class="mt-2 text-[11px] text-gray-500">
                白名单域名访问时，延迟低于此值判定为内网，高于此值判定为外网。默认 {{ DEFAULT_LATENCY_THRESHOLD_MS }} ms。
              </p>
            </div>
          </div>

          <div v-if="activeTab === 'lucky-stun'" class="p-4 space-y-4">
            <div class="flex items-center gap-2 mb-4">
              <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                开放中心
              </h4>
            </div>

            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6 space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h4 class="text-base font-bold text-gray-900">浏览器助手通信</h4>
                  <p class="text-xs text-gray-500 mt-1">
                    为 `flatnas-helper` 生成专用握手链接。插件在当前页点击图标时会优先读取它并自动保存站点与令牌。
                  </p>
                </div>
              </div>

              <template v-if="browserHelperHandshakeLink">
                <a
                  :href="browserHelperHandshakeLink"
                  :data-flatnas-helper-link="browserHelperHandshakeLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-[11px] text-blue-600 break-all hover:border-blue-300 transition-colors"
                >
                  {{ browserHelperHandshakeLink }}
                </a>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    @click="copyBrowserHelperHandshakeLink"
                    class="px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs rounded-lg transition-colors"
                  >
                    复制握手链接
                  </button>
                  <button
                    @click="openBrowserHelperHandshakeLink"
                    class="px-3 py-1.5 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-xs rounded-lg transition-colors"
                  >
                    打开握手页
                  </button>
                  <a
                    href="https://qdnas.icu/c/8/g/14"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors inline-block"
                  >
                    下载浏览器助手
                  </a>
                </div>
                <p class="text-[11px] text-gray-500">
                  如果插件提示未连接，请先停留在这个页面，再点击浏览器助手图标进行自动配对。
                </p>
              </template>
              <p v-else class="text-[11px] text-amber-600">
                当前未检测到登录令牌。请先登录 FlatNas，随后这里会自动生成浏览器助手握手链接。
              </p>
            </div>


            <!-- Music Widget Settings -->
            <div id="music-settings" class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6">
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-base font-bold text-gray-900">道理鱼音乐设置</h4>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="!!musicWidget"
                    @change="
                      (e) => {
                        if ((e.target as HTMLInputElement).checked) addMusicWidget();
                        else if (musicWidget) {
                          removeWidget(musicWidget.id);
                        }
                      }
                    "
                    class="sr-only peer"
                  />
                  <div
                    class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"
                  ></div>
                </label>
              </div>

              <div v-if="musicWidget && musicWidget.data" class="space-y-3 animate-fade-in">
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">API 地址</label>
                  <input
                    v-model="musicWidget.data.apiUrl"
                    @change="store.markDirty()"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                    placeholder="例如：http://192.168.1.10:3000"
                  />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">用户名</label>
                    <input
                      v-model="musicWidget.data.username"
                      @change="store.markDirty()"
                      type="text"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                      placeholder="用户名"
                      autocomplete="off"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">密码</label>
                    <input
                      v-model="musicWidget.data.password"
                      @change="store.markDirty()"
                      type="password"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                      placeholder="密码"
                      autocomplete="new-password"
                    />
                  </div>
                </div>

                <div class="flex items-center gap-2 mt-2">
                  <button
                    @click="testMusicAuth"
                    class="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs rounded transition-colors flex items-center gap-1"
                    :disabled="isTestingMusicAuth"
                  >
                    <span v-if="isTestingMusicAuth" class="animate-spin text-xs">●</span>
                    {{ isTestingMusicAuth ? "登录中..." : "登录 & 测试连接" }}
                  </button>
                  <span
                    v-if="testMusicAuthResult"
                    class="text-xs"
                    :class="testMusicAuthResult.success ? 'text-gray-600' : 'text-gray-500'"
                  >
                    {{ testMusicAuthResult.message }}
                  </span>
                  <span class="text-[15px] text-gray-400"
                    >TIPS:道理鱼歌词不准管我FlatNas什么事</span
                  >
                </div>

                <div
                  v-if="musicWidget.data.token"
                  class="bg-white border border-gray-200 rounded-lg p-3"
                >
                  <div class="flex items-center gap-3">
                    <img
                      v-if="musicWidget.data.userProfile?.avatar"
                      :src="getMusicAvatarUrl(musicWidget.data.userProfile.avatar)"
                      class="w-10 h-10 rounded-full object-cover border border-gray-200 bg-white"
                      alt="Avatar"
                    />
                    <div
                      v-else
                      class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm"
                    >
                      {{
                        (
                          musicWidget.data.userProfile?.displayName ||
                          musicWidget.data.username ||
                          "U"
                        )
                          .charAt(0)
                          .toUpperCase()
                      }}
                    </div>

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-gray-900 truncate">
                          {{
                            musicWidget.data.userProfile?.displayName || musicWidget.data.username
                          }}
                        </span>
                        <button
                          @click="openRenameModal"
                          class="text-xs text-gray-500 hover:text-gray-900 shrink-0"
                          :disabled="isUpdatingProfile"
                        >
                          编辑
                        </button>
                      </div>
                      <div class="text-[10px] text-gray-500 truncate">
                        {{
                          musicWidget.data.userProfile?.id
                            ? `ID: ${musicWidget.data.userProfile.id}`
                            : "未获取到资料"
                        }}
                      </div>
                    </div>

                    <button
                      @click="
                        () => {
                          if (musicWidget && musicWidget.data) {
                            musicWidget.data.token = '';
                            musicWidget.data.userProfile = null;
                            store.markDirty();
                            testMusicAuthResult = null;
                          }
                        }
                      "
                      class="px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors"
                    >
                      登出
                    </button>
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-2">组件尺寸</label>
                  <div class="flex items-center gap-4">
                    <div class="flex gap-3">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="music-size"
                          :checked="selectedMusicSize.cols === 1 && selectedMusicSize.rows === 1"
                          @change="selectedMusicSize = { cols: 1, rows: 1 }"
                          class="text-gray-900 accent-blue-400"
                        />
                        <span class="text-sm">迷你 (1x1)</span>
                      </label>
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="music-size"
                          :checked="selectedMusicSize.cols === 2 && selectedMusicSize.rows === 3"
                          @change="selectedMusicSize = { cols: 2, rows: 3 }"
                          class="text-gray-900 accent-blue-400"
                        />
                        <span class="text-sm">标准 (2x3)</span>
                      </label>
                    </div>
                    <button
                      v-if="
                        musicWidget.colSpan !== selectedMusicSize.cols ||
                        musicWidget.rowSpan !== selectedMusicSize.rows
                      "
                      @click="setMusicSize(selectedMusicSize.cols, selectedMusicSize.rows)"
                      class="px-3 py-1 bg-gray-900 text-white text-xs rounded hover:bg-gray-800 transition-colors animate-fade-in"
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Custom CSS Section -->
            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6">
              <h4 class="text-base font-bold mb-4 text-gray-900">自定义 CSS</h4>
              <div>
                <ScriptManager
                  v-if="store.appConfig.customCssList"
                  v-model="store.appConfig.customCssList"
                  type="css"
                  placeholder="/* 输入自定义 CSS 代码 */
.card-item {
  border-radius: 20px;
}"
                  @change="store.updateCustomScripts()"
                />
                <div class="text-xs text-gray-500 mt-2">
                  提示：在此处输入的 CSS 将直接应用到页面，可用于微调样式。
                </div>
                <div class="mt-3 rounded-xl border border-gray-100 bg-white/70">
                  <div class="px-3 py-2 text-xs font-bold text-gray-700">样式变量表</div>
                  <div
                    class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] gap-y-2 gap-x-3 px-3 pb-3 text-xs"
                  >
                    <div class="text-[10px] font-semibold text-gray-400">变量</div>
                    <div class="text-[10px] font-semibold text-gray-400">用途</div>
                    <div class="text-[10px] font-semibold text-gray-400">当前值</div>
                    <template v-for="row in styleVariableRows" :key="row.name">
                      <div class="font-mono text-[11px] text-gray-700">{{ row.name }}</div>
                      <div class="text-gray-500">{{ row.desc }}</div>
                      <div class="font-mono text-[11px] text-gray-600">{{ row.value }}</div>
                    </template>
                  </div>
                  <div
                    class="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-[10px] text-gray-500"
                  >
                    <span>对比度：{{ styleVariableStatus.contrast }}</span>
                    <span>视觉回归：{{ styleVariableStatus.visual }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Custom JS Section -->
            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6">
              <h4 class="text-base font-bold mb-4 text-gray-900">自定义 JS</h4>

              <div
                v-if="!store.appConfig.customJsDisclaimerAgreed"
                class="p-4 bg-white rounded-lg border border-gray-200 shadow-sm"
              >
                <h5 class="font-bold text-gray-700 mb-2 flex items-center gap-2">安全免责声明</h5>
                <div class="text-sm text-gray-600 mb-3 leading-relaxed">
                  使用自定义 JavaScript 功能允许您向页面注入任意代码。这可能导致：
                  <ul class="list-disc list-inside ml-2 mt-1 space-y-1 text-xs">
                    <li>XSS (跨站脚本) 攻击风险</li>
                    <li>页面功能异常或崩溃</li>
                    <li>敏感数据泄露</li>
                  </ul>
                </div>
                <p class="text-sm text-gray-600 mb-4 font-bold">
                  由此产生的一切后果由您自行承担。请确保您完全信任并理解您所添加的代码。
                </p>
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    v-model="store.appConfig.customJsDisclaimerAgreed"
                    class="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-blue-400 accent-blue-400"
                  />
                  <span class="text-sm font-medium text-gray-700"
                    >我已阅读并同意上述风险，确认启用此功能</span
                  >
                </label>
              </div>

              <div v-else>
                <ScriptManager
                  v-if="store.appConfig.customJsList"
                  v-model="store.appConfig.customJsList"
                  type="js"
                  placeholder="// 输入自定义 JS 代码
console.log('Hello from Custom JS!');
document.querySelector('.card-item').addEventListener('click', () => {
  alert('Clicked!');
});"
                  @change="store.updateCustomScripts()"
                />
                <div class="text-xs text-gray-500 mt-2 flex justify-between items-center">
                  <span>提示：JS 代码将在页面加载时执行。可与自定义 CSS 配合实现高级交互。</span>
                  <button
                    @click="store.appConfig.customJsDisclaimerAgreed = false"
                    class="text-xs text-gray-500 hover:text-gray-600 underline"
                  >
                    撤销免责声明并禁用
                  </button>
                </div>
              </div>
            </div>

            <!-- Weather Service Settings -->
            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6">
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-base font-bold text-gray-900">天气服务设置</h4>
              </div>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-2">天气源选择</label>
                  <div class="flex items-center gap-4 mb-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        v-model="store.appConfig.weatherSource"
                        value="uapi"
                        class="text-gray-900 accent-blue-400"
                      />
                      <span class="text-sm">OpenMeteo (免费/推荐)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        v-model="store.appConfig.weatherSource"
                        value="amap"
                        class="text-gray-900 accent-blue-400"
                      />
                      <span class="text-sm">高德地图 (AMap)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        v-model="store.appConfig.weatherSource"
                        value="qweather"
                        class="text-gray-900 accent-blue-400"
                      />
                      <span class="text-sm">和风天气 (QWeather)</span>
                    </label>
                  </div>

                  <!-- OpenMeteo Settings -->
                  <div v-if="(!store.appConfig.weatherSource || store.appConfig.weatherSource === 'uapi')" class="animate-fade-in mt-2 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p class="text-xs text-blue-700 mb-2">
                      OpenMeteo 是一个免费开源的天气 API，无需申请 Key，支持全球天气数据。
                    </p>
                    <div class="flex items-center gap-2">
                      <button
                        @click="testWeatherConnection('uapi')"
                        class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center gap-1"
                        :disabled="isTestingWeather"
                      >
                        <span v-if="isTestingWeather" class="animate-spin text-xs">●</span>
                        {{ isTestingWeather ? "测试中..." : "测试连接 (OpenMeteo)" }}
                      </button>
                      <span
                        v-if="testWeatherResult"
                        class="text-xs"
                        :class="testWeatherResult.success ? 'text-green-600' : 'text-red-500'"
                      >
                        {{ testWeatherResult.message }}
                      </span>
                    </div>
                  </div>
                </div>

                <div v-if="store.appConfig.weatherSource === 'amap'" class="animate-fade-in">
                  <label class="block text-xs font-bold text-gray-600 mb-1">高德 API Key</label>
                  <input
                    v-model="store.appConfig.amapKey"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                    placeholder="请输入高德 Web 服务 Key"
                  />
                  <div class="flex items-center justify-between mt-2">
                    <p class="text-[10px] text-gray-500">
                      请前往
                      <a
                        href="https://console.amap.com/dev/key/app"
                        target="_blank"
                        class="text-gray-600 underline hover:text-gray-900"
                        >高德开放平台</a
                      >
                      申请 Web 服务 Key。
                    </p>
                    <button
                      @click="addAmapWeatherWidget"
                      class="px-3 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1"
                    >
                      <span>+</span> 添加天气组件到桌面
                    </button>
                  </div>
                </div>

                <div
                  v-if="store.appConfig.weatherSource === 'qweather'"
                  class="animate-fade-in space-y-2"
                >
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Project ID</label>
                    <input
                      v-model="store.appConfig.qweatherProjectId"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                      placeholder="请输入 Project ID"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Key ID</label>
                    <input
                      v-model="store.appConfig.qweatherKeyId"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                      placeholder="请输入 Key ID"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">Private Key</label>
                    <textarea
                      v-model="store.appConfig.qweatherPrivateKey"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none min-h-[80px]"
                      placeholder="请输入 Private Key (需包含 -----BEGIN PRIVATE KEY----- 头尾)"
                    ></textarea>
                  </div>
                  <p class="text-[10px] text-gray-500 mt-1">
                    请前往
                    <a
                      href="https://console.qweather.com/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                      >和风天气控制台</a
                    >
                    获取 JWT 凭证。
                  </p>
                  <div class="flex items-center gap-2 mt-2">
                    <button
                      @click="testWeatherConnection('qweather')"
                      class="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs rounded transition-colors flex items-center gap-1"
                      :disabled="isTestingWeather"
                    >
                      <span v-if="isTestingWeather" class="animate-spin text-xs">●</span>
                      {{ isTestingWeather ? "测试中..." : "测试连接" }}
                    </button>
                    <span
                      v-if="testWeatherResult"
                      class="text-xs"
                      :class="testWeatherResult.success ? 'text-gray-600' : 'text-gray-500'"
                    >
                      {{ testWeatherResult.message }}
                    </span>
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">自定义天气源 URL</label>
                  <input
                    v-model="store.appConfig.weatherApiUrl"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                    placeholder="默认使用内置源，输入 URL 以自定义"
                  />
                  <p class="text-[10px] text-gray-500 mt-1">
                    若填写，将直接请求该地址获取天气数据。返回格式需包含：
                    <code>{ data: { temp, text, city, humidity, today: { min, max } } }</code>
                  </p>
                </div>
              </div>
            </div>

            <!-- Webhook Settings -->
            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-base font-bold text-gray-900">Webhook 设置 (内测中)</h4>
              </div>

              <div class="mb-6">
                <h5 class="font-bold text-gray-900 mb-2">Webhook 地址</h5>
                <div class="flex items-center gap-2 bg-white/60 p-2 rounded border border-gray-200">
                  <code class="text-xs text-gray-600 flex-1 break-all">{{ getWebhookUrl() }}</code>
                  <button
                    @click="copyWebhookUrl"
                    class="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200 font-bold transition-colors"
                  >
                    复制
                  </button>
                </div>
                <p class="text-xs text-gray-500 mt-2">
                  请在 STUN 穿透配置中，将全局 Webhook 的地址设置为上述地址，并使用以下配置：
                </p>

                <div class="mt-3 space-y-3 bg-white/60 p-3 rounded-lg border border-gray-200">
                  <div>
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-xs font-bold text-gray-700">请求头 (Header)</span>
                    </div>
                    <code
                      class="block text-xs text-gray-600 font-mono bg-gray-50 p-1.5 rounded border border-gray-200"
                      >Content-Type: application/json</code
                    >
                  </div>
                  <div>
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-xs font-bold text-gray-700">请求体 (Body)</span>
                    </div>
                    <pre
                      class="text-xs text-gray-600 font-mono bg-gray-50 p-1.5 rounded border border-gray-200 whitespace-pre"
                    >
{
  "stun": "success",
  "ip": "#{ip}",
  "port": "#{port}"
}</pre
                    >
                  </div>
                </div>
              </div>

              <div class="space-y-3">
                <h5 class="font-bold text-gray-900">最新状态</h5>
                <div
                  v-if="store.luckyStunData && store.luckyStunData.data"
                  class="grid grid-cols-2 gap-3"
                >
                  <div class="bg-white/60 p-3 rounded-lg border border-gray-200">
                    <div class="text-xs text-gray-500 mb-1">状态</div>
                    <div
                      class="font-bold"
                      :class="
                        store.luckyStunData.data.stun === 'success'
                          ? 'text-gray-900'
                          : 'text-gray-500'
                      "
                    >
                      {{ store.luckyStunData.data.stun || "未知" }}
                    </div>
                  </div>
                  <div class="bg-white/60 p-3 rounded-lg border border-gray-200">
                    <div class="text-xs text-gray-500 mb-1">公网 IP</div>
                    <div class="font-bold text-gray-900 font-mono break-all">
                      {{ store.luckyStunData.data.ip || "-" }}
                    </div>
                  </div>
                  <div class="bg-white/60 p-3 rounded-lg border border-gray-200">
                    <div class="text-xs text-gray-500 mb-1">端口</div>
                    <div class="font-bold text-gray-900">
                      {{ store.luckyStunData.data.port || "-" }}
                    </div>
                  </div>
                  <div class="bg-white/60 p-3 rounded-lg border border-gray-200">
                    <div class="text-xs text-gray-500 mb-1">更新时间</div>
                    <div class="text-xs text-gray-900">
                      {{ formatTime(store.luckyStunData.ts) }}
                    </div>
                  </div>
                </div>
                <div
                  v-else
                  class="text-center py-8 text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-200"
                >
                  暂无数据，请等待 Webhook 触发...
                </div>
              </div>

              <div class="flex justify-end mt-4">
                <button
                  @click="store.fetchLuckyStunData"
                  class="text-sm text-gray-500 hover:text-gray-900 hover:underline flex items-center gap-1 font-bold transition-colors"
                >
                  <span>🔄</span> 刷新数据
                </button>
              </div>
            </div>

          </div>

          <div v-if="activeTab === 'account'" class="min-h-full flex flex-col justify-center">
            <div v-if="!store.isLogged" class="text-center">
              <h4 class="text-xl font-bold mb-6 text-gray-900">管理员登录</h4>
              <input
                v-model="passwordInput"
                type="password"
                placeholder="密码..."
                class="w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl mb-4 mx-auto text-center focus:border-gray-900 outline-none"
                @keyup.enter="handleLogin"
              />
              <button
                @click="handleLogin"
                class="bg-gray-900 text-white px-10 py-3 rounded-xl font-bold hover:bg-gray-800 transition-colors"
              >
                登 录
              </button>
            </div>
            <div v-else class="max-w-sm mx-auto w-full">
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-100 mb-6">
                <h5 class="text-sm font-bold text-gray-900 mb-3">📦 备份与恢复</h5>
                <div class="grid grid-cols-2 gap-3">
                  <button
                    @click="handleExport"
                    class="col-span-2 bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
                  >
                    📤 导出配置
                  </button>
                  <button
                    @click="triggerImport"
                    class="col-span-2 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
                  >
                    📥 导入配置
                  </button>
                  <button
                    v-if="hasAdminAccess"
                    @click="handleSaveAsDefault"
                    class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-900 transition-all"
                  >
                    {{ saveDefaultBtnText }}
                  </button>
                  <button
                    @click="handleReset"
                    class="bg-white text-gray-600 border border-gray-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                  >
                    🧹 恢复初始化
                  </button>
                  <input
                    ref="fileInput"
                    type="file"
                    accept=".navbak,.json"
                    class="hidden"
                    @change="handleFileChange"
                  />
                </div>
              </div>
              <div
                v-if="hasAdminAccess"
                class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6"
              >
                <h5 class="text-sm font-bold text-gray-900 mb-3">系统模式</h5>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-700"
                    >当前模式：{{
                      store.systemConfig.authMode === "single" ? "单用户模式" : "多用户模式"
                    }}</span
                  >
                  <button
                    v-if="hasAdminAccess"
                    @click="toggleAuthMode"
                    class="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all bg-gray-900 hover:bg-gray-800"
                  >
                    切换为{{
                      store.systemConfig.authMode === "single" ? "多用户模式" : "单用户模式"
                    }}
                  </button>
                  <span
                    v-else
                    class="px-4 py-2 rounded-lg text-sm font-bold text-gray-500 bg-gray-100"
                  >
                    仅管理员可切换
                  </span>
                </div>
                <p class="text-xs text-gray-500 mt-2">
                  {{
                    store.systemConfig.authMode === "single"
                      ? "单用户模式下，登录界面简化，仅需输入密码即可登录 Admin 账户。"
                      : "多用户模式下，允许多个用户注册和登录，数据相互隔离。"
                  }}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  单用户默认密码:admin 多用户模式用户名密码都默认：admin
                </p>
              </div>
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                <h5 class="text-sm font-bold text-gray-900 mb-3">🕘 配置版本</h5>
                <div class="flex gap-2 items-center mb-2">
                  <input
                    v-model="versionLabel"
                    placeholder="版本备注（可选）"
                    class="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-gray-900 outline-none"
                  />
                  <button
                    @click="saveVersion"
                    class="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all bg-gray-900 hover:bg-gray-800"
                  >
                    保存为版本
                  </button>
                </div>
                <div class="text-[10px] text-gray-500 mb-2">
                  {{
                    store.systemConfig.authMode === "single"
                      ? "保存位置：data/config_versions"
                      : "保存位置：data/config_versions (仅当前用户可见)"
                  }}
                </div>
                <div class="max-h-40 overflow-y-auto space-y-1">
                  <div v-if="loadingVersions" class="text-xs text-gray-500">加载中...</div>
                  <div v-else-if="versions.length === 0" class="text-xs text-gray-400 text-center py-4">
                    暂无保存的版本
                  </div>
                  <div
                    v-for="v in versions"
                    :key="v.id"
                    class="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-200"
                  >
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-900 truncate">
                        {{ v.label || "未命名版本" }}
                      </div>
                      <div class="text-[10px] text-gray-500">
                        {{ new Date(v.createdAt).toLocaleString() }} ·
                        {{ Math.round(v.size / 1024) }}KB
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <button
                        @click="restoreVersion(v.id)"
                        class="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                      >
                        恢复
                      </button>
                      <button
                        @click="deleteVersion(v.id)"
                        class="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                <h5 class="text-sm font-medium text-gray-700 mb-1">🔑 修改密码</h5>
                <p class="text-xs text-gray-500 mb-2">点击修改后请输入原来密码</p>
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <input
                      v-model="newPasswordInput"
                      :type="showPassword ? 'text' : 'password'"
                      placeholder="新密码..."
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 pr-10 focus:border-gray-900 outline-none"
                    />
                    <button
                      @click="showPassword = !showPassword"
                      class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                      type="button"
                      tabindex="-1"
                      :title="showPassword ? '隐藏密码' : '显示密码'"
                    >
                      <svg
                        v-if="showPassword"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="currentColor"
                        class="w-5 h-5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                        />
                      </svg>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="1.5"
                        stroke="currentColor"
                        class="w-5 h-5"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </button>
                  </div>
                  <button
                    @click="handleChangePassword"
                    class="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 transition-colors"
                  >
                    修改
                  </button>
                </div>
              </div>
              <!-- Admin User Management UI -->
              <div
                v-if="canManageUsers"
                class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6"
              >
                <h5 class="text-sm font-bold text-gray-900 mb-3">👥 用户管理 (Admin)</h5>

                <!-- Add User -->
                <div class="flex flex-col gap-2 mb-4">
                  <div class="flex gap-2">
                    <input
                      v-model="newUser"
                      placeholder="用户名"
                      class="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-gray-900 outline-none"
                    />
                    <input
                      v-model="newPwd"
                      type="password"
                      placeholder="密码"
                      class="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-gray-900 outline-none"
                    />
                  </div>
                  <button
                    @click="handleAddUser"
                    class="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
                  >
                    添加用户
                  </button>
                </div>

                <!-- User List -->
                <div class="space-y-2 max-h-40 overflow-y-auto">
                  <div
                    v-for="u in userList"
                    :key="u"
                    class="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-gray-200"
                  >
                    <span class="text-sm text-gray-700 font-medium">
                      {{ u }}
                      <span v-if="u === 'admin'" class="text-xs text-gray-500">(管理员)</span>
                    </span>
                    <button
                      v-if="u !== 'admin'"
                      @click="handleDeleteUser(u)"
                      class="text-gray-400 hover:text-gray-600 text-xs font-bold px-2"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <!-- License Management -->
                <div class="mt-4 pt-4 border-t border-gray-200">
                  <h6 class="text-xs font-bold text-gray-900 mb-2">🔑 授权密钥 (License Key)</h6>
                  <div class="flex gap-2">
                    <input
                      v-model="licenseKey"
                      placeholder="输入密钥解除限制..."
                      class="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-gray-900 outline-none"
                    />
                    <button
                      @click="handleUploadLicense"
                      class="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-gray-800 whitespace-nowrap transition-colors"
                    >
                      导入
                    </button>
                  </div>
                  <p class="text-[10px] text-gray-500 mt-1">
                    导入有效密钥可解除5个用户的注册限制。
                  </p>
                </div>
              </div>

              <button
                @click="store.logout"
                class="w-full text-gray-700 py-3 rounded-xl font-bold border border-gray-200 transition-colors glass-chip selectable-outline"
              >
                退出登录
              </button>
            </div>
          </div>
          <div v-if="activeTab === 'about'" class="min-h-full flex flex-col p-8 -mt-4">
            <div class="bg-white/60 border border-gray-100 rounded-xl p-4">
              <h5 class="text-sm font-bold text-gray-900 mb-2">感谢</h5>
              <div class="text-xs text-gray-600 leading-relaxed">
                <div class="text-sm">
                  <span class="font-medium text-gray-800">投喂人：</span>
                  <span class="font-bold text-base text-gray-900">你应爱</span>；小浣熊；*俊；*牛社区主理人；*a；*甜蜜主理人；*坤；T*t;*O；*陈等
                </div>
                <div class="mt-2">
                  <span class="font-medium text-gray-800">特别鸣谢意见反馈：</span>
                  Excel;徐大大;时也,命也;大星;友人A;汪仔饭;Assassin;多度;Wheezer;苍蝇炖粉条等
                </div>
              </div>
            </div>
            <div
              class="mt-4 bg-white/60 border border-gray-100 rounded-xl p-4 flex flex-row items-center justify-center gap-6"
            >
              <div
                class="text-lg font-bold text-gray-700"
                style="writing-mode: vertical-rl; text-orientation: mixed"
              >
                ☕ 投喂作者
              </div>
              <div class="flex flex-row flex-wrap items-start justify-center gap-6">
                <div class="flex flex-col items-center gap-2">
                  <img
                    src="/public/alipay.jpg"
                    class="w-36 h-36 rounded-lg shadow-sm border border-gray-100 object-contain transition-all"
                    alt="支付宝"
                  />
                  <span class="text-sm text-gray-500">支付宝</span>
                </div>
                <div class="flex flex-col items-center gap-2">
                  <img
                    src="/public/wechat.jpg"
                    class="w-36 h-36 rounded-lg shadow-sm border border-gray-100 object-contain transition-all"
                    alt="微信"
                  />
                  <span class="text-sm text-gray-500">微信</span>
                </div>
              </div>
            </div>

            <div class="mt-auto pt-4">
              <div class="bg-white/60 border border-gray-100 rounded-xl p-4">
                <div class="flex items-center justify-between gap-4">
                  <div class="flex items-baseline gap-2">
                    <span class="text-xs text-gray-500">QQ群</span>
                    <span class="text-lg text-gray-700 font-mono">613835409</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-lg text-gray-400 font-mono">v{{ store.currentVersion }}</span>
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  <div class="text-xs text-gray-500">
                    官网与介绍：
                    <a
                      href="https://flatnas.top/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                    >
                      https://flatnas.top/
                    </a>
                  </div>
                  <div class="text-xs text-gray-500">
                    飞牛百科：
                    <a
                      href="http://qdnas.icu/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                    >
                      http://qdnas.icu/
                    </a>
                  </div>
                  <div class="text-xs text-gray-500">
                    图标库主站：
                    <a
                      href="https://nasicon.top/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                    >
                      https://nasicon.top/
                    </a>
                  </div>
                  <div class="text-xs text-gray-500">
                    图标库二站：
                    <a
                      href="https://2.nasicon.top/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                    >
                      https://2.nasicon.top/
                    </a>
                  </div>
                  <div class="text-xs text-gray-500">
                    图标库三站：
                    <a
                      href="https://4.nasicon.top/"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                    >
                      https://4.nasicon.top/
                    </a>
                  </div>
                </div>

                <div class="mt-4 flex items-center justify-end gap-6">
                  <a
                    href="https://github.com/Garry-QD/FlatNas"
                    target="_blank"
                    class="text-gray-700 hover:text-gray-900 hover:opacity-80 transition-opacity"
                    title="GitHub"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      class="w-6 h-6"
                    >
                      <path
                        d="M12 .296c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.332-1.754-1.332-1.754-1.09-.744.084-.729.084-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.604-2.665-.305-5.467-1.335-5.467-5.932 0-1.31.465-2.38 1.235-3.22-.135-.304-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.52 11.52 0 013.003-.405c1.02.006 2.045.138 3.003.405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.872.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.922.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.296c0-6.627-5.373-12-12-12"
                      />
                    </svg>
                  </a>
                  <a
                    href="https://gitee.com/gjx0808/FlatNas"
                    target="_blank"
                    class="text-gray-700 hover:text-gray-900 hover:opacity-80 transition-opacity"
                    title="Gitee"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      class="w-6 h-6"
                    >
                      <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.811 17.914l-.943-.896c-.342-.325-.92-.332-1.19-.026l-2.72 3.067a.772.772 0 0 1-1.05.09l-6.55-5.314a.775.775 0 0 1 .1-1.267l6.894-4.003a.775.775 0 0 1  1.03.22l2.214 3.285a.775.775 0 0 0 1.19.12l1.024-.967a.775.775 0 0 0 .08-1.02l-3.65-5.504a.775.775 0 0 0-1.17-.14l-8.78 7.32a.775.775 0 0 0-.15 1.08l7.87 6.38a.775.775 0 0 0 1.05-.09l3.58-4.034a.775.775 0 0 0 .02-1.08z"
                      />
                    </svg>
                  </a>
                  <a
                    href="https://hub.docker.com/r/qdnas/flatnas"
                    target="_blank"
                    class="text-blue-600 hover:text-blue-700 hover:opacity-80 transition-opacity"
                    title="Docker"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      class="w-6 h-6"
                    >
                      <path
                        d="M13.84 10.74H16v2.14h-2.16v-2.14zm-2.38 0h2.16v2.14h-2.16v-2.14zm-2.38 0h2.16v2.14H9.08v-2.14zm-2.38 0h2.16v2.14H6.7v-2.14zm2.38-2.32h2.16v2.14H9.08V8.42zm2.38 0h2.16v2.14h-2.16V8.42zm-2.38-2.32h2.16v2.14H9.08V6.1zM22.45 11.09c-.2-.14-.66-.28-1.2-.2a3.22 3.22 0 00-1.52.72 4.86 4.86 0 00-.98-1.6l-.22-.2-.2.22a4.42 4.42 0 00-.9 1.46 8.92 8.92 0 00-.56 2.1H1.53a.25.25 0 00-.24.28 8.47 8.47 0 001.14 3.24c1.22 1.86 3.22 2.8 5.98 2.8 5.98 0 10.4-2.76 12.16-7.56.66.04 2.08-.02 2.42-1.3.02-.06.18-.72-.54-1.06z"
                      />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </OverlayMotion>
  <PasswordConfirmModal
    v-model:show="showPasswordConfirm"
    :title="confirmTitle"
    :on-success="onAuthSuccess"
  />

  <!-- Multi-User Warning Modal -->
  <OverlayMotion
    :show="showMultiUserWarning"
    :z-index="80"
    overlay-class="bg-black/40 backdrop-blur-sm p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
    panel-class="max-w-sm"
  >
    <div class="bg-white rounded-xl shadow-xl p-6 w-full border border-gray-100">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-2xl">
          !
        </div>
        <h3 class="text-base font-bold text-gray-900">切换模式警告</h3>
      </div>

      <p class="text-sm text-gray-600 mb-6 leading-relaxed">
        请先导出配置！<br />
        切换到多用户模式会导致当前单用户配置丢失（数据隔离），是否确认继续？
      </p>

      <div class="flex gap-3">
        <button
          @click="showMultiUserWarning = false"
          class="flex-1 px-4 py-2.5 min-h-[44px] bg-gray-100 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          @click="
            showMultiUserWarning = false;
            requestAuth(() => performAuthModeSwitch('multi'), '请输入管理员密码以确认切换');
          "
          class="flex-1 px-4 py-2.5 min-h-[44px] bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors shadow-md"
        >
          确认切换
        </button>
      </div>
    </div>
  </OverlayMotion>

  <!-- Delete Confirmation Modal -->
  <OverlayMotion
    :show="showDeleteWidgetConfirm"
    :z-index="70"
    overlay-class="bg-black/20 backdrop-blur-sm p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
    panel-class="max-w-sm"
  >
    <div class="bg-white rounded-xl shadow-xl p-6 w-full border border-gray-100">
      <h3 class="text-base font-bold text-gray-900 mb-2">确认删除</h3>
      <p class="text-sm text-gray-500 mb-6">确定要删除这个万能窗口吗？此操作无法撤销。</p>
      <div class="flex gap-3">
        <button
          @click="showDeleteWidgetConfirm = false"
          class="flex-1 px-4 py-2 min-h-[44px] bg-gray-100 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          @click="confirmRemoveWidget"
          class="flex-1 px-4 py-2 min-h-[44px] bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
        >
          删除
        </button>
      </div>
    </div>
  </OverlayMotion>

  <OverlayMotion
    :show="showRenameModal"
    :z-index="90"
    overlay-class="bg-black/40 backdrop-blur-sm p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
    panel-class="max-w-sm"
  >
    <div class="bg-white rounded-xl shadow-xl w-full p-4 border border-gray-100">
      <div class="text-base font-bold text-gray-900">修改昵称</div>
      <div class="text-xs text-gray-500 mt-1">将同步更新到道理鱼音乐账户资料</div>

      <input
        v-model="newDisplayName"
        type="text"
        class="mt-3 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
        placeholder="请输入新的昵称"
        @keyup.enter="updateDisplayName"
      />

      <div class="mt-4 flex justify-end gap-2">
        <button
          @click="showRenameModal = false"
          class="px-4 py-2 min-h-[44px] text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors"
        >
          取消
        </button>
        <button
          @click="updateDisplayName"
          :disabled="isUpdatingProfile"
          class="px-4 py-2 min-h-[44px] bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {{ isUpdatingProfile ? "保存中..." : "保存" }}
        </button>
      </div>
    </div>
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
.glass-panel,
.glass-card,
.glass-chip {
  background-color: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.glass-chip:hover {
  background-color: rgba(255, 255, 255, 0.12);
}
.night-settings :deep(.glass-panel),
.night-settings :deep(.glass-card),
.night-settings :deep(.glass-chip) {
  color: #f8fafc;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
.selected-outline {
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
  font-weight: 700;
}
.selectable-outline:focus-visible,
.selectable-outline:active {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.95);
}
</style>
