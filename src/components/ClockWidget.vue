<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

// Default style
if (!props.widget.data) {
  props.widget.data = { style: "digital" };
}

watch(
  () => props.widget.data,
  (newVal) => {
    if (!newVal) {
      props.widget.data = { style: "digital" };
    }
  },
  { deep: true },
);

const styles = ["digital", "analog", "retro"];
const styleIndex = computed(() => {
  const s = props.widget.data?.style || "digital";
  return styles.indexOf(s) === -1 ? 0 : styles.indexOf(s);
});

const toggleStyle = () => {
  if (!props.widget.data) props.widget.data = {};
  const nextIndex = (styleIndex.value + 1) % styles.length;
  props.widget.data.style = styles[nextIndex];
  store.saveData();
};

const now = ref(new Date());
let timer: number | null = null;

const updateTime = () => {
  now.value = new Date();
  requestAnimationFrame(updateTime);
};

onMounted(() => {
  timer = requestAnimationFrame(updateTime);
});

onUnmounted(() => {
  if (timer) cancelAnimationFrame(timer);
});

// Digital Logic
const timeStr = computed(() => now.value.toLocaleTimeString("zh-CN", { hour12: false }));
const dateStr = computed(() => now.value.toLocaleDateString());

// Analog Logic
const seconds = computed(() => now.value.getSeconds() + now.value.getMilliseconds() / 1000);
const minutes = computed(() => now.value.getMinutes() + seconds.value / 60);
const hours = computed(() => (now.value.getHours() % 12) + minutes.value / 60);

const secDeg = computed(() => seconds.value * 6);
const minDeg = computed(() => minutes.value * 6);
const hourDeg = computed(() => hours.value * 30);
</script>

<template>
  <div
    class="w-full h-full relative group transition-all overflow-hidden rounded-2xl border border-white/10"
    :class="[
      widget.data?.style === 'digital'
        ? 'bg-black/20 backdrop-blur hover:bg-black/30'
        : widget.data?.style === 'retro'
          ? 'bg-[#e8dcc4] text-gray-900 border-[#8b5a2b]'
          : 'bg-white/90 text-gray-800',
    ]"
  >
    <!-- Toggle Button -->
    <button
      @click.stop="toggleStyle"
      class="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-black/10 active:scale-95"
      title="切换风格"
      :class="widget.data?.style === 'digital' ? 'text-white' : 'text-gray-600'"
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
          d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
        />
      </svg>
    </button>

    <!-- Digital Style -->
    <div
      v-if="widget.data?.style === 'digital'"
      class="w-full h-full flex flex-col items-center justify-center"
    >
      <div class="text-4xl font-mono font-bold">{{ timeStr }}</div>
      <div class="text-sm opacity-80 mt-1">{{ dateStr }}</div>
    </div>

    <!-- Analog Style (Modern) -->
    <div
      v-else-if="widget.data?.style === 'analog'"
      class="w-full h-full flex items-center justify-center p-2"
    >
      <div class="relative w-full max-w-[140px] aspect-square">
        <!-- Clock Face -->
        <svg viewBox="0 0 100 100" class="w-full h-full drop-shadow-md">
          <circle cx="50" cy="50" r="48" fill="white" stroke="#e5e7eb" stroke-width="2" />
          
          <!-- Hour Markers -->
          <g v-for="i in 12" :key="i" :transform="`rotate(${i * 30} 50 50)`">
            <line x1="50" y1="6" x2="50" y2="10" stroke="#374151" stroke-width="2" stroke-linecap="round" />
          </g>

          <!-- Hands -->
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="25"
            stroke="#1f2937"
            stroke-width="3"
            stroke-linecap="round"
            :transform="`rotate(${hourDeg} 50 50)`"
          />
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="15"
            stroke="#4b5563"
            stroke-width="2"
            stroke-linecap="round"
            :transform="`rotate(${minDeg} 50 50)`"
          />
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="10"
            stroke="#ef4444"
            stroke-width="1"
            stroke-linecap="round"
            :transform="`rotate(${secDeg} 50 50)`"
          />
          
          <!-- Center Dot -->
          <circle cx="50" cy="50" r="2" fill="#ef4444" />
        </svg>
      </div>
    </div>

    <!-- Retro Style (Pocket Watch) -->
    <div
      v-else-if="widget.data?.style === 'retro'"
      class="w-full h-full flex items-center justify-center p-2"
    >
      <div class="relative w-full max-w-[140px] aspect-square">
        <!-- Top Ring -->
        <div class="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-4 border-2 border-[#8b5a2b] rounded-full z-0"></div>
        <div class="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-1 bg-[#8b5a2b] z-0"></div>

        <svg viewBox="0 0 100 100" class="w-full h-full drop-shadow-lg relative z-10">
          <!-- Outer Rim -->
          <circle cx="50" cy="50" r="48" fill="#fcf8ed" stroke="#8b5a2b" stroke-width="3" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="#d4b483" stroke-width="1" />
          
          <!-- Roman Numerals (Simplified) -->
          <text v-for="(n, i) in ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']" 
                :key="i"
                x="50" y="16"
                text-anchor="middle"
                class="text-[8px] font-serif font-bold fill-[#5c3a1e]"
                :transform="`rotate(${i * 30} 50 50)`"
          >{{ n }}</text>

          <!-- Decorative inner circle -->
          <circle cx="50" cy="50" r="25" fill="none" stroke="#e8dcc4" stroke-width="0.5" />

          <!-- Hands (Ornate) -->
          <!-- Hour -->
          <path d="M48,50 L50,28 L52,50 Z" fill="#2c1810" :transform="`rotate(${hourDeg} 50 50)`" />
          <!-- Minute -->
          <path d="M49,50 L50,18 L51,50 Z" fill="#2c1810" :transform="`rotate(${minDeg} 50 50)`" />
          <!-- Second -->
          <line
            x1="50"
            y1="50"
            x2="50"
            y2="12"
            stroke="#8b5a2b"
            stroke-width="0.5"
            :transform="`rotate(${secDeg} 50 50)`"
          />
          
          <circle cx="50" cy="50" r="1.5" fill="#8b5a2b" />
        </svg>
      </div>
    </div>
  </div>
</template>
