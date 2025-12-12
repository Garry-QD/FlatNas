<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useMainStore } from "../stores/main";
import type { RssFeed, WidgetConfig, RssCategory, SearchEngine, NavGroup, NavItem } from "@/types";
import IconUploader from "./IconUploader.vue";
import WallpaperLibrary from "./WallpaperLibrary.vue";
import PasswordConfirmModal from "./PasswordConfirmModal.vue";
import { VueDraggable } from "vue-draggable-plus";
import DockerWidget from "./DockerWidget.vue";
import SystemStatusWidget from "./SystemStatusWidget.vue";

defineProps<{ show: boolean }>();
const emit = defineEmits(["update:show"]);
const store = useMainStore();

const showWallpaperLibrary = ref(false);

const handleWallpaperSelect = (payload: { url: string; type: string } | string) => {
  const url = typeof payload === "string" ? payload : payload.url;
  const type = typeof payload === "string" ? "pc" : payload.type;

  if (type === "mobile") {
    store.appConfig.mobileBackground = url;
  } else {
    store.appConfig.background = url;
  }
};

const activeTab = ref("style");
const searchWidget = computed(() => store.widgets.find((w) => w.id === "w5"));
const dockerWidget = computed(() => store.widgets.find((w) => w.type === "docker"));
const systemStatusWidget = computed(() => store.widgets.find((w) => w.type === "system-status"));
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
        `✅ 连接成功!\n\nSocket: ${data.socketPath}\n版本: ${data.version.Version}\n系统: ${data.info.OSType} / ${data.info.Architecture}\n容器: ${data.info.Containers}\n名称: ${data.info.Name}`,
      );
    } else {
      alert(`❌ 连接失败: ${data.error}\nSocket: ${data.socketPath}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    alert("❌ 网络错误: " + msg);
  }
};

const piClickCount = ref(0);
const handlePiClick = () => {
  piClickCount.value++;
  if (piClickCount.value === 3) {
    store.isExpandedMode = !store.isExpandedMode;
    piClickCount.value = 0;
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
    alert(`已切换为${newMode === "single" ? "单用户模式" : "多用户模式"}`);
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
      alert("❌ 保存版本失败: " + (d.error || r.status));
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
      alert("❌ 恢复失败: " + (d.error || r.status));
      return;
    }
    window.location.reload();
  } catch (e) {
    console.error("[SettingsModal][RestoreVersion]", e);
  }
};

const deleteVersion = async (id: string) => {
  try {
    if (!confirm("确认删除该版本？此操作不可撤销")) return;
    const token = localStorage.getItem("flat-nas-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const r = await fetch(`/api/config-versions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert("❌ 删除失败: " + (d.error || r.status));
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
      alert("✅ 导入成功！");
      window.location.reload();
    } catch (err) {
      alert("❌ 导入失败，请检查文件格式是否为 JSON。");
      console.error("[SettingsModal][Import] failed", err);
    } finally {
      if (fileInput.value) fileInput.value.value = "";
    }
  };
  reader.readAsText(file);
};

const saveDefaultBtnText = ref("💾 设为默认模板");

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
      alert("❌ 恢复失败: " + (err.message || "未知错误"));
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
      saveDefaultBtnText.value = "✅ 保存成功！";
      setTimeout(() => {
        saveDefaultBtnText.value = "💾 设为默认模板";
      }, 2000);
    } catch (e: unknown) {
      const err = e as Error;
      alert("❌ 保存失败: " + (err.message || "未知错误"));
      console.error("[SettingsModal][SaveDefault] failed", e);
    }
  }, "请输入密码以确认保存默认模板");
};

// 修复：移除 computed 中的副作用，改用 onMounted 初始化
onMounted(() => {
  store.widgets.forEach((w: WidgetConfig) => {
    if (w.type === "iframe" && !w.data) {
      w.data = { url: "" };
    }
  });
});

const addSearchEngine = () => {
  const id = Date.now().toString();
  const key = "custom-" + id;
  const label = "新搜索引擎";
  const urlTemplate = "https://example.com/search?q={q}";

  if (!store.appConfig.searchEngines) {
    store.appConfig.searchEngines = [];
  }
  store.appConfig.searchEngines.push({ id, key, label, urlTemplate });
};
const removeSearchEngine = (key: string) => {
  const list = (store.appConfig.searchEngines || []).filter((e: SearchEngine) => e.key !== key);
  store.appConfig.searchEngines = list;
  if (store.appConfig.defaultSearchEngine === key) {
    store.appConfig.defaultSearchEngine = list[0]?.key || "";
  }
};

// RSS Logic
const rssForm = ref({
  id: "",
  title: "",
  url: "",
  category: "",
  tags: "",
  enable: true,
  isPublic: true,
});
const editingRss = ref(false);

const editRss = (feed?: RssFeed) => {
  if (feed) {
    rssForm.value = { ...feed, category: feed.category || "", tags: (feed.tags || []).join(", ") };
    editingRss.value = true;
  } else {
    rssForm.value = {
      id: "",
      title: "",
      url: "",
      category: "",
      tags: "",
      enable: true,
      isPublic: true,
    };
    editingRss.value = true;
  }
};

const saveRss = () => {
  if (!rssForm.value.title || !rssForm.value.url) return alert("请填写标题和 URL");

  const tags = rssForm.value.tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t);
  const newItem = {
    id: rssForm.value.id || Date.now().toString(),
    title: rssForm.value.title,
    url: rssForm.value.url,
    category: rssForm.value.category,
    tags,
    enable: rssForm.value.enable,
    isPublic: rssForm.value.isPublic,
  };

  if (!store.rssFeeds) store.rssFeeds = [];

  if (rssForm.value.id) {
    const index = store.rssFeeds.findIndex((f: RssFeed) => f.id === rssForm.value.id);
    if (index !== -1) store.rssFeeds[index] = newItem;
  } else {
    store.rssFeeds.push(newItem);
  }

  // Auto-add category
  if (rssForm.value.category) {
    if (!store.rssCategories) store.rssCategories = [];
    const exists = store.rssCategories.some((c: RssCategory) => c.name === rssForm.value.category);
    if (!exists) {
      store.rssCategories.push({
        id: Date.now().toString() + "-cat",
        name: rssForm.value.category,
        feeds: [],
      });
    }
  }

  store.saveData(); // Trigger save
  editingRss.value = false;
};

const deleteRss = (id: string) => {
  if (!confirm("确定删除此订阅源？")) return;
  store.rssFeeds = store.rssFeeds.filter((f: RssFeed) => f.id !== id);
};

const rssWidget = computed(() => store.widgets.find((w: WidgetConfig) => w.type === "rss"));

// RSS Category Management
const managingCategories = ref(false);
const newCategoryName = ref("");
const editingCategoryId = ref<string | null>(null);
const editCategoryName = ref("");

const addCategory = () => {
  const name = newCategoryName.value.trim();
  if (!name) return;
  if (!store.rssCategories) store.rssCategories = [];
  if (store.rssCategories.some((c: RssCategory) => c.name === name)) return alert("分类已存在");

  store.rssCategories.push({ id: Date.now().toString() + "-cat", name, feeds: [] });
  newCategoryName.value = "";
  store.saveData();
};

const startEditCategory = (cat: { id: string; name: string }) => {
  editingCategoryId.value = cat.id;
  editCategoryName.value = cat.name;
};

const updateCategory = () => {
  if (!editingCategoryId.value || !editCategoryName.value.trim()) return;
  const index = store.rssCategories.findIndex((c: RssCategory) => c.id === editingCategoryId.value);
  if (index !== -1) {
    // Update category name in feeds
    const cat = store.rssCategories[index];
    if (cat) {
      const oldName = cat.name;
      const newName = editCategoryName.value.trim();
      cat.name = newName;

      // Update associated feeds
      if (store.rssFeeds) {
        store.rssFeeds.forEach((f: RssFeed) => {
          if (f.category === oldName) f.category = newName;
        });
      }
      store.saveData();
    }
  }
  editingCategoryId.value = null;
  editCategoryName.value = "";
};

const deleteCategory = (id: string) => {
  if (!confirm("确定删除该分类？(该分类下的订阅源将变为无分类)")) return;
  const cat = store.rssCategories.find((c: RssCategory) => c.id === id);
  if (cat) {
    // Clear category from feeds
    if (store.rssFeeds) {
      store.rssFeeds.forEach((f: RssFeed) => {
        if (f.category === cat.name) f.category = "";
      });
    }
    store.rssCategories = store.rssCategories.filter((c: RssCategory) => c.id !== id);
    store.saveData();
  }
};

// Tag Suggestions
const allTags = computed(() => {
  const tags = new Set<string>();
  store.rssFeeds?.forEach((f: RssFeed) => {
    f.tags?.forEach((t: string) => tags.add(t));
  });
  return Array.from(tags);
});

const addTagToForm = (tag: string) => {
  const currentTags = rssForm.value.tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t);
  if (!currentTags.includes(tag)) {
    currentTags.push(tag);
    rssForm.value.tags = currentTags.join(", ");
  }
};

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
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col md:flex-row h-[600px] md:h-[480px] relative"
    >
      <button
        @click="close"
        class="absolute top-4 right-4 bg-[#FF0000] hover:bg-red-600 text-white z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-sm transition-colors"
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
        class="w-full md:w-48 bg-gray-50 border-b md:border-b-0 md:border-r border-gray-100 p-4 flex flex-col md:flex-col shrink-0"
      >
        <h3 class="text-xl font-bold text-gray-800 mb-4 md:mb-6 px-2">⚙️ 设置</h3>
        <nav
          class="flex flex-row md:flex-col gap-2 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0"
        >
          <button
            @click="activeTab = 'style'"
            :class="
              activeTab === 'style'
                ? 'bg-purple-100 text-purple-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            🎨 外观布局
          </button>
          <button
            @click="activeTab = 'widgets'"
            :class="
              activeTab === 'widgets'
                ? 'bg-green-100 text-green-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            🧩 单开组件
          </button>
          <button
            @click="activeTab = 'rss'"
            :class="
              activeTab === 'rss'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            📡 RSS 订阅
          </button>
          <button
            @click="activeTab = 'search'"
            :class="
              activeTab === 'search'
                ? 'bg-blue-100 text-blue-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            🔎 搜索引擎
          </button>
          <button
            @click="activeTab = 'universal-window'"
            :class="
              activeTab === 'universal-window'
                ? 'bg-purple-100 text-purple-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            🖥️ 多开组件
          </button>
          <button
            @click="activeTab = 'docker'"
            :class="
              activeTab === 'docker'
                ? 'bg-blue-100 text-blue-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-0 md:mb-1"
          >
            🐳 Docker 管理
          </button>
          <button
            @click="activeTab = 'account'"
            :class="
              activeTab === 'account'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="whitespace-nowrap md:whitespace-normal w-auto md:w-full text-left px-4 py-2 rounded-lg text-sm transition-colors"
          >
            🔒 账户管理
          </button>
        </nav>

        <div class="mt-auto pt-4 border-t border-gray-200 px-2 hidden md:grid grid-cols-1 gap-2">
          <div class="text-center flex items-center justify-center gap-1">
            <span class="text-xs text-gray-400 font-mono">v{{ store.currentVersion }}</span>
            <span
              v-if="store.hasUpdate && store.isLogged"
              class="w-2 h-2 bg-red-500 rounded-full cursor-pointer"
              title="发现新版本"
              @click="store.checkUpdate"
            ></span>
          </div>
          <div class="text-center text-xs text-gray-500">QQ群:613835409</div>
          <div class="flex items-center justify-center gap-4">
            <a
              href="https://github.com/Garry-QD/FlatNas"
              target="_blank"
              class="hover:opacity-80 transition-opacity"
              title="GitHub"
            >
              <img src="/icons/github.svg" alt="GitHub" class="w-6 h-6" />
            </a>
            <a
              href="https://gitee.com/gjx0808/FlatNas"
              target="_blank"
              class="text-[#C71D23] hover:opacity-80 transition-opacity"
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
                  d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.811 17.914l-.943-.896c-.342-.325-.92-.332-1.19-.026l-2.72 3.067a.772.772 0 0 1-1.05.09l-6.55-5.314a.775.775 0 0 1 .1-1.267l6.894-4.003a.775.775 0 0 1 1.03.22l2.214 3.285a.775.775 0 0 0 1.19.12l1.024-.967a.775.775 0 0 0 .08-1.02l-3.65-5.504a.775.775 0 0 0-1.17-.14l-8.78 7.32a.775.775 0 0 0-.15 1.08l7.87 6.38a.775.775 0 0 0 1.05-.09l3.58-4.034a.775.775 0 0 0 .02-1.08z"
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
                class="w-6 h-6 object-contain scale-110"
              />
            </a>
          </div>
        </div>
      </div>

      <div class="flex-1 flex flex-col bg-white overflow-hidden">
        <div class="flex-1 p-4 overflow-y-auto">
          <div v-if="activeTab === 'style'" class="space-y-4">
            <div>
              <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-blue-500 pl-2">
                基础信息
              </h4>
              <div class="space-y-2">
                <div>
                  <label class="text-sm font-bold text-gray-600 mb-1 block">网站标题</label>
                  <input
                    v-model="store.appConfig.customTitle"
                    type="text"
                    class="w-full px-2 py-2 border border-gray-200 rounded-xl focus:border-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label class="text-sm font-bold text-gray-600 mb-1 block">背景图片</label>
                  <div class="border border-gray-200 rounded-xl p-2 bg-gray-50">
                    <IconUploader
                      v-model="store.appConfig.background"
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
                        @click="store.appConfig.background = ''"
                        class="text-xs text-red-500 hover:underline"
                      >
                        清除背景
                      </button>
                      <button
                        @click="showWallpaperLibrary = true"
                        class="text-xs text-blue-500 hover:underline font-bold flex items-center gap-1 ml-auto"
                      >
                        <span>🖼️</span> 管理壁纸库
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-100"></div>

            <WallpaperLibrary v-model:show="showWallpaperLibrary" @select="handleWallpaperSelect" />

            <div>
              <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-purple-500 pl-2">
                布局与排版
              </h4>
              <div class="mb-2">
                <h5 class="text-sm font-bold text-gray-600 mb-2">顶部栏布局</h5>
                <div class="flex gap-2">
                  <button
                    @click="store.appConfig.titleAlign = 'left'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2"
                    :class="
                      store.appConfig.titleAlign === 'left'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    "
                  >
                    <span>⬅️</span><span class="text-sm font-bold">标准布局</span>
                  </button>
                  <button
                    @click="store.appConfig.titleAlign = 'right'"
                    class="flex-1 p-2 border-2 rounded-xl flex items-center justify-center gap-2"
                    :class="
                      store.appConfig.titleAlign === 'right'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    "
                  >
                    <span class="text-sm font-bold">反转布局</span><span>➡️</span>
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <h4 class="text-sm font-bold text-gray-600 mb-1">标题大小</h4>
                  <input
                    type="range"
                    v-model.number="store.appConfig.titleSize"
                    min="20"
                    max="80"
                    class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  />
                </div>
                <div>
                  <h4 class="text-sm font-bold text-gray-600 mb-1">标题颜色</h4>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      v-model="store.appConfig.titleColor"
                      class="w-10 h-10 rounded cursor-pointer border-0 p-0"
                    />
                    <button
                      @click="store.appConfig.titleColor = '#ffffff'"
                      class="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors text-sm"
                      title="重置颜色"
                    >
                      ↺
                    </button>
                  </div>
                </div>
                <div>
                  <h4 class="text-sm font-bold text-gray-600 mb-1">分组垂直间距</h4>
                  <div class="flex items-center gap-2">
                    <input
                      type="range"
                      v-model.number="store.appConfig.groupGap"
                      min="0"
                      max="100"
                      step="5"
                      class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <span class="text-xs text-gray-500 w-6">{{
                      store.appConfig.groupGap ?? 30
                    }}</span>
                  </div>
                </div>
                <div class="flex items-end justify-end">
                  <button
                    @click="handlePiClick"
                    class="text-[8px] text-gray-300 hover:text-gray-600 transition-colors opacity-50 hover:opacity-100 p-1"
                    title="菩提祖师授长生"
                  >
                    π
                  </button>
                </div>
              </div>
            </div>

            <div>
              <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-purple-500 pl-2">
                页脚设置
              </h4>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm font-bold text-gray-600">显示访客统计</label>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      v-model="store.appConfig.showFooterStats"
                      class="sr-only peer"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"
                    ></div>
                  </label>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-bold text-gray-600 mb-1 block">页脚高度 (px)</label>
                    <div class="text-xs text-gray-400 mb-1">0 为自适应</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerHeight"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-purple-500 outline-none text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label class="text-sm font-bold text-gray-600 mb-1 block"
                      >页脚内容宽度 (px)</label
                    >
                    <div class="text-xs text-gray-400 mb-1">默认 1280</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerWidth"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-purple-500 outline-none text-sm"
                      placeholder="1280"
                    />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm font-bold text-gray-600 mb-1 block"
                      >页脚距底部 (px)</label
                    >
                    <div class="text-xs text-gray-400 mb-1">调整页脚垂直位置</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerMarginBottom"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-purple-500 outline-none text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label class="text-sm font-bold text-gray-600 mb-1 block"
                      >页脚字体大小 (px)</label
                    >
                    <div class="text-xs text-gray-400 mb-1">默认 12px</div>
                    <input
                      type="number"
                      v-model="store.appConfig.footerFontSize"
                      class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-purple-500 outline-none text-sm"
                      placeholder="12"
                    />
                  </div>
                </div>
                <div>
                  <label class="text-sm font-bold text-gray-600 mb-1 block"
                    >自定义页脚内容 (HTML)</label
                  >
                  <textarea
                    v-model="store.appConfig.footerHtml"
                    rows="3"
                    placeholder="可输入备案号等信息，支持 HTML 标签"
                    class="w-full px-3 py-2 border border-gray-200 rounded-xl focus:border-purple-500 outline-none text-sm font-mono"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'widgets'" class="space-y-4">
            <div class="flex items-center justify-between mb-4 mr-8">
              <h4 class="text-lg font-bold text-gray-800 border-l-4 border-green-500 pl-3">
                桌面组件
              </h4>
              <div class="flex items-center gap-3 text-xs mr-[10px]">
                <button
                  @click="restoreMissingWidgets"
                  class="text-blue-500 hover:text-blue-700 underline mr-2"
                >
                  恢复默认组件
                </button>
                <div class="flex items-center gap-1">
                  <div class="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                  <span class="text-gray-500">公开</span>
                </div>
                <div class="flex items-center gap-1">
                  <div class="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                  <span class="text-gray-500">启用</span>
                </div>
              </div>
            </div>

            <!-- Normal Widgets Grid -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <template v-for="w in sortedWidgets" :key="w.id">
                <div
                  v-if="w.type !== 'iframe' && w.type !== 'countdown' && w.type !== 'docker'"
                  :class="[
                    'border border-gray-100 rounded-xl bg-white hover:shadow-md transition-all relative',
                    w.type === 'player'
                      ? 'col-span-2 md:col-span-4 flex flex-col gap-3 p-4 md:grid md:grid-cols-[auto_1fr_auto] md:items-center md:gap-4'
                      : 'flex flex-col items-center justify-between p-4 aspect-square',
                  ]"
                >
                  <button
                    v-if="isUnknownWidget(w.type)"
                    @click="deleteWidget(w.id)"
                    class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-full text-xs transition-colors z-20"
                    title="删除组件"
                  >
                    ✕
                  </button>
                  <template v-if="w.type === 'player'">
                    <div class="flex items-center gap-3 flex-shrink-0">
                      <div
                        class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                      >
                        🎵
                      </div>
                      <span class="font-bold text-gray-700 text-sm">随机音乐</span>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                      <label
                        class="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs rounded-lg cursor-pointer hover:bg-blue-100 transition-colors flex items-center gap-1 whitespace-nowrap"
                      >
                        <span>📤 上传音乐</span>
                        <input
                          type="file"
                          accept="audio/*"
                          class="hidden"
                          multiple
                          @change="uploadMusic"
                        />
                      </label>
                      <span
                        v-if="uploadStatus"
                        class="text-xs"
                        :class="uploadStatus.includes('失败') ? 'text-red-500' : 'text-green-500'"
                        >{{ uploadStatus }}</span
                      >
                    </div>
                    <div class="flex items-center justify-center md:justify-end gap-3 md:gap-4">
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
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"
                          ></div
                        ></label>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="flex flex-col items-center gap-2 flex-1 justify-center scale-100">
                      <div
                        class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                      >
                        {{
                          w.type === "clock"
                            ? "⏰"
                            : w.type === "weather"
                              ? "🌦️"
                              : w.type === "clockweather"
                                ? "🕒🌦️"
                                : w.type === "calendar"
                                  ? "📅"
                                  : w.type === "memo"
                                    ? "📝"
                                    : w.type === "search"
                                      ? "🔍"
                                      : w.type === "quote"
                                        ? "💬"
                                        : w.type === "bookmarks"
                                          ? "📑"
                                          : w.type === "todo"
                                            ? "✅"
                                            : w.type === "calculator"
                                              ? "🧮"
                                              : w.type === "ip"
                                                ? "🌐"
                                                : w.type === "player"
                                                  ? "🎵"
                                                  : w.type === "hot"
                                                    ? "🔥"
                                                    : w.type === "rss"
                                                      ? "📡"
                                                      : w.type === "sidebar"
                                                        ? "⬅️"
                                                        : "🖥️"
                        }}
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
                                                                : `未知组件 (${w.type})`
                        }}
                      </span>
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
                            class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-500"
                          ></div
                        ></label>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
            </div>

            <!-- Weather Service Settings -->
            <div class="flex items-center justify-between mt-8 mb-4 border-t border-gray-100 pt-6">
              <h4 class="text-lg font-bold text-gray-800">天气服务设置</h4>
            </div>
            <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6">
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-2">天气源选择</label>
                  <div class="flex items-center gap-4 mb-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        v-model="store.appConfig.weatherSource"
                        value="wttr"
                        class="text-blue-500"
                      />
                      <span class="text-sm">Wttr.in (默认)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        v-model="store.appConfig.weatherSource"
                        value="amap"
                        class="text-blue-500"
                      />
                      <span class="text-sm">高德地图 (AMap)</span>
                    </label>
                  </div>
                </div>

                <div v-if="store.appConfig.weatherSource === 'amap'" class="animate-fade-in">
                  <label class="block text-xs font-bold text-gray-600 mb-1">高德 API Key</label>
                  <input
                    v-model="store.appConfig.amapKey"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                    placeholder="请输入高德 Web 服务 Key"
                  />
                  <p class="text-[10px] text-gray-500 mt-1">
                    请前往
                    <a
                      href="https://console.amap.com/dev/key/app"
                      target="_blank"
                      class="text-blue-500 underline"
                      >高德开放平台</a
                    >
                    申请 Web 服务 Key。
                  </p>
                </div>

                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">自定义天气源 URL</label>
                  <input
                    v-model="store.appConfig.weatherApiUrl"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none"
                    placeholder="默认使用内置源，输入 URL 以自定义"
                  />
                  <p class="text-[10px] text-gray-500 mt-1">
                    若填写，将直接请求该地址获取天气数据。返回格式需包含：
                    <code>{ data: { temp, text, city, humidity, today: { min, max } } }</code>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'rss'" class="space-y-3">
            <div class="flex items-center justify-between border-l-2 border-orange-500 pl-2 mb-2">
              <h4 class="text-lg font-bold text-gray-800">RSS 订阅管理</h4>
              <span
                class="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100 flex items-center gap-1"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                云端同步已开启
              </span>
            </div>

            <!-- RSS Widget Master Switch -->
            <div
              v-if="rssWidget"
              class="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50 hover:bg-white hover:shadow-md transition-all"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-lg shadow-sm"
                >
                  📡
                </div>
                <div>
                  <h5 class="font-bold text-gray-700">RSS 阅读器组件</h5>
                  <p class="text-xs text-gray-400">桌面组件总开关</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <div class="flex flex-col items-end gap-1">
                  <span class="text-[10px] text-gray-400 font-medium">公开</span
                  ><label class="relative inline-flex items-center cursor-pointer"
                    ><input type="checkbox" v-model="rssWidget.isPublic" class="sr-only peer" />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                    ></div
                  ></label>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <span class="text-[10px] text-gray-400 font-medium">启用</span
                  ><label class="relative inline-flex items-center cursor-pointer"
                    ><input type="checkbox" v-model="rssWidget.enable" class="sr-only peer" />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"
                    ></div
                  ></label>
                </div>
              </div>
            </div>

            <!-- Add/Edit Form -->
            <div
              v-if="editingRss"
              class="bg-orange-50 border border-orange-100 rounded-lg p-3 mb-3 animate-fade-in"
            >
              <h5 class="text-sm font-bold text-orange-800 mb-3">
                {{ rssForm.id ? "编辑订阅源" : "新增订阅源" }}
              </h5>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">标题</label>
                  <input
                    v-model="rssForm.title"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                    placeholder="例如：少数派"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold text-gray-600 mb-1">RSS 地址</label>
                  <input
                    v-model="rssForm.url"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                    placeholder="https://..."
                  />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">分类</label>
                    <input
                      v-model="rssForm.category"
                      list="rss-categories"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                      placeholder="选择或输入分类"
                    />
                    <datalist id="rss-categories">
                      <option v-for="c in store.rssCategories" :key="c.id" :value="c.name"></option>
                    </datalist>
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1"
                      >标签 (逗号分隔)</label
                    >
                    <input
                      v-model="rssForm.tags"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
                      placeholder="科技, 设计"
                    />
                    <div v-if="allTags.length > 0" class="mt-2 flex flex-wrap gap-2">
                      <span class="text-[10px] text-gray-400">常用标签：</span>
                      <button
                        v-for="tag in allTags"
                        :key="tag"
                        @click="addTagToForm(tag)"
                        class="text-[10px] px-1.5 py-0.5 bg-gray-100 hover:bg-orange-100 text-gray-500 hover:text-orange-600 rounded transition-colors"
                      >
                        {{ tag }}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-3 pt-2">
                  <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" v-model="rssForm.enable" class="accent-orange-500" />
                    启用
                  </label>
                  <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" v-model="rssForm.isPublic" class="accent-orange-500" />
                    公开
                  </label>
                </div>
                <div class="flex justify-end gap-3 mt-2">
                  <button
                    @click="editingRss = false"
                    class="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm font-bold"
                  >
                    取消
                  </button>
                  <button
                    @click="saveRss"
                    class="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>

            <!-- RSS List / Category Management -->
            <div v-if="!editingRss">
              <div class="flex gap-2 mb-3">
                <button
                  @click="editRss()"
                  class="flex-1 py-2 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition-all text-sm font-bold flex items-center justify-center gap-2"
                >
                  <span>+</span> 新增订阅源
                </button>
                <button
                  @click="managingCategories = !managingCategories"
                  :class="
                    managingCategories
                      ? 'bg-orange-100 text-orange-600 border-orange-200'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  "
                  class="px-3 py-2 border rounded-lg text-sm font-bold transition-all"
                >
                  {{ managingCategories ? "返回订阅列表" : "🗂️ 管理分类" }}
                </button>
              </div>

              <!-- Category Management View -->
              <div v-if="managingCategories" class="space-y-3 animate-fade-in">
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <h5 class="text-sm font-bold text-gray-700 mb-2">添加新分类</h5>
                  <div class="flex gap-2">
                    <input
                      v-model="newCategoryName"
                      @keyup.enter="addCategory"
                      placeholder="输入分类名称..."
                      class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-orange-500"
                    />
                    <button
                      @click="addCategory"
                      class="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600"
                    >
                      添加
                    </button>
                  </div>
                </div>

                <div class="space-y-2">
                  <div
                    v-for="cat in store.rssCategories"
                    :key="cat.id"
                    class="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-lg hover:shadow-sm"
                  >
                    <div v-if="editingCategoryId === cat.id" class="flex-1 flex gap-2 mr-4">
                      <input
                        v-model="editCategoryName"
                        class="flex-1 px-2 py-1 border border-orange-300 rounded text-sm outline-none"
                      />
                      <button @click="updateCategory" class="text-green-600 text-xs font-bold">
                        保存
                      </button>
                      <button @click="editingCategoryId = null" class="text-gray-400 text-xs">
                        取消
                      </button>
                    </div>
                    <div v-else class="flex items-center gap-3">
                      <span class="text-xl">📁</span>
                      <span class="text-sm font-bold text-gray-700">{{ cat.name }}</span>
                      <span class="text-xs text-gray-400"
                        >({{
                          store.rssFeeds?.filter((f) => f.category === cat.name).length || 0
                        }})</span
                      >
                    </div>

                    <div v-if="editingCategoryId !== cat.id" class="flex items-center gap-2">
                      <button
                        @click="startEditCategory(cat)"
                        class="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded"
                      >
                        ✏️
                      </button>
                      <button
                        @click="deleteCategory(cat.id)"
                        class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div
                    v-if="!store.rssCategories || store.rssCategories.length === 0"
                    class="text-center py-6 text-gray-400 text-sm"
                  >
                    暂无分类
                  </div>
                </div>
              </div>

              <!-- RSS Feed List -->
              <div v-else class="space-y-2 animate-fade-in">
                <div
                  v-if="!store.rssFeeds || store.rssFeeds.length === 0"
                  class="text-center py-6 text-gray-400 text-sm"
                >
                  暂无订阅源，点击上方按钮添加
                </div>

                <div
                  v-for="feed in store.rssFeeds"
                  :key="feed.id"
                  class="p-3 border border-gray-100 rounded-lg bg-white hover:shadow-md transition-all group"
                >
                  <div class="flex items-start justify-between mb-1">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-base"
                      >
                        {{ feed.title.substring(0, 1) }}
                      </div>
                      <div>
                        <h5 class="font-bold text-gray-800">{{ feed.title }}</h5>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span
                            v-if="feed.category"
                            class="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-500"
                            >{{ feed.category }}</span
                          >
                          <span class="text-[10px] text-gray-400 truncate max-w-[200px]">{{
                            feed.url
                          }}</span>
                        </div>
                      </div>
                    </div>
                    <div
                      class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <button
                        @click="editRss(feed)"
                        class="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                      >
                        ✏️
                      </button>
                      <button
                        @click="deleteRss(feed.id)"
                        class="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center justify-between pt-1 border-t border-gray-50 mt-1">
                    <div class="flex gap-2">
                      <span v-for="tag in feed.tags" :key="tag" class="text-[10px] text-orange-400"
                        >#{{ tag }}</span
                      >
                    </div>
                    <div class="flex gap-2">
                      <span
                        :class="feed.enable ? 'text-green-500' : 'text-gray-300'"
                        class="text-xs font-bold"
                        >{{ feed.enable ? "已启用" : "已禁用" }}</span
                      >
                      <span
                        :class="feed.isPublic ? 'text-blue-500' : 'text-gray-300'"
                        class="text-xs font-bold"
                        >{{ feed.isPublic ? "公开" : "私有" }}</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'docker'" class="space-y-4">
            <div class="flex items-center justify-between mb-4 mr-8">
              <h4 class="text-lg font-bold text-gray-800 border-l-4 border-blue-500 pl-3">
                Docker 管理 (内测中)
              </h4>
              <div v-if="dockerWidget" class="flex items-center gap-3 text-xs mr-[10px]">
                <button
                  @click="checkDockerConnection"
                  class="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-100 transition-colors font-bold"
                >
                  ⚡ 测试连接
                </button>
              </div>
            </div>

            <!-- Host Status Widget Section -->
            <div class="space-y-3 mb-6 pb-6 border-b border-gray-100">
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold text-gray-800">宿主机状态组件</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="systemStatusWidget?.enable"
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
                    class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                  ></div>
                </label>
              </div>

              <div
                v-if="systemStatusWidget && systemStatusWidget.enable"
                class="animate-fade-in space-y-3"
              >
                <div class="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
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
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">使用模拟数据</span>
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
                        class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"
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
                <span class="text-sm font-bold text-gray-800">Docker 组件</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" v-model="dockerWidget.enable" class="sr-only peer" />
                  <div
                    class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                  ></div>
                </label>
              </div>

              <div class="flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
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
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-400">支持启动/停止/重启</span>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      :checked="!!dockerWidget.data?.useMock"
                      @change="(e) => toggleDockerMock((e.target as HTMLInputElement).checked)"
                      class="sr-only peer"
                    />
                    <div
                      class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"
                    ></div>
                  </label>
                  <span class="text-[10px] text-gray-500">使用模拟数据</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-700 font-medium">内网主机</span>
                  <input
                    :value="dockerWidget.data?.lanHost"
                    @change="
                      (e) => {
                        if (!dockerWidget.data) dockerWidget.data = {};
                        dockerWidget.data.lanHost = (e.target as HTMLInputElement).value;
                        store.saveData();
                      }
                    "
                    type="text"
                    placeholder="例如：192.168.1.10"
                    class="px-2 py-1 border border-gray-200 rounded text-xs focus:border-blue-500 outline-none"
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
                class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
              >
                启用 Docker 组件
              </button>
              <p class="mt-4 text-xs text-gray-400 max-w-xs mx-auto">
                如果您的系统不支持
                Docker（如旧版本），启用后可以在上方开启"使用模拟数据"以体验功能。
              </p>
            </div>
          </div>

          <div v-if="activeTab === 'search'" class="space-y-6">
            <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-blue-500 pl-3">
              搜索引擎设置
            </h4>

            <div
              v-if="searchWidget"
              class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl shadow-sm mb-4"
            >
              <div class="flex flex-col">
                <span class="text-sm font-bold text-gray-800">显示搜索栏</span>
                <span class="text-xs text-gray-500">开启后将在桌面顶部显示搜索输入框</span>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" v-model="searchWidget.enable" class="sr-only peer" />
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"
                ></div>
              </label>
            </div>

            <div class="flex items-center justify-between mb-2">
              <div class="text-xs text-gray-500">拖拽调整优先级；点击单选框设置默认搜索引擎。</div>
              <label
                class="flex items-center gap-2 text-xs font-bold text-gray-700 cursor-pointer hover:text-blue-600 transition-colors bg-blue-50 px-2 py-1 rounded-lg border border-blue-100"
              >
                <input
                  type="checkbox"
                  v-model="store.appConfig.rememberLastEngine"
                  class="w-3 h-3 accent-blue-500 rounded"
                />
                记住上次选择
              </label>
            </div>
            <VueDraggable
              v-model="store.appConfig.searchEngines"
              :animation="300"
              handle=".drag-handle"
              class="space-y-3"
            >
              <div
                v-for="e in store.appConfig.searchEngines"
                :key="e.id"
                class="p-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-white transition-all flex flex-col gap-2"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 flex-1">
                    <div
                      class="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1"
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
                        <circle cx="9" cy="12" r="1" />
                        <circle cx="9" cy="5" r="1" />
                        <circle cx="9" cy="19" r="1" />
                        <circle cx="15" cy="12" r="1" />
                        <circle cx="15" cy="5" r="1" />
                        <circle cx="15" cy="19" r="1" />
                      </svg>
                    </div>
                    <input
                      v-model="e.label"
                      class="text-sm font-bold text-gray-700 bg-transparent border border-transparent hover:border-gray-300 focus:border-blue-500 rounded px-1 py-0.5 outline-none transition-all w-32"
                      placeholder="名称"
                    />
                    <span class="text-[10px] text-gray-400 font-mono">{{ e.key }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <label
                      class="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer hover:text-blue-600 transition-colors px-2 py-1 rounded-lg border border-transparent hover:border-gray-200 hover:bg-white"
                      :class="{
                        'text-blue-600 font-bold bg-blue-50 border-blue-100':
                          store.appConfig.defaultSearchEngine === e.key,
                      }"
                    >
                      <span>{{
                        store.appConfig.defaultSearchEngine === e.key ? "当前默认" : "设为默认"
                      }}</span>
                      <input
                        type="radio"
                        :value="e.key"
                        v-model="store.appConfig.defaultSearchEngine"
                        class="accent-blue-500 w-3 h-3 cursor-pointer"
                      />
                    </label>
                    <button
                      class="text-xs text-red-500 hover:underline px-1"
                      @click="removeSearchEngine(e.key)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <label class="text-[10px] text-gray-500">URL 模板</label>
                  <input
                    v-model="e.urlTemplate"
                    class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none"
                    placeholder="例如：https://example.com/search?q={q}"
                  />
                </div>
              </div>
            </VueDraggable>
            <div class="flex items-center gap-3">
              <button
                @click="addSearchEngine"
                class="flex-1 p-2 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all text-sm font-bold"
              >
                + 添加搜索引擎
              </button>
            </div>
          </div>

          <div v-if="activeTab === 'universal-window'" class="flatnas-handshake-signal space-y-4">
            <!-- Universal Window Widget Section -->
            <div class="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
              <div class="flex items-center gap-2">
                <h4 class="text-lg font-bold text-gray-800 border-l-4 border-purple-500 pl-3">
                  万能窗口
                </h4>
                <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">可多开</span>
                <button
                  @click="addIframeWidget"
                  class="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1 ml-2"
                >
                  <span class="text-lg leading-none">+</span> 新增窗口
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
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                    >
                      🖥️
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
                <div class="w-full bg-white p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1"
                      >外网/默认地址 (URL)</label
                    >
                    <input
                      v-model="w.data.url"
                      type="url"
                      placeholder="例如：https://example.com"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none"
                    />
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
                    <input
                      v-model="w.data.lanUrl"
                      type="url"
                      placeholder="例如：http://192.168.x.x"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none"
                    />
                  </div>
                  <p class="text-[10px] text-gray-500 mt-1">
                    加群下载浏览器插件可以解决无法正常访问问题
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
                <h4 class="text-lg font-bold text-gray-800 border-l-4 border-red-500 pl-3">
                  倒计时
                </h4>
                <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">可多开</span>
                <button
                  @click="addCountdownWidget"
                  class="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1 ml-2"
                >
                  <span class="text-lg leading-none">+</span> 新增倒计时
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
                      class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                    >
                      ⏳
                    </div>
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-700">倒计时</span>
                      <span class="text-[10px] text-gray-400 font-mono">ID: {{ w.id }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-6">
                    <button
                      @click="removeWidget(w.id)"
                      class="text-red-400 hover:text-red-600 text-xs underline px-2"
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
                <div class="w-full bg-white p-3 rounded-lg border border-gray-100 space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">标题</label>
                    <input
                      v-model="w.data.title"
                      type="text"
                      placeholder="例如：春节"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-red-500 outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-gray-600 mb-1">目标时间</label>
                    <input
                      v-model="w.data.targetDate"
                      type="datetime-local"
                      class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:border-red-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-if="activeTab === 'account'" class="min-h-full flex flex-col justify-center">
            <div v-if="!store.isLogged" class="text-center">
              <h4 class="text-xl font-bold mb-6 text-gray-800">管理员登录</h4>
              <input
                v-model="passwordInput"
                type="password"
                placeholder="密码..."
                class="w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl mb-4 mx-auto text-center"
                @keyup.enter="handleLogin"
              />
              <button
                @click="handleLogin"
                class="bg-orange-500 text-white px-10 py-3 rounded-xl font-bold"
              >
                登 录
              </button>
            </div>
            <div v-else class="max-w-sm mx-auto w-full">
              <div class="bg-blue-50 p-5 rounded-xl border border-blue-100 mb-6">
                <h5 class="text-sm font-bold text-blue-800 mb-3">📦 备份与恢复</h5>
                <div class="grid grid-cols-2 gap-3">
                  <button
                    @click="handleExport"
                    class="col-span-2 bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-lg text-sm font-bold"
                  >
                    📤 导出配置
                  </button>
                  <button
                    @click="triggerImport"
                    class="col-span-2 bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
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
                    class="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
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
                class="bg-purple-50 p-5 rounded-xl border border-purple-200 mb-6"
              >
                <h5 class="text-sm font-bold text-purple-800 mb-3">⚙️ 系统模式</h5>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-700"
                    >当前模式：{{
                      store.systemConfig.authMode === "single" ? "单用户模式" : "多用户模式"
                    }}</span
                  >
                  <button
                    @click="toggleAuthMode"
                    class="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all"
                    :class="
                      store.systemConfig.authMode === 'single'
                        ? 'bg-purple-500 hover:bg-purple-600'
                        : 'bg-blue-500 hover:bg-blue-600'
                    "
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
                      class="flex-1 px-3 py-2 rounded-lg border border-purple-300 text-sm"
                    />
                    <button
                      @click="saveVersion"
                      class="px-4 py-2 rounded-lg text-sm font-bold text-white transition-all bg-purple-600 hover:bg-purple-700"
                    >
                      保存为版本
                    </button>
                  </div>
                  <div class="text-[10px] text-purple-600 mb-2">保存位置：data/config_versions</div>
                  <div class="max-h-40 overflow-y-auto space-y-1">
                    <div v-if="loadingVersions" class="text-xs text-gray-500">加载中...</div>
                    <div
                      v-for="v in versions"
                      :key="v.id"
                      class="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-purple-100"
                    >
                      <div class="flex-1">
                        <div class="text-sm font-medium text-gray-800 truncate">
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
                          class="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600"
                        >
                          恢复
                        </button>
                        <button
                          @click="deleteVersion(v.id)"
                          class="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                <h5 class="text-sm font-bold text-gray-700 mb-1">🔑 修改密码</h5>
                <p class="text-xs text-gray-500 mb-2">点击修改后请输入原来密码</p>
                <div class="flex gap-2">
                  <div class="relative flex-1">
                    <input
                      v-model="newPasswordInput"
                      :type="showPassword ? 'text' : 'password'"
                      placeholder="新密码..."
                      class="w-full px-3 py-2 rounded-lg border border-gray-300 pr-10"
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
                    class="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm"
                  >
                    修改
                  </button>
                </div>
              </div>
              <button
                @click="store.logout"
                class="w-full bg-red-50 text-red-600 py-3 rounded-xl font-bold border border-red-100"
              >
                退出登录
              </button>

              <!-- Admin User Management UI -->
              <div
                v-if="store.username === 'admin' && store.systemConfig.authMode === 'multi'"
                class="mt-6 bg-blue-50 p-5 rounded-xl border border-blue-200"
              >
                <h5 class="text-sm font-bold text-blue-800 mb-3">👥 用户管理 (Admin)</h5>

                <!-- Add User -->
                <div class="flex flex-col gap-2 mb-4">
                  <div class="flex gap-2">
                    <input
                      v-model="newUser"
                      placeholder="用户名"
                      class="flex-1 px-3 py-2 rounded-lg border border-blue-300 text-sm"
                    />
                    <input
                      v-model="newPwd"
                      type="password"
                      placeholder="密码"
                      class="flex-1 px-3 py-2 rounded-lg border border-blue-300 text-sm"
                    />
                  </div>
                  <button
                    @click="handleAddUser"
                    class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700"
                  >
                    添加用户
                  </button>
                </div>

                <!-- User List -->
                <div class="space-y-2 max-h-40 overflow-y-auto">
                  <div
                    v-for="u in userList"
                    :key="u"
                    class="flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-blue-100"
                  >
                    <span class="text-sm text-gray-700 font-medium">
                      {{ u }}
                      <span v-if="u === 'admin'" class="text-xs text-blue-500">(管理员)</span>
                    </span>
                    <button
                      v-if="u !== 'admin'"
                      @click="handleDeleteUser(u)"
                      class="text-red-500 hover:text-red-700 text-xs font-bold px-2"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <!-- License Management -->
                <div class="mt-4 pt-4 border-t border-blue-200">
                  <h6 class="text-xs font-bold text-blue-800 mb-2">🔑 授权密钥 (License Key)</h6>
                  <div class="flex gap-2">
                    <input
                      v-model="licenseKey"
                      placeholder="输入密钥解除限制..."
                      class="flex-1 px-3 py-2 rounded-lg border border-blue-300 text-sm"
                    />
                    <button
                      @click="handleUploadLicense"
                      class="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-green-700 whitespace-nowrap"
                    >
                      导入
                    </button>
                  </div>
                  <p class="text-[10px] text-blue-600 mt-1">
                    导入有效密钥可解除5个用户的注册限制。
                  </p>
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
        <div class="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-2xl">
          ⚠️
        </div>
        <h3 class="text-lg font-bold text-gray-800">切换模式警告</h3>
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
          class="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md"
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
      <h3 class="text-lg font-bold text-gray-800 mb-2">确认删除</h3>
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
          class="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600 transition-colors"
        >
          删除
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
