<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useStorage } from "@vueuse/core";
import { useMainStore } from "../stores/main";
import type { WidgetConfig, NavGroup, NavItem } from "@/types";
import IconUploader from "./IconUploader.vue";
import WallpaperLibrary from "./WallpaperLibrary.vue";
import PasswordConfirmModal from "./PasswordConfirmModal.vue";
import DockerWidget from "./DockerWidget.vue";
import SystemStatusWidget from "./SystemStatusWidget.vue";
import RssSettings from "./RssSettings.vue";
import SearchSettings from "./SearchSettings.vue";
import ScriptManager from "./ScriptManager.vue";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits(["update:show"]);
const store = useMainStore();

const showWallpaperLibrary = ref(false);
const musicVolume = useStorage<number>("flat-nas-music-volume", 0.7);
const musicVolumePercent = computed({
  get: () => Math.round((musicVolume.value ?? 0.7) * 100),
  set: (val: number) => {
    const v = Number.isFinite(val) ? val : 70;
    musicVolume.value = Math.min(1, Math.max(0, v / 100));
  },
});
const solidBackgroundColorProxy = computed({
  get: () => store.appConfig.solidBackgroundColor || "#f3f4f6",
  set: (val: string) => {
    store.appConfig.solidBackgroundColor = val;
    store.saveData();
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
    store.saveData();
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
  store.saveData();
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

// Debug Active Tab
watch(activeTab, (val) => {
  console.log("Active Tab Changed:", val);
});

// Ensure Docker Widget Exists
onMounted(() => {
  // 移除强制恢复逻辑，避免覆盖用户配置
  // const hasDocker = store.widgets.some((w) => w.type === "docker");
  // if (!hasDocker) { ... }
});

const testWeatherResult = ref<{ success: boolean; message: string } | null>(null);
const isTestingWeather = ref(false);

const tempInputs = ref<Record<string, string>>({});

const updateTempInput = (key: string, value: string) => {
  tempInputs.value[key] = value;
};

const confirmTempInput = (w: any, field: string, key: string) => {
  if (tempInputs.value[key] !== undefined) {
    w.data[field] = tempInputs.value[key];
    store.saveData();
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
    store.saveData();
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

        store.saveData();
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
      store.saveData();
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
  return path.startsWith("/") ? `${apiBase}${path}` : `${apiBase}/${path}`;
};

const testQWeather = async () => {
  isTestingWeather.value = true;
  testWeatherResult.value = null;
  const source = "qweather";
  const projectId = store.appConfig.qweatherProjectId || "";
  const keyId = store.appConfig.qweatherKeyId || "";
  const privateKey = store.appConfig.qweatherPrivateKey || "";

  // Use "auto" to trigger IP location on server, or "Shanghai" as a safe default for testing
  const city = "auto";
  const url = `/api/weather?city=${encodeURIComponent(city)}&source=${source}&projectId=${encodeURIComponent(projectId)}&keyId=${encodeURIComponent(keyId)}&privateKey=${encodeURIComponent(privateKey)}`;

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

const toggleDockerMock = (checked: boolean) => {
  const w = dockerWidget.value;
  if (w) {
    if (!w.data) w.data = {};
    w.data.useMock = checked;
    store.saveData();
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
    store.saveData();
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

const checkDockerConnection = async () => {
  try {
    const headers = store.getHeaders();
    const res = await fetch("/api/docker/info", { headers });
    const data = await res.json();
    if (data.success) {
      alert(
        `连接成功!\n\nSocket: ${data.socketPath}\n版本: ${data.version.Version}\n系统: ${data.info.OSType} / ${data.info.Architecture}\n容器: ${data.info.Containers}\n名称: ${data.info.Name}`,
      );
    } else {
      alert(`连接失败: ${data.error}\nSocket: ${data.socketPath}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    alert("网络错误: " + msg);
  }
};

// Password Confirm Logic
const showPasswordConfirm = ref(false);
const showMultiUserWarning = ref(false);
const pendingAction = ref<(() => void) | null>(null);
const confirmTitle = ref("");

const requestAuth = (action: () => void, title: string) => {
  pendingAction.value = action;
  confirmTitle.value = title;
  showPasswordConfirm.value = true;
};

const onAuthSuccess = () => {
  if (pendingAction.value) {
    pendingAction.value();
    pendingAction.value = null;
  }
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
    await store.saveData(true);
    alert("密码修改成功");
    newPasswordInput.value = "";
  }, "请输入当前密码以确认修改");
};

const onMobileDockerDisplayChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement | null)?.checked ?? false;
  const w = dockerWidget.value;
  if (w) {
    w.hideOnMobile = !checked;
    store.saveData();
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
  if (store.username === "admin" && store.systemConfig.authMode === "multi") {
    userList.value = await store.fetchUsers();
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
watch(activeTab, (val) => {
  if (val === "account") {
    loadUsers();
  }
});

const toggleAuthMode = async () => {
  const currentMode = store.systemConfig.authMode;
  const newMode = currentMode === "single" ? "multi" : "single";

  if (newMode === "single") {
    if (!confirm("确定要切换到单用户模式吗？\n切换后将隐藏注册入口，默认登录 Admin 账户。")) return;
    performAuthModeSwitch(newMode);
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
  if (store.username === "admin" && store.systemConfig.authMode === "single") {
    fetchVersions();
  }
});

const getWebhookUrl = () => {
  return `${window.location.protocol}//${window.location.hostname}:${window.location.port || "3000"}/api/webhook/lucky/stun`;
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
    "system-status",
    "file-transfer",
    "music",
  ];

  return !knownTypes.includes(type);
};

const restoreMissingWidgets = () => {
  const defaultWidgets: WidgetConfig[] = [
    {
      id: "clockweather",
      type: "clockweather",
      enable: true,
      colSpan: 1,
      rowSpan: 1,
      isPublic: true,
    },
    { id: "w1", type: "clock", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "w2", type: "weather", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "w3", type: "calendar", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "w5", type: "search", enable: true, isPublic: true },
    { id: "w7", type: "quote", enable: true, isPublic: true },
    { id: "sidebar", type: "sidebar", enable: false, isPublic: true },
    { id: "docker", type: "docker", enable: false, isPublic: true, colSpan: 1, rowSpan: 1 },
    {
      id: "file-transfer",
      type: "file-transfer",
      enable: true,
      colSpan: 2,
      rowSpan: 2,
      isPublic: true,
    },
    {
      id: "system-status",
      type: "system-status",
      enable: false,
      isPublic: true,
      colSpan: 1,
      rowSpan: 1,
      data: { useMock: false },
    },
    { id: "memo", type: "memo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "todo", type: "todo", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "calculator", type: "calculator", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "ip", type: "ip", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "hot", type: "hot", enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
    { id: "player", type: "player", enable: true, colSpan: 2, rowSpan: 1, isPublic: true },
  ];

  let addedCount = 0;
  defaultWidgets.forEach((def) => {
    const exists = store.widgets.some((w) => w.type === def.type);
    if (!exists) {
      store.widgets.push(def);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    store.saveData();
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
      html: '<div class="my-custom-component">\n  <h3>自定义组件</h3>\n  <p>点击右上角编辑按钮修改内容</p>\n</div>',
      css: ".my-custom-component {\n  padding: 10px;\n  background: linear-gradient(to right, #e0eafc, #cfdef3);\n  border-radius: 8px;\n  text-align: center;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n}\n.my-custom-component h3 {\n  margin: 0 0 5px 0;\n  color: #333;\n}",
    },
    colSpan: 1,
    rowSpan: 1,
    isPublic: true,
  });
  store.saveData();
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
  store.saveData();
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
    store.saveData();
  } else {
    exists.enable = true;
    store.saveData();
  }
};

const toggleSystemStatusMock = (checked: boolean) => {
  const w = systemStatusWidget.value;
  if (w) {
    if (!w.data) w.data = {};
    w.data.useMock = checked;
    store.saveData();
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
    store.saveData();
  } else {
    exists.enable = true;
    store.saveData();
  }
};

const onMobileSystemStatusDisplayChange = (e: Event) => {
  const checked = (e.target as HTMLInputElement | null)?.checked ?? false;
  const w = systemStatusWidget.value;
  if (w) {
    w.hideOnMobile = !checked;
    store.saveData();
  }
};

const handleExport = async () => {
  try {
    // 强制立即保存，确保后端数据也是最新的
    await store.saveData(true);

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
const handleFileChange = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e: ProgressEvent<FileReader>) => {
    try {
      const content = e.target?.result as string;
      let data = JSON.parse(content);

      // SunPanel format support
      if (Array.isArray(data.icons)) {
        const newGroups: NavGroup[] = data.icons.map(
          (
            g: {
              title?: string;
              children?: { title?: string; url?: string; lanUrl?: string }[];
            },
            gIdx: number,
          ) => ({
            id: Date.now().toString() + "_" + gIdx,
            title: g.title || "New Group",
            items: (g.children || []).map(
              (c: { title?: string; url?: string; lanUrl?: string }, cIdx: number) => ({
                id: Date.now().toString() + "_" + gIdx + "_" + cIdx,
                title: c.title || "New Item",
                url: c.url || "",
                lanUrl: c.lanUrl || "",
                icon: "",
                isPublic: true,
              }),
            ),
          }),
        );

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
      const token = localStorage.getItem("flat-nas-token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch("/api/data/import", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("import_post_failed:" + r.status);
      alert("导入成功！");
      window.location.reload();
    } catch (err) {
      alert("导入失败，请检查文件格式是否为 JSON。");
      console.error("[SettingsModal][Import] failed", err);
    } finally {
      if (fileInput.value) fileInput.value.value = "";
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

  if (changed) store.saveData();
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
  store.saveData();
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
  store.saveData();
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
    if (
      val &&
      activeTab.value === "account" &&
      store.username === "admin" &&
      store.systemConfig.authMode === "single"
    ) {
      fetchVersions();
    }
  },
);

watch(activeTab, (val) => {
  if (val === "account" && store.username === "admin" && store.systemConfig.authMode === "single") {
    fetchVersions();
  }
});
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col md:flex-row h-[600px] md:h-[480px] relative"
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
        class="w-full md:w-1/4 bg-transparent border-b md:border-b-0 md:border-r border-gray-100 p-4 flex flex-col md:flex-col shrink-0 cursor-move"
        @mousedown="onMouseDown"
      >
        <h3 class="text-xl font-bold text-gray-900 mb-4 md:mb-6 px-2">设置</h3>
        <nav
          ref="navRef"
          class="flex flex-row md:flex-col gap-2 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 no-drag cursor-grab active:cursor-grabbing overscroll-contain"
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
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            外观布局
          </button>
          <button
            @click="activeTab = 'widgets'"
            :class="
              activeTab === 'widgets'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            单开组件
          </button>

          <button
            @click="activeTab = 'universal-window'"
            :class="
              activeTab === 'universal-window'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            多开组件
          </button>
          <button
            @click="activeTab = 'docker'"
            :class="
              activeTab === 'docker'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            Docker 管理
          </button>
          <button
            @click="activeTab = 'account'"
            :class="
              activeTab === 'account'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors"
          >
            账户管理
          </button>
          <button
            @click="activeTab = 'network'"
            :class="[
              'px-4 py-2 text-sm transition-colors text-left flex items-center gap-2',
              activeTab === 'network'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50',
            ]"
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 rounded-lg mb-0 md:mb-1"
          >
            网络判定
          </button>
          <button
            @click="activeTab = 'lucky-stun'"
            :class="
              activeTab === 'lucky-stun'
                ? 'border border-black text-gray-900 font-bold bg-transparent'
                : 'border border-transparent text-gray-600 hover:bg-gray-50'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            开放中心
          </button>
          <button
            @click="activeTab = 'about'"
            :class="
              activeTab === 'about'
                ? 'border border-red-500 text-red-600 font-bold bg-red-50'
                : 'border border-transparent text-red-500 hover:bg-red-50 font-medium'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full shrink-0 text-left px-4 py-2 rounded-lg text-sm transition-colors"
          >
            关于
          </button>
        </nav>
      </div>

      <div class="flex-1 flex flex-col bg-transparent overflow-hidden">
        <div class="flex-1 p-4 overflow-y-auto overscroll-contain" @wheel.stop>
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
                      @update:modelValue="store.saveData()"
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
                          store.saveData();
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
                      @change="store.saveData()"
                      type="text"
                      placeholder="#f3f4f6"
                      class="flex-1 px-2 py-2 border border-gray-200 rounded-xl focus:border-gray-900 outline-none text-sm"
                    />
                    <button
                      @click="
                        store.appConfig.solidBackgroundColor = '';
                        store.saveData();
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
                        ? 'border-gray-900 bg-gray-100 text-gray-900 font-bold'
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
                        ? 'border-gray-900 bg-gray-100 text-gray-900 font-bold'
                        : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'
                    "
                  >
                    <span class="text-sm">反转布局</span>
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
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
                  <h4 class="text-sm font-medium text-gray-700 mb-1">黑暗模式</h4>
                  <div class="flex items-center gap-2">
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        v-model="store.appConfig.empireMode"
                        class="sr-only peer"
                      />
                      <div
                        class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                      ></div>
                    </label>
                    <span class="text-xs text-gray-500">开启明黄云纹模式</span>
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

                <div class="flex items-center justify-between mt-4 border-t pt-4 border-gray-100">
                  <div>
                    <div class="text-sm font-medium text-gray-700 flex items-center gap-1">
                      自动适配带鱼屏
                      <span
                        class="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded leading-none font-normal"
                        >内测中</span
                      >
                    </div>
                    <div class="text-xs text-gray-500">
                      检测到 21:9 或 32:9 分辨率时自动开启宽屏模式
                    </div>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      v-model="store.appConfig.autoUltrawide"
                      class="sr-only peer"
                      @change="handleUltrawideChange"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
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

            <!-- Normal Widgets Grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <template v-for="w in sortedWidgets" :key="w.id">
                <div
                  v-if="w.type !== 'iframe' && w.type !== 'countdown' && w.type !== 'docker'"
                  :class="[
                    'border border-gray-100 rounded-xl bg-white/60 hover:shadow-md transition-all relative',
                    w.type === 'player'
                      ? 'col-span-2 md:col-span-4 flex flex-col gap-3 p-4 md:grid md:grid-cols-[auto_1fr_auto] md:items-center md:gap-4'
                      : 'flex flex-col items-center justify-between p-4 aspect-square',
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
                        class="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-1 whitespace-nowrap"
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
                        class="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-1 whitespace-nowrap"
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
                            ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" />
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
                            ><input type="checkbox" v-model="w.enable" class="sr-only peer" />
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
                                  store.saveData();
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
                              @change="store.saveData()"
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
                      class="flex flex-col items-center gap-2 flex-1 justify-center scale-100 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors w-full"
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
                                store.saveData();
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
                                    store.saveData();
                                  }
                                "
                                @change="store.saveData()"
                                class="w-5 h-5 p-0 border-0 rounded-full cursor-pointer overflow-hidden shadow-sm"
                                title="选择颜色"
                              />
                              <button
                                v-if="w.textColor"
                                @click.stop="
                                  w.textColor = undefined;
                                  store.saveData();
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
                          class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-sm font-medium text-gray-700 shadow-sm"
                        >
                          <img
                            v-if="w.type === 'music'"
                            src="/daoliyu.png"
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
                                                              : w.type === "custom-css"
                                                                ? "自"
                                                                : "组"
                            }}
                          </template>
                        </div>
                        <span
                          class="font-bold text-gray-700 text-sm leading-snug text-center truncate w-full px-1"
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
                                                              : w.type === "iframe"
                                                                ? "万能窗口"
                                                                : w.type === "countdown"
                                                                  ? "倒计时"
                                                                  : w.type === "docker"
                                                                    ? "Docker 管理"
                                                                    : w.type === "custom-css"
                                                                      ? "自定义组件"
                                                                      : w.type === "music"
                                                                        ? "道理鱼音乐"
                                                                        : `未知组件 (${w.type})`
                          }}
                        </span>
                      </template>
                    </div>
                    <div
                      class="grid grid-cols-3 gap-2 w-full mt-2 md:flex md:items-center md:justify-center md:gap-4"
                    >
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">公开</span>
                        <label class="relative inline-flex items-center cursor-pointer" title="公开"
                          ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" />
                          <div
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"
                          ></div
                        ></label>
                      </div>
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">启用</span>
                        <label class="relative inline-flex items-center cursor-pointer" title="启用"
                          ><input type="checkbox" v-model="w.enable" class="sr-only peer" />
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
                                store.saveData();
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
                            @change="store.saveData()"
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
              <div v-if="dockerWidget" class="flex items-center gap-3 text-xs mr-[10px]">
                <button
                  @click="checkDockerConnection"
                  class="bg-gray-100 text-gray-900 px-3 py-1 rounded-lg hover:bg-gray-200 transition-colors font-bold"
                >
                  测试连接
                </button>
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
                            store.saveData();
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

            <div v-if="dockerWidget" class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold text-gray-900">Docker 组件</span>
                <div class="flex items-center gap-4">
                  <div v-if="dockerWidget.enable" class="flex items-center gap-2 animate-fade-in">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-gray-700 font-medium">公开访问</span>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          v-model="dockerWidget.isPublic"
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
                          :checked="!dockerWidget.hideOnMobile"
                          @change="onMobileDockerDisplayChange"
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
                      v-model="dockerWidget.enable"
                      aria-label="启用"
                      class="sr-only peer"
                    />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                    ></div>
                    <span class="text-sm text-gray-700 ml-3">启用</span>
                  </label>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">支持启动/停止/重启</span>
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
                  <span class="text-[10px] text-gray-500">使用模拟数据</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">自动升级镜像(每2小时)</span>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      :checked="!!dockerWidget.data?.autoUpdate"
                      @change="
                        (e) => {
                          if (dockerWidget) {
                            if (!dockerWidget.data) dockerWidget.data = {};
                            dockerWidget.data.autoUpdate = (e.target as HTMLInputElement).checked;
                            store.saveData();
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
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-700 font-medium">内网主机</span>
                  <input
                    :value="dockerWidget?.data?.lanHost"
                    @change="
                      (e) => {
                        if (dockerWidget) {
                          if (!dockerWidget.data) dockerWidget.data = {};
                          dockerWidget.data.lanHost = (e.target as HTMLInputElement).value;
                          store.saveData();
                        }
                      }
                    "
                    type="text"
                    placeholder="例如：192.168.1.10"
                    class="px-2 py-1 border border-gray-200 rounded text-xs focus:border-gray-900 outline-none"
                  />
                </div>
              </div>
              <div class="h-[500px]">
                <DockerWidget :widget="dockerWidget" :compact="true" />
              </div>
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              <p class="mb-4">未启用 Docker 组件</p>
              <button
                @click="enableDockerWidget"
                class="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors shadow-sm"
              >
                启用 Docker 组件
              </button>
              <p class="mt-4 text-xs text-gray-500 max-w-xs mx-auto">
                如果您的系统不支持
                Docker（如旧版本），启用后可以在上方开启"使用模拟数据"以体验功能。
              </p>
            </div>
          </div>

          <div v-if="activeTab === 'universal-window'" class="flatnas-handshake-signal space-y-4">
            <!-- Universal Window Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  万能窗口
                </h4>
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">可多开</span>
                <button
                  @click="addIframeWidget"
                  class="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1 ml-2"
                >
                  <span class="text-base leading-none">+</span> 新增窗口
                </button>
              </div>
            </div>

            <template v-for="w in store.widgets" :key="'iframe-' + w.id">
              <div
                v-if="w.type === 'iframe'"
                class="flatnas-handshake-signal flex flex-col gap-3 p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
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
                          @change="store.saveData()" />
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
                              store.saveData();
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
                          @change="store.saveData()" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                        ></div
                      ></label>
                    </div>
                  </div>
                </div>
                <div class="w-full bg-white/60 p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1"
                      >外网/默认地址 (URL)</label
                    >
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
                      <span class="text-[10px] font-normal text-gray-400 bg-gray-100 px-1.5 rounded"
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

            <!-- Countdown Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4 mt-8">
              <div class="flex items-center gap-2">
                <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                  倒计时
                </h4>
                <span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">可多开</span>
                <button
                  @click="addCountdownWidget"
                  class="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-1 ml-2"
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
                          @change="store.saveData()" />
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
                              store.saveData();
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
                          @change="store.saveData()" />
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
          </div>

          <div v-if="activeTab === 'network'" class="p-4 space-y-4">
            <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3 mb-4">
              网络环境判定设置
            </h4>

            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <div class="flex items-start gap-2 mb-3">
                <span
                  class="text-xs text-gray-500 font-medium border border-gray-200 rounded px-1.5 py-0.5 mt-0.5"
                  >注</span
                >
                <p class="text-xs text-gray-600 leading-relaxed">
                  FlatNas 会自动检测您的网络环境。如果检测到您处于内网（如家庭 Wi-Fi），
                  应用卡片会自动切换到内网地址以提高速度。
                  <br />
                  如果您使用了<b>内网穿透</b>或<b>P2P工具</b>（如 FRP, ZeroTier, Tailscale），
                  请将这些域名或 IP 段添加到下方白名单中，以便 FlatNas 将其识别为“内网环境”。
                </p>
              </div>

              <div class="space-y-3">
                <label class="block text-sm font-medium text-gray-700">
                  自定义内网域名/IP白名单
                </label>
                <textarea
                  v-model="store.appConfig.internalDomains"
                  @change="store.saveData()"
                  rows="4"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-gray-900 outline-none font-mono"
                  placeholder="每行一个，支持域名后缀或 IP 段。例如：
.frp.yourdomain.com
100.64.
192.168.100."
                ></textarea>
                <p class="text-[10px] text-gray-500">
                  * 系统默认已包含 localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x 等标准私有地址。
                </p>
              </div>
            </div>

            <div class="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <h5 class="text-sm font-medium text-gray-700 mb-3">强制模式</h5>
              <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    v-model="store.appConfig.forceNetworkMode"
                    value="auto"
                    @change="store.saveData()"
                    class="text-gray-900 focus:ring-blue-400 accent-blue-400"
                  />
                  <span class="text-sm text-gray-700">自动判定 (推荐)</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    v-model="store.appConfig.forceNetworkMode"
                    value="lan"
                    @change="store.saveData()"
                    class="text-gray-900 focus:ring-blue-400 accent-blue-400"
                  />
                  <span class="text-sm text-gray-700">强制内网模式</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    v-model="store.appConfig.forceNetworkMode"
                    value="wan"
                    @change="store.saveData()"
                    class="text-gray-900 focus:ring-blue-400 accent-blue-400"
                  />

                  <span class="text-sm text-gray-700">强制外网模式</span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'lucky-stun'" class="p-4 space-y-4">
            <div class="flex items-center gap-2 mb-4">
              <h4 class="text-base font-bold text-gray-900 border-l-4 border-gray-900 pl-3">
                开放中心
              </h4>
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
                    @change="store.saveData()"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                    placeholder="例如：http://192.168.1.10:3000"
                  />
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">用户名</label>
                    <input
                      v-model="musicWidget.data.username"
                      @change="store.saveData()"
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
                      @change="store.saveData()"
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
                            store.saveData();
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
                        value="wttr"
                        class="text-gray-900 accent-blue-400"
                      />
                      <span class="text-sm">Wttr.in (默认)</span>
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
                </div>

                <div v-if="store.appConfig.weatherSource === 'amap'" class="animate-fade-in">
                  <label class="block text-xs font-bold text-gray-600 mb-1">高德 API Key</label>
                  <input
                    v-model="store.appConfig.amapKey"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-gray-900 outline-none"
                    placeholder="请输入高德 Web 服务 Key"
                  />
                  <p class="text-[10px] text-gray-500 mt-1">
                    请前往
                    <a
                      href="https://console.amap.com/dev/key/app"
                      target="_blank"
                      class="text-gray-600 underline hover:text-gray-900"
                      >高德开放平台</a
                    >
                    申请 Web 服务 Key。
                  </p>
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
                      @click="testQWeather"
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
                v-if="store.username === 'admin'"
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
                    @click="toggleAuthMode"
                    class="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all bg-gray-900 hover:bg-gray-800"
                  >
                    切换为{{
                      store.systemConfig.authMode === "single" ? "多用户模式" : "单用户模式"
                    }}
                  </button>
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

                <div v-if="store.systemConfig.authMode === 'single'" class="mt-4">
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
                  <div class="text-[10px] text-gray-500 mb-2">保存位置：data/config_versions</div>
                  <div class="max-h-40 overflow-y-auto space-y-1">
                    <div v-if="loadingVersions" class="text-xs text-gray-500">加载中...</div>
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
              <button
                @click="store.logout"
                class="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-bold border border-gray-200 hover:bg-gray-200 transition-colors"
              >
                退出登录
              </button>

              <!-- Admin User Management UI -->
              <div
                v-if="store.username === 'admin' && store.systemConfig.authMode === 'multi'"
                class="mt-6 bg-gray-50 p-5 rounded-xl border border-gray-200"
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
            </div>
          </div>
          <div
            v-if="activeTab === 'about'"
            class="min-h-full flex flex-row items-start justify-between p-8 gap-8 -mt-4"
          >
            <div class="flex-[0.618] text-left space-y-4 self-center">
              <h4 class="text-2xl font-bold text-gray-900 mb-1">关于 FlatNas</h4>
              <div class="flex items-center justify-start gap-2">
                <span class="text-2xl text-gray-400 font-mono">v{{ store.currentVersion }}</span>
                <span
                  v-if="store.hasUpdate && store.isLogged"
                  class="w-2 h-2 bg-gray-900 rounded-full cursor-pointer"
                  title="发现新版本"
                  @click="store.checkUpdate"
                ></span>
              </div>
              <div class="text-xs text-gray-500">QQ群:613835409</div>
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
              <div class="flex items-center justify-start gap-6">
                <a
                  href="https://github.com/Garry-QD/FlatNas"
                  target="_blank"
                  class="hover:opacity-80 transition-opacity"
                  title="GitHub"
                >
                  <img src="/icons/github.svg" alt="GitHub" class="w-6 h-6 transition-all" />
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
                  class="hover:opacity-80 transition-opacity"
                  title="Docker"
                >
                  <img
                    src="/icons/Docker+Docker+docker.com.png"
                    alt="Docker"
                    class="w-6 h-6 object-contain scale-110 transition-all"
                  />
                </a>
              </div>
            </div>

            <div class="flex-[0.382] flex flex-col items-center gap-4">
              <div class="text-sm font-medium text-gray-700">☕ 投喂作者</div>
              <div class="flex flex-col gap-4">
                <div class="flex flex-col items-center gap-2">
                  <img
                    src="/alipay.jpg"
                    class="w-40 h-40 rounded-lg shadow-sm border border-gray-100 object-contain transition-all"
                    alt="支付宝"
                  />
                  <span class="text-[10px] text-gray-500">支付宝</span>
                </div>
                <div class="flex flex-col items-center gap-2">
                  <img
                    src="/wechat.jpg"
                    class="w-40 h-40 rounded-lg shadow-sm border border-gray-100 object-contain transition-all"
                    alt="微信"
                  />
                  <span class="text-[10px] text-gray-500">微信</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <PasswordConfirmModal
    v-model:show="showPasswordConfirm"
    :title="confirmTitle"
    :on-success="onAuthSuccess"
  />

  <!-- Multi-User Warning Modal -->
  <div
    v-if="showMultiUserWarning"
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm"
  >
    <div
      class="bg-white rounded-xl shadow-xl p-6 w-96 border border-gray-100 transform scale-100 animate-fade-in"
    >
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
          class="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          @click="
            showMultiUserWarning = false;
            performAuthModeSwitch('multi');
          "
          class="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors shadow-md"
        >
          确认切换
        </button>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Modal -->
  <div
    v-if="showDeleteWidgetConfirm"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 backdrop-blur-sm"
  >
    <div
      class="bg-white rounded-xl shadow-xl p-6 w-80 border border-gray-100 transform scale-100 animate-fade-in"
    >
      <h3 class="text-base font-bold text-gray-900 mb-2">确认删除</h3>
      <p class="text-sm text-gray-500 mb-6">确定要删除这个万能窗口吗？此操作无法撤销。</p>
      <div class="flex gap-3">
        <button
          @click="showDeleteWidgetConfirm = false"
          class="flex-1 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          @click="confirmRemoveWidget"
          class="flex-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 transition-colors"
        >
          删除
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="showRenameModal"
    class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
  >
    <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 border border-gray-100">
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
          class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm transition-colors"
        >
          取消
        </button>
        <button
          @click="updateDisplayName"
          :disabled="isUpdatingProfile"
          class="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {{ isUpdatingProfile ? "保存中..." : "保存" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
