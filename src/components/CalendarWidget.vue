<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

// Default to 'day' if not set
if (!props.widget.data) {
  props.widget.data = { style: "day" };
}

// Ensure reactivity if data is replaced
watch(
  () => props.widget.data,
  (newVal) => {
    if (!newVal) {
      props.widget.data = { style: "day" };
    }
  },
  { deep: true },
);

// Reactive date
const now = ref(new Date());
let timer: number | null = null;

onMounted(() => {
  // Sync with minute
  const syncTimer = setTimeout(() => {
    now.value = new Date();
    timer = setInterval(() => {
      now.value = new Date();
    }, 60000) as unknown as number;
  }, (60 - new Date().getSeconds()) * 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

// Day View Data
const dayNum = computed(() => now.value.getDate());
const weekDay = computed(() =>
  ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.value.getDay()],
);
const yearMonth = computed(() => `${now.value.getFullYear()}.${now.value.getMonth() + 1}`);

// Month View Data
const currentMonth = ref(new Date());

const calendarDays = computed(() => {
  const year = currentMonth.value.getFullYear();
  const month = currentMonth.value.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days = [];

  // Padding for start of week (Sunday start)
  const startPadding = firstDay.getDay();
  for (let i = 0; i < startPadding; i++) {
    days.push({ day: "", current: false, today: false });
  }

  // Days of month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const isToday =
      i === now.value.getDate() &&
      month === now.value.getMonth() &&
      year === now.value.getFullYear();
    days.push({ day: i, current: true, today: isToday });
  }

  return days;
});

const toggleStyle = () => {
  if (!props.widget.data) props.widget.data = {};
  props.widget.data.style = props.widget.data.style === "day" ? "month" : "day";
  store.saveData();
};

const nextMonth = () => {
  currentMonth.value = new Date(
    currentMonth.value.getFullYear(),
    currentMonth.value.getMonth() + 1,
    1,
  );
};
const prevMonth = () => {
  currentMonth.value = new Date(
    currentMonth.value.getFullYear(),
    currentMonth.value.getMonth() - 1,
    1,
  );
};

const goToday = () => {
  currentMonth.value = new Date();
};
</script>

<template>
  <div
    class="w-full h-full relative overflow-hidden group transition-all"
    :class="[
      widget.data?.style === 'month'
        ? 'bg-white/90 text-gray-800'
        : 'bg-red-500/20 text-white hover:bg-red-500/30',
      'rounded-2xl backdrop-blur border border-white/10',
    ]"
  >
    <!-- Toggle Button (Visible on Hover) -->
    <button
      @click.stop="toggleStyle"
      class="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-black/10 active:scale-95"
      title="切换视图"
      :class="widget.data?.style === 'month' ? 'text-gray-600' : 'text-white'"
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
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    </button>

    <!-- Day View -->
    <div
      v-if="widget.data?.style === 'day'"
      class="w-full h-full flex flex-col items-center justify-center cursor-pointer"
      @click="toggleStyle"
    >
      <div
        class="absolute -right-4 -bottom-6 text-9xl font-bold opacity-5 pointer-events-none"
      >
        {{ dayNum }}
      </div>
      <div class="text-xs opacity-70 tracking-widest uppercase mb-1">{{ yearMonth }}</div>
      <div class="text-5xl font-bold shadow-text">{{ dayNum }}</div>
      <div class="text-sm mt-1 bg-white/20 px-3 py-0.5 rounded-full backdrop-blur-md">
        {{ weekDay }}
      </div>
    </div>

    <!-- Month View -->
    <div v-else class="w-full h-full flex flex-col p-3">
      <!-- Header -->
      <div class="flex items-center justify-between mb-2">
        <button
          @click.stop="prevMonth"
          class="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-4 h-4"
          >
            <path
              fill-rule="evenodd"
              d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
        <span class="text-sm font-bold cursor-pointer select-none" @click="goToday">
          {{ currentMonth.getFullYear() }}.{{ currentMonth.getMonth() + 1 }}
        </span>
        <button
          @click.stop="nextMonth"
          class="p-1 hover:bg-gray-200 rounded text-gray-600 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-4 h-4"
          >
            <path
              fill-rule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>

      <!-- Grid -->
      <div class="grid grid-cols-7 gap-1 text-center flex-1 text-[10px] content-start">
        <div v-for="d in ['日', '一', '二', '三', '四', '五', '六']" :key="d" class="text-gray-400 font-medium">
          {{ d }}
        </div>
        <div
          v-for="(d, i) in calendarDays"
          :key="i"
          class="aspect-square flex items-center justify-center rounded-full transition-all"
          :class="{
            'bg-red-500 text-white font-bold shadow-sm': d.today,
            'hover:bg-red-100 text-gray-700': d.current && !d.today,
            'invisible': !d.current,
            'cursor-pointer': d.current
          }"
        >
          {{ d.day }}
        </div>
      </div>
    </div>
  </div>
</template>
