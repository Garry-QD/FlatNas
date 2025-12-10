<script setup lang="ts">
import { watch, onMounted, ref } from "vue";
import { useStorage, useDebounceFn } from "@vueuse/core";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

const isFocused = ref(false);

const localData = ref("");
const localBackup = useStorage<string>(`flatnas-memo-backup-${props.widget.id}`, "");
let suppressSave = false;

const autoSave = useDebounceFn(async () => {
  if (!store.isLogged) return;
  Reflect.set(props.widget as unknown as Record<string, unknown>, "data", localData.value);
  await store.saveWidget(props.widget.id, localData.value);
  store.socket.emit("memo:update", {
    token: store.token || localStorage.getItem("flat-nas-token"),
    widgetId: props.widget.id,
    content: localData.value,
  });
}, 1000);

onMounted(() => {
  // 优先使用本地备份，其次才是服务端数据 (仅作为初始值，不再同步)
  if (localBackup.value) {
    localData.value = localBackup.value;
  } else if (props.widget.data) {
    localData.value = props.widget.data;
  }
});

watch(localData, (newVal) => {
  if (typeof newVal === "string") {
    localBackup.value = newVal;
    if (!suppressSave) autoSave();
  }
});

// Watch for prop changes (e.g. initial load or other reasons)
watch(
  () => props.widget.data,
  (newVal) => {
    if (typeof newVal === "string" && newVal !== localData.value) {
      suppressSave = true;
      localData.value = newVal;
      localBackup.value = newVal;
      suppressSave = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    class="w-full h-full p-4 rounded-2xl bg-yellow-100/90 backdrop-blur border border-white/10 text-gray-700 relative group"
  >
    <textarea
      :readonly="!store.isLogged"
      v-model="localData"
      @focus="isFocused = true"
      @blur="isFocused = false"
      class="w-full h-full bg-transparent resize-none outline-none text-sm placeholder-gray-600 font-medium"
      :placeholder="store.isLogged ? '写点什么...' : '请先登录'"
    ></textarea>
  </div>
</template>
