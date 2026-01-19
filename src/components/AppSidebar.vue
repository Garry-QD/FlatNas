<script setup lang="ts">
defineOptions({
  name: "AppSidebar",
});
import { computed, onMounted, onUnmounted, ref, nextTick, toRef } from "vue";
import { useMainStore } from "../stores/main";
import { useDevice } from "../composables/useDevice";
import type { BookmarkCategory, BookmarkItem } from "@/types";
import { parseBookmarks } from "../utils/bookmark";
import { VueDraggable } from "vue-draggable-plus";

const props = defineProps<{
  onOpenSettings: () => void;
  onOpenEdit: () => void;
  collapsed: boolean;
}>();

const emit = defineEmits(["update:collapsed"]);
const store = useMainStore();
const { isMobile } = useDevice(toRef(store.appConfig, "deviceMode"));
const isHovered = ref(false);
const isCollapsed = computed(() => {
  if (isMobile.value) return props.collapsed;
  return props.collapsed && !isHovered.value;
});
const fileInput = ref<HTMLInputElement | null>(null);
const viewMode = ref<"bookmarks" | "groups">(store.appConfig.sidebarViewMode || "bookmarks");

const toggleViewMode = () => {
  viewMode.value = viewMode.value === "bookmarks" ? "groups" : "bookmarks";
  store.appConfig.sidebarViewMode = viewMode.value;
  if (store.isLogged) store.saveData();
};

const scrollToGroup = (groupId: string) => {
  const el = document.getElementById("group-" + groupId);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (isMobile.value) {
      toggle();
    }
  }
};

const activeCategory = ref<BookmarkCategory | null>(null);
const activePath = ref<BookmarkCategory[]>([]);

const currentFolder = computed(() => {
  if (activePath.value.length === 0) return activeCategory.value;
  return activePath.value[activePath.value.length - 1];
});

const navigateTo = (category: BookmarkCategory) => {
  activePath.value.push(category);
};

const navigateToLevel = (index: number) => {
  activePath.value = activePath.value.slice(0, index + 1);
};

const showAddCategoryModal = ref(false);
const newCategoryTitle = ref("");
const addCategoryInputRef = ref<HTMLInputElement | null>(null);

const handleCategoryClick = (category: BookmarkCategory) => {
  if (activeCategory.value?.id === category.id) {
    activeCategory.value = null;
    activePath.value = [];
  } else {
    activeCategory.value = category;
    activePath.value = [category];
  }
};

const targetParentCategory = ref<BookmarkCategory | null>(null);

const openAddCategoryModal = (parent: BookmarkCategory | null = null) => {
  if (!store.isLogged) return;
  targetParentCategory.value = parent;
  newCategoryTitle.value = "";
  showAddCategoryModal.value = true;
  nextTick(() => {
    addCategoryInputRef.value?.focus();
  });
};

const confirmAddCategory = () => {
  if (!store.isLogged || !newCategoryTitle.value) return;

  const newCat: BookmarkCategory = {
    id: Date.now().toString(),
    title: newCategoryTitle.value,
    collapsed: false,
    children: [],
    type: "category",
  };

  if (targetParentCategory.value) {
    targetParentCategory.value.children.push(newCat);
  } else {
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
    (widget.data as BookmarkCategory[]).push(newCat);
  }

  store.saveData();
  showAddCategoryModal.value = false;
};

// --- Bookmarks ---
const bookmarks = computed(() => {
  // 查找所有收藏夹组件，无论是否启用（enable）
  const widgets = store.widgets.filter((w) => w.type === "bookmarks");
  return widgets.flatMap((w) => (w.data as BookmarkCategory[]) || []);
});

// --- Context Menu ---
const showContextMenu = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuTargetCategory = ref<BookmarkCategory | null>(null);

const onCategoryContextMenu = (e: MouseEvent, category: BookmarkCategory) => {
  if (!store.isLogged) return;
  e.preventDefault();
  contextMenuTargetCategory.value = category;
  contextMenuPosition.value = { x: e.clientX, y: e.clientY };
  showContextMenu.value = true;
};

const closeContextMenu = () => {
  showContextMenu.value = false;
};

const handleContextRename = () => {
  if (contextMenuTargetCategory.value) {
    openEditModal(contextMenuTargetCategory.value);
  }
  closeContextMenu();
};

const handleContextDelete = () => {
  if (contextMenuTargetCategory.value) {
    handleDeleteCategory(contextMenuTargetCategory.value.id);
  }
  closeContextMenu();
};

onMounted(() => {
  document.addEventListener("click", closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener("click", closeContextMenu);
});

const bookmarkGroups = computed(() => {
  return bookmarks.value.filter((c) => c.title !== "默认收藏");
});

const ungroupedCategory = computed(() => {
  return bookmarks.value.find((c) => c.title === "默认收藏");
});

const handleImportClick = () => {
  if (!store.isLogged) return;
  fileInput.value?.click();
};

const handleFileUpload = (event: Event) => {
  if (!store.isLogged) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
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

        // 分离文件夹和独立的书签
        const folders: BookmarkCategory[] = [];
        const links: BookmarkItem[] = [];

        for (const item of newItems) {
          if ("url" in item) {
            links.push(item as BookmarkItem);
          } else {
            folders.push(item as BookmarkCategory);
          }
        }

        // 1. 文件夹直接添加到根目录
        (widget.data as BookmarkCategory[]).push(...folders);

        // 2. 独立书签添加到“默认收藏”
        if (links.length > 0) {
          let defaultCat = (widget.data as BookmarkCategory[]).find((c) => c.title === "默认收藏");
          if (!defaultCat) {
            defaultCat = {
              id: Date.now().toString() + "_default",
              title: "默认收藏",
              collapsed: false,
              children: [],
            };
            (widget.data as BookmarkCategory[]).push(defaultCat);
          }
          defaultCat.children.push(...links);
        }

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

const handleDeleteBookmark = (category: BookmarkCategory, itemId: string) => {
  if (!store.isLogged) return;
  category.children = category.children.filter((item) => item.id !== itemId);
  store.saveData();
};

const handleDeleteCategory = (categoryId: string) => {
  if (!store.isLogged) return;
  for (const widget of store.widgets) {
    if (widget.type === "bookmarks" && widget.data) {
      const index = (widget.data as BookmarkCategory[]).findIndex((c) => c.id === categoryId);
      if (index !== -1) {
        (widget.data as BookmarkCategory[]).splice(index, 1);
        if (activeCategory.value?.id === categoryId) {
          activeCategory.value = null;
        }
        store.saveData();
        return;
      }
    }
  }
};

const getLinkUrl = (item: BookmarkItem | BookmarkCategory): string => {
  if ("url" in item) {
    return item.url;
  }
  return "#";
};

const getLinkIcon = (item: BookmarkItem | BookmarkCategory): string | undefined => {
  if ("url" in item) {
    return item.icon;
  }
  return undefined;
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
const showEditModal = ref(false);
const newBookmarkUrl = ref("");
const editingBookmarkId = ref<string | null>(null);
const editingBookmarkTitle = ref("");
const editingBookmarkUrl = ref("");
const editingBookmarkIcon = ref("");
const addInputRef = ref<HTMLInputElement | null>(null);
const editInputRef = ref<HTMLInputElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);

const handleWheel = (e: WheelEvent) => {
  const el = scrollContainer.value;
  if (!el) return;

  const { scrollTop, scrollHeight, clientHeight } = el;
  const isScrollable = scrollHeight > clientHeight;

  // 如果不可滚动，或者滚动到了边界，阻止默认行为（防止父级滚动）
  if (!isScrollable) {
    e.preventDefault();
    return;
  }

  // 向上滚动
  if (e.deltaY < 0) {
    if (scrollTop <= 0) {
      e.preventDefault();
    }
  }
  // 向下滚动
  else if (e.deltaY > 0) {
    // 允许 2px 的误差，处理高分屏或缩放情况
    if (scrollHeight - scrollTop - clientHeight <= 2) {
      e.preventDefault();
    }
  }
};

onMounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.addEventListener("wheel", handleWheel, { passive: false });
  }
});

onUnmounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener("wheel", handleWheel);
  }
});

const selectedCategoryForAdd = ref<string>("");

const openAddModal = () => {
  if (!store.isLogged) return;
  newBookmarkUrl.value = "";
  // 默认选中当前激活的分组
  if (activeCategory.value) {
    selectedCategoryForAdd.value = activeCategory.value.id;
  } else {
    selectedCategoryForAdd.value = "";
  }
  showAddModal.value = true;
  nextTick(() => {
    addInputRef.value?.focus();
  });
};

const editingItemType = ref<"link" | "category">("link");

const openEditModal = (item: BookmarkItem | BookmarkCategory) => {
  editingBookmarkId.value = item.id;
  editingBookmarkTitle.value = item.title;

  if ("url" in item) {
    editingItemType.value = "link";
    editingBookmarkUrl.value = item.url;
    editingBookmarkIcon.value = item.icon || "";
  } else {
    editingItemType.value = "category";
    editingBookmarkUrl.value = "";
    editingBookmarkIcon.value = "";
  }

  showEditModal.value = true;
  nextTick(() => {
    editInputRef.value?.focus();
  });
};

const confirmEditBookmark = async () => {
  if (!editingBookmarkId.value) return;
  if (editingItemType.value === "link" && !editingBookmarkUrl.value) return;

  const updateItem = (item: BookmarkItem | BookmarkCategory) => {
    item.title = editingBookmarkTitle.value || item.title;
    if (editingItemType.value === "link" && "url" in item) {
      item.url = editingBookmarkUrl.value;
      item.icon = editingBookmarkIcon.value || item.icon;

      // Auto fetch icon if empty
      if (!item.icon) {
        try {
          item.icon = `https://api.uomg.com/api/get.favicon?url=${new URL(item.url).hostname}`;
        } catch {
          // ignore
        }
      }
    }
  };

  const findAndEdit = (items: (BookmarkItem | BookmarkCategory)[]): boolean => {
    for (const item of items) {
      if (item.id === editingBookmarkId.value) {
        updateItem(item);
        return true;
      }
      if ("children" in item && item.children) {
        if (findAndEdit(item.children)) return true;
      }
    }
    return false;
  };

  // Find the bookmark and update it
  for (const widget of store.widgets) {
    if (widget.type === "bookmarks" && widget.data) {
      const data = widget.data as BookmarkCategory[];
      // Check top level first
      const topLevel = data.find((c) => c.id === editingBookmarkId.value);
      if (topLevel) {
        updateItem(topLevel);
        store.saveData();
        showEditModal.value = false;
        return;
      }

      // Recursive search
      if (findAndEdit(data)) {
        store.saveData();
        showEditModal.value = false;
        return;
      }
    }
  }
  showEditModal.value = false;
};

const confirmAddBookmark = async () => {
  let targetCategory: BookmarkCategory | undefined;
  if (!store.isLogged) return;
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

  if (!selectedCategoryForAdd.value) {
    targetCategory = categories.find((c) => c.title === "默认收藏");
    if (!targetCategory) {
      targetCategory = {
        id: Date.now().toString(),
        title: "默认收藏",
        collapsed: false,
        children: [],
      };
      categories.unshift(targetCategory);
    }
  } else {
    targetCategory = categories.find((c) => c.id === selectedCategoryForAdd.value);
  }

  if (!targetCategory) {
    alert("未找到选中的分组");
    return;
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
      icon = `https://www.favicon.vip/get.php?url=${encodeURIComponent(finalUrl)}`;
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
  // Force update UI
  activeCategory.value = { ...targetCategory };
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
</script>

<template>
  <div
    class="flex flex-col transition-all duration-200 z-50 fixed max-h-[85vh] rounded-xl text-black md:before:absolute md:before:-inset-10 md:before:content-[''] md:before:bg-transparent md:before:z-[-1]"
    :class="[
      isMobile && isCollapsed
        ? 'w-auto h-auto rounded-lg bottom-6 left-6 top-auto'
        : 'top-4 left-4 backdrop-blur-[12px] shadow-[0_4px_15px_rgba(0,0,0,0.1)] bg-white/20 border border-white/20',
      isCollapsed && !isMobile ? 'w-[48px] !top-1/2 !-translate-y-1/2 !max-h-[60vh]' : '',
      isCollapsed ? (isMobile ? 'w-auto' : 'w-[48px]') : 'w-64',
    ]"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Toggle Button -->
    <div
      v-if="!isCollapsed || isMobile"
      class="flex items-center text-black"
      :class="[
        isMobile && isCollapsed ? 'p-0' : 'px-3 py-4 border-b',
        'border-white/15',
        isCollapsed ? 'justify-center' : 'justify-between',
      ]"
    >
      <button
        v-if="!isCollapsed"
        @click="toggleViewMode"
        class="font-bold text-lg truncate hover:opacity-70 transition-opacity flex items-center gap-1 text-black"
        :title="viewMode === 'bookmarks' ? '切换到分组导航' : '切换到书签'"
      >
        {{ viewMode === "bookmarks" ? "收藏夹" : "快捷导航" }}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-4 h-4 opacity-50"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
          />
        </svg>
      </button>
      <div class="flex items-center gap-2">
        <button
          v-if="store.isLogged && !isCollapsed && viewMode === 'bookmarks'"
          @click="handleImportClick"
          class="p-1.5 rounded-xl transition-all group relative bg-white/10 backdrop-blur-[8px] border border-white/15 hover:bg-white/25 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:bg-white/15 text-black"
          title="导入书签"
        >
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
        </button>
        <button
          @click="toggle"
          class="p-1.5 transition-all group relative backdrop-blur-[8px] border hover:bg-white/25 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:bg-white/15"
          :class="[
            isCollapsed
              ? 'w-12 h-12 flex justify-center items-center rounded-full text-white bg-white/20 border-white/30 shadow-lg'
              : 'rounded-xl text-black bg-white/10 border-white/15',
          ]"
          title="Ctrl+B 切换侧边栏"
        >
          <svg
            v-if="isCollapsed"
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
            class="w-5 h-5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div
      ref="scrollContainer"
      class="flex-1 overflow-y-auto py-2 space-y-1 px-1 overscroll-contain custom-scrollbar"
      :class="{ 'no-scrollbar': isCollapsed, 'flex flex-col items-center': isCollapsed }"
      v-show="!isMobile || !isCollapsed"
    >
      <!-- Bookmarks View -->
      <template v-if="viewMode === 'bookmarks'">
        <template
          v-if="
            bookmarkGroups.length > 0 ||
            (ungroupedCategory && ungroupedCategory.children.length > 0)
          "
        >
          <!-- Groups Area -->
          <div v-if="bookmarkGroups.length > 0" class="space-y-1 mb-2">
            <template v-for="category in bookmarkGroups" :key="category.id">
              <!-- Category Title (Click to open flyout) -->
              <div
                @click="handleCategoryClick(category)"
                @contextmenu.prevent="onCategoryContextMenu($event, category)"
                class="w-full px-2 py-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-black transition-all cursor-pointer group/header rounded-lg hover:bg-white/10"
                :class="[
                  activeCategory?.id === category.id
                    ? 'bg-white/20 opacity-100'
                    : 'opacity-70 hover:opacity-100',
                  { 'flex-col justify-center': isCollapsed },
                ]"
              >
                <div
                  class="flex items-center gap-2 flex-1 min-w-0"
                  :class="{ 'justify-center': isCollapsed }"
                >
                  <div
                    v-if="isCollapsed"
                    class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center text-[10px] font-bold"
                  >
                    {{ category.title.substring(0, 2) }}
                  </div>
                  <span v-if="!isCollapsed" class="truncate text-base md:text-xs">{{
                    category.title
                  }}</span>
                </div>

                <div v-if="!isCollapsed" class="flex items-center gap-2">
                  <!-- Chevron (Right) -->
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                    stroke="currentColor"
                    class="w-5 h-5 md:w-3 md:h-3 transition-transform duration-200"
                    :class="{ 'rotate-90': activeCategory?.id === category.id }"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </div>
              </div>
            </template>
          </div>

          <!-- Divider -->
          <div
            v-if="bookmarkGroups.length > 0 && ungroupedCategory?.children.length"
            class="border-t border-black/5 my-2 mx-2"
          ></div>

          <!-- Ungrouped Bookmarks Area -->
          <div v-if="ungroupedCategory?.children.length" class="space-y-1">
            <div
              v-for="item in ungroupedCategory.children"
              :key="item.id"
              class="w-full px-2 py-2 flex items-center justify-between text-black transition-all cursor-pointer group/item rounded-lg hover:bg-white/10"
              :class="{ 'flex-col justify-center': isCollapsed }"
            >
              <a
                :href="getLinkUrl(item)"
                target="_blank"
                class="flex items-center gap-2 flex-1 min-w-0 w-full"
                :class="{ 'justify-center': isCollapsed }"
              >
                <!-- Icon -->
                <div
                  class="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center overflow-hidden"
                >
                  <img
                    v-if="getLinkIcon(item)"
                    :src="getLinkIcon(item)"
                    class="w-full h-full object-contain"
                    alt=""
                  />
                  <span v-else class="text-[10px] font-bold opacity-70 leading-none">{{
                    item.title.substring(0, 1).toUpperCase()
                  }}</span>
                </div>

                <!-- Title -->
                <span
                  v-if="!isCollapsed"
                  class="truncate text-sm opacity-80 group-hover/item:opacity-100 font-medium"
                  >{{ item.title }}</span
                >
              </a>

              <!-- Actions -->
              <div
                v-if="!isCollapsed && store.isLogged"
                class="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity"
              >
                <button
                  @click.stop="openEditModal(item)"
                  class="p-0.5 rounded hover:bg-blue-500/20 text-blue-500"
                  title="编辑"
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
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                    />
                  </svg>
                </button>
                <button
                  @click.stop="handleDeleteBookmark(ungroupedCategory!, item.id)"
                  class="p-0.5 rounded hover:bg-red-500/20 text-red-500"
                  title="删除"
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
              </div>
            </div>
          </div>
        </template>
        <div v-else class="flex flex-col items-center justify-center py-8 opacity-40 gap-2">
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

        <!-- Mobile Backdrop for Flyout -->
        <div
          v-if="isMobile && activeCategory"
          class="fixed inset-0 z-30 bg-black/10 backdrop-blur-[1px]"
          @click="activeCategory = null"
        ></div>

        <!-- Flyout -->
        <div
          v-if="activeCategory && (!isCollapsed || isMobile)"
          @wheel.stop
          class="bg-white/90 backdrop-blur-xl border-l border-white/20 shadow-2xl flex flex-col z-40 transition-all duration-300 animate-fade-in overflow-hidden"
          :class="[
            isMobile
              ? 'fixed inset-x-4 top-24 bottom-24 rounded-xl border border-white/20'
              : 'absolute left-full top-0 bottom-0 w-72 ml-2 rounded-r-xl my-0',
            store.appConfig.background ? 'text-black bg-white/60 border-white/40' : 'text-black',
          ]"
        >
          <div class="p-3 border-b border-black/5 flex justify-between items-center shrink-0">
            <div
              class="flex items-center gap-1 overflow-x-auto no-scrollbar mask-gradient-right flex-1 min-w-0 mr-2"
            >
              <template v-for="(cat, index) in activePath" :key="cat.id">
                <span v-if="index > 0" class="text-gray-400 text-xs shrink-0">/</span>
                <button
                  @click="navigateToLevel(index)"
                  class="text-sm font-bold whitespace-nowrap hover:underline shrink-0"
                  :class="
                    index === activePath.length - 1
                      ? 'text-black cursor-default no-underline'
                      : 'text-gray-500'
                  "
                >
                  {{ cat.title }}
                </button>
              </template>
            </div>
            <button
              @click="activeCategory = null"
              class="p-2 md:p-1 hover:bg-black/5 rounded transition-colors shrink-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-6 h-6 md:w-4 md:h-4"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            <VueDraggable
              v-if="currentFolder"
              v-model="currentFolder.children"
              class="space-y-1 min-h-[50px]"
              :animation="150"
              group="bookmarks"
              @end="store.saveData()"
            >
              <div
                v-for="item in currentFolder.children"
                :key="item.id"
                class="w-full flex items-center gap-2 transition-all group relative hover:bg-black/5 text-inherit p-2 rounded-lg cursor-pointer"
                @click="
                  item.type === 'category' || 'children' in item
                    ? navigateTo(item as BookmarkCategory)
                    : null
                "
              >
                <!-- Folder Item -->
                <template v-if="item.type === 'category' || 'children' in item">
                  <div
                    class="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded bg-yellow-100/50 text-yellow-600"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="1.5"
                      stroke="currentColor"
                      class="w-4 h-4"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                      />
                    </svg>
                  </div>
                  <span class="font-medium truncate text-base md:text-sm flex-1">{{
                    item.title
                  }}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-4 h-4 opacity-40"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </template>

                <!-- Link Item -->
                <template v-else>
                  <a
                    :href="item.url"
                    target="_blank"
                    class="flex-1 flex items-center gap-2 min-w-0"
                    @click.stop
                  >
                    <!-- Icon -->
                    <div
                      class="flex-shrink-0 flex items-center justify-center overflow-hidden w-6 h-6 rounded bg-black/5"
                    >
                      <img
                        v-if="item.icon"
                        :src="item.icon"
                        class="max-w-full max-h-full object-contain"
                        alt=""
                        @error="
                          item.icon = `https://www.favicon.vip/get.php?url=${encodeURIComponent(item.url)}`
                        "
                      />
                      <span v-else class="text-[10px] font-bold opacity-70 leading-none">{{
                        item.title.substring(0, 2).toUpperCase()
                      }}</span>
                    </div>

                    <!-- Label -->
                    <span class="font-medium truncate text-base md:text-sm flex-1">
                      {{ item.title }}
                    </span>
                  </a>
                </template>

                <!-- Edit/Delete Buttons -->
                <div
                  v-if="store.isLogged"
                  class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <button
                    @click.stop="openEditModal(item)"
                    class="p-1 rounded hover:bg-blue-500/20 text-blue-400"
                    title="编辑"
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
                        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                      />
                    </svg>
                  </button>
                  <button
                    @click.stop="handleDeleteBookmark(currentFolder!, item.id)"
                    class="p-1 rounded hover:bg-red-500/20 text-red-400"
                    title="删除"
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
                </div>
              </div>

              <div
                v-if="currentFolder && currentFolder.children.length === 0"
                class="flex flex-col items-center justify-center py-8 opacity-40 gap-2"
              >
                <span class="text-xs">暂无内容</span>
              </div>
            </VueDraggable>
          </div>

          <div v-if="store.isLogged" class="p-3 border-t border-black/5 shrink-0 flex gap-2">
            <button
              @click="openAddCategoryModal(currentFolder)"
              class="flex-1 p-2 rounded-lg transition-colors group flex items-center justify-center gap-2 border border-dashed hover:bg-black/5 border-black/20 text-inherit text-xs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              添加分组
            </button>
            <button
              @click="openAddModal"
              class="flex-1 p-2 rounded-lg transition-colors group flex items-center justify-center gap-2 border border-dashed hover:bg-black/5 border-black/20 text-inherit text-xs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-4 h-4"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              添加书签
            </button>
          </div>
        </div>
      </template>

      <!-- Groups View -->
      <template v-else>
        <VueDraggable
          v-if="store.groups.length > 0 && store.isLogged"
          v-model="store.groups"
          class="space-y-1"
          :animation="150"
          :forceFallback="true"
          :fallback-on-body="true"
          :disabled="isCollapsed"
          handle=".drag-handle"
          @end="store.saveData()"
          :class="{ 'flex flex-col items-center w-full': isCollapsed }"
        >
          <button
            v-for="group in store.groups"
            :key="group.id"
            @click="scrollToGroup(group.id)"
            class="w-full flex items-center transition-all group relative text-left text-black bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/25 hover:shadow-md hover:-translate-y-[1px] active:translate-y-0 active:bg-white/15"
            :class="[
              isCollapsed ? 'justify-center w-10 h-10 p-0 rounded-xl' : 'p-2 rounded-lg gap-2',
            ]"
          >
            <!-- Icon/Indicator -->
            <div
              class="flex-shrink-0 flex items-center justify-center"
              :class="[isCollapsed ? 'w-5 h-5' : 'w-5 h-5']"
            >
              <img
                v-if="group.icon"
                :src="group.icon"
                class="w-full h-full object-contain"
                alt=""
              />
              <span v-else class="text-[10px] font-bold opacity-70 leading-none">{{
                group.title.substring(0, 2)
              }}</span>
            </div>

            <!-- Label -->
            <span
              class="font-medium whitespace-nowrap transition-all duration-300 origin-left flex-1 truncate text-sm"
              :class="isCollapsed ? 'hidden' : 'opacity-100 w-auto'"
            >
              {{ group.title }}
            </span>

            <!-- Drag Handle (Right) -->
            <div
              v-if="!isCollapsed"
              class="drag-handle cursor-move p-1 text-black/30 hover:text-black/80 transition-colors select-none text-xs font-bold"
              title="拖动排序"
            >
              ::
            </div>

            <!-- Tooltip for collapsed -->
            <div
              v-if="isCollapsed"
              class="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-black/80 text-white text-xs rounded-lg pointer-events-none whitespace-nowrap z-[60] flex items-center gap-2 shadow-lg transition-opacity duration-200 backdrop-blur-md border border-white/10 opacity-100"
            >
              {{ group.title }}
              <!-- Arrow -->
              <div
                class="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-black/80"
              ></div>
            </div>
          </button>
        </VueDraggable>
        <div
          v-else-if="store.groups.length > 0"
          class="space-y-1"
          :class="{ 'flex flex-col items-center w-full': isCollapsed }"
        >
          <button
            v-for="group in store.groups"
            :key="group.id"
            @click="scrollToGroup(group.id)"
            class="w-full flex items-center transition-all group relative text-left text-black bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/25 hover:shadow-md hover:-translate-y-[1px] active:translate-y-0 active:bg-white/15"
            :class="[
              isCollapsed ? 'justify-center w-10 h-10 p-0 rounded-xl' : 'p-2 rounded-lg gap-2',
            ]"
          >
            <div
              class="flex-shrink-0 flex items-center justify-center"
              :class="isCollapsed ? 'w-5 h-5' : 'w-5 h-5'"
            >
              <img
                v-if="group.icon"
                :src="group.icon"
                class="w-full h-full object-contain"
                alt=""
              />
              <span v-else class="text-[10px] font-bold opacity-70 leading-none">{{
                group.title.substring(0, 2)
              }}</span>
            </div>
            <span
              class="font-medium whitespace-nowrap transition-all duration-300 origin-left flex-1 truncate text-sm"
              :class="isCollapsed ? 'hidden' : 'opacity-100 w-auto'"
            >
              {{ group.title }}
            </span>
            <div
              v-if="isCollapsed"
              class="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1.5 bg-black/80 text-white text-xs rounded-lg pointer-events-none whitespace-nowrap z-[60] flex items-center gap-2 shadow-lg transition-opacity duration-200 backdrop-blur-md border border-white/10 opacity-100"
            >
              {{ group.title }}
              <div
                class="absolute right-full top-1/2 -translate-y-1/2 border-8 border-transparent border-r-black/80"
              ></div>
            </div>
          </button>
        </div>
        <div v-else class="flex flex-col items-center justify-center h-full opacity-40 gap-2">
          <span class="text-xs">暂无分组</span>
        </div>
      </template>
    </div>

    <div
      v-if="store.isLogged && !isCollapsed && viewMode === 'bookmarks'"
      class="flex justify-between p-2 gap-2 border-t border-white/10"
    >
      <button
        @click="openAddCategoryModal(null)"
        class="p-2 rounded-lg transition-colors group relative flex-1 flex items-center justify-center gap-2 border border-dashed hover:bg-white/25 border-black/20 text-black"
        title="添加分组"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-5 h-5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span class="text-xs font-medium">添加分组</span>
      </button>
      <button
        @click="openAddModal"
        class="p-2 rounded-lg transition-colors group relative flex-1 flex items-center justify-center gap-2 border border-dashed hover:bg-white/25 border-black/20 text-black"
        title="添加书签"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-5 h-5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span class="text-xs font-medium">添加书签</span>
      </button>
    </div>

    <input ref="fileInput" type="file" accept=".html" class="hidden" @change="handleFileUpload" />

    <Teleport to="body">
      <!-- Add Bookmark Modal -->
      <div v-if="showAddModal" class="fixed inset-0 z-[100] pointer-events-none">
        <div class="absolute left-[264px] top-1/2 -translate-y-1/2 pointer-events-auto">
          <div
            class="rounded-xl p-4 w-[320px] shadow-2xl space-y-3 animate-fade-in border backdrop-blur-xl transition-colors duration-300"
            :class="
              store.appConfig.background
                ? 'bg-white/60 border-white/40'
                : 'bg-white border-gray-100'
            "
          >
            <h3
              class="font-bold text-sm"
              :class="store.appConfig.background ? 'text-black' : 'text-gray-800'"
            >
              添加书签
            </h3>
            <div class="space-y-3">
              <div>
                <label
                  class="text-xs opacity-70 mb-1 block"
                  :class="store.appConfig.background ? 'text-black' : 'text-gray-600'"
                  >网址</label
                >
                <input
                  ref="addInputRef"
                  v-model="newBookmarkUrl"
                  placeholder="请输入网址 (https://...)"
                  class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
                  :class="
                    store.appConfig.background
                      ? 'bg-white/40 border-white/40 text-black placeholder-black/40 focus:bg-white/60 focus:border-white/60'
                      : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
                  "
                  @keyup.enter="confirmAddBookmark()"
                />
              </div>

              <div>
                <label
                  class="text-xs opacity-70 mb-1 block"
                  :class="store.appConfig.background ? 'text-black' : 'text-gray-600'"
                  >分组</label
                >
                <select
                  v-model="selectedCategoryForAdd"
                  class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors appearance-none"
                  :class="
                    store.appConfig.background
                      ? 'bg-white/40 border-white/40 text-black focus:bg-white/60 focus:border-white/60'
                      : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
                  "
                >
                  <option value="">默认 (未分组)</option>
                  <option v-for="cat in bookmarks" :key="cat.id" :value="cat.id" class="text-black">
                    {{ cat.title }}
                  </option>
                </select>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-4">
              <button
                @click="showAddModal = false"
                class="px-3 py-1.5 text-xs rounded-lg transition-colors"
                :class="
                  store.appConfig.background
                    ? 'text-black/60 hover:bg-white/20 hover:text-black'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                "
              >
                取消
              </button>
              <button
                @click="confirmAddBookmark"
                class="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-sm"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit Bookmark Modal -->
      <div v-if="showEditModal" class="fixed inset-0 z-[100] pointer-events-none">
        <div class="absolute left-[264px] top-1/2 -translate-y-1/2 pointer-events-auto">
          <div
            class="rounded-xl p-4 w-[320px] shadow-2xl space-y-3 animate-fade-in border backdrop-blur-xl transition-colors duration-300"
            :class="
              store.appConfig.background
                ? 'bg-white/60 border-white/40'
                : 'bg-white border-gray-100'
            "
          >
            <h3
              class="font-bold text-sm"
              :class="store.appConfig.background ? 'text-black' : 'text-gray-800'"
            >
              {{ editingItemType === "category" ? "编辑分组" : "编辑书签" }}
            </h3>

            <div class="space-y-2">
              <div>
                <label
                  class="text-xs opacity-70 mb-1 block"
                  :class="store.appConfig.background ? 'text-black' : 'text-gray-600'"
                  >标题</label
                >
                <input
                  ref="editInputRef"
                  v-model="editingBookmarkTitle"
                  class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
                  :class="
                    store.appConfig.background
                      ? 'bg-white/40 border-white/40 text-black placeholder-black/40 focus:bg-white/60 focus:border-white/60'
                      : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
                  "
                  @keyup.enter="confirmEditBookmark"
                />
              </div>
              <template v-if="editingItemType === 'link'">
                <div>
                  <label
                    class="text-xs opacity-70 mb-1 block"
                    :class="store.appConfig.background ? 'text-black' : 'text-gray-600'"
                    >链接</label
                  >
                  <input
                    v-model="editingBookmarkUrl"
                    class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
                    :class="
                      store.appConfig.background
                        ? 'bg-white/40 border-white/40 text-black placeholder-black/40 focus:bg-white/60 focus:border-white/60'
                        : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
                    "
                    @keyup.enter="confirmEditBookmark"
                  />
                </div>
                <div>
                  <label
                    class="text-xs opacity-70 mb-1 block"
                    :class="store.appConfig.background ? 'text-black' : 'text-gray-600'"
                    >图标 URL (可选)</label
                  >
                  <div class="flex gap-2">
                    <div
                      class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden border border-gray-200/50"
                    >
                      <img
                        v-if="editingBookmarkIcon"
                        :src="editingBookmarkIcon"
                        class="w-5 h-5 object-contain"
                        @error="editingBookmarkIcon = ''"
                      />
                      <span v-else class="text-[10px] text-gray-400">icon</span>
                    </div>
                    <input
                      v-model="editingBookmarkIcon"
                      class="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
                      :class="
                        store.appConfig.background
                          ? 'bg-white/40 border-white/40 text-black placeholder-black/40 focus:bg-white/60 focus:border-white/60'
                          : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
                      "
                      @keyup.enter="confirmEditBookmark"
                    />
                  </div>
                </div>
              </template>
            </div>

            <div class="flex justify-end gap-2">
              <button
                @click="showEditModal = false"
                class="px-3 py-1.5 text-xs rounded-lg transition-colors"
                :class="
                  store.appConfig.background
                    ? 'text-black/60 hover:bg-white/20 hover:text-black'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                "
              >
                取消
              </button>
              <button
                @click="confirmEditBookmark"
                class="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-sm"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Category Modal -->
      <div v-if="showAddCategoryModal" class="fixed inset-0 z-[100] pointer-events-none">
        <div class="absolute left-[264px] top-1/2 -translate-y-1/2 pointer-events-auto">
          <div
            class="rounded-xl p-4 w-[320px] shadow-2xl space-y-3 animate-fade-in border backdrop-blur-xl transition-colors duration-300"
            :class="
              store.appConfig.background
                ? 'bg-white/60 border-white/40'
                : 'bg-white border-gray-100'
            "
          >
            <h3
              class="font-bold text-sm"
              :class="store.appConfig.background ? 'text-black' : 'text-gray-800'"
            >
              添加分组
            </h3>
            <input
              ref="addCategoryInputRef"
              v-model="newCategoryTitle"
              placeholder="请输入分组名称"
              class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition-colors"
              :class="
                store.appConfig.background
                  ? 'bg-white/40 border-white/40 text-black placeholder-black/40 focus:bg-white/60 focus:border-white/60'
                  : 'bg-gray-50 border-gray-200 text-gray-900 focus:bg-white focus:border-blue-500'
              "
              @keyup.enter="confirmAddCategory"
            />
            <div class="flex justify-end gap-2">
              <button
                @click="showAddCategoryModal = false"
                class="px-3 py-1.5 text-xs rounded-lg transition-colors"
                :class="
                  store.appConfig.background
                    ? 'text-black/60 hover:bg-white/20 hover:text-black'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                "
              >
                取消
              </button>
              <button
                @click="confirmAddCategory"
                class="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-sm"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="showContextMenu"
        class="fixed z-[9999] bg-white/90 backdrop-blur-xl border border-white/20 shadow-xl rounded-lg overflow-hidden py-1 min-w-[120px]"
        :style="{ top: contextMenuPosition.y + 'px', left: contextMenuPosition.x + 'px' }"
        @click.stop
      >
        <button
          @click="handleContextRename"
          class="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-black/5 transition-colors flex items-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-4 h-4"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
            />
          </svg>
          重命名
        </button>
        <button
          @click="handleContextDelete"
          class="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-4 h-4"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
            />
          </svg>
          删除分组
        </button>
      </div>
    </Teleport>

    <!-- Mobile Collapse Button (Restores original toggle position) -->
    <Teleport to="body">
      <button
        v-if="isMobile && !isCollapsed"
        @click="toggle"
        class="fixed bottom-6 left-6 z-[60] p-1.5 transition-all group backdrop-blur-[8px] border hover:bg-white/25 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:bg-white/15 w-12 h-12 flex justify-center items-center rounded-full text-white bg-white/20 border-white/30 shadow-lg"
        title="收起侧边栏"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-5 h-5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
    </Teleport>
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

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
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
