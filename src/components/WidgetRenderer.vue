<script setup lang="ts">
import type { WidgetConfig } from "@/types";
import ClockWidget from "./ClockWidget.vue";
import SimpleWeatherWidget from "./SimpleWeatherWidget.vue";
import CalendarWidget from "./CalendarWidget.vue";
import MemoWidget from "./MemoWidget.vue";
import TodoWidget from "./TodoWidget.vue";
import CalculatorWidget from "./CalculatorWidget.vue";
import CountdownWidget from "./CountdownWidget.vue";
import IframeWidget from "./IframeWidget.vue";
import BookmarkWidget from "./BookmarkWidget.vue";
import HotWidget from "./HotWidget.vue";
import ClockWeatherWidget from "./ClockWeatherWidget.vue";
import RssWidget from "./RssWidget.vue";
import DockerWidget from "./DockerWidget.vue";

defineProps<{
  widget: WidgetConfig;
}>();
</script>

<template>
  <ClockWidget v-if="widget.type === 'clock'" :widget="widget" />
  <SimpleWeatherWidget v-else-if="widget.type === 'weather'" :widget="widget" />
  <CalendarWidget v-else-if="widget.type === 'calendar'" :widget="widget" />
  <MemoWidget v-else-if="widget.type === 'memo'" :widget="widget" />
  <TodoWidget v-else-if="widget.type === 'todo'" :widget="widget" />
  <CalculatorWidget v-else-if="widget.type === 'calculator'" />
  <div
    v-else-if="widget.type === 'ip'"
    class="flex items-center justify-center h-full text-gray-500 text-xs"
  >
    IP Widget (TODO)
  </div>
  <CountdownWidget v-else-if="widget.type === 'countdown'" :widget="widget" />
  <IframeWidget v-else-if="widget.type === 'iframe'" :widget="widget" />
  <BookmarkWidget v-else-if="widget.type === 'bookmarks'" :widget="widget" />
  <HotWidget v-else-if="widget.type === 'hot'" :widget="widget" />
  <ClockWeatherWidget v-else-if="widget.type === 'clockweather'" :widget="widget" />
  <RssWidget v-else-if="widget.type === 'rss'" :widget="widget" />
  <DockerWidget v-else-if="widget.type === 'docker'" :widget="widget" />
  <div v-else class="flex items-center justify-center h-full bg-red-50 text-red-500 text-xs p-2">
    Unknown: {{ widget.type }} ({{ widget.id }})
  </div>
</template>
