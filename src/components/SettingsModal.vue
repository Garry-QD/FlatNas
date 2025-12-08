<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useMainStore } from "../stores/main";
import type { RssFeed, WidgetConfig, RssCategory, SearchEngine, NavGroup } from "@/types";
import IconUploader from "./IconUploader.vue";
import PasswordConfirmModal from "./PasswordConfirmModal.vue";
import { VueDraggable } from "vue-draggable-plus";

defineProps<{ show: boolean }>();
const emit = defineEmits(["update:show"]);
const store = useMainStore();

const activeTab = ref("style");
const searchWidget = computed(() => store.widgets.find((w) => w.id === "w5"));
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
const passwordInput = ref("");
const newPasswordInput = ref("");

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
    const res = await fetch("/api/music/upload", {
      method: "POST",
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

// Password Confirm Logic
const showPasswordConfirm = ref(false);
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
  store.changePassword(newPasswordInput.value);
  alert("密码修改成功");
  newPasswordInput.value = "";
};

const toggleAuthMode = async () => {
  const currentMode = store.systemConfig.authMode;
  const newMode = currentMode === "single" ? "multi" : "single";

  if (newMode === "single") {
    if (!confirm("确定要切换到单用户模式吗？\n切换后将隐藏注册入口，默认登录 Admin 账户。")) return;
  } else {
    if (!confirm("确定要切换到多用户模式吗？\n切换后将允许新用户注册，登录时需输入用户名。"))
      return;
  }

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
const handleExport = async () => {
  try {
    // 强制立即保存，确保后端数据也是最新的
    await store.saveData(true);

    const backupData = {
      items: store.items,
      widgets: store.widgets,
      appConfig: store.appConfig,
      password: store.password,
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
      if (data.appName === "Sun-Panel-Config" && Array.isArray(data.icons)) {
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
          password: store.password,
        };
      } else if (!data.groups && data.items) {
        data.groups = [{ id: Date.now().toString(), title: "默认分组", items: data.items }];
      }
      const r = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const r = await fetch("/api/reset", { method: "POST" });
      if (!r.ok) throw new Error("reset_failed");
      // 移除成功弹窗，直接刷新
      window.location.reload();
    } catch (e) {
      alert("❌ 恢复失败");
      console.error("[SettingsModal][Reset] failed", e);
    }
  }, "请输入密码以确认恢复初始化");
};

const handleSaveAsDefault = async () => {
  requestAuth(async () => {
    // 密码验证通过后直接执行
    try {
      const r = await fetch("/api/default/save", { method: "POST" });
      if (!r.ok) throw new Error("save_default_failed");

      // 移除成功弹窗，使用按钮文字反馈
      saveDefaultBtnText.value = "✅ 保存成功！";
      setTimeout(() => {
        saveDefaultBtnText.value = "💾 设为默认模板";
      }, 2000);
    } catch (e) {
      alert("❌ 保存失败");
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

const removeWidget = (id: string) => {
  widgetToDeleteId.value = id;
  showDeleteWidgetConfirm.value = true;
};
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex h-[480px] relative"
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

      <div class="w-48 bg-gray-50 border-r border-gray-100 p-4 flex flex-col">
        <h3 class="text-xl font-bold text-gray-800 mb-6 px-2">⚙️ 设置</h3>
        <nav class="space-y-1">
          <button
            @click="activeTab = 'style'"
            :class="
              activeTab === 'style'
                ? 'bg-purple-100 text-purple-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🎨 外观与布局
          </button>
          <button
            @click="activeTab = 'widgets'"
            :class="
              activeTab === 'widgets'
                ? 'bg-green-100 text-green-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🧩 小组件
          </button>
          <button
            @click="activeTab = 'rss'"
            :class="
              activeTab === 'rss'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
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
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
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
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors mb-1"
          >
            🖥️ 万能窗口
          </button>
          <button
            @click="activeTab = 'account'"
            :class="
              activeTab === 'account'
                ? 'bg-orange-100 text-orange-700 font-bold'
                : 'text-gray-600 hover:bg-gray-100'
            "
            class="w-full text-left px-4 py-2 rounded-lg text-sm transition-colors"
          >
            🔒 账户管理
          </button>
        </nav>

        <div class="mt-auto pt-4 border-t border-gray-200 px-2 grid grid-cols-1 gap-2">
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
                    <button
                      v-if="store.appConfig.background"
                      @click="store.appConfig.background = ''"
                      class="mt-2 text-xs text-red-500 hover:underline"
                    >
                      清除背景
                    </button>
                  </div>

                  <div
                    v-if="store.appConfig.background"
                    class="grid grid-cols-2 gap-4 mt-2 p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <label class="block text-xs text-gray-500 mb-1 flex justify-between">
                        <span>模糊半径</span>
                        <span>{{ store.appConfig.backgroundBlur ?? 0 }}px</span>
                      </label>
                      <input
                        type="range"
                        v-model.number="store.appConfig.backgroundBlur"
                        min="0"
                        max="20"
                        step="1"
                        class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                    <div>
                      <label class="block text-xs text-gray-500 mb-1 flex justify-between">
                        <span>遮罩浓度</span>
                        <span>{{ Math.round((store.appConfig.backgroundMask ?? 0) * 100) }}%</span>
                      </label>
                      <input
                        type="range"
                        v-model.number="store.appConfig.backgroundMask"
                        min="0"
                        max="1"
                        step="0.1"
                        class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="border-t border-gray-100"></div>

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
                  <input
                    type="color"
                    v-model="store.appConfig.titleColor"
                    class="w-10 h-10 rounded cursor-pointer border-0 p-0"
                  />
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
                桌面小组件
              </h4>
              <div class="flex items-center gap-3 text-xs mr-[10px]">
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
            <div class="grid grid-cols-4 gap-4">
              <template v-for="w in sortedWidgets" :key="w.id">
                <div
                  v-if="w.type !== 'iframe'"
                  :class="[
                    'flex items-center justify-between p-3 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all',
                    w.type === 'player' ? 'col-span-4 flex-row' : 'aspect-square flex-col',
                  ]"
                >
                  <template v-if="w.type === 'player'">
                    <div class="flex items-center gap-3 flex-shrink-0">
                      <div
                        class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                      >
                        🎵
                      </div>
                      <span class="font-bold text-gray-700 text-sm">随机音乐</span>
                    </div>
                    <div
                      class="flex-1 flex items-center gap-2 px-4 border-l border-gray-200 ml-4 h-8"
                    >
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
                    <div class="flex items-center gap-4 flex-shrink-0">
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
                        <span class="text-[10px] text-gray-400 scale-90">自动</span>
                        <label
                          class="relative inline-flex items-center cursor-pointer"
                          title="自动播放"
                          ><input
                            type="checkbox"
                            v-model="store.appConfig.autoPlayMusic"
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
                                                        : w.type === "iframe"
                                                          ? "万能窗口"
                                                          : "未知组件"
                        }}
                      </span>
                    </div>
                    <div class="flex items-center justify-around w-full mt-1">
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
                      <div v-if="w.type === 'player'" class="flex flex-col items-center gap-0.5">
                        <span class="text-[10px] text-gray-400 scale-90">自动</span>
                        <label
                          class="relative inline-flex items-center cursor-pointer"
                          title="自动播放"
                          ><input
                            type="checkbox"
                            v-model="store.appConfig.autoPlayMusic"
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

          <div v-if="activeTab === 'rss'" class="space-y-6">
            <div
              class="flex items-center justify-between border-l-4 border-orange-500 pl-3 mb-4 mr-8"
            >
              <h4 class="text-lg font-bold text-gray-800">RSS 订阅管理</h4>
              <span
                class="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100 flex items-center gap-1 mr-[10px]"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                云端同步已开启
              </span>
            </div>

            <!-- RSS Widget Master Switch -->
            <div
              v-if="rssWidget"
              class="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50 hover:bg-white hover:shadow-md transition-all"
            >
              <div class="flex items-center gap-4">
                <div
                  class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl shadow-sm"
                >
                  📡
                </div>
                <div>
                  <h5 class="font-bold text-gray-700">RSS 阅读器组件</h5>
                  <p class="text-xs text-gray-400">桌面组件总开关</p>
                </div>
              </div>
              <div class="flex items-center gap-6">
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
              class="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-6 animate-fade-in"
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
                <div class="grid grid-cols-2 gap-4">
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
                <div class="flex items-center gap-6 pt-2">
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
              <div class="flex gap-3 mb-4">
                <button
                  @click="editRss()"
                  class="flex-1 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50 transition-all text-sm font-bold flex items-center justify-center gap-2"
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
                  class="px-4 py-3 border rounded-xl text-sm font-bold transition-all"
                >
                  {{ managingCategories ? "返回订阅列表" : "🗂️ 管理分类" }}
                </button>
              </div>

              <!-- Category Management View -->
              <div v-if="managingCategories" class="space-y-4 animate-fade-in">
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <h5 class="text-sm font-bold text-gray-700 mb-3">添加新分类</h5>
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
                    class="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm"
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
                    class="text-center py-8 text-gray-400 text-sm"
                  >
                    暂无分类
                  </div>
                </div>
              </div>

              <!-- RSS Feed List -->
              <div v-else class="space-y-3 animate-fade-in">
                <div
                  v-if="!store.rssFeeds || store.rssFeeds.length === 0"
                  class="text-center py-8 text-gray-400 text-sm"
                >
                  暂无订阅源，点击上方按钮添加
                </div>

                <div
                  v-for="feed in store.rssFeeds"
                  :key="feed.id"
                  class="p-4 border border-gray-100 rounded-xl bg-white hover:shadow-md transition-all group"
                >
                  <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-3">
                      <div
                        class="w-10 h-10 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg"
                      >
                        {{ feed.title.substring(0, 1) }}
                      </div>
                      <div>
                        <h5 class="font-bold text-gray-800">{{ feed.title }}</h5>
                        <div class="flex items-center gap-2 mt-1">
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
                        class="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                      >
                        ✏️
                      </button>
                      <button
                        @click="deleteRss(feed.id)"
                        class="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div class="flex items-center justify-between pt-2 border-t border-gray-50 mt-2">
                    <div class="flex gap-2">
                      <span v-for="tag in feed.tags" :key="tag" class="text-[10px] text-orange-400"
                        >#{{ tag }}</span
                      >
                    </div>
                    <div class="flex gap-3">
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
                        ><input type="checkbox" v-model="w.isPublic" class="sr-only peer" />
                        <div
                          class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"
                        ></div
                      ></label>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span class="text-[10px] text-gray-400 font-medium">启用</span
                      ><label class="relative inline-flex items-center cursor-pointer"
                        ><input type="checkbox" v-model="w.enable" class="sr-only peer" />
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
              </div>
              <div class="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-6">
                <h5 class="text-sm font-bold text-gray-700 mb-3">🔑 修改密码</h5>
                <div class="flex gap-2">
                  <input
                    v-model="newPasswordInput"
                    type="password"
                    placeholder="新密码..."
                    class="flex-1 px-3 py-2 rounded-lg border border-gray-300"
                  /><button
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
