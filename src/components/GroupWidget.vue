<script setup lang="ts">
import type { WidgetConfig } from "@/types";
import WidgetRenderer from "./WidgetRenderer.vue";

defineProps<{
  widget: WidgetConfig;
}>();
</script>

<template>
  <div class="group-widget w-full h-full relative">
    <WidgetRenderer :widget="widget" />
  </div>
</template>
