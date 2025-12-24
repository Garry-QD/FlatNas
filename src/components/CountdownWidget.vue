<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { WidgetConfig } from "@/types";
import { useMainStore } from "../stores/main";

const props = defineProps<{ widget: WidgetConfig }>();
const store = useMainStore();

// Initialize data structure
const initData = () => {
  const w = store.widgets.find((item) => item.id === props.widget.id);
  if (w && !w.data) {
    w.data = {
      targetDate: "",
      title: "重要时刻",
      style: "card",
    };
  }
};
initData();

const showConfig = ref(false);
const formData = ref({
  targetDate: "",
  title: "",
  style: "card",
});

const openConfig = () => {
  const data = props.widget.data || {
    targetDate: "",
    title: "重要时刻",
    style: "card",
  };
  formData.value = { ...data };
  showConfig.value = true;
};

const saveConfig = () => {
  const w = store.widgets.find((item) => item.id === props.widget.id);
  if (w) {
    w.data = { ...w.data, ...formData.value };
    store.saveData();
    calculate();
  }
  showConfig.value = false;
};

const timeLeft = ref({ days: 0, hours: 0, minutes: 0, seconds: 0, daysCeil: 0 });
const isExpired = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const styles = [
  { label: "卡片风格", value: "card" },
  { label: "极简文字", value: "simple" },
  { label: "霓虹光效", value: "neon" },
];

const isSmall = computed(
  () => (props.widget.colSpan ?? 1) <= 1 && (props.widget.rowSpan ?? 1) <= 1,
);

const displayDays = computed(() => (isSmall.value ? timeLeft.value.daysCeil : timeLeft.value.days));

const calculate = () => {
  if (!props.widget.data?.targetDate) {
    timeLeft.value = { days: 0, hours: 0, minutes: 0, seconds: 0, daysCeil: 0 };
    return;
  }

  try {
    const target = new Date(props.widget.data.targetDate).getTime();
    const now = new Date().getTime();
    const diff = target - now;

    if (diff <= 0) {
      timeLeft.value = { days: 0, hours: 0, minutes: 0, seconds: 0, daysCeil: 0 };
      isExpired.value = true;
      return;
    }

    isExpired.value = false;

    // Standard calculation
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    // Ceiling days for "Days Only" display (e.g. 1 hour left = 1 day)
    const daysCeil = Math.ceil(diff / (1000 * 60 * 60 * 24));

    timeLeft.value = {
      days,
      hours,
      minutes,
      seconds,
      daysCeil,
    };
  } catch (e) {
    console.error("Countdown calculation error:", e);
  }
};

onMounted(() => {
  calculate();
  timer = setInterval(calculate, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const formatNum = (num: number) => num.toString().padStart(2, "0");
</script>

<template>
  <div
    class="w-full h-full relative group overflow-hidden rounded-2xl transition-all select-none"
    :class="[
      widget.data?.style === 'neon'
        ? 'bg-gray-900 text-white border border-purple-500/30'
        : widget.data?.style === 'simple'
          ? 'bg-white/90 text-gray-800 border border-white/40'
          : 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg border border-white/10',
    ]"
  >
    <!-- Config Modal -->
    <Teleport to="body">
      <div
        v-if="showConfig"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        @click.self="saveConfig"
      >
        <div
          class="bg-white text-gray-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-fade-in-up"
        >
          <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <div class="font-bold text-lg">倒计时设置</div>
            <button @click="saveConfig" class="text-gray-400 hover:text-gray-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div class="p-5 flex flex-col gap-4">
            <div>
              <label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5"
                >标题</label
              >
              <input
                v-model="formData.title"
                class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                placeholder="例如：春节"
              />
            </div>

            <div>
              <label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5"
                >目标时间</label
              >
              <input
                type="datetime-local"
                v-model="formData.targetDate"
                class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              />
            </div>

            <div>
              <label class="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5"
                >风格</label
              >
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="s in styles"
                  :key="s.value"
                  @click="formData.style = s.value"
                  class="px-2 py-2 text-xs font-medium rounded-lg border transition-all text-center"
                  :class="
                    formData.style === s.value
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  "
                >
                  {{ s.label }}
                </button>
              </div>
            </div>
          </div>

          <div class="p-4 bg-gray-50 border-t border-gray-100">
            <button
              @click="saveConfig"
              class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Placeholder when no data -->
    <div
      v-if="!widget.data?.targetDate"
      class="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-black/10 transition-colors p-2 text-center"
      @click="openConfig"
    >
      <div
        class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mb-2 backdrop-blur-sm"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 text-white"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
      <span class="text-xs font-bold text-white/90">点击配置倒计时</span>
    </div>

    <!-- Display Content -->
    <div v-else class="w-full h-full flex flex-col items-center justify-center p-2 relative z-10">
      <!-- Settings Button -->
      <button
        @click.stop="openConfig"
        class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-black/10 active:scale-95 z-20"
        title="设置"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="w-4 h-4"
        >
          <path
            fill-rule="evenodd"
            d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
            clip-rule="evenodd"
          />
        </svg>
      </button>

      <!-- Title -->
      <div class="text-xs font-medium opacity-80 mb-1 uppercase tracking-wider truncate max-w-full">
        {{ widget.data.title || "倒计时" }}
      </div>

      <!-- Card Style -->
      <div
        v-if="widget.data.style === 'card'"
        class="flex items-center gap-1.5"
        :class="{ 'flex-col gap-0 justify-center': isSmall }"
      >
        <div class="flex flex-col items-center">
          <div
            class="bg-white/20 backdrop-blur rounded px-1.5 py-1 text-xl font-bold font-mono min-w-[2.5rem] text-center"
            :class="{ 'text-3xl min-w-[3.5rem] py-2': isSmall }"
          >
            {{ displayDays }}
          </div>
          <span class="text-[10px] opacity-80 mt-0.5">天</span>
        </div>

        <template v-if="!isSmall">
          <div class="text-xl font-bold -mt-3">:</div>
          <div class="flex flex-col items-center">
            <div
              class="bg-white/20 backdrop-blur rounded px-1.5 py-1 text-xl font-bold font-mono min-w-[2.5rem] text-center"
            >
              {{ formatNum(timeLeft.hours) }}
            </div>
            <span class="text-[10px] opacity-80 mt-0.5">时</span>
          </div>
          <div class="text-xl font-bold -mt-3">:</div>
          <div class="flex flex-col items-center">
            <div
              class="bg-white/20 backdrop-blur rounded px-1.5 py-1 text-xl font-bold font-mono min-w-[2.5rem] text-center"
            >
              {{ formatNum(timeLeft.minutes) }}
            </div>
            <span class="text-[10px] opacity-80 mt-0.5">分</span>
          </div>
        </template>
      </div>

      <!-- Simple Style -->
      <div v-else-if="widget.data.style === 'simple'" class="flex flex-col items-center">
        <div class="font-bold font-mono text-blue-600" :class="isSmall ? 'text-5xl' : 'text-4xl'">
          {{ displayDays
          }}<span class="text-sm font-normal text-gray-400 ml-1" v-if="!isSmall">天</span>
        </div>
        <div v-if="isSmall" class="text-xs text-gray-400">天</div>
        <div v-else class="text-sm font-mono text-gray-500 mt-1">
          {{ formatNum(timeLeft.hours) }}:{{ formatNum(timeLeft.minutes) }}:{{
            formatNum(timeLeft.seconds)
          }}
        </div>
      </div>

      <!-- Neon Style -->
      <div v-else-if="widget.data.style === 'neon'" class="flex flex-col items-center">
        <div
          class="font-bold font-mono text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]"
          :class="isSmall ? 'text-5xl' : 'text-3xl'"
        >
          {{ displayDays }} <span v-if="!isSmall" class="text-lg">DAY</span>
        </div>
        <div
          v-if="isSmall"
          class="text-xs text-pink-300 drop-shadow-[0_0_2px_rgba(236,72,153,0.5)]"
        >
          DAYS
        </div>
        <div
          v-else
          class="text-lg font-mono text-pink-300 drop-shadow-[0_0_2px_rgba(236,72,153,0.5)] mt-1"
        >
          {{ formatNum(timeLeft.hours) }}:{{ formatNum(timeLeft.minutes) }}:{{
            formatNum(timeLeft.seconds)
          }}
        </div>
      </div>

      <div
        v-if="isExpired"
        class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10"
      >
        <span class="text-xl font-bold text-white">🎉 已到达</span>
      </div>
    </div>
  </div>
</template>
