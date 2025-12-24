<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const store = useMainStore();
defineProps<{ widget: WidgetConfig }>();

interface HotItem {
  title: string;
  url: string;
  hot: string | number;
}

// 缓存不同 Tab 的数据，避免来回切换时重复请求
const cache = ref<Record<string, { data: HotItem[]; ts: number }>>({});
const CACHE_TTL = 60 * 1000; // 缓存 1 分钟

const activeTab = ref<"weibo" | "news" | "huxiu">("weibo");
const list = ref<HotItem[]>([]);
const loading = ref(false);

// 获取数据 (带缓存优化)
const fetchHot = async (type: "weibo" | "news" | "huxiu", force = false) => {
  activeTab.value = type;

  // 检查缓存
  const now = Date.now();
  if (!force && cache.value[type] && now - cache.value[type].ts < CACHE_TTL) {
    list.value = cache.value[type].data;
    return;
  }

  loading.value = true;
  list.value = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onData = (payload: any) => {
    if (payload.type === type) {
      list.value = payload.data;
      cache.value[type] = { data: list.value, ts: Date.now() };
      loading.value = false;
      cleanup();
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onError = (payload: any) => {
    if (payload.type === type) {
      console.error(`加载 ${type} 失败`, payload.error);
      list.value = [{ title: "加载失败，请重试", url: "#", hot: "" }];
      loading.value = false;
      cleanup();
    }
  };

  const cleanup = () => {
    store.socket.off("hot:data", onData);
    store.socket.off("hot:error", onError);
  };

  store.socket.on("hot:data", onData);
  store.socket.on("hot:error", onError);

  store.socket.emit("hot:fetch", { type, force });
};

onMounted(() => {
  fetchHot("weibo");
});

const handleScrollIsolation = (e: WheelEvent) => {
  const el = e.currentTarget as HTMLDivElement;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const delta = e.deltaY;

  const isAtTop = scrollTop <= 0;
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;

  if ((isAtTop && delta < 0) || (isAtBottom && delta > 0)) {
    e.preventDefault();
    e.stopPropagation();
  }
};
</script>

<template>
  <div
    class="w-full h-full backdrop-blur border border-white/40 rounded-2xl flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-all group"
    :style="{ backgroundColor: `rgba(255, 255, 255, ${widget.opacity ?? 0.8})` }"
  >
    <div class="flex border-b border-gray-100 bg-white/50 select-none">
      <button
        v-for="tab in ['weibo', 'news', 'huxiu'] as const"
        :key="tab"
        @click="fetchHot(tab)"
        class="flex-1 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 relative overflow-hidden"
        :class="
          activeTab === tab
            ? tab === 'weibo'
              ? 'text-red-600 bg-red-50/50'
              : tab === 'news'
                ? 'text-blue-600 bg-blue-50/50'
                : 'text-orange-600 bg-orange-50/50'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        "
      >
        <span class="text-sm">{{ tab === "weibo" ? "🔥" : tab === "news" ? "🗞️" : "🐯" }}</span>
        <span>{{ tab === "weibo" ? "微博" : tab === "news" ? "中新网" : "虎嗅" }}</span>
        <div
          v-if="activeTab === tab"
          class="absolute bottom-0 left-0 right-0 h-0.5"
          :class="tab === 'weibo' ? 'bg-red-500' : tab === 'news' ? 'bg-blue-500' : 'bg-orange-500'"
        ></div>
      </button>
    </div>

    <div class="flex-1 overflow-hidden relative">
      <div class="h-full overflow-y-auto custom-scrollbar p-0" @wheel="handleScrollIsolation">
        <div
          v-if="loading && list.length === 0"
          class="p-8 text-center text-gray-400 text-xs animate-pulse"
        >
          加载中...
        </div>
        <div v-else class="flex flex-col py-1">
          <a
            v-for="(item, index) in list"
            :key="index"
            :href="item.url"
            target="_blank"
            class="block px-3 py-1 hover:bg-gray-50 transition-colors group/item flex items-start gap-2"
          >
            <span
              class="text-xs font-bold min-w-[1.25rem] h-5 flex items-center justify-center rounded mt-0.5 transition-colors"
              :class="
                index < 3
                  ? activeTab === 'weibo'
                    ? 'text-red-500 bg-red-50'
                    : activeTab === 'news'
                      ? 'text-blue-500 bg-blue-50'
                      : 'text-orange-500 bg-orange-50'
                  : 'text-gray-400 bg-gray-100'
              "
            >
              {{ index + 1 }}
            </span>
            <div class="flex-1 min-w-0">
              <div
                class="text-sm text-gray-700 group-hover/item:text-blue-600 transition-colors line-clamp-2 leading-relaxed"
              >
                {{ item.title }}
              </div>
            </div>
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
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
