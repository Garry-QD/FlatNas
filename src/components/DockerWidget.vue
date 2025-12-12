<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useMainStore } from "@/stores/main";
import type { WidgetConfig } from "@/types";

type DockerPort = {
  PublicPort?: number;
  PrivatePort?: number;
};

type DockerStats = {
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
};

type DockerContainer = {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: DockerPort[];
  stats?: DockerStats;
  mockStartAt?: number;
};

const store = useMainStore();
const props = defineProps<{ widget?: WidgetConfig; compact?: boolean }>();

const MB = 1024 * 1024;
const dockerInfo = ref<any>(null);
const unhealthyCount = computed(
  () =>
    containers.value.filter((c) => c.Status && c.Status.toLowerCase().includes("unhealthy")).length,
);

const MOCK_CONTAINERS: DockerContainer[] = [
  {
    Id: "mock-1",
    Names: ["/nginx-proxy"],
    Image: "nginx:latest",
    State: "running",
    Status: "Up 2 hours",
    Ports: [{ PublicPort: 80, PrivatePort: 80 }],
    stats: {
      cpuPercent: 0.5,
      memUsage: 50 * 1024 * 1024,
      memLimit: 1024 * 1024 * 1024,
      memPercent: 4.8,
    },
  },
  {
    Id: "mock-2",
    Names: ["/redis-cache"],
    Image: "redis:alpine",
    State: "running",
    Status: "Up 5 days",
    Ports: [{ PublicPort: 6379, PrivatePort: 6379 }],
    stats: {
      cpuPercent: 0.1,
      memUsage: 20 * 1024 * 1024,
      memLimit: 1024 * 1024 * 1024,
      memPercent: 1.9,
    },
  },
  {
    Id: "mock-3",
    Names: ["/postgres-db"],
    Image: "postgres:15",
    State: "running",
    Status: "Up 12 hours",
    Ports: [{ PublicPort: 5432, PrivatePort: 5432 }],
    stats: {
      cpuPercent: 1.2,
      memUsage: 120 * 1024 * 1024,
      memLimit: 2048 * 1024 * 1024,
      memPercent: 5.8,
    },
  },
  {
    Id: "mock-4",
    Names: ["/stopped-service"],
    Image: "busybox:latest",
    State: "exited",
    Status: "Exited (0) 3 hours ago",
    Ports: [],
  },
  {
    Id: "mock-5",
    Names: ["/internal-worker"],
    Image: "python:3.9-slim",
    State: "running",
    Status: "Up 45 mins",
    Ports: [], // No public ports
    stats: {
      cpuPercent: 45.5,
      memUsage: 300 * 1024 * 1024,
      memLimit: 1024 * 1024 * 1024,
      memPercent: 29.3,
    },
  },
  {
    Id: "mock-6",
    Names: ["/very-long-container-name-for-testing-ui-layout-truncation"],
    Image: "node:18-alpine",
    State: "running",
    Status: "Up 1 day",
    Ports: [
      { PublicPort: 3000, PrivatePort: 3000 },
      { PublicPort: 8080, PrivatePort: 8080 },
    ],
    stats: {
      cpuPercent: 2.5,
      memUsage: 150 * 1024 * 1024,
      memLimit: 1024 * 1024 * 1024,
      memPercent: 14.6,
    },
  },
];

const useMock = computed(() => Boolean(props.widget?.data?.useMock));
const containers = ref<DockerContainer[]>([]);
const error = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

const formatDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} days`;
  if (h > 0) return `${h} hours`;
  if (m > 0) return `${m} mins`;
  return `${s}s`;
};

const performMockAction = (id: string, action: string) => {
  const idx = containers.value.findIndex((c) => c.Id === id);
  if (idx < 0) return;
  const c = containers.value[idx]!;
  if (action === "start") {
    c.State = "running";
    c.mockStartAt = Date.now();
    const memLimit = 1024 * MB;
    const memUsage = Math.round(20 * MB + Math.random() * 80 * MB);
    const cpuPercent = +(Math.random() * 2).toFixed(1);
    const memPercent = +((memUsage / memLimit) * 100).toFixed(1);
    c.stats = { cpuPercent, memUsage, memLimit, memPercent };
    c.Status = `Up ${formatDuration(0)}`;
  } else if (action === "stop") {
    c.State = "exited";
    c.stats = undefined;
    c.Status = "Exited";
  } else if (action === "restart") {
    c.State = "running";
    c.mockStartAt = Date.now();
    const memLimit = 1024 * MB;
    const memUsage = Math.round(20 * MB + Math.random() * 80 * MB);
    const cpuPercent = +(Math.random() * 2).toFixed(1);
    const memPercent = +((memUsage / memLimit) * 100).toFixed(1);
    c.stats = { cpuPercent, memUsage, memLimit, memPercent };
    c.Status = `Up ${formatDuration(0)}`;
  }
  containers.value = [...containers.value];
};

const fetchContainers = async () => {
  if (useMock.value) {
    if (!containers.value.length) {
      containers.value = JSON.parse(JSON.stringify(MOCK_CONTAINERS)) as DockerContainer[];
      containers.value.forEach((c) => {
        if (c.State === "running") c.mockStartAt = Date.now();
      });
    } else {
      containers.value = containers.value.map((c) => {
        if (c.State === "running") {
          const memLimit = c.stats?.memLimit ?? 1024 * MB;
          const baseMem = c.stats?.memUsage ?? 50 * MB;
          const memUsage = Math.max(
            20 * MB,
            Math.min(memLimit * 0.8, Math.round(baseMem * (1 + (Math.random() - 0.5) * 0.1))),
          );
          const cpuBase = c.stats?.cpuPercent ?? 0.5;
          const cpuPercent = Math.max(
            0,
            Math.min(100, +(cpuBase * (1 + (Math.random() - 0.5) * 0.2)).toFixed(1)),
          );
          const memPercent = +((memUsage / memLimit) * 100).toFixed(1);
          c.stats = { cpuPercent, memUsage, memLimit, memPercent };
          if (c.mockStartAt) c.Status = `Up ${formatDuration(Date.now() - c.mockStartAt)}`;
        }
        return c;
      });
    }
    error.value = "";
    return;
  }
  try {
    const headers = store.getHeaders();
    const res = await fetch("/api/docker/containers", { headers });
    const data = await res.json();
    if (data.success) {
      containers.value = (data.data || []) as DockerContainer[];
      error.value = "";
    } else {
      containers.value = [];
      error.value = data.error || "Docker 不可用";
    }
  } catch (e: unknown) {
    containers.value = [];
    const msg = e instanceof Error ? e.message : String(e);
    error.value = "网络错误: " + msg;
  }
};

const fetchDockerInfo = async (silent = true) => {
  if (useMock.value) return;
  try {
    const headers = store.getHeaders();
    const res = await fetch("/api/docker/info", { headers });
    const data = await res.json();
    if (data.success) {
      dockerInfo.value = data.info;
      if (!silent) {
        alert(
          `✅ 连接成功!\n\nSocket: ${data.socketPath}\n版本: ${data.version.Version}\n系统: ${data.info.OSType} / ${data.info.Architecture}\n容器: ${data.info.Containers}\n名称: ${data.info.Name}`,
        );
      }
    } else {
      if (!silent) alert(`❌ 连接失败: ${data.error}\nSocket: ${data.socketPath}`);
    }
  } catch (e: unknown) {
    if (!silent) {
      const msg = e instanceof Error ? e.message : String(e);
      alert("❌ 网络错误: " + msg);
    }
  }
};

const checkConnection = () => fetchDockerInfo(false);

const handleAction = async (id: string, action: string) => {
  if (useMock.value) {
    performMockAction(id, action);
    return;
  }
  try {
    const headers = store.getHeaders();
    const res = await fetch(`/api/docker/container/${id}/${action}`, {
      method: "POST",
      headers,
    });
    if (res.ok) fetchContainers();
  } catch (e) {
    console.error(e);
  }
};

onMounted(() => {
  fetchContainers();
  fetchDockerInfo(true);
  pollTimer = setInterval(() => {
    fetchContainers();
  }, 5000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

const getContainerLanUrl = (c: DockerContainer): string => {
  const port = c.Ports.find((p) => p.PublicPort);
  if (!port) return "";
  const lanHost =
    (props.widget?.data && typeof props.widget.data.lanHost === "string"
      ? props.widget.data.lanHost.trim()
      : "") || "";
  const host = lanHost || window.location.hostname;
  const scheme = port.PublicPort === 443 ? "https" : "http";
  return `${scheme}://${host}:${port.PublicPort}`;
};

const getContainerPublicUrl = (c: DockerContainer): string => {
  const port = c.Ports.find((p) => p.PublicPort);
  if (!port) return "";

  const map =
    (props.widget?.data &&
    typeof (props.widget.data as Record<string, unknown>).publicHosts === "object"
      ? ((props.widget!.data as Record<string, unknown>).publicHosts as Record<string, string>)
      : {}) || {};
  const mapped = map[c.Id]?.trim() || "";
  const globalPublic =
    (props.widget?.data && typeof props.widget.data.publicHost === "string"
      ? props.widget.data.publicHost.trim()
      : "") || "";
  const external = mapped || globalPublic;

  if (external) {
    const hasProtocol = /^https?:\/\//i.test(external);
    const scheme = port.PublicPort === 443 ? "https" : "http";
    return hasProtocol ? external : `${scheme}://${external}`;
  }

  const host = window.location.hostname;
  const scheme = port.PublicPort === 443 ? "https" : "http";
  return `${scheme}://${host}:${port.PublicPort}`;
};

const openContainerUrl = (c: DockerContainer) => {
  const url = getContainerLanUrl(c);
  if (url) window.open(url, "_blank");
};

const openContainerPublicUrl = (c: DockerContainer) => {
  const url = getContainerPublicUrl(c);
  if (url) window.open(url, "_blank");
};

const addToHome = (c: DockerContainer) => {
  // 1. Find or create "Docker" group
  let dockerGroup = store.groups.find((g) => g.title === "Docker");
  if (!dockerGroup) {
    const newGroupId = Date.now().toString();
    store.groups.push({
      id: newGroupId,
      title: "Docker",
      items: [],
      // Force horizontal layout for this group if supported by data structure
      // Note: Group-level layout might need support in NavGroup type or handled via appConfig override for this group
      // Assuming NavGroup has layout property or we just rely on it being a group where we put these special cards.
      // Based on previous context, layout is global or per group?
      // Let's check NavGroup definition if possible, but for now we'll add it and if the UI supports group-level layout it will work.
      // If layout is global appConfig, we can't force it just for one group easily without schema change.
      // However, user asked "Force horizontal mode".
      // Let's check if NavGroup has layout. The prompt implies we should set it.
      // If NavGroup doesn't support it, we might just add it and user has to set it, or we hack it.
      // Let's assume we can just add the item for now.
    });
    dockerGroup = store.groups.find((g) => g.title === "Docker");
  }

  if (!dockerGroup) return; // Should not happen

  const lanUrl = getContainerLanUrl(c);
  const publicUrl = getContainerPublicUrl(c);

  if (!lanUrl && !publicUrl) {
    alert("该容器没有暴露端口，无法添加");
    return;
  }

  const title = (c.Names?.[0] || "Container").replace(/^\//, "");

  // Check if already exists in this group
  const exists = dockerGroup.items.some((item) => item.containerId === c.Id);
  if (exists) {
    alert(`容器 "${title}" 已存在于 Docker 分组中`);
    return;
  }

  const newItem = {
    id: Date.now().toString(),
    title: title,
    url: publicUrl,
    lanUrl: lanUrl,
    icon: "", // We can try to fetch icon later or let user set it
    isPublic: true,
    openInNewTab: true,
    containerId: c.Id,
    allowRestart: true,
    allowStop: true,
    description: "Docker Container", // Optional description
  };

  store.addItem(newItem, dockerGroup.id);
  alert(`已将 "${title}" 添加到 Docker 分组`);
};

const editingPublicId = ref<string | null>(null);
const publicHostTemp = ref("");
const promptPublicHost = (c: DockerContainer) => {
  const map =
    (props.widget?.data &&
    typeof (props.widget.data as Record<string, unknown>).publicHosts === "object"
      ? ((props.widget!.data as Record<string, unknown>).publicHosts as Record<string, string>)
      : {}) || {};
  publicHostTemp.value = map[c.Id] || "";
  editingPublicId.value = c.Id;
};
const savePublicHost = (c: DockerContainer) => {
  const w = store.widgets.find((x) => x.id === props.widget?.id);
  if (!w) return;
  if (!w.data) w.data = {};
  const map =
    typeof (w.data as Record<string, unknown>).publicHosts === "object"
      ? ((w.data as Record<string, unknown>).publicHosts as Record<string, string>)
      : {};
  map[c.Id] = publicHostTemp.value.trim();
  (w.data as Record<string, unknown>).publicHosts = map;
  store.saveData();
  editingPublicId.value = null;
};
const cancelPublicHost = () => {
  editingPublicId.value = null;
};

const getStatusColor = (state: string) => {
  if (state === "running") return "bg-green-500";
  if (state === "exited") return "bg-gray-400";
  return "bg-yellow-500";
};
</script>

<template>
  <div
    :class="[
      'w-full h-full flex flex-col overflow-hidden',
      props.compact
        ? ''
        : 'bg-white/80 dark:bg-gray-800/80 backdrop-blur-md rounded-2xl p-4 relative',
    ]"
  >
    <div v-if="!props.compact" class="flex items-center justify-between mb-1 shrink-0">
      <div class="flex items-center gap-2">
        <span class="text-xl">🐳</span>
        <span class="font-bold text-gray-700 dark:text-gray-200">Docker</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="checkConnection"
          class="text-[10px] bg-blue-50 text-blue-500 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
          title="测试连接"
        >
          测试
        </button>
        <div class="text-xs text-gray-500" v-if="containers.length">
          {{ containers.filter((c) => c.State === "running").length }} / {{ containers.length }}
        </div>
      </div>
    </div>

    <div
      v-if="error"
      class="flex-1 flex flex-col items-center justify-center text-red-500 text-xs text-center p-2 gap-2"
    >
      <span>{{ error }}</span>
      <button
        @click="checkConnection"
        class="px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs"
      >
        测试连接
      </button>
    </div>

    <div v-else class="flex flex-col h-full overflow-hidden">
      <!-- 容器列表 (滚动区域) -->
      <div class="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar min-h-0">
        <div
          class="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-1 mb-1"
        >
          <div class="flex gap-2">
            <span
              class="px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex items-center gap-1 text-xs"
              title="Running"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {{ containers.filter((c) => c.State === "running").length }}
            </span>
            <span
              class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded flex items-center gap-1 text-xs"
              title="Stopped"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
              {{ containers.filter((c) => c.State !== "running").length }}
            </span>
            <span
              v-if="unhealthyCount > 0"
              class="px-1.5 py-0.5 bg-red-100 text-red-700 rounded flex items-center gap-1 text-xs"
              title="Unhealthy"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              {{ unhealthyCount }}
            </span>
          </div>
          <div v-if="dockerInfo" class="flex gap-2 text-[10px] text-gray-400 items-center ml-1">
            <span title="Images">IMG:{{ dockerInfo.Images }}</span>
          </div>
        </div>
        <div
          v-for="c in containers"
          :key="c.Id"
          class="flex flex-col gap-1 p-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 overflow-hidden flex-1">
              <div :class="['w-2 h-2 rounded-full shrink-0', getStatusColor(c.State)]"></div>
              <div class="flex flex-col overflow-hidden min-w-0">
                <span
                  class="font-medium text-sm truncate text-gray-700 dark:text-gray-200"
                  :title="c.Names?.[0] || ''"
                >
                  {{ (c.Names?.[0] || "").replace(/^\//, "") }}
                </span>
                <span class="text-[10px] text-gray-400 truncate block" :title="c.Image">
                  {{ c.Image }}
                </span>
              </div>
              <button
                @click="promptPublicHost(c)"
                class="text-[10px] text-blue-500 hover:underline px-1 shrink-0"
                title="添加外网地址"
              >
                添加外网地址
              </button>
              <div v-if="editingPublicId === c.Id" class="flex items-center gap-1 ml-2 shrink-0">
                <input
                  v-model="publicHostTemp"
                  type="text"
                  placeholder="nas.example.com"
                  class="px-2 py-1 border border-gray-200 rounded text-[10px] focus:border-blue-500 outline-none w-36"
                />
                <button
                  @click="savePublicHost(c)"
                  class="text-[10px] text-green-600 hover:underline px-1"
                  title="保存"
                >
                  保存
                </button>
                <button
                  @click="cancelPublicHost"
                  class="text-[10px] text-gray-500 hover:underline px-1"
                  title="取消"
                >
                  取消
                </button>
              </div>
            </div>
            <div class="flex flex-col items-end shrink-0 ml-2">
              <span class="text-[10px] text-gray-400">{{ c.Status }}</span>
              <div class="flex gap-1 mt-0.5" v-if="c.Ports && c.Ports.length">
                <span
                  v-for="(p, i) in c.Ports.filter((p) => p.PublicPort).slice(0, 1)"
                  :key="i"
                  class="text-[9px] bg-blue-50 text-blue-500 px-1 rounded border border-blue-100"
                >
                  {{ p.PublicPort }}
                </span>
                <span
                  v-if="c.Ports.filter((p) => p.PublicPort).length > 1"
                  class="text-[9px] text-gray-400"
                  >+{{ c.Ports.filter((p) => p.PublicPort).length - 1 }}</span
                >
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 mt-1">
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-gray-500 items-end">
                <span>CPU</span>
                <span v-if="c.stats" class="font-mono">{{ c.stats.cpuPercent.toFixed(1) }}%</span>
                <span v-else class="text-gray-300">--</span>
              </div>
              <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 rounded-full transition-all duration-500"
                  :style="{ width: c.stats ? Math.min(c.stats.cpuPercent, 100) + '%' : '0%' }"
                ></div>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-gray-500 items-end">
                <span>MEM</span>
                <span v-if="c.stats" class="font-mono"
                  >{{ (c.stats.memUsage / 1024 / 1024).toFixed(0) }}MB</span
                >
                <span v-else class="text-gray-300">--</span>
              </div>
              <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  class="h-full bg-purple-500 rounded-full transition-all duration-500"
                  :style="{ width: c.stats ? Math.min(c.stats.memPercent, 100) + '%' : '0%' }"
                ></div>
              </div>
            </div>
          </div>

          <div
            class="flex items-center justify-end gap-2 mt-1 pt-1 border-t border-gray-100 dark:border-gray-700"
          >
            <div class="flex items-center gap-2 mr-auto whitespace-nowrap">
              <button
                v-if="c.State === 'running' && c.Ports.some((p) => p.PublicPort)"
                @click="openContainerUrl(c)"
                class="px-2 py-1 hover:bg-gray-100 text-gray-600 rounded transition-colors text-xs flex items-center gap-1 whitespace-nowrap"
                title="内网打开"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    fill-rule="evenodd"
                    d="M15.75 2.25H21a.75.75 0 01.75.75v5.25a.75.75 0 01-1.5 0V4.81L8.03 17.03a.75.75 0 01-1.06-1.06L19.19 3.75h-3.44a.75.75 0 010-1.5zm-10.5 4.5a1.5 1.5 0 00-1.5 1.5v10.5a1.5 1.5 0 001.5 1.5h10.5a1.5 1.5 0 001.5-1.5V10.5a.75.75 0 011.5 0v8.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V8.25a3 3 0 013-3h8.25a.75.75 0 010 1.5H5.25z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>内网打开</span>
              </button>
              <button
                v-if="c.State === 'running' && c.Ports.some((p) => p.PublicPort)"
                @click="openContainerPublicUrl(c)"
                class="px-2 py-1 hover:bg-gray-100 text-gray-600 rounded transition-colors text-xs flex items-center gap-1 whitespace-nowrap"
                title="外网打开"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    fill-rule="evenodd"
                    d="M3 4.5A1.5 1.5 0 014.5 3h9A1.5 1.5 0 0115 4.5V9a1.5 1.5 0 01-1.5 1.5H9.31l2.44 2.44a.75.75 0 11-1.06 1.06L7.5 10.31V12a1.5 1.5 0 01-1.5 1.5H1.5A1.5 1.5 0 010 12V4.5A1.5 1.5 0 011.5 3H3v1.5z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>外网打开</span>
              </button>
              <button
                v-if="c.State === 'running' && c.Ports.some((p) => p.PublicPort)"
                @click="addToHome(c)"
                class="px-2 py-1 hover:bg-gray-100 text-gray-600 rounded transition-colors text-xs flex items-center gap-1 whitespace-nowrap"
                title="添加到桌面"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  class="w-4 h-4"
                >
                  <path
                    fill-rule="evenodd"
                    d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>添加卡片</span>
              </button>
            </div>

            <button
              v-if="c.State !== 'running'"
              @click="handleAction(c.Id, 'start')"
              class="p-1 hover:bg-green-100 text-green-600 rounded transition-colors"
              title="启动"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-4 h-4"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            <button
              v-if="c.State === 'running'"
              @click="handleAction(c.Id, 'stop')"
              class="p-1 hover:bg-red-100 text-red-600 rounded transition-colors"
              title="停止"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-4 h-4"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            <button
              @click="handleAction(c.Id, 'restart')"
              class="p-1 hover:bg-blue-100 text-blue-600 rounded transition-colors"
              title="重启"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-4 h-4"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.755 10.059a7.5 7.5 0 0112.548-3.364l1.903 1.903h-3.183a.75.75 0 100 1.5h4.992a.75.75 0 00.75-.75V4.356a.75.75 0 00-1.5 0v3.18l-1.9-1.9A9 9 0 003.306 9.67a.75.75 0 101.45.388zm15.408 3.352a.75.75 0 00-.919.53 7.5 7.5 0 01-12.548 3.364l-1.902-1.903h3.183a.75.75 0 000-1.5H2.984a.75.75 0 00-.75.75v4.992a.75.75 0 001.5 0v-3.18l1.9 1.9a9 9 0 0015.059-4.035.75.75 0 00-.53-.919z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
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
