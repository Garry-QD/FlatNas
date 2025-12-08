<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
import { ref, nextTick, watch, onMounted } from "vue";
import { useStorage } from "@vueuse/core";
import type { WidgetConfig, BookmarkItem, BookmarkCategory } from "@/types";
import { useMainStore } from "../stores/main";
import { isInternalDomain, processSecurityUrl } from "../utils/security";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

// Local Backup
const localBackup = useStorage<BookmarkCategory[]>(
  `flatnas-bookmark-backup-${props.widget.id}`,
  [],
);

watch(
  () => props.widget.data,
  (newVal) => {
    if (newVal && newVal.length > 0) localBackup.value = newVal;
  },
  { deep: true },
);

onMounted(() => {
  if ((!props.widget.data || props.widget.data.length === 0) && localBackup.value.length > 0) {
    props.widget.data = localBackup.value;
  }
});

const showInput = ref<string | null>(null);
const editingLinkId = ref<string | null>(null);
const newTitle = ref("");
const newUrl = ref("");
const newIcon = ref("");
const isFetching = ref(false);
const isAddingCategory = ref(false);
const newCategoryTitle = ref("");
const categoryInputRef = ref<HTMLInputElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// 导入书签
const triggerImport = () => {
  fileInputRef.value?.click();
};

const handleFileUpload = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result as string;
    parseBookmarks(content);
  };
  reader.readAsText(file);
  // Reset input so the same file can be selected again if needed
  if (event.target) (event.target as HTMLInputElement).value = "";
};

const parseBookmarks = (html: string) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const links = doc.querySelectorAll("a");

    const newItems: BookmarkItem[] = [];
    links.forEach((link) => {
      const url = link.href;
      if (!url.startsWith("http")) return; // Skip non-http links (e.g. chrome://)

      let icon = link.getAttribute("icon");
      if (!icon) {
        try {
          icon = `https://api.iowen.cn/favicon/${new URL(url).hostname}.png`;
        } catch {
          icon = "";
        }
      }

      newItems.push({
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        title: link.textContent || url,
        url: url,
        icon: icon,
      });
    });

    if (newItems.length > 0) {
      if (!props.widget.data) props.widget.data = [];
      props.widget.data.push({
        id: Date.now().toString(),
        title: `导入收藏 ${new Date().toLocaleDateString()}`,
        collapsed: false,
        children: newItems,
      });
      alert(`成功导入 ${newItems.length} 个书签`);
    } else {
      alert("未找到可导入的书签");
    }
  } catch (error) {
    console.error("Import failed", error);
    alert("导入失败，请检查文件格式");
  }
};

// 添加分类
const addCategory = () => {
  isAddingCategory.value = true;
  newCategoryTitle.value = "";
  nextTick(() => {
    categoryInputRef.value?.focus();
  });
};

const confirmAddCategory = () => {
  if (newCategoryTitle.value) {
    if (!props.widget.data) props.widget.data = [];
    props.widget.data.push({
      id: Date.now().toString(),
      title: newCategoryTitle.value,
      collapsed: false,
      children: [],
    });
    isAddingCategory.value = false;
  }
};

const cancelAddCategory = () => {
  isAddingCategory.value = false;
};

// 自动获取标题和图标
const autoFetchIcon = async () => {
  if (!newUrl.value) return;
  isFetching.value = true;

  try {
    const res = await fetch(`/api/fetch-meta?url=${encodeURIComponent(newUrl.value)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.title) newTitle.value = data.title;
      if (data.icon) newIcon.value = data.icon;
    }
  } catch (e) {
    console.error(e);
  } finally {
    isFetching.value = false;
  }
};

const startAdd = (catId: string) => {
  showInput.value = catId;
  editingLinkId.value = null;
  newTitle.value = "";
  newUrl.value = "";
  newIcon.value = "";
};

const startEdit = (catId: string, link: BookmarkItem) => {
  showInput.value = catId;
  editingLinkId.value = link.id;
  newTitle.value = link.title;
  newUrl.value = link.url;
  newIcon.value = link.icon || "";
};

const confirmSubmit = (cat: BookmarkCategory) => {
  if (newTitle.value && newUrl.value) {
    let finalUrl = newUrl.value;
    if (!finalUrl.startsWith("http")) finalUrl = "https://" + finalUrl;

    if (!newIcon.value) {
      try {
        newIcon.value = `https://api.iowen.cn/favicon/${new URL(finalUrl).hostname}.png`;
      } catch {
        // ignore
      }
    }

    if (editingLinkId.value) {
      const target = cat.children.find((l: BookmarkItem) => l.id === editingLinkId.value);
      if (target) {
        target.title = newTitle.value;
        target.url = finalUrl;
        target.icon = newIcon.value;
      }
    } else {
      cat.children.push({
        id: Date.now().toString(),
        title: newTitle.value,
        url: finalUrl,
        icon: newIcon.value,
      });
    }

    showInput.value = null;
    editingLinkId.value = null;
  }
};

const deleteItem = (catIndex: number, childIndex?: number) => {
  if (!confirm("确定删除吗？")) return;
  if (typeof childIndex === "number") {
    props.widget.data[catIndex].children.splice(childIndex, 1);
  } else {
    props.widget.data.splice(catIndex, 1);
  }
};

const openUrl = (url: string) => {
  if (!url) return;

  // Security Rule: Intercept unlogged users
  if (!store.isLogged) {
    if (isInternalDomain(url)) {
      alert("为了您的安全，未登录状态下禁止访问内网资源");
      return;
    }
    const targetUrl = processSecurityUrl(url);
    window.location.href = targetUrl;
    return;
  }

  window.open(url, "_blank");
};
</script>

<template>
  <div
    class="w-full h-full bg-white/90 backdrop-blur-md border border-white/40 rounded-2xl flex flex-col overflow-hidden shadow-sm relative group hover:bg-white transition-colors"
  >
    <div
      class="px-4 py-3 border-b border-gray-200/50 flex justify-between items-center bg-white/50 shrink-0"
    >
      <div class="font-bold text-gray-800 text-sm flex items-center gap-2">📑 收藏夹</div>
      <div
        v-if="store.isLogged"
        class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <input
          type="file"
          ref="fileInputRef"
          accept=".html"
          class="hidden"
          @change="handleFileUpload"
        />
        <button
          @click="triggerImport"
          class="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-200"
          title="导入浏览器收藏夹HTML"
        >
          导入
        </button>
        <button
          @click="addCategory"
          class="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded hover:bg-green-200"
        >
          + 分类
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
      <div
        v-if="isAddingCategory"
        class="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 animate-fade-in"
      >
        <div class="text-xs font-bold text-blue-500 mb-2">添加新分类</div>
        <div class="flex gap-2">
          <input
            ref="categoryInputRef"
            v-model="newCategoryTitle"
            placeholder="分类名称"
            class="flex-1 text-sm px-3 py-2 rounded-lg border bg-white text-gray-900 focus:outline-none focus:border-blue-300"
            @keyup.enter="confirmAddCategory"
          />
          <button
            @click="confirmAddCategory"
            class="bg-blue-500 text-white text-xs px-3 py-2 rounded-lg hover:bg-blue-600 whitespace-nowrap"
          >
            确定
          </button>
          <button
            @click="cancelAddCategory"
            class="bg-gray-200 text-gray-600 text-xs px-3 py-2 rounded-lg hover:bg-gray-300 whitespace-nowrap"
          >
            取消
          </button>
        </div>
      </div>

      <div v-for="(cat, catIdx) in widget.data" :key="cat.id">
        <div class="flex items-center justify-between mb-3 group/cat border-b border-gray-100 pb-1">
          <span
            class="font-bold text-gray-600 text-sm flex items-center gap-1 cursor-pointer select-none"
            @click="cat.collapsed = !cat.collapsed"
          >
            <span
              class="transform transition-transform text-xs"
              :class="cat.collapsed ? '-rotate-90' : ''"
              >▼</span
            >
            {{ cat.title }}
          </span>
          <div
            v-if="store.isLogged"
            class="flex gap-2 opacity-0 group-hover/cat:opacity-100 transition-opacity"
          >
            <button
              @click="startAdd(cat.id)"
              class="text-blue-500 hover:text-blue-700 text-xs font-bold"
            >
              + 添加
            </button>
            <button @click="deleteItem(catIdx)" class="text-gray-300 hover:text-red-500 text-xs">
              删除分类
            </button>
          </div>
        </div>

        <div v-if="!cat.collapsed" class="flex flex-col gap-2">
          <div
            v-for="(link, linkIdx) in cat.children"
            :key="link.id"
            class="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-xl cursor-pointer transition-all group/link border border-transparent hover:border-gray-200"
            @click.stop="openUrl(link.url)"
            title="点击跳转"
          >
            <div
              class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden border border-gray-200"
            >
              <img
                :src="link.icon"
                class="w-6 h-6 object-cover"
                @error="link.icon = 'https://api.iowen.cn/favicon/unknown.png'"
              />
            </div>

            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-medium text-gray-700 text-sm truncate group-hover:text-blue-600">{{
                link.title
              }}</span>
              <span class="text-xs text-gray-400 truncate">{{ link.url }}</span>
            </div>

            <div
              v-if="store.isLogged"
              class="flex gap-1 ml-auto pl-2 opacity-0 group-hover/link:opacity-100 transition-opacity"
            >
              <button
                @click.stop="startEdit(cat.id, link)"
                class="text-blue-400 hover:text-blue-600 p-1"
                title="编辑"
              >
                ✎
              </button>
              <button
                @click.stop="deleteItem(catIdx, linkIdx)"
                class="text-gray-300 hover:text-red-500 p-1"
                title="删除"
              >
                ×
              </button>
            </div>
          </div>

          <div
            v-if="cat.children.length === 0 && showInput !== cat.id"
            class="text-sm text-gray-400 py-2 px-4 border border-dashed border-gray-200 rounded-lg select-none"
          >
            (空文件夹)
          </div>
        </div>

        <div
          v-if="showInput === cat.id"
          class="mt-3 p-4 bg-white rounded-xl border border-blue-200 shadow-lg animate-fade-in z-10 relative"
        >
          <div class="text-xs font-bold text-blue-500 mb-2">
            {{ editingLinkId ? "编辑书签" : "添加新书签" }}
          </div>
          <div class="grid grid-cols-1 gap-3 mb-3">
            <div class="flex gap-2">
              <input
                v-model="newUrl"
                placeholder="网址 (例如: www.example.com)"
                class="flex-1 text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all"
                @blur="autoFetchIcon"
              />
              <button
                @click="autoFetchIcon"
                :disabled="isFetching"
                class="px-3 bg-blue-50 text-blue-600 text-xs rounded-lg font-bold hover:bg-blue-100 transition-colors flex items-center gap-1"
                title="自动获取标题和图标"
              >
                <span
                  v-if="isFetching"
                  class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
                ></span>
                {{ isFetching ? "获取中" : "⚡" }}
              </button>
            </div>
            <input
              v-model="newTitle"
              placeholder="标题 (自动获取)"
              class="w-full text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all"
            />
            <div class="flex gap-2 items-center">
              <div
                class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center border overflow-hidden shrink-0"
              >
                <img v-if="newIcon" :src="newIcon" class="w-full h-full object-cover" />
                <span v-else class="text-xs text-gray-300">icon</span>
              </div>
              <input
                v-model="newIcon"
                placeholder="图标地址 (自动获取)"
                class="flex-1 text-sm px-3 py-2 rounded-lg border bg-gray-50 text-gray-900 focus:bg-white outline-none transition-all"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              @click="showInput = null"
              class="text-sm text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded transition-colors"
            >
              取消
            </button>
            <button
              @click="confirmSubmit(cat)"
              class="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 shadow-md transition-all"
            >
              {{ editingLinkId ? "保存" : "添加" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.animate-fade-in {
  animation: fadeIn 0.2s ease-out;
}
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
