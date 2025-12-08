<script setup lang="ts">
defineOptions({
  name: "AppSidebar",
});
import { computed, onMounted, onUnmounted, ref, nextTick } from "vue";
import { useMainStore } from "../stores/main";
import type { BookmarkCategory } from "@/types";
import { parseBookmarks } from "../utils/bookmark";

const props = defineProps<{
  onOpenSettings: () => void;
  onOpenEdit: () => void;
  collapsed: boolean;
}>();

const emit = defineEmits(["update:collapsed"]);
const store = useMainStore();
const fileInput = ref<HTMLInputElement | null>(null);

// --- Bookmarks ---
const bookmarks = computed(() => {
  const widgets = store.widgets.filter((w) => w.type === "bookmarks" && w.enable);
  return widgets.flatMap((w) => (w.data as BookmarkCategory[]) || []);
});

const handleImportClick = () => {
  fileInput.value?.click();
};

const handleFileUpload = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result as string;
    try {
      const newItems = parseBookmarks(content);
      if (newItems.length > 0) {
        // Find existing bookmark widget or create new one
        let widget = store.widgets.find((w) => w.type === "bookmarks");

        if (!widget) {
          widget = {
            id: "w" + Date.now(),
            type: "bookmarks",
            enable: true,
            isPublic: false,
            data: [],
          };
          store.widgets.push(widget);
        }

        if (!widget.data) widget.data = [];

        widget.data.push({
          id: Date.now().toString(),
          title: `导入收藏 ${new Date().toLocaleDateString()}`,
          collapsed: false,
          children: newItems,
        });

        // Save store
        store.saveData();

        alert(`成功导入 ${newItems.length} 个书签！`);
      } else {
        alert("未找到可导入的书签");
      }
    } catch (error) {
      console.error("Import failed", error);
      alert("导入失败，请检查文件格式");
    }
  };
  reader.readAsText(file);
  // Reset input
  if (event.target) (event.target as HTMLInputElement).value = "";
};

const toggleCategory = (category: BookmarkCategory) => {
  category.collapsed = !category.collapsed;
  store.saveData();
};

const handleDeleteBookmark = (category: BookmarkCategory, itemId: string) => {
  category.children = category.children.filter((item) => item.id !== itemId);
  store.saveData();
};

const handleDeleteCategory = (categoryId: string) => {
  for (const widget of store.widgets) {
    if (widget.type === "bookmarks" && widget.data) {
      const index = (widget.data as BookmarkCategory[]).findIndex((c) => c.id === categoryId);
      if (index !== -1) {
        (widget.data as BookmarkCategory[]).splice(index, 1);
        store.saveData();
        return;
      }
    }
  }
};

// --- Keyboard Shortcuts ---
const handleKeydown = (e: KeyboardEvent) => {
  // Ignore if input is focused
  if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;

  if (e.ctrlKey && e.key === "b") {
    // Ctrl+B to toggle sidebar
    e.preventDefault();
    toggle();
  }
};

const showAddModal = ref(false);
const newBookmarkUrl = ref("");
const addInputRef = ref<HTMLInputElement | null>(null);

const openAddModal = () => {
  newBookmarkUrl.value = "";
  showAddModal.value = true;
  nextTick(() => {
    addInputRef.value?.focus();
  });
};

const confirmAddBookmark = async () => {
  const url = newBookmarkUrl.value;
  if (!url) return;

  showAddModal.value = false;

  let finalUrl = url.trim();
  if (!finalUrl.startsWith("http")) finalUrl = "https://" + finalUrl;

  let widget = store.widgets.find((w) => w.type === "bookmarks");

  if (!widget) {
    widget = {
      id: "w" + Date.now(),
      type: "bookmarks",
      enable: true,
      isPublic: false,
      data: [],
    };
    store.widgets.push(widget);
  }

  if (!widget.data) widget.data = [];
  const categories = widget.data as BookmarkCategory[];

  // Use first category or create one
  let targetCategory = categories[0];
  if (!targetCategory) {
    targetCategory = {
      id: Date.now().toString(),
      title: "默认分类",
      collapsed: false,
      children: [],
    };
    categories.push(targetCategory);
  }

  // Try to fetch meta
  let title = finalUrl;
  let icon = "";

  try {
    const res = await fetch(`/api/fetch-meta?url=${encodeURIComponent(finalUrl)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.title) title = data.title;
      if (data.icon) icon = data.icon;
    }
  } catch (e) {
    console.error("Meta fetch failed", e);
  }

  if (!icon) {
    try {
      icon = `https://api.iowen.cn/favicon/${new URL(finalUrl).hostname}.png`;
    } catch {
      // ignore
    }
  }

  targetCategory.children.push({
    id: Date.now().toString(),
    title: title,
    url: finalUrl,
    icon: icon,
  });

  store.saveData();
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

const toggle = () => {
  emit("update:collapsed", !props.collapsed);
};

const handleLogout = async () => {
  if (confirm("确定要退出登录吗？")) {
    await store.logout();
  }
};

// --- Menu Items ---
const menuItems = computed(() => {
  const items = [
    {
      id: "home",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>',
      label: "首页",
      action: () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
      shortcut: "Home",
    },
    {
      id: "edit",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>',
      label: "编辑模式",
      action: () => props.onOpenEdit(),
      shortcut: "",
    },
    {
      id: "settings",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.212 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.212-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
      label: "设置",
      action: () => props.onOpenSettings(),
      shortcut: "",
    },
  ];

  if (store.isLogged) {
    items.push({
      id: "logout",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>',
      label: "退出登录",
      action: handleLogout,
      shortcut: "",
    });
  }

  return items;
});
</script>

<template>
  <div
    class="flex flex-col h-full transition-all duration-300 border-r z-50 backdrop-blur-md"
    :class="[
      collapsed ? 'w-[68px]' : 'w-64',
      store.appConfig.background
        ? 'bg-black/40 border-white/10 text-white'
        : 'bg-white border-gray-200 text-gray-700',
    ]"
  >
    <!-- Toggle Button -->
    <div
      class="p-4 flex items-center justify-between border-b"
      :class="store.appConfig.background ? 'border-white/10' : 'border-gray-100'"
    >
      <span v-if="!collapsed" class="font-bold text-lg truncate">菜单</span>
      <button
        v-if="!collapsed"
        @click="openAddModal"
        class="p-1.5 rounded-lg transition-colors group relative"
        :class="store.appConfig.background ? 'hover:bg-white/10' : 'hover:bg-gray-100'"
        title="快速添加书签"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
      <button
        @click="toggle"
        class="p-1.5 rounded-lg transition-colors group relative"
        :class="store.appConfig.background ? 'hover:bg-white/10' : 'hover:bg-gray-100'"
        title="Ctrl+B 切换侧边栏"
      >
        <svg
          v-if="collapsed"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-6 h-6"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
    </div>

    <!-- Bookmarks (Main Content) -->
    <div class="flex-1 overflow-y-auto py-4 space-y-2 px-3" :class="{ 'no-scrollbar': collapsed }">
      <template v-if="bookmarks.length > 0">
        <div v-for="category in bookmarks" :key="category.id" class="space-y-1">
          <!-- Category Title -->
          <div
            v-if="!collapsed"
            @click="toggleCategory(category)"
            class="w-full px-2 py-1 flex items-center justify-between text-xs font-bold uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity cursor-pointer group/header"
          >
            <span class="truncate flex-1">{{ category.title }}</span>

            <div class="flex items-center gap-2">
              <!-- Delete Button -->
              <button
                @click.stop="handleDeleteCategory(category.id)"
                class="p-0.5 rounded-full opacity-0 group-hover/header:opacity-100 transition-opacity hover:bg-red-500/10 text-red-500"
                title="删除分组"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-3.5 h-3.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>

              <!-- Chevron -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-3 h-3 transition-transform duration-200"
                :class="{ '-rotate-90': category.collapsed }"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                />
              </svg>
            </div>
          </div>

          <!-- Items -->
          <div v-show="!category.collapsed || collapsed">
            <div
              v-for="item in category.children"
              :key="item.id"
              class="w-full flex items-center gap-2 p-1.5 rounded-lg transition-all group relative"
              :class="[
                store.appConfig.background
                  ? 'hover:bg-white/10 text-white/90'
                  : 'hover:bg-gray-100 text-gray-600',
              ]"
            >
              <a :href="item.url" target="_blank" class="flex-1 flex items-center gap-2 min-w-0">
                <!-- Icon -->
                <div class="w-4 h-4 flex-shrink-0 flex items-center justify-center overflow-hidden">
                  <img
                    v-if="item.icon"
                    :src="item.icon"
                    class="w-full h-full object-contain"
                    alt=""
                  />
                  <span v-else class="text-[10px] font-bold opacity-70 leading-none">{{
                    item.title.substring(0, 1).toUpperCase()
                  }}</span>
                </div>

                <!-- Label -->
                <span
                  class="font-medium whitespace-nowrap transition-all duration-300 origin-left flex-1 truncate text-sm"
                  :class="collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-auto'"
                >
                  {{ item.title }}
                </span>
              </a>

              <!-- Delete Button -->
              <button
                v-if="!collapsed"
                @click.stop="handleDeleteBookmark(category, item.id)"
                class="p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                :class="[
                  store.appConfig.background
                    ? 'hover:bg-red-500/20 text-red-400'
                    : 'hover:bg-red-500/10 text-red-500',
                ]"
                title="删除书签"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-3 h-3"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <!-- Tooltip for collapsed -->
              <div
                v-if="collapsed"
                class="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[60] flex items-center gap-2 shadow-lg"
              >
                {{ item.title }}
                <!-- Arrow -->
                <div
                  class="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-gray-800"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="flex flex-col items-center justify-center h-full opacity-40 gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-8 h-8"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
          />
        </svg>
        <span class="text-xs">暂无书签</span>
      </div>
    </div>

    <!-- Bottom Toolbar (Menu Items + Import) -->
    <div
      v-if="!collapsed"
      class="p-2 border-t"
      :class="store.appConfig.background ? 'border-white/10' : 'border-gray-100'"
    >
      <div class="flex flex-wrap items-center justify-center gap-1">
        <!-- Menu Items -->
        <button
          v-for="item in menuItems"
          :key="item.id"
          @click="item.action"
          class="p-2 rounded-lg transition-all group relative"
          :class="[
            store.appConfig.background
              ? 'hover:bg-white/10 text-white/90'
              : 'hover:bg-gray-100 text-gray-600',
          ]"
          :title="item.label"
        >
          <div class="w-5 h-5 flex-shrink-0" v-html="item.icon"></div>

          <!-- Custom Tooltip -->
          <div
            class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[60]"
          >
            {{ item.label }}
            <!-- Arrow -->
            <div
              class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"
            ></div>
          </div>
        </button>

        <!-- Import Button -->
        <button
          @click="handleImportClick"
          class="p-2 rounded-lg transition-all group relative"
          :class="[
            store.appConfig.background
              ? 'hover:bg-white/10 text-white/90'
              : 'hover:bg-gray-100 text-gray-600',
          ]"
          title="导入书签"
        >
          <div class="w-5 h-5 flex-shrink-0">
            <svg
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
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>

          <!-- Custom Tooltip -->
          <div
            class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[60]"
          >
            导入书签
            <div
              class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"
            ></div>
          </div>

          <input
            ref="fileInput"
            type="file"
            accept=".html"
            class="hidden"
            @change="handleFileUpload"
          />
        </button>
      </div>
    </div>

    <!-- Add Bookmark Modal -->
    <div
      v-if="showAddModal"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showAddModal = false"
    >
      <div
        class="rounded-xl p-4 w-80 shadow-2xl space-y-3 animate-fade-in border backdrop-blur-md transition-colors duration-300"
        :class="
          store.appConfig.background ? 'bg-black/60 border-white/10' : 'bg-white border-gray-100'
        "
      >
        <h3
          class="font-bold text-sm"
          :class="store.appConfig.background ? 'text-white' : 'text-gray-800'"
        >
          添加书签
        </h3>
        <input
          ref="addInputRef"
          v-model="newBookmarkUrl"
          placeholder="请输入网址 (https://...)"
          class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
          :class="
            store.appConfig.background
              ? 'bg-white/5 border-white/20 text-white placeholder-white/40 focus:bg-white/10 focus:border-white/30'
              : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
          "
          @keyup.enter="confirmAddBookmark"
        />
        <div class="flex justify-end gap-2">
          <button
            @click="showAddModal = false"
            class="px-3 py-1.5 text-xs rounded-lg transition-colors"
            :class="
              store.appConfig.background
                ? 'text-white/60 hover:bg-white/10 hover:text-white'
                : 'text-gray-500 hover:bg-gray-100'
            "
          >
            取消
          </button>
          <button
            @click="confirmAddBookmark"
            class="px-3 py-1.5 text-xs bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide scrollbar for Chrome, Safari and Opera */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Hide scrollbar for IE, Edge and Firefox */
.no-scrollbar {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}

.animate-fade-in {
  animation: fadeIn 0.2s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
