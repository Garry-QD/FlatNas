<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
import { watch, onMounted } from "vue";
import { useStorage } from "@vueuse/core";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

// Local Backup
const localBackup = useStorage<string>(`flatnas-memo-backup-${props.widget.id}`, "");

watch(
  () => props.widget.data,
  (newVal) => {
    if (newVal) localBackup.value = newVal;
  },
);

onMounted(() => {
  if (!props.widget.data && localBackup.value) {
    props.widget.data = localBackup.value;
  }
});
</script>

<template>
  <div
    class="w-full h-full p-4 rounded-2xl bg-yellow-100/90 backdrop-blur border border-white/10 text-gray-700 relative group"
  >
    <textarea
      :readonly="!store.isLogged"
      v-model="widget.data"
      class="w-full h-full bg-transparent resize-none outline-none text-sm placeholder-gray-600 font-medium"
      :placeholder="store.isLogged ? '写点什么...' : '暂无内容'"
    ></textarea>
  </div>
</template>
