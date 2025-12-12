<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useMainStore } from "@/stores/main";
import type { WidgetConfig } from "@/types";

type SystemStats = {
  cpu: {
    currentLoad: number;
    currentLoadUser: number;
    currentLoadSystem: number;
    manufacturer?: string;
    brand?: string;
    speed?: number;
    cores?: number;
  };
  mem: { total: number; used: number; active: number; available: number };
  disk: { fs: string; type: string; size: number; used: number; use: number; mount: string }[];
  network: { iface: string; rx_sec: number; tx_sec: number }[];
  temp: { main: number; cores: number[]; max: number };
  uptime: number;
  os?: {
    distro: string;
    release: string;
    codename: string;
    kernel: string;
    arch: string;
    hostname: string;
  };
};

const store = useMainStore();
const props = defineProps<{ widget?: WidgetConfig }>();

const systemStats = ref<SystemStats | null>(null);
const useMock = computed(() => Boolean(props.widget?.data?.useMock));
const isMedium = computed(
  () => (props.widget?.w || 1) >= 2 && (props.widget?.w || 1) < 4 && (props.widget?.h || 1) <= 1,
);
const isLarge = computed(() => (props.widget?.w || 1) >= 4 && (props.widget?.h || 1) <= 1);
const isWide = computed(() => isMedium.value || isLarge.value);
const isTall = computed(() => (props.widget?.h || 1) >= 4 && (props.widget?.w || 1) <= 1);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const fetchSystemStats = async () => {
  if (useMock.value) {
    systemStats.value = {
      cpu: {
        currentLoad: 15,
        currentLoadUser: 10,
        currentLoadSystem: 5,
        manufacturer: "Intel",
        brand: "Core i9-9900K",
        speed: 3.6,
        cores: 8,
      },
      mem: {
        total: 16 * 1024 * 1024 * 1024,
        used: 8 * 1024 * 1024 * 1024,
        active: 8 * 1024 * 1024 * 1024,
        available: 8 * 1024 * 1024 * 1024,
      },
      disk: [
        {
          fs: "/dev/sda1",
          type: "ext4",
          size: 500 * 1024 * 1024 * 1024,
          used: 200 * 1024 * 1024 * 1024,
          use: 40,
          mount: "/",
        },
      ],
      network: [{ iface: "eth0", rx_sec: 1024 * 1024, tx_sec: 512 * 1024 }],
      temp: { main: 45, cores: [], max: 45 },
      uptime: 3600 * 24 * 2,
      os: {
        distro: "Mock OS",
        release: "1.0",
        codename: "Mocky",
        kernel: "5.15.0",
        arch: "x64",
        hostname: "mock-server",
      },
    };
    return;
  }
  try {
    const headers = store.getHeaders();
    const res = await fetch("/api/system/stats", { headers });
    const data = await res.json();
    if (data.success) {
      systemStats.value = data.data;
    }
  } catch (e) {
    console.error(e);
  }
};

onMounted(() => {
  fetchSystemStats();
  pollTimer = setInterval(fetchSystemStats, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div
    class="w-full h-full flex overflow-hidden bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-2xl p-3 relative transition-all"
    :class="[isWide ? 'flex-row items-center gap-3' : 'flex-col']"
  >
    <!-- Header -->
    <div
      class="flex shrink-0 transition-all rounded-xl"
      :class="[
        isWide
          ? 'flex-col justify-between text-left bg-gray-50/50 dark:bg-gray-700/30 px-3 py-2 h-full'
          : 'flex-row items-center justify-between mb-3',
        isMedium ? 'w-[220px]' : '',
        isLarge ? 'w-[240px]' : '',
      ]"
    >
      <div class="flex items-center justify-between w-full">
        <div class="flex flex-col">
          <span class="font-bold text-gray-700 dark:text-gray-200 leading-none">系统状态</span>
          <div
            v-if="systemStats?.os"
            class="mt-1 font-mono leading-tight text-gray-500 dark:text-gray-400"
            :class="isWide ? 'text-base flex flex-col items-start' : 'text-sm'"
          >
            <div v-if="!isWide">
              {{ systemStats.os.distro }} {{ systemStats.os.release }}
              <span class="opacity-75 text-xs">({{ systemStats.os.arch }})</span>
            </div>
            <div v-else>
              {{ systemStats.os.distro }} {{ systemStats.os.release }}
              <span class="opacity-75 text-sm">({{ systemStats.os.arch }})</span>
            </div>
            <div v-if="systemStats.os.kernel" class="opacity-80 origin-left">
              Kernel: {{ systemStats.os.kernel }}
            </div>
          </div>
        </div>
        <span class="text-xl">🖥️</span>
      </div>

      <div
        v-if="systemStats"
        class="text-sm text-gray-400"
        :class="[isWide ? 'mt-1 text-right' : 'text-right']"
      >
        <div>运行: {{ (systemStats.uptime / 86400).toFixed(1) }} 天</div>
        <div
          v-if="systemStats.os"
          class="truncate"
          :class="[isWide ? 'max-w-[120px]' : 'scale-90 origin-right max-w-[80px]']"
          :title="systemStats.os.hostname"
        >
          {{ systemStats.os.hostname }}
        </div>
      </div>
    </div>

    <!-- Content -->
    <div
      v-if="systemStats"
      class="flex-1 overflow-y-auto custom-scrollbar"
      :class="[
        isMedium ? 'grid grid-cols-1 gap-y-2 content-center h-full pr-1' : '',
        isLarge ? 'grid grid-cols-3 gap-x-4 gap-y-2 content-center h-full pr-1' : '',
        !isWide ? 'flex flex-col gap-3 pr-1' : '',
      ]"
    >
      <!-- CPU -->
      <div class="flex flex-col gap-0.5">
        <div class="flex justify-between text-xs text-gray-500">
          <div class="flex flex-col">
            <div class="flex gap-2">
              <span>CPU</span>
              <span class="text-[10px] text-gray-400" v-if="systemStats.temp.main"
                >{{ systemStats.temp.main }}°C</span
              >
            </div>
            <div
              v-if="systemStats.cpu.brand && !isWide"
              class="text-[9px] text-gray-400 truncate max-w-[120px]"
              :title="systemStats.cpu.manufacturer + ' ' + systemStats.cpu.brand"
            >
              {{ systemStats.cpu.brand }}
            </div>
          </div>
          <span>{{ systemStats.cpu.currentLoad.toFixed(1) }}%</span>
        </div>
        <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
          <div
            class="h-full bg-blue-500"
            :style="{ width: systemStats.cpu.currentLoadUser + '%' }"
            title="User"
          ></div>
          <div
            class="h-full bg-red-400"
            :style="{ width: systemStats.cpu.currentLoadSystem + '%' }"
            title="System"
          ></div>
        </div>
      </div>

      <!-- RAM -->
      <div class="flex flex-col gap-0.5">
        <div class="flex justify-between text-xs text-gray-500">
          <span>RAM</span>
          <span class="scale-90 origin-right"
            >{{ (systemStats.mem.active / 1024 / 1024 / 1024).toFixed(1) }}/{{
              (systemStats.mem.total / 1024 / 1024 / 1024).toFixed(1)
            }}G</span
          >
        </div>
        <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-purple-500 transition-all duration-500"
            :style="{
              width: (systemStats.mem.active / systemStats.mem.total) * 100 + '%',
            }"
          ></div>
        </div>
      </div>

      <!-- Disk -->
      <div class="flex flex-col gap-1" :class="{ 'row-span-2': isLarge }">
        <div
          v-for="(disk, idx) in systemStats.disk.slice(0, isWide ? 1 : undefined)"
          :key="idx"
          class="flex flex-col gap-0.5"
        >
          <div class="flex justify-between text-xs text-gray-500">
            <span class="truncate max-w-[60%] text-[10px]" :title="disk.mount"
              >Disk ({{ disk.mount }})</span
            >
            <span class="text-[10px]">{{ disk.use.toFixed(0) }}%</span>
          </div>
          <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-green-500 transition-all duration-500"
              :style="{ width: disk.use + '%' }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Network -->
      <div
        class="flex flex-col gap-1"
        :class="[
          !isWide ? 'pt-2 border-t border-gray-100 dark:border-gray-700 mt-1' : '',
          isLarge ? 'col-span-2' : '',
        ]"
      >
        <div
          v-for="(net, idx) in systemStats.network
            .filter((n) => n.rx_sec > 0 || n.tx_sec > 0 || n.iface === 'eth0' || idx === 0)
            .slice(0, isWide ? 1 : 3)"
          :key="idx"
          class="flex items-center justify-between text-[10px] text-gray-500 font-mono"
        >
          <span class="text-gray-400 truncate max-w-[40px]" :title="net.iface">{{
            net.iface
          }}</span>
          <div class="flex gap-1 scale-90 origin-right">
            <span>↓{{ (net.rx_sec / 1024).toFixed(0) }}K</span>
            <span>↑{{ (net.tx_sec / 1024).toFixed(0) }}K</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="flex-1 flex items-center justify-center text-xs text-gray-400">
      加载中...
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
  background: #e5e7eb;
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #d1d5db;
}
</style>
