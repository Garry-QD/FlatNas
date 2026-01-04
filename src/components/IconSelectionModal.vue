<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";

const props = defineProps<{
  show: boolean;
  candidates: string[]; // List of icon URLs or paths
  title: string; // Search term
  source: "local" | "api";
}>();

const emit = defineEmits(["update:show", "select", "cancelLink"]);

const timeoutSeconds = ref(10);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let timer: any = null;

const startTimer = () => {
  clearInterval(timer);
  timeoutSeconds.value = 10;
  timer = setInterval(() => {
    timeoutSeconds.value--;
    if (timeoutSeconds.value <= 0) {
      if (props.candidates.length > 0) {
        const first = props.candidates[0];
        if (first) {
          selectIcon(first);
        }
      }
    }
  }, 1000);
};

const selectIcon = (icon: string) => {
  clearInterval(timer);
  emit("select", icon);
  emit("update:show", false);
};

watch(
  () => props.show,
  (val) => {
    if (val) {
      startTimer();
    } else {
      clearInterval(timer);
    }
  },
);

onUnmounted(() => clearInterval(timer));

const getIconName = (url: string) => {
  // Extract name from URL or path
  // e.g., "icons/QQ.png" -> "QQ"
  // e.g., "https://simpleicons.org/icons/github.svg" -> "github"
  // e.g., "https://cdn.simpleicons.org/github" -> "github"
  try {
    if (!url) return "";
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return url;
    // Remove extension if present
    const name = lastPart?.split(".")[0] || "";
    // Decode URI component just in case
    return decodeURIComponent(name);
  } catch {
    return url;
  }
};

const PAGE_SIZE = 100;
const visibleCount = ref(PAGE_SIZE);
const visibleCandidates = computed(() => props.candidates.slice(0, visibleCount.value));
const hasMore = computed(() => visibleCount.value < props.candidates.length);

const loadMore = () => {
  visibleCount.value += PAGE_SIZE;
};

// Reset visible count when candidates change or show changes
watch(
  () => [props.candidates, props.show],
  () => {
    visibleCount.value = PAGE_SIZE;
  },
);
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
    @click.self="$emit('update:show', false)"
  >
    <div
      class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200"
    >
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span v-if="source === 'local'">📁 本地图标</span>
          <span v-else>🌐 网络图标</span>
          <span class="text-sm font-normal text-gray-500">({{ candidates.length }}个匹配)</span>
        </h3>
        <div
          class="text-sm text-orange-500 font-medium bg-orange-50 px-2 py-1 rounded-full flex items-center gap-1"
        >
          <span>⏱️</span>
          <span>{{ timeoutSeconds }}s 后自动选择</span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2 min-h-[200px]">
        <div class="grid grid-cols-4 sm:grid-cols-6 gap-4">
          <button
            v-for="icon in visibleCandidates"
            :key="icon"
            @click="selectIcon(icon)"
            class="group flex flex-col items-center gap-3 p-3 rounded-xl hover:bg-blue-50 transition-all border border-gray-100 hover:border-blue-200 hover:shadow-md"
          >
            <div
              class="w-12 h-12 flex items-center justify-center bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform"
            >
              <img :src="icon" class="w-8 h-8 object-contain" loading="lazy" />
            </div>
            <span
              class="text-xs text-gray-600 truncate w-full text-center font-medium"
              :title="getIconName(icon)"
            >
              {{ getIconName(icon) }}
            </span>
          </button>
        </div>
        <div v-if="hasMore" class="mt-4 flex justify-center">
          <button
            @click="loadMore"
            class="px-4 py-2 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors"
          >
            加载更多 ({{ candidates.length - visibleCount }} 个)
          </button>
        </div>
      </div>

      <div class="mt-6 flex justify-between items-center border-t pt-4">
        <button
          v-if="source === 'api'"
          @click="$emit('cancelLink')"
          class="px-4 py-2 rounded-lg text-red-500 hover:bg-red-50 font-medium transition-colors flex items-center gap-1"
        >
          <span>🔗</span> 取消链接
        </button>
        <div v-else></div>

        <button
          @click="$emit('update:show', false)"
          class="px-6 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  </div>
</template>
