<script setup lang="ts">
import { useMainStore } from "../stores/main";
import { VueDraggable } from "vue-draggable-plus";
import type { SearchEngine } from "@/types";

const store = useMainStore();

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
</script>

<template>
  <div class="space-y-6">
    <h4 class="text-lg font-bold mb-2 text-gray-800 border-l-4 border-blue-500 pl-3">
      搜索引擎设置
    </h4>
    <div class="text-xs text-gray-500 mb-2">
      拖拽调整优先级；设置默认或开启“记住上次选择”。
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
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </div>
            <input
              v-model="e.label"
              class="font-bold text-gray-700 bg-transparent border-b border-transparent focus:border-blue-500 outline-none w-24"
            />
            <span class="text-xs text-gray-400 font-mono">{{ e.key }}</span>
          </div>
          <div class="flex items-center gap-2">
            <label
              class="flex items-center gap-1 text-xs px-2 py-1 rounded-lg cursor-pointer transition-colors"
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
</template>
