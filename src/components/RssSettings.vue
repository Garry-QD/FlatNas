<script setup lang="ts">
import { ref, computed } from "vue";
import { useMainStore } from "../stores/main";
import type { RssFeed, RssCategory, WidgetConfig } from "@/types";

const store = useMainStore();

const rssWidget = computed(() => store.widgets.find((w: WidgetConfig) => w.type === "rss"));

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

// RSS Category Management
const managingCategories = ref(false);
const newCategoryName = ref("");
const editingCategoryId = ref<string | null>(null);
const editCategoryName = ref("");

const addCategory = () => {
  if (!newCategoryName.value.trim()) return;
  if (!store.rssCategories) store.rssCategories = [];
  store.rssCategories.push({
    id: Date.now().toString() + "-cat",
    name: newCategoryName.value.trim(),
    feeds: [],
  });
  newCategoryName.value = "";
  store.saveData();
};

const deleteCategory = (id: string) => {
  if (!confirm("确定删除分类？(不会删除订阅源)")) return;
  store.rssCategories = store.rssCategories.filter((c: RssCategory) => c.id !== id);
  store.saveData();
};

const startEditCategory = (c: RssCategory) => {
  editingCategoryId.value = c.id;
  editCategoryName.value = c.name;
};

const updateCategory = () => {
  if (!editingCategoryId.value || !editCategoryName.value.trim()) return;
  const cat = store.rssCategories.find((c: RssCategory) => c.id === editingCategoryId.value);
  if (cat) {
    cat.name = editCategoryName.value.trim();
    store.saveData();
  }
  editingCategoryId.value = null;
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
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between border-l-4 border-orange-500 pl-3 mb-4">
      <h4 class="text-lg font-bold text-gray-800">RSS 订阅管理</h4>
      <span
        class="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100 flex items-center gap-1"
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
              placeholder="选择或输入"
            />
            <datalist id="rss-categories">
              <option v-for="cat in store.rssCategories" :key="cat.id" :value="cat.name"></option>
            </datalist>
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">标签</label>
            <input
              v-model="rssForm.tags"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-500 outline-none"
              placeholder="逗号分隔"
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
        <div class="flex items-center gap-4 mt-2">
          <label class="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
            <input type="checkbox" v-model="rssForm.enable" class="accent-orange-500" />
            启用
          </label>
          <label class="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
            <input type="checkbox" v-model="rssForm.isPublic" class="accent-blue-500" />
            公开
          </label>
        </div>
        <div class="flex justify-end gap-2 mt-2">
          <button
            @click="editingRss = false"
            class="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm font-bold"
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
      <div v-if="managingCategories" class="space-y-2 animate-fade-in">
        <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <h5 class="text-xs font-bold text-gray-500 mb-2">添加新分类</h5>
          <div class="flex gap-2">
            <input
              v-model="newCategoryName"
              placeholder="分类名称"
              class="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:border-orange-500 outline-none"
              @keyup.enter="addCategory"
            />
            <button
              @click="addCategory"
              class="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg hover:bg-orange-600"
            >
              添加
            </button>
          </div>
        </div>
        <div class="space-y-2">
          <div
            v-for="cat in store.rssCategories"
            :key="cat.id"
            class="flex items-center justify-between p-2 bg-white border border-gray-100 rounded-lg"
          >
            <div class="flex-1">
              <input
                v-if="editingCategoryId === cat.id"
                v-model="editCategoryName"
                class="w-full px-2 py-1 text-sm border border-orange-300 rounded outline-none"
                @keyup.enter="updateCategory"
                ref="editCategoryInput"
              />
              <span v-else class="text-sm font-bold text-gray-700 pl-2">{{ cat.name }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="editingCategoryId === cat.id"
                @click="updateCategory"
                class="text-xs text-green-500 font-bold px-2"
              >
                保存
              </button>
              <button v-else @click="startEditCategory(cat)" class="text-xs text-blue-500 px-2">
                ✏️
              </button>
              <button
                @click="deleteCategory(cat.id)"
                class="text-xs text-red-500 px-2 hover:bg-red-50 rounded"
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
                <div class="font-bold text-gray-800 text-sm">{{ feed.title }}</div>
                <div class="text-[10px] text-gray-400 max-w-[200px] truncate">
                  {{ feed.url }}
                </div>
              </div>
            </div>
            <div
              class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <button
                @click="editRss(feed)"
                class="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"
                title="编辑"
              >
                ✏️
              </button>
              <button
                @click="deleteRss(feed.id)"
                class="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                title="删除"
              >
                🗑️
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-2">
            <span
              v-if="feed.category"
              class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
              >{{ feed.category }}</span
            >
            <div class="flex-1"></div>
            <span
              :class="feed.enable ? 'text-green-500' : 'text-gray-300'"
              class="text-xs font-bold"
              >{{ feed.enable ? "已启用" : "已禁用" }}</span
            >
            <span class="text-gray-200">|</span>
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
</template>
