<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";
import { Lunar, Solar, HolidayUtil } from "lunar-javascript";

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
  setTimeout(
    () => {
      now.value = new Date();
      timer = setInterval(() => {
        now.value = new Date();
      }, 60000) as unknown as number;
    },
    (60 - new Date().getSeconds()) * 1000,
  );
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

// Day View Data
const dayNum = computed(() => now.value.getDate());
const weekDay = computed(
  () => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.value.getDay()],
);
const yearMonth = computed(() => `${now.value.getFullYear()}.${now.value.getMonth() + 1}`);

const lunarDate = computed(() => {
  const d = Lunar.fromDate(now.value);
  return `${d.getMonthInChinese()}月${d.getDayInChinese()}`;
});

const lunarYear = computed(() => {
  const d = Lunar.fromDate(now.value);
  return `${d.getYearInGanZhi()}${d.getYearShengXiao()}年`;
});

const MEMORIAL_DAYS: Record<string, string> = {
  "1-10": "警察",
  "4-15": "全民",
  "4-24": "航天",
  "5-4": "五四",
  "7-1": "建党",
  "8-19": "医师",
  "9-3": "抗战",
  "9-30": "烈士",
  "11-8": "记者",
  "11-9": "消防",
  "12-13": "公祭",
};

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
    days.push({ day: "", current: false, today: false, lunar: "", labelOnly: false });
  }

  // Days of month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const isToday =
      i === now.value.getDate() &&
      month === now.value.getMonth() &&
      year === now.value.getFullYear();

    const date = new Date(year, month, i);
    const lunar = Lunar.fromDate(date);
    const jieqi = lunar.getJieQi();

    let label = "";
    let origin: "none" | "jieqi" | "solarFest" | "lunarFest" | "holiday" = "none";

    const solar = Solar.fromDate(date);
    const sFest = solar.getFestivals();
    if (sFest && sFest.length > 0) {
      label = sFest[0];
      origin = "solarFest";
    }

    if (!label) {
      const lFest = lunar.getFestivals();
      if (lFest && lFest.length > 0) {
        label = lFest[0];
        origin = "lunarFest";
      }
    }

    if (!label) {
      try {
        const holiday = HolidayUtil.getHoliday(year, month + 1, i);
        if (holiday && !holiday.isWork()) {
          label = holiday.getName();
          origin = "holiday";
        }
      } catch {}
    }

    if (!label) {
      const k = `${month + 1}-${i}`;
      const m = MEMORIAL_DAYS[k];
      if (m) {
        label = m;
        origin = "solarFest";
      }
    }

    if (!label && jieqi) {
      label = jieqi;
      origin = "jieqi";
    }

    if (!label) {
      let lunarStr = lunar.getDayInChinese();
      if (lunarStr === "初一") lunarStr = lunar.getMonthInChinese() + "月";
      label = lunarStr;
      origin = "none";
    }

    // Remove trailing '节' when the origin is a festival/holiday label
    if (origin === "solarFest" || origin === "lunarFest" || origin === "holiday") {
      label = label.replace(/节$/, "");
    }

    if (label.length > 4) label = label.substring(0, 4);

    days.push({ day: i, current: true, today: isToday, lunar: label, origin });
  }

  return days;
});

// Styles: day, month-lunar, month-memorial
const styles = ["day", "month-lunar", "month-memorial"] as const;
const toggleStyle = () => {
  if (!props.widget.data) props.widget.data = {};
  const cur = props.widget.data.style || "day";
  // Migration: map old styles to new ones if necessary, or just reset
  let idx = styles.indexOf(cur as (typeof styles)[number]);
  if (idx === -1) idx = 0; // Default to day if unknown style

  const next = styles[(idx + 1) % styles.length];
  props.widget.data.style = next;
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
      widget.data?.style !== 'day'
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
      :class="widget.data?.style !== 'day' ? 'text-gray-600' : 'text-white'"
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
      class="w-full h-full flex flex-row cursor-pointer relative overflow-hidden"
      @click="toggleStyle"
    >
      <!-- Background Number -->
      <div
        class="absolute right-0 bottom-0 text-7xl md:text-9xl font-bold opacity-5 pointer-events-none select-none leading-none -mb-4 -mr-4"
      >
        {{ dayNum }}
      </div>

      <!-- Left 1/3: Day Number -->
      <div
        class="w-1/3 h-full flex items-center justify-center border-r border-white/10 bg-black/5 flex-shrink-0"
      >
        <div class="text-4xl md:text-5xl font-bold shadow-text leading-none">
          {{ dayNum }}
        </div>
      </div>

      <!-- Right: Details -->
      <div class="flex-1 h-full flex flex-col justify-center px-3 z-10 min-w-0">
        <!-- Year.Month -->
        <div class="text-[10px] md:text-xs opacity-60 tracking-widest uppercase mb-0.5">
          {{ yearMonth }}
        </div>

        <!-- Lunar Date -->
        <div class="text-lg md:text-2xl font-bold opacity-90 leading-tight truncate">
          {{ lunarDate }}
        </div>

        <!-- WeekDay & Lunar Year -->
        <div class="flex items-center gap-2 mt-1">
          <span
            class="text-[10px] md:text-xs bg-white/20 px-1.5 py-0.5 rounded backdrop-blur-md whitespace-nowrap"
          >
            {{ weekDay }}
          </span>
          <span class="text-[10px] md:text-xs opacity-60 truncate">{{ lunarYear }}</span>
        </div>
      </div>
    </div>

    <!-- Month View (with lunar) and Memorial-only -->
    <div v-else class="w-full h-full flex flex-col p-3">
      <!-- Header -->
      <div class="flex items-center justify-center gap-2 mb-2">
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
      <div
        class="grid grid-cols-7 gap-1 text-center flex-1 text-[11px] md:text-[12px] content-start"
      >
        <div
          v-for="d in ['日', '一', '二', '三', '四', '五', '六']"
          :key="d"
          class="text-gray-400 font-medium"
        >
          {{ d }}
        </div>
        <div
          v-for="(d, i) in calendarDays"
          :key="i"
          class="aspect-square flex items-center justify-center rounded-2xl transition-all"
          :class="{
            'bg-red-500 text-white font-bold shadow-sm': d.today,
            'hover:bg-red-100 text-gray-700': d.current && !d.today,
            invisible: !d.current,
            'cursor-pointer': d.current,
          }"
        >
          <div class="flex flex-col items-center justify-center leading-none h-full py-1">
            <span v-if="d.day" class="text-base font-bold">{{ d.day }}</span>
            <span
              v-if="
                widget.data?.style === 'month-lunar' ||
                (widget.data?.style === 'month-memorial' &&
                  (d.origin === 'holiday' || d.origin === 'solarFest' || d.origin === 'lunarFest'))
              "
              class="text-[10px] md:text-[11px] opacity-80 mt-0.5"
              :class="{ 'scale-90': d.lunar.length > 3 }"
              >{{ d.lunar }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
