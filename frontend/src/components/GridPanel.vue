<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  computed,
  watch,
  nextTick,
  toRef,
  defineAsyncComponent,
} from "vue";
import { VueDraggable } from "vue-draggable-plus";
import { GridLayout, GridItem } from "grid-layout-plus";
import { useStorage, useWindowSize, useIntervalFn } from "@vueuse/core";
import { useMainStore } from "../stores/main";
import { useWallpaperRotation } from "../composables/useWallpaperRotation";
import { useDevice } from "../composables/useDevice";
import { generateLayout, type GridLayoutItem } from "../utils/gridLayout";
import type { NavItem, WidgetConfig, NavGroup } from "@/types";
import { isInternalNetwork, getNetworkConfig } from "@/utils/network";
import DOMPurify from "dompurify";
const EditModal = defineAsyncComponent(() => import("./EditModal.vue"));
const SettingsModal = defineAsyncComponent(() => import("./SettingsModal.vue"));
const GroupSettingsModal = defineAsyncComponent(() => import("./GroupSettingsModal.vue"));
const LoginModal = defineAsyncComponent(() => import("./LoginModal.vue"));
const BookmarkWidget = defineAsyncComponent(() => import("./BookmarkWidget.vue"));
const MemoWidget = defineAsyncComponent(() => import("./MemoWidget.vue"));
const TodoWidget = defineAsyncComponent(() => import("./TodoWidget.vue"));
const CalculatorWidget = defineAsyncComponent(() => import("./CalculatorWidget.vue"));
const MusicWidget = defineAsyncComponent(() => import("./MusicWidget.vue"));
const MiniPlayer = defineAsyncComponent(() => import("./MiniPlayer.vue"));
const HotWidget = defineAsyncComponent(() => import("./HotWidget.vue"));
const ClockWeatherWidget = defineAsyncComponent(() => import("./ClockWeatherWidget.vue"));
const RssWidget = defineAsyncComponent(() => import("./RssWidget.vue"));
const IconShape = defineAsyncComponent(() => import("./IconShape.vue"));
const IframeWidget = defineAsyncComponent(() => import("./IframeWidget.vue"));
const SimpleWeatherWidget = defineAsyncComponent(() => import("./SimpleWeatherWidget.vue"));
const CalendarWidget = defineAsyncComponent(() => import("./CalendarWidget.vue"));
const ClockWidget = defineAsyncComponent(() => import("./ClockWidget.vue"));
const AppSidebar = defineAsyncComponent(() => import("./AppSidebar.vue"));
const CountdownWidget = defineAsyncComponent(() => import("./CountdownWidget.vue"));
const CountUpWidget = defineAsyncComponent(() => import("./CountUpWidget.vue"));
const DockerWidget = defineAsyncComponent(() => import("./DockerWidget.vue"));
const SystemStatusWidget = defineAsyncComponent(() => import("./SystemStatusWidget.vue"));
const CustomCssWidget = defineAsyncComponent(() => import("./CustomCssWidget.vue"));
const AmapWeatherWidget = defineAsyncComponent(() => import("./AmapWeatherWidget.vue"));
const FileTransferWidget = defineAsyncComponent(() => import("./FileTransferWidget.vue"));
const SizeSelector = defineAsyncComponent(() => import("./SizeSelector.vue"));

const store = useMainStore();
useWallpaperRotation();
const { deviceKey, isMobile } = useDevice(toRef(store.appConfig, "deviceMode"));
const { width, height } = useWindowSize();
const isHeaderRowLayout = computed(() => width.value >= 1280);
const gridWidgetTypes = new Set([
  "clock",
  "weather",
  "calendar",
  "memo",
  "todo",
  "music",
  "calculator",
  "ip",
  "div-card",
  "countdown",
  "countup",
  "iframe",
  "bookmarks",
  "hot",
  "clockweather",
  "amap-weather",
  "rss",
  "docker",
  "system-status",
  "custom-css",
  "file-transfer",
]);

const currentHour = ref(new Date().getHours());
let daylightTimer: ReturnType<typeof setInterval> | null = null;
const updateHour = () => {
  currentHour.value = new Date().getHours();
};
const isNightTime = computed(() => currentHour.value >= 18 || currentHour.value < 6);
const effectiveBackgroundMask = computed(() => {
  const base = store.appConfig.backgroundMask ?? 0;
  const daylightMask = store.appConfig.daylightMask ?? 0.5;
  if (store.appConfig.daylightModeEnabled && isNightTime.value) return daylightMask;
  return base;
});
const effectiveMobileBackgroundMask = computed(() => {
  const base = store.appConfig.mobileBackgroundMask ?? 0;
  const daylightMask = store.appConfig.daylightMask ?? 0.5;
  if (store.appConfig.daylightModeEnabled && isNightTime.value) return daylightMask;
  return base;
});

const weatherText = ref("");
const weatherLoading = ref(false);
const weatherEffectEnabled = computed(() => !!store.appConfig.weatherEffectEnabled);
const isRainWeather = computed(() => /雨|雷/.test(weatherText.value || ""));
const isFogWeather = computed(() => /雾|霾/.test(weatherText.value || ""));
const showFogEffect = computed(() => weatherEffectEnabled.value && isFogWeather.value);
const showRainEffect = computed(() => weatherEffectEnabled.value && isRainWeather.value);

const getWeatherCity = () => {
  try {
    const cached = localStorage.getItem("flatnas_auto_city");
    if (cached) {
      const data = JSON.parse(cached);
      if (data?.city) return data.city;
    }
  } catch {
    return "Shanghai";
  }
  return "Shanghai";
};

const buildWeatherUrl = (city: string) => {
  if (store.appConfig.weatherApiUrl) {
    let url = store.appConfig.weatherApiUrl;
    if (url.includes("{city}")) {
      url = url.replace("{city}", encodeURIComponent(city));
    }
    return url;
  }
  const source = store.appConfig.weatherSource || "uapi";
  const key = store.appConfig.amapKey || "";
  const projectId = store.appConfig.qweatherProjectId || "";
  const keyId = store.appConfig.qweatherKeyId || "";
  const privateKey = store.appConfig.qweatherPrivateKey || "";
  let url = `/api/weather?city=${encodeURIComponent(city)}&source=${source}&key=${encodeURIComponent(key)}`;
  if (source === "qweather") {
    url += `&projectId=${encodeURIComponent(projectId)}&keyId=${encodeURIComponent(keyId)}&privateKey=${encodeURIComponent(privateKey)}`;
  }
  return url;
};

const fetchWeatherForEffect = async () => {
  if (!weatherEffectEnabled.value || weatherLoading.value) return;
  weatherLoading.value = true;
  const city = getWeatherCity();
  try {
    const res = await fetch(buildWeatherUrl(city));
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    if (data?.data?.text) {
      weatherText.value = data.data.text;
    } else if (data?.text) {
      weatherText.value = data.text;
    } else if (data?.weather) {
      weatherText.value = data.weather;
    } else {
      weatherText.value = "";
    }
  } catch {
    weatherText.value = "";
  } finally {
    weatherLoading.value = false;
  }
};

type RainRenderer = { stop: () => void; resize: () => void };
const rainCanvasRef = ref<HTMLCanvasElement | null>(null);
const rainRenderer = ref<RainRenderer | null>(null);

const createRainRenderer = (canvas: HTMLCanvasElement): RainRenderer | null => {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
  if (!gl) return null;

  const vertexSource = `
    attribute vec3 a_position;
    uniform float u_time;
    uniform float u_speed;
    varying float v_alpha;
    void main() {
      float z = a_position.z;
      float speed = mix(0.4, 1.2, z) * u_speed;
      float y = fract(a_position.y - u_time * speed);
      float x = a_position.x * 2.0 - 1.0;
      float py = y * 2.0 - 1.0;
      float depth = mix(0.6, 1.0, z);
      gl_Position = vec4(x * depth, py * depth, 0.0, 1.0);
      gl_PointSize = mix(1.0, 4.0, z);
      v_alpha = mix(0.2, 0.8, z);
    }
  `;

  const fragmentSource = `
    precision mediump float;
    varying float v_alpha;
    void main() {
      vec2 uv = gl_PointCoord;
      float body = smoothstep(0.0, 0.25, uv.y) * (1.0 - smoothstep(0.75, 1.0, uv.y));
      float width = smoothstep(0.5, 0.0, abs(uv.x - 0.5));
      float alpha = body * width * v_alpha;
      gl_FragColor = vec4(0.7, 0.85, 1.0, alpha);
    }
  `;

  const compileShader = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const positionLoc = gl.getAttribLocation(program, "a_position");
  const timeLoc = gl.getUniformLocation(program, "u_time");
  const speedLoc = gl.getUniformLocation(program, "u_speed");

  const count = 1200;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.random();
    positions[i * 3 + 1] = Math.random();
    positions[i * 3 + 2] = Math.random();
  }

  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let running = true;
  let frame = 0;
  const start = performance.now();

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const render = (now: number) => {
    if (!running) return;
    const t = (now - start) / 1000;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    if (timeLoc) gl.uniform1f(timeLoc, t);
    if (speedLoc) gl.uniform1f(speedLoc, 0.6);
    gl.drawArrays(gl.POINTS, 0, count);
    frame = requestAnimationFrame(render);
  };

  resize();
  frame = requestAnimationFrame(render);

  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  return { stop, resize };
};

const initRain = async () => {
  if (!showRainEffect.value || rainRenderer.value) return;
  await nextTick();
  const canvas = rainCanvasRef.value;
  if (!canvas) return;
  const renderer = createRainRenderer(canvas);
  if (!renderer) return;
  rainRenderer.value = renderer;
  renderer.resize();
};

const stopRain = () => {
  rainRenderer.value?.stop();
  rainRenderer.value = null;
};

let weatherTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => weatherEffectEnabled.value,
  (enabled) => {
    if (enabled) {
      fetchWeatherForEffect();
      if (weatherTimer) clearInterval(weatherTimer);
      weatherTimer = setInterval(fetchWeatherForEffect, 60 * 60 * 1000);
    } else {
      if (weatherTimer) clearInterval(weatherTimer);
      weatherTimer = null;
      weatherText.value = "";
      stopRain();
    }
  },
  { immediate: true },
);

watch(
  () => [
    store.appConfig.weatherSource,
    store.appConfig.weatherApiUrl,
    store.appConfig.amapKey,
    store.appConfig.qweatherProjectId,
    store.appConfig.qweatherKeyId,
    store.appConfig.qweatherPrivateKey,
  ],
  () => {
    if (weatherEffectEnabled.value) fetchWeatherForEffect();
  },
);

watch([showRainEffect, () => rainCanvasRef.value], ([show]) => {
  if (show) {
    initRain();
  } else {
    stopRain();
  }
});

watch([width, height], () => {
  rainRenderer.value?.resize();
});

const empireBackgroundUrl = `data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4af37' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E`;

const showEditModal = ref(false);
const showSettingsModal = ref(false);
const showGroupSettingsModal = ref(false);

const showLoginModal = ref(false);
const isEditMode = ref(false);
const activeResizeWidgetId = ref<string | null>(null);
const currentEditItem = ref<NavItem | null>(null);
const currentGroupId = ref<string>("");
const activePaginationGroupId = computed<string>({
  get: () => store.webPaginationActiveGroupId || "",
  set: (val) => {
    store.webPaginationActiveGroupId = val;
  },
});
const isWebPaginationMode = computed(() => store.appConfig.webGroupPagination && !isMobile.value);
const mainContainerRef = ref<HTMLElement | null>(null);

watch(
  [() => store.groups, isWebPaginationMode],
  ([groups, mode]) => {
    if (mode && groups.length > 0) {
      if (
        !activePaginationGroupId.value ||
        !groups.find((g) => g.id === activePaginationGroupId.value)
      ) {
        const first = groups[0];
        if (first) {
          activePaginationGroupId.value = first.id;
        }
      }
    }
  },
  { immediate: true, deep: true },
);

watch(showGroupSettingsModal, (val) => {
  isEditMode.value = val;
});
const isLanMode = ref(false);
const latency = ref(0);
const isChecking = ref(false);
const networkScope = typeof window !== "undefined" ? window.location.hostname : "default";
const networkConfig = computed(() => getNetworkConfig(store.appConfig));
const forceMode = computed({
  get: () => networkConfig.value.forceNetworkMode,
  set: (val) => {
    store.appConfig.forceNetworkMode = val;
    store.saveData();
  },
});
const latencyThresholdMs = computed(() => networkConfig.value.latencyThresholdMs);

const effectiveIsLan = computed(() => {
  if (!store.isLanModeInited) return false;
  if (forceMode.value === "lan") return true;
  if (forceMode.value === "wan") return false;
  if (forceMode.value === "latency") {
    if (latency.value > 0) return latency.value < latencyThresholdMs.value;
    return false;
  }
  return isLanMode.value;
});

const sidebarCollapsed = ref(true);
const isSidebarEnabled = computed(() => {
  const w = store.widgets.find((w) => w.type === "sidebar" && w.enable);
  return checkVisible(w) && !(isMobile.value && w?.hideOnMobile);
});

const toggleForceMode = () => {
  if (forceMode.value === "auto") forceMode.value = "lan";
  else if (forceMode.value === "lan") forceMode.value = "wan";
  else if (forceMode.value === "wan") forceMode.value = "latency";
  else forceMode.value = "auto";
};

const searchEngineStored = useStorage("flat-nas-engine", "google");
const engines = computed(
  () =>
    store.appConfig.searchEngines || [
      {
        id: "google",
        key: "google",
        label: "Google",
        urlTemplate: "https://www.google.com/search?q={q}",
      },
      { id: "bing", key: "bing", label: "Bing", urlTemplate: "https://cn.bing.com/search?q={q}" },
      { id: "baidu", key: "baidu", label: "百度", urlTemplate: "https://www.baidu.com/s?wd={q}" },
    ],
);
const sessionEngine = ref<string | null>(null);
const effectiveEngine = computed({
  get: () =>
    sessionEngine.value ||
    (store.appConfig.rememberLastEngine
      ? searchEngineStored.value
      : store.appConfig.defaultSearchEngine || engines.value[0]?.key || "google"),
  set: (val: string) => {
    sessionEngine.value = val;
    if (store.appConfig.rememberLastEngine) {
      searchEngineStored.value = val;
    }
  },
});
const searchText = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);

const hexToRgb = (hex: string) => {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const rgbaFromHex = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
};

const searchWidget = computed(() => {
  const enabled = store.widgets.find((w) => w.type === "search" && w.enable !== false);
  if (enabled) return enabled as WidgetConfig;
  const any = store.widgets.find((w) => w.type === "search");
  return any as WidgetConfig | undefined;
});
const searchTextColor = computed(() => searchWidget.value?.textColor || "#111827");
const searchBgAlpha = computed(() => {
  const raw = searchWidget.value?.opacity;
  if (typeof raw !== "number") return 0.9;
  return Math.max(0.1, Math.min(1, raw));
});
const searchPlaceholderColor = computed(
  () => rgbaFromHex(searchTextColor.value, 0.55) || "rgba(107, 114, 128, 1)",
);

watch(
  () => store.appConfig.defaultSearchEngine,
  (newVal) => {
    if (newVal) {
      // 当默认搜索引擎改变时，重置会话选择
      sessionEngine.value = null;
      // 如果开启了"记住上次选择"，则同步更新存储的值
      if (store.appConfig.rememberLastEngine) {
        searchEngineStored.value = newVal;
      }
    }
  },
);

// --- 核心修复逻辑开始 ---
// 用于清洗 SVG 代码中的无效颜色类名，强制转为白色
const processIcon = (iconStr: string) => {
  if (!iconStr) return "";
  if (!iconStr.trim().startsWith("<svg")) return iconStr;
  let fixed = iconStr;
  const badColorRegex = /fill-[a-z]+-(50|100|200)/g;
  if (badColorRegex.test(fixed)) {
    fixed = fixed.replace(
      /class="([^"]*)\bfill-[a-z]+-(50|100|200)\b([^"]*)"/g,
      'class="$1 $3" style="fill: #ffffff;"',
    );
  }
  return fixed;
};
// --- 核心修复逻辑结束 ---

// --- Wallpaper Preload Logic ---
const isPcBgLoaded = ref(false);
const isMobileBgLoaded = ref(false);

const pcBgUrl = computed(() =>
  store.appConfig.background ? store.getAssetUrl(store.appConfig.background) : "",
);
const mobileBgUrl = computed(() =>
  store.appConfig.mobileBackground ? store.getAssetUrl(store.appConfig.mobileBackground) : "",
);

watch(
  pcBgUrl,
  (url) => {
    if (!url) {
      isPcBgLoaded.value = false;
      return;
    }
    const img = new Image();
    img.src = url;
    if (img.complete) {
      isPcBgLoaded.value = true;
    } else {
      isPcBgLoaded.value = false;
      img.onload = () => {
        isPcBgLoaded.value = true;
      };
      img.onerror = () => {
        isPcBgLoaded.value = true;
      };
    }
  },
  { immediate: true },
);

watch(
  mobileBgUrl,
  (url) => {
    if (!url) {
      isMobileBgLoaded.value = false;
      return;
    }
    const img = new Image();
    img.src = url;
    if (img.complete) {
      isMobileBgLoaded.value = true;
    } else {
      isMobileBgLoaded.value = false;
      img.onload = () => {
        isMobileBgLoaded.value = true;
      };
      img.onerror = () => {
        isMobileBgLoaded.value = true;
      };
    }
  },
  { immediate: true },
);
// ------------------------------

/*
const draggableWidgets = computed({
  get: () =>
    store.widgets.filter(
      (w) =>
        checkVisible(w) &&
        w.type !== "player" &&
        w.type !== "search" &&
        w.type !== "quote" &&
        w.type !== "sidebar",
    ),
  set: (newOrder: WidgetConfig[]) => {
    const hiddenWidgets = store.widgets.filter(
      (w) =>
        !checkVisible(w) ||
        w.type === "player" ||
        w.type === "search" ||
        w.type === "quote" ||
        w.type === "sidebar",
    );
    store.widgets = [...newOrder, ...hiddenWidgets];
    store.saveData();
  },
});
*/

const layoutData = ref<GridLayoutItem[]>([]);
let skipNextLayoutSave = false;
let isInternalUpdate = false;
const isHandheld = computed(() => deviceKey.value === "mobile" || deviceKey.value === "tablet");
const checkVisible = (obj?: WidgetConfig | NavItem) => {
  if (!obj) return false;
  if ("enable" in obj && !obj.enable) return false;
  if ("hideOnMobile" in obj && obj.hideOnMobile && isMobile.value) return false;
  if (store.isLogged) return true;
  return !!obj.isPublic;
};
const isGridWidget = (widget: WidgetConfig) => gridWidgetTypes.has(widget.type);
const isTabletPortrait = computed(() => deviceKey.value === "tablet" && height.value > width.value);
const desktopWidgetAreaCols = computed(() => {
  const raw = store.appConfig.widgetAreaCols ?? store.appConfig.widgetAreaSize;
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 4;
  const clamped = Math.min(16, Math.max(0.5, n));
  if (store.isExpandedMode) return Math.min(16, Math.max(8, clamped));
  return clamped;
});
const isWideLayout = computed(
  () => deviceKey.value === "desktop" && desktopWidgetAreaCols.value > 4,
);
const mainContentMaxWidth = computed(() => {
  if (deviceKey.value !== "desktop") return undefined;
  const base = 1280;
  const maxAllowed = Math.round(width.value * 0.89);
  if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) return `${base}px`;

  if (desktopWidgetAreaCols.value <= 4) {
    return `${Math.min(base, maxAllowed)}px`;
  }

  const baseColWidth = base / 4;
  const required = Math.round(baseColWidth * desktopWidgetAreaCols.value);
  const target = Math.min(required, maxAllowed);
  return `${Math.max(0, target)}px`;
});
const widgetColNum = computed(() => {
  if (deviceKey.value === "mobile") return 1;
  if (deviceKey.value === "tablet") return isTabletPortrait.value ? 2 : 4;
  return desktopWidgetAreaCols.value;
});
const rowHeight = computed(() =>
  deviceKey.value === "mobile" ? 120 : deviceKey.value === "tablet" ? 130 : 140,
);
const gridScale = 2;
const gridMargin = computed<[number, number]>(() => (isMobile.value ? [12, 12] : [24, 24]));
const scaledRowHeight = computed(() =>
  Math.max(1, (rowHeight.value - gridMargin.value[1]) / gridScale),
);
const scaleGridValue = (value: number) => Math.round(value * gridScale);
const unscaleGridValue = (value: number) => Math.round(value) / gridScale;
const scaledLayoutData = computed<GridLayoutItem[]>({
  get: () =>
    layoutData.value.map((item) => ({
      ...item,
      x: scaleGridValue(item.x),
      y: scaleGridValue(item.y),
      w: scaleGridValue(item.w),
      h: scaleGridValue(item.h),
    })),
  set: (next) => {
    const current = new Map(layoutData.value.map((item) => [item.i, item]));
    layoutData.value = next.map((item) => {
      const base = current.get(item.i);
      const x = unscaleGridValue(item.x);
      const y = unscaleGridValue(item.y);
      const w = unscaleGridValue(item.w);
      const h = unscaleGridValue(item.h);
      if (base) {
        return { ...base, x, y, w, h, colSpan: w, rowSpan: h };
      }
      return { ...item, x, y, w, h };
    });
  },
});

const compactVertical = (layout: GridLayoutItem[]) => {
  const step = 1 / gridScale;
  const collides = (a: GridLayoutItem, b: GridLayoutItem) =>
    a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const canPlace = (item: GridLayoutItem, placed: GridLayoutItem[]) =>
    !placed.some((p) => collides(item, p));

  const sorted = [...layout].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const placed: GridLayoutItem[] = [];
  const compacted: GridLayoutItem[] = [];

  for (const item of sorted) {
    const originalY = Math.max(0, item.y || 0);
    let next = { ...item, y: originalY };

    // 1. Try to move UP to fill gaps (vertical compaction)
    let found = false;
    // 使用 step 步进检查，确保能填充 0.5 高度的空隙
    for (let y = 0; y < originalY; y += step) {
      const candidate = { ...next, y };
      if (canPlace(candidate, placed)) {
        next = candidate;
        found = true;
        break;
      }
    }

    // 2. If not moved up, check if originalY is valid. If not, push DOWN.
    if (!found) {
      let y = originalY;
      while (true) {
        const candidate = { ...next, y };
        if (canPlace(candidate, placed)) {
          next = candidate;
          break;
        }
        y += step;
        if (y > 10000) break; // Safety break
      }
    }

    placed.push(next);
    compacted.push(next);
  }

  const byId = new Map(compacted.map((it) => [it.i, it] as const));
  return layout.map((it) => byId.get(it.i) || it);
};

watch(
  () => [store.widgets, widgetColNum.value, deviceKey.value],
  () => {
    if (isInternalUpdate) return;

    // 防止编辑时因服务端推送导致的布局回弹 (Rebound)
    // 处于编辑模式(活跃)时，忽略外部更新，以本地拖拽状态为准
    if (isEditMode.value) return;

    const visibleWidgets = store.widgets
      .filter(
        (w) =>
          checkVisible(w) &&
          isGridWidget(w) &&
          !(deviceKey.value === "mobile" && w.hideOnMobile),
      )
      .sort((a, b) => {
        // Sort by visual position (Row-major) to ensure correct reflow order
        const ay = a.y ?? 0;
        const by = b.y ?? 0;
        if (ay !== by) return ay - by;
        return (a.x ?? 0) - (b.x ?? 0);
      });

    const colNum = widgetColNum.value;

    const widgetsToLayout = visibleWidgets.map((w) => {
      const newW: WidgetConfig = { ...w };
      const layouts = newW.layouts;
      const key = deviceKey.value as "desktop" | "tablet" | "mobile";
      const spec = layouts ? layouts[key] : undefined;
      if (spec) {
        newW.x = spec.x;
        newW.y = spec.y;
        newW.w = spec.w;
        newW.h = spec.h;
        newW.colSpan = spec.w;
        newW.rowSpan = spec.h;
      } else if (deviceKey.value === "mobile") {
        // If no mobile layout exists, reset position to force auto-layout in reading order
        newW.x = undefined;
        newW.y = undefined;
      }

      if (deviceKey.value === "mobile") {
        if ((newW.w || 1) > colNum) newW.w = colNum;
        if (
          [
            "clockweather",
            "calendar",
            "rss",
            "iframe",
            "todo",
            "memo",
            "bookmarks",
            "hot",
          ].includes(newW.type)
        ) {
          newW.w = colNum;
        }
      }
      if (deviceKey.value === "tablet" && isTabletPortrait.value) {
        if ((newW.w || 1) > colNum) newW.w = colNum;
      }
      return newW;
    });

    // 标记为程序化布局更新，避免触发保存循环
    skipNextLayoutSave = true;
    layoutData.value = compactVertical(generateLayout(widgetsToLayout, colNum));
  },
  { deep: true, immediate: true },
);

const handleLayoutUpdated = (newLayout: GridLayoutItem[]) => {
  // 如果是程序化更新导致的事件，跳过保存
  if (skipNextLayoutSave) {
    skipNextLayoutSave = false;
    return;
  }

  const key = deviceKey.value as "desktop" | "tablet" | "mobile";

  // 如果布局与当前 store.widgets 相同，跳过保存
  let changed = false;
  for (const l of newLayout) {
    const w = store.widgets.find((sw) => sw.id === l.i);
    const spec = w?.layouts?.[key];
    const curX = spec?.x ?? w?.x;
    const curY = spec?.y ?? w?.y;
    const curW = spec?.w ?? w?.w ?? w?.colSpan ?? 1;
    const curH = spec?.h ?? w?.h ?? w?.rowSpan ?? 1;
    if (!w || curX !== l.x || curY !== l.y || curW !== l.w || curH !== l.h) {
      changed = true;
      break;
    }
  }
  if (!changed) return;

  isInternalUpdate = true;

  newLayout.forEach((l) => {
    const w = store.widgets.find((sw) => sw.id === l.i);
    if (w) {
      const layouts = w.layouts || {};
      const spec: { x: number; y: number; w: number; h: number } = {
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      };
      layouts[key] = spec;
      w.layouts = layouts;

      if (key === "desktop") {
        w.x = l.x;
        w.y = l.y;
        w.w = l.w;
        w.h = l.h;
        w.colSpan = l.w;
        w.rowSpan = l.h;
      }
    }
  });
  store.saveData();
  nextTick(() => {
    isInternalUpdate = false;
  });
};

const displayGroups = computed(() => {
  // ✨ 性能优化：在编辑模式且无搜索时，直接返回 store.groups 引用
  // 这样 VueDraggable 就能直接操作 store 中的数组，确保拖拽状态实时同步
  if (isEditMode.value && !searchText.value) {
    return store.groups;
  }

  return store.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const isMatch =
          !searchText.value ||
          item.title.toLowerCase().includes(searchText.value.toLowerCase()) ||
          item.url.toLowerCase().includes(searchText.value.toLowerCase());
        const isVisible = checkVisible(item);
        return isMatch && isVisible;
      }),
    }))
    .filter((g) => {
      if (store.isLogged) return true;
      return g.items.length > 0 || !!g.preset;
    });
});

const paginationWheelLockUntil = ref(0);
const getScrollElement = () => {
  if (typeof document === "undefined") return null;
  return (document.scrollingElement ||
    document.documentElement ||
    document.body) as HTMLElement | null;
};
const movePaginationGroup = (step: number) => {
  const groups = displayGroups.value;
  if (groups.length === 0) return;
  const ids = groups.map((g) => g.id);
  let idx = ids.indexOf(activePaginationGroupId.value);
  if (idx < 0) idx = 0;
  const nextId = ids[(idx + step + ids.length) % ids.length];
  if (nextId) activePaginationGroupId.value = nextId;
};
const handleWebPaginationWheel = (e: WheelEvent) => {
  if (!isWebPaginationMode.value) return;
  if (isEditMode.value) return;
  if (
    showEditModal.value ||
    showSettingsModal.value ||
    showGroupSettingsModal.value ||
    showLoginModal.value
  )
    return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (!e.deltaY) return;

  const now = Date.now();
  if (now < paginationWheelLockUntil.value) return;

  const scrollEl = getScrollElement();
  if (!scrollEl) return;

  const canScroll = scrollEl.scrollHeight - scrollEl.clientHeight > 2;
  const atTop = scrollEl.scrollTop <= 0;
  const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
  const shouldPaginate = !canScroll || (e.deltaY < 0 ? atTop : atBottom);
  if (!shouldPaginate) return;

  e.preventDefault();
  e.stopPropagation();

  paginationWheelLockUntil.value = now + 320;
  if (store.appConfig.webGroupPaginationDisableFlip) return;
  movePaginationGroup(e.deltaY > 0 ? 1 : -1);
};

watch(
  [activePaginationGroupId, isWebPaginationMode],
  ([, mode]) => {
    if (!mode) return;
    nextTick(() => {
      const el = getScrollElement();
      el?.scrollTo({ top: 0 });
    });
  },
  { flush: "post" },
);

const sanitizedFooterHtml = computed(() => {
  return DOMPurify.sanitize(store.appConfig.footerHtml || "");
});

onMounted(() => {
  mainContainerRef.value?.addEventListener("wheel", handleWebPaginationWheel, { passive: false });
});

onUnmounted(() => {
  mainContainerRef.value?.removeEventListener("wheel", handleWebPaginationWheel);
});

const cycleWidgetSize = (widget: WidgetConfig) => {
  // 统一为所有组件启用 4x4 尺寸选择器
  activeResizeWidgetId.value = activeResizeWidgetId.value === widget.id ? null : widget.id;
};

let widgetHandlePointerId: number | null = null;
let widgetHandleStartX = 0;
let widgetHandleStartY = 0;
const suppressNextWidgetHandleClick = ref(false);

const onWidgetHandlePointerDown = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  widgetHandlePointerId = e.pointerId;
  widgetHandleStartX = e.clientX;
  widgetHandleStartY = e.clientY;
  suppressNextWidgetHandleClick.value = false;
};

const onWidgetHandlePointerMove = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  if (widgetHandlePointerId === null || e.pointerId !== widgetHandlePointerId) return;
  const dx = e.clientX - widgetHandleStartX;
  const dy = e.clientY - widgetHandleStartY;
  if (dx * dx + dy * dy > 64) suppressNextWidgetHandleClick.value = true;
};

const onWidgetHandlePointerUp = (e: PointerEvent) => {
  if (!isHandheld.value) return;
  if (widgetHandlePointerId === null || e.pointerId !== widgetHandlePointerId) return;
  widgetHandlePointerId = null;
};

const onWidgetHandleClick = (widget: WidgetConfig) => {
  if (isHandheld.value && suppressNextWidgetHandleClick.value) {
    suppressNextWidgetHandleClick.value = false;
    return;
  }
  cycleWidgetSize(widget);
};

const handleSizeSelect = (widget: GridLayoutItem, size: { colSpan: number; rowSpan: number }) => {
  const maxCols = deviceKey.value === "mobile" ? 2 : Math.min(4, widgetColNum.value);
  const maxRows = 4;
  const min = 0.5;
  const normalize = (value: number) => Math.round(value * 2) / 2;
  const nextW = Math.min(Math.max(normalize(size.colSpan), min), maxCols);
  const nextH = Math.min(Math.max(normalize(size.rowSpan), min), maxRows);

  widget.w = nextW;
  widget.h = nextH;
  widget.colSpan = nextW;
  widget.rowSpan = nextH;

  // Manually trigger layout compaction to resolve collisions
  const newLayout = compactVertical(layoutData.value);
  layoutData.value = newLayout;

  // Sync back to store (all widgets, not just the resized one)
  handleLayoutUpdated(newLayout);

  activeResizeWidgetId.value = null;
};

const handleScaledLayoutUpdated = (newLayout: GridLayoutItem[]) => {
  const unscaled = newLayout.map((item) => ({
    ...item,
    x: unscaleGridValue(item.x),
    y: unscaleGridValue(item.y),
    w: unscaleGridValue(item.w),
    h: unscaleGridValue(item.h),
  }));

  // Enforce custom compaction logic (0.5 unit support)
  // This ensures the layout is consistent with what will be loaded after refresh
  const compacted = compactVertical(unscaled);

  // 仅当压实后位置与当前 layoutData 不同时才更新（防止递归触发）
  const isLayoutChanged =
    layoutData.value.length !== compacted.length ||
    layoutData.value.some((item) => {
      const match = compacted.find((c) => c.i === item.i);
      if (!match) return true;
      return (
        match.x !== item.x ||
        match.y !== item.y ||
        match.w !== item.w ||
        match.h !== item.h
      );
    });

  if (isLayoutChanged) {
    layoutData.value = compacted;
  }

  // 始终同步到 store.widgets —— handleLayoutUpdated 内部有 store.widgets 对比守卫，不会无限循环
  handleLayoutUpdated(compacted);
};

const isEmpireCloudWidget = (type: string) => {
  return ["bookmarks", "countdown", "rss", "todo", "calendar", "hot"].includes(type);
};

const devtoolsClickCount = ref(0);
const devtoolsClickTimer = ref<number | null>(null);

const closeResizeSelector = () => {
  activeResizeWidgetId.value = null;
};

onMounted(() => {
  document.addEventListener("click", closeResizeSelector);
});

onUnmounted(() => {
  document.removeEventListener("click", closeResizeSelector);
});

const toggleDevTools = () => {
  const style = document.getElementById("devtools-hider");
  if (style) {
    style.remove();
  } else {
    const newStyle = document.createElement("style");
    newStyle.id = "devtools-hider";
    newStyle.innerHTML = `
      #vue-devtools-anchor,
      .vue-devtools__anchor,
      .vue-devtools__trigger,
      [data-v-inspector-toggle] {
        display: none !important;
      }
    `;
    document.head.appendChild(newStyle);
  }
};

const handleNetworkClick = async () => {
  checkLatency();

  const now = Date.now();
  if (!devtoolsClickTimer.value) {
    devtoolsClickTimer.value = now;
    devtoolsClickCount.value = 1;
  } else {
    if (now - devtoolsClickTimer.value > 5000) {
      devtoolsClickTimer.value = now;
      devtoolsClickCount.value = 1;
    } else {
      devtoolsClickCount.value++;
    }
  }

  if (devtoolsClickCount.value >= 10) {
    toggleDevTools();
    devtoolsClickCount.value = 0;
    devtoolsClickTimer.value = null;
  }
};

const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 500) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
};

const checkLatency = async () => {
  try {
    if (isChecking.value) return;
    isChecking.value = true;
    const samples: number[] = [];
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(
          `/api/rtt?ts=${Date.now()}`,
          { method: "GET", cache: "no-store" },
          500,
        );
        await res.json().catch(() => null);
        samples.push(Math.round(performance.now() - start));
      } catch {
        if (forceMode.value === "latency") {
          forceMode.value = "auto";
        }
      }
      if (i === 0) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    latency.value = samples.length > 0 ? Math.min(...samples) : 0;
  } finally {
    isChecking.value = false;
  }
};

watch(forceMode, (val) => {
  if (val === "latency") {
    checkLatency();
  }
});
watch(latencyThresholdMs, () => {
  if (forceMode.value === "latency") {
    checkLatency();
  }
});

onMounted(() => {
  isLanMode.value = isInternalNetwork(
    window.location.hostname,
    networkConfig.value.internalDomains,
  );
  setTimeout(() => checkLatency(), 2000);
  fetchIp(true);
  // Poll IP every 1 hour
  ipInterval = window.setInterval(() => fetchIp(), 3600000);

  store.init().then(() => {
    store.cleanInvalidGroups();
    normalizeDivCardWidgets();
  });
  nextTick(() => {
    searchInputRef.value?.focus();
  });
});

const doSearch = () => {
  if (!searchText.value) return;
  const eng = engines.value.find((e) => e.key === effectiveEngine.value);
  const template = eng?.urlTemplate || "https://www.google.com/search?q={q}";
  const url = template.replace("{q}", encodeURIComponent(searchText.value));
  window.open(url, "_blank");
  searchText.value = "";
};

const openAddModal = (groupId: string) => {
  currentEditItem.value = null;
  currentGroupId.value = groupId;
  showEditModal.value = true;
};
const openEditModal = (item: NavItem, groupId?: string) => {
  currentEditItem.value = item;
  if (groupId) {
    currentGroupId.value = groupId;
  }
  showEditModal.value = true;
};
const handleSave = (payload: { item: NavItem; groupId?: string }) => {
  // Check if it's a div-card widget update
  const widget = store.widgets.find((w) => w.id === payload.item.id && w.type === "div-card");
  if (widget) {
    // Merge all properties from the edited item back into widget.data
    // This ensures icon, url, background, etc. are saved
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...dataProps } = payload.item;
    widget.data = {
      ...widget.data,
      ...dataProps,
    };
    store.saveData();
    return;
  }

  if (payload.item.id) {
    // Check for group move
    const targetGroupId = payload.groupId;
    let moved = false;
    
    if (targetGroupId) {
      const currentGroup = store.groups.find(g => g.items.some(i => i.id === payload.item.id));
      if (currentGroup && currentGroup.id !== targetGroupId) {
        // Move item: remove from old group, add to new group
        store.deleteItem(payload.item.id);
        store.addItem(payload.item, targetGroupId);
        moved = true;
      }
    }
    
    if (!moved) {
      store.updateItem(payload.item);
    }
  } else if (payload.groupId)
    store.addItem({ ...payload.item, id: Date.now().toString() }, payload.groupId);
};
const normalizeGridSpan = (value: number) => Math.round(value * 2) / 2;
const getDivCardDefaultSize = () => {
  const maxCols = widgetColNum.value;
  const w = Math.max(0.5, Math.min(maxCols, normalizeGridSpan(0.5)));
  return { w, h: 1 };
};
const normalizeDivCardWidgets = () => {
  let changed = false;
  const { w: defaultW, h: defaultH } = getDivCardDefaultSize();
  store.widgets.forEach((widget) => {
    if (widget.type !== "div-card") return;
    const nextW = widget.w ?? widget.colSpan ?? defaultW;
    const nextH = widget.h ?? widget.rowSpan ?? defaultH;
    const finalW = nextW > 0 ? nextW : defaultW;
    const finalH = nextH > 0 ? nextH : defaultH;
    if (
      widget.w !== finalW ||
      widget.h !== finalH ||
      widget.colSpan !== finalW ||
      widget.rowSpan !== finalH
    ) {
      widget.w = finalW;
      widget.h = finalH;
      widget.colSpan = finalW;
      widget.rowSpan = finalH;
      changed = true;
    }
  });
  if (changed) store.saveData();
};
const addDivCardWidget = () => {
  const newId = `div-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { w, h } = getDivCardDefaultSize();
  const newWidget: WidgetConfig = {
    id: newId,
    type: "div-card",
    enable: true,
    isPublic: true,
    w,
    h,
    colSpan: w,
    rowSpan: h,
    data: {
      title: "div 卡片",
      iconSize: 180,
    },
  };
  
  store.widgets.push(newWidget);

  // Manually update layoutData because the watcher is disabled in edit mode
  const currentLayout = [...layoutData.value];
  const newLayoutItem = { 
    ...newWidget, 
    i: newWidget.id, 
    x: 0, // Initial X (will be fixed by layout logic)
    y: Infinity, // Put at bottom initially
    w, 
    h 
  };
  
  // Use generateLayout + compactVertical to find the correct position
  const updatedLayout = compactVertical(generateLayout([...currentLayout, newLayoutItem], widgetColNum.value));
  
  layoutData.value = updatedLayout;
  
  // Sync the calculated position back to the widget in store
  handleLayoutUpdated(updatedLayout);
  
  store.saveData();
};
const handleDivCardClick = (widget: WidgetConfig) => {
  if (isEditMode.value) {
    // Edit mode: Disable click to avoid conflict with drag
    // User can use right-click context menu to edit/add
    return;
  }

  // View mode: Open URL if available
  if (widget.data) {
    const item: NavItem = {
      id: widget.id,
      title: widget.data.title || "div 卡片",
      url: widget.data.url || "",
      ...widget.data,
    };
    handleCardClick(item);
  }
};
const deleteDivCardWidget = (id: string) => {
  store.widgets = store.widgets.filter((w) => w.id !== id);
  layoutData.value = layoutData.value.filter((w) => w.i !== id && w.id !== id);
  if (activeResizeWidgetId.value === id) activeResizeWidgetId.value = null;
  const newLayout = compactVertical(layoutData.value);
  layoutData.value = newLayout;
  handleLayoutUpdated(newLayout);
  store.saveData();
};

// --- Heartbeat / Polling Mechanism for Layout ---
// Active (Edit Mode): Stop polling to prevent interference.
// Inactive (View Mode): Poll to keep in sync.
const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  async () => {
    if (store.isLogged && !isEditMode.value) {
      await store.fetchData();
    }
  },
  30000,
  { immediate: false },
);

watch(
  isEditMode,
  (active) => {
    if (active) {
      pausePolling();
    } else {
      resumePolling();
      // 退出编辑模式时，不需要立即刷新，因为本地状态就是最新的
      // 立即刷新反而可能因为服务器尚未写入完成或缓存导致回滚
      // if (store.isLogged) store.fetchData();
    }
  },
  { immediate: true },
);

// const deleteItem = (id: string) => {
//   openDeleteConfirm(id)
// }
let skipNextCardClickId: string | null = null;
const handleCardClick = (item: NavItem) => {
  if (skipNextCardClickId === item.id) {
    skipNextCardClickId = null;
    return;
  }
  if (isEditMode.value) return;

  // 逻辑优化：
  // 1. 默认使用外网链接 (item.url)
  // 2. 只有在【已登录】且【处于内网环境】且【配置了内网链接】时，才优先使用内网链接
  // 3. 支持强制切换模式
  // 4. 修复：统一使用 effectiveIsLan 判断，确保 UI 显示与跳转行为一致

  let targetUrl = item.url;

  // effectiveIsLan 已经封装了 forceMode (LAN/WAN/Latency/Auto) 的所有判断逻辑
  // 直接使用它可以保证 UI 状态（是否显示内网标识）与实际跳转逻辑的一致性
  if (store.isLogged && effectiveIsLan.value && item.lanUrl) {
    targetUrl = item.lanUrl;
  }

  // 特殊情况：如果解析出的 targetUrl 为空（说明没有外网链接），
  // 但存在内网链接（说明是因为未登录被降级了，或者是压根没配外网链接）
  // 此时如果用户未登录，则拦截并提示登录。
  if (!targetUrl && item.lanUrl && !store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  // 如果确实没有链接可跳，则不做反应
  if (!targetUrl) return;

  // Lucky STUN Port Replacement
  // 当配置了 Lucky STUN 且当前访问域名与卡片链接域名一致时，自动替换端口
  // 逻辑升级 V2：
  // 1. 默认行为：只要域名一致，就认为是“同一台机器”，默认尝试替换端口（为了解决从 STUN 端口访问时，卡片仍是内网端口的问题）。
  // 2. 例外处理：如果用户显式勾选了 skipLuckyStun（禁止替换），则保持原样（用于 Plex 等其他服务）。
  const stunData = store.luckyStunData?.data;
  if (stunData?.stun === "success" && stunData?.port) {
    try {
      const urlObj = new URL(targetUrl);
      if (urlObj.hostname === window.location.hostname) {
        // 只要当前不是内网 IP 访问，就自动替换端口
        // (防止在局域网用 IP 访问时，被错误替换成公网端口导致无法访问)
        if (!isInternalNetwork(window.location.hostname)) {
          urlObj.port = String(stunData.port);
          targetUrl = urlObj.toString();
        }
      }
    } catch {
      // Ignore relative or invalid URLs
    }
  }

  window.open(targetUrl, "_blank");
};

const handleDockerAction = async (item: NavItem, action: string) => {
  let containerId = item.containerId;

  // Resolve ID from name if needed
  if ((!containerId || !containerStatuses.value[containerId]) && item.containerName) {
    const resolvedId = liveContainerNamesMap.value[item.containerName];
    if (resolvedId) {
      containerId = resolvedId;
    }
  }

  if (!containerId) return;

  if (action === "update") {
    isUpdating.value.add(containerId);
  }

  try {
    const headers = store.getHeaders();
    await fetch(`/api/docker/container/${containerId}/${action}`, {
      method: "POST",
      headers,
    });
    // Optimistic update or wait for poll? For now just wait for poll or refresh if needed.
    // Ideally we should refresh status here, but status is on the card?
    // We need to fetch container status to update the card UI if we display it.
    // Let's implement status fetching for cards.
    fetchContainerStatuses();
  } catch (e) {
    console.error(`Failed to ${action} container`, e);
  } finally {
    if (action === "update") {
      isUpdating.value.delete(containerId);
      // Force refresh status immediately after update
      setTimeout(fetchContainerStatuses, 1000);
      setTimeout(fetchContainerStatuses, 5000);
    }
  }
};

const containerStatuses = ref<
  Record<
    string,
    {
      state: string;
      hasUpdate?: boolean;
      stats?: {
        cpuPercent: number;
        memPercent: number;
        memUsage: number;
        netIO?: { rx: number; tx: number };
        blockIO?: { read: number; write: number };
      };
    }
  >
>({});

// Track updating containers
const isUpdating = ref<Set<string>>(new Set());

const isItemUpdating = (item: NavItem) => {
  if (!item) return false;
  // Check explicit ID
  if (item.containerId && isUpdating.value.has(item.containerId)) return true;

  // Check resolved ID
  if (item.containerName) {
    const id = liveContainerNamesMap.value[item.containerName];
    if (id && isUpdating.value.has(id)) return true;
  }
  return false;
};

const formatBytes = (bytes: number, decimals = 1) => {
  if (!bytes) return "0B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + (sizes[index] || "B");
};

interface ContainerStatus {
  state: string;
  hasUpdate?: boolean;
  stats?: {
    cpuPercent: number;
    memPercent: number;
    memUsage: number;
    netIO?: { rx: number; tx: number };
    blockIO?: { read: number; write: number };
  };
}

interface DockerContainer {
  Id: string;
  Names: string[];
  State: string;
  hasUpdate?: boolean;
  stats?: {
    cpuPercent: number;
    memPercent: number;
    memUsage: number;
    netIO?: { rx: number; tx: number };
    blockIO?: { read: number; write: number };
  };
  [key: string]: unknown;
}

const previousStatsMap = ref<
  Record<
    string,
    {
      time: number;
      netIO?: { rx: number; tx: number };
      blockIO?: { read: number; write: number };
    }
  >
>({});

const liveContainerNamesMap = ref<Record<string, string>>({});

const getContainerStatus = (item: NavItem) => {
  if (!item) return undefined;

  // 1. Try by ID (Fastest)
  if (item.containerId && containerStatuses.value[item.containerId]) {
    return containerStatuses.value[item.containerId];
  }

  // 2. Try by Name (Fallback / No-ID case)
  if (item.containerName) {
    const id = liveContainerNamesMap.value[item.containerName];
    if (id && containerStatuses.value[id]) {
      return containerStatuses.value[id];
    }
  }

  return undefined;
};

const fetchContainerStatuses = async () => {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    if (containerPollTimer) clearTimeout(containerPollTimer);
    containerPollTimer = null;
    return;
  }

  const hasAnyContainerItems = store.groups.some((g) =>
    g.items.some((item) => !!item.containerId || !!item.containerName),
  );
  if (!hasAnyContainerItems) {
    if (containerPollTimer) clearTimeout(containerPollTimer);
    containerPollTimer = null;
    if (Object.keys(containerStatuses.value).length) containerStatuses.value = {};
    if (Object.keys(previousStatsMap.value).length) previousStatsMap.value = {};
    return;
  }

  const statusMap: Record<string, ContainerStatus> = {};
  const now = Date.now();

  // 0. Ensure every docker-bound item has at least a placeholder status
  store.groups.forEach((g) => {
    g.items.forEach((item) => {
      if (!item.containerId && !item.containerName) return;

      // If we only have name, we can't key by ID yet, but we will fix this in step 2
      if (item.containerId) {
        const existing = containerStatuses.value[item.containerId];
        statusMap[item.containerId] = {
          state: existing?.state || "unknown",
          stats: existing?.stats,
        };
      }
    });
  });

  // 1. Generate Mock Data for known mock containers (ALWAYS do this for testing)
  store.groups.forEach((g) => {
    g.items.forEach((item) => {
      if (item.containerId && item.containerId.startsWith("mock-")) {
        const existing = containerStatuses.value[item.containerId];
        // Simulate fluctuating stats
        const cpuPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.cpuPercent || 30) + (Math.random() - 0.5) * 20),
        );
        const memPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.memPercent || 40) + (Math.random() - 0.5) * 10),
        );
        const memUsage = (memPercent / 100) * 1024 * 1024 * 1024; // Mock 1GB limit

        // Mock IO
        const rx = Math.random() * 1024 * 1024; // 0-1MB
        const tx = Math.random() * 512 * 1024; // 0-512KB
        const read = Math.random() * 2 * 1024 * 1024; // 0-2MB
        const write = Math.random() * 1024 * 1024; // 0-1MB

        statusMap[item.containerId] = {
          state: existing?.state || "running",
          hasUpdate: existing?.hasUpdate !== undefined ? existing.hasUpdate : Math.random() > 0.7, // Demo: 30% chance of update
          stats: {
            cpuPercent,
            memPercent,
            memUsage,
            netIO: { rx, tx },
            blockIO: { read, write },
          },
        };
      }
    });
  });

  const dockerWidget = store.widgets.find((w) => w.type === "docker" || w.id === "docker");
  const dockerMockEnabled = Boolean(dockerWidget?.data && dockerWidget.data.useMock);

  if (dockerMockEnabled) {
    store.groups.forEach((g) => {
      g.items.forEach((item) => {
        if (!item.containerId || item.containerId.startsWith("mock-")) return;
        const existing = containerStatuses.value[item.containerId];
        const cpuPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.cpuPercent || 30) + (Math.random() - 0.5) * 20),
        );
        const memPercent = Math.min(
          100,
          Math.max(0, (existing?.stats?.memPercent || 40) + (Math.random() - 0.5) * 10),
        );
        const memUsage = (memPercent / 100) * 1024 * 1024 * 1024;
        const rx = Math.random() * 1024 * 1024;
        const tx = Math.random() * 512 * 1024;
        const read = Math.random() * 2 * 1024 * 1024;
        const write = Math.random() * 1024 * 1024;
        statusMap[item.containerId] = {
          state: existing?.state || "running",
          hasUpdate: existing?.hasUpdate !== undefined ? existing.hasUpdate : Math.random() > 0.7,
          stats: {
            cpuPercent,
            memPercent,
            memUsage,
            netIO: { rx, tx },
            blockIO: { read, write },
          },
        };
      });
    });
  }

  // 2. Try to fetch real data
  // Only fetch if there are container items to update
  const hasRealDockerItems = store.groups.some((g) =>
    g.items.some(
      (item) => (item.containerId && !item.containerId.startsWith("mock-")) || item.containerName,
    ),
  );

  if (hasRealDockerItems && !dockerMockEnabled) {
    try {
      const headers = store.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch("/api/docker/containers", { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.success) {
        const liveContainers = (data.data || []) as DockerContainer[];

        // Build Name -> ID map for fallback lookups
        const newNameMap: Record<string, string> = {};
        liveContainers.forEach((c) => {
          if (c.Names && c.Names.length) {
            c.Names.forEach((n) => {
              const cleanName = n.replace(/^\//, "");
              newNameMap[cleanName] = c.Id;
            });
          }
        });
        liveContainerNamesMap.value = newNameMap;

        let needsSave = false;
        store.groups.forEach((g) => {
          g.items.forEach((item) => {
            // Case 1: Has ID. Check if valid, or fix if invalid.
            if (item.containerId && !item.containerId.startsWith("mock-")) {
              const foundById = liveContainers.find((c) => c.Id === item.containerId);
              if (!foundById) {
                // Try to find by name (handle ID change after container recreation)
                let foundByName: DockerContainer | undefined;

                // 1. Try strict match by containerName (if set)
                if (item.containerName) {
                  foundByName = liveContainers.find((c) =>
                    (c.Names || []).some((n) => n.replace(/^\//, "") === item.containerName),
                  );
                }

                // 2. Fallback to match by item.title (legacy support or if name matches title)
                if (!foundByName && item.title) {
                  foundByName = liveContainers.find((c) =>
                    (c.Names || []).some((n) => n.replace(/^\//, "") === item.title),
                  );
                }

                if (foundByName) {
                  console.log(
                    `[Docker Fix] Container ID changed. Updating ${item.containerId} -> ${foundByName.Id} (Name: ${foundByName.Names?.[0]})`,
                  );
                  item.containerId = foundByName.Id;

                  // Ensure containerName is synced to the real container name
                  // This ensures future updates work even if user renames the card title
                  const realName = (foundByName.Names?.[0] || "").replace(/^\//, "");
                  if (realName && item.containerName !== realName) {
                    item.containerName = realName;
                  }

                  needsSave = true;
                }
              }
            }
            // Case 2: No ID (or mock ID), but has Name. Try to bind.
            else if (
              (!item.containerId || item.containerId.startsWith("mock-")) &&
              item.containerName
            ) {
              const foundByName = liveContainers.find((c) =>
                (c.Names || []).some((n) => n.replace(/^\//, "") === item.containerName),
              );

              if (foundByName) {
                console.log(
                  `[Docker Bind] Found container by name. Binding ${item.containerName} -> ${foundByName.Id}`,
                );
                item.containerId = foundByName.Id;
                needsSave = true;
              }
            }
          });
        });

        if (needsSave) {
          store.saveData();
        }

        liveContainers.forEach((c) => {
          let stats = c.stats;

          if (stats && stats.netIO && stats.blockIO) {
            const prev = previousStatsMap.value[c.Id];
            const currentNetRx = stats.netIO.rx || 0;
            const currentNetTx = stats.netIO.tx || 0;
            const currentBlockRead = stats.blockIO.read || 0;
            const currentBlockWrite = stats.blockIO.write || 0;

            let rxRate = 0;
            let txRate = 0;
            let readRate = 0;
            let writeRate = 0;

            if (prev) {
              const dt = (now - prev.time) / 1000;
              if (dt > 0) {
                rxRate = Math.max(0, (currentNetRx - (prev.netIO?.rx || 0)) / dt);
                txRate = Math.max(0, (currentNetTx - (prev.netIO?.tx || 0)) / dt);
                readRate = Math.max(0, (currentBlockRead - (prev.blockIO?.read || 0)) / dt);
                writeRate = Math.max(0, (currentBlockWrite - (prev.blockIO?.write || 0)) / dt);
              }
            }

            previousStatsMap.value[c.Id] = {
              time: now,
              netIO: { rx: currentNetRx, tx: currentNetTx },
              blockIO: { read: currentBlockRead, write: currentBlockWrite },
            };

            stats = {
              ...stats,
              netIO: { rx: rxRate, tx: txRate },
              blockIO: { read: readRate, write: writeRate },
            };
          }

          statusMap[c.Id] = {
            state: c.State,
            hasUpdate: c.hasUpdate,
            stats: stats,
          };
        });
      }
    } catch {
      // ignore
    } finally {
      // ignore
    }
  }

  // 3. Update State
  containerStatuses.value = { ...containerStatuses.value, ...statusMap };

  // Schedule next poll
  if (isMounted.value) {
    containerPollTimer = setTimeout(fetchContainerStatuses, 5000);
  }
};

let containerPollTimer: ReturnType<typeof setTimeout> | null = null;
const isMounted = ref(false);

const handleContainerVisibilityChange = () => {
  if (!isMounted.value) return;
  if (document.visibilityState === "hidden") {
    if (containerPollTimer) clearTimeout(containerPollTimer);
    containerPollTimer = null;
    return;
  }
  fetchContainerStatuses();
};

onMounted(() => {
  isMounted.value = true;
  fetchContainerStatuses();
  document.addEventListener("visibilitychange", handleContainerVisibilityChange);
});

onUnmounted(() => {
  isMounted.value = false;
  if (containerPollTimer) clearTimeout(containerPollTimer);
  document.removeEventListener("visibilitychange", handleContainerVisibilityChange);
});

// 监听 store.groups 变化，一旦出现容器组件，立即启动轮询
// 这是为了解决页面初始化时 store 数据尚未加载完成，导致 fetchContainerStatuses 提前退出且不再调度的问题
watch(
  () => store.groups,
  () => {
    const hasAny = store.groups.some((g) =>
      g.items.some((item) => !!item.containerId || !!item.containerName),
    );
    if (hasAny && !containerPollTimer && isMounted.value && document.visibilityState !== "hidden") {
      fetchContainerStatuses();
    }
  },
  { deep: true },
);

const handleAuthAction = () => {
  if (store.isLogged) {
    store.logout();
    isEditMode.value = false;
  } else {
    showLoginModal.value = true;
  }
};
const openSettings = () => {
  if (!store.isLogged) {
    showLoginModal.value = true;
  } else {
    showSettingsModal.value = true;
  }
};

// const updateGroupName = (id: string, e: Event) => {
//   const val = (e.target as HTMLElement).innerText
//   store.updateGroupTitle(id, val)
// }

const onGroupItemsChange = (groupId: string, newItems: NavItem[]) => {
  const group = store.groups.find((g) => g.id === groupId);
  if (group) {
    group.items = newItems;
  }
};

const openBackupUrl = (url: string | { url: string }) => {
  const target = typeof url === "string" ? url : url.url;
  if (!target) return;
  window.open(target, "_blank");
};

// --- Context Menu Logic ---
const showContextMenu = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuItem = ref<NavItem | null>(null);
const contextMenuGroupId = ref<string | undefined>(undefined);
let ignoreNextNativeContextMenu = false;

const openContextMenuAt = (x: number, y: number, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  contextMenuItem.value = item;
  contextMenuGroupId.value = groupId;

  // Prevent menu from going off-screen (basic logic)
  const menuWidth = 150;
  const menuHeight = 100;
  let finalX = x;
  let finalY = y;

  if (finalX + menuWidth > window.innerWidth) finalX -= menuWidth;
  if (finalY + menuHeight > window.innerHeight) finalY -= menuHeight;

  contextMenuPosition.value = { x: finalX, y: finalY };
  showContextMenu.value = true;
};

const openContextMenu = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  e.preventDefault();
  openContextMenuAt(e.clientX, e.clientY, item, groupId);
};

const hasTouch = computed(() => {
  if (typeof navigator === "undefined") return false;
  const n = navigator as Navigator & { msMaxTouchPoints?: number };
  const maxPoints = Math.max(0, n.maxTouchPoints || 0, n.msMaxTouchPoints || 0);
  if (maxPoints > 0) return true;
  return typeof window !== "undefined" && "ontouchstart" in window;
});
const enableLongPressContextMenu = computed(() => hasTouch.value);
let cardLongPressTimer: number | null = null;
let cardLongPressStartX = 0;
let cardLongPressStartY = 0;
let cardLongPressItem: NavItem | null = null;
let cardLongPressGroupId: string | undefined;
let cardLongPressSource: "touch" | "pointer" | null = null;

const clearCardLongPress = () => {
  if (cardLongPressTimer) window.clearTimeout(cardLongPressTimer);
  cardLongPressTimer = null;
  cardLongPressItem = null;
  cardLongPressGroupId = undefined;
  cardLongPressSource = null;
};

const onCardTouchStart = (e: TouchEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (showContextMenu.value) return;
  if (cardLongPressSource === "pointer") return;

  const t = e.touches && e.touches[0];
  if (!t) return;

  clearCardLongPress();
  cardLongPressSource = "touch";
  cardLongPressStartX = t.clientX;
  cardLongPressStartY = t.clientY;
  cardLongPressItem = item;
  cardLongPressGroupId = groupId;
  cardLongPressTimer = window.setTimeout(() => {
    if (!cardLongPressItem) return;
    skipNextCardClickId = cardLongPressItem.id;
    openContextMenuAt(
      cardLongPressStartX,
      cardLongPressStartY,
      cardLongPressItem,
      cardLongPressGroupId,
    );
    clearCardLongPress();
  }, 520);
};

const onCardTouchMove = (e: TouchEvent) => {
  if (!cardLongPressTimer) return;
  if (cardLongPressSource !== "touch") return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dx = t.clientX - cardLongPressStartX;
  const dy = t.clientY - cardLongPressStartY;
  if (dx * dx + dy * dy > 256) clearCardLongPress();
};

const onCardTouchEnd = () => {
  clearCardLongPress();
};

const onCardPointerDown = (e: PointerEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (!enableLongPressContextMenu.value) return;
  if (showContextMenu.value) return;
  if (e.pointerType !== "touch") return;

  clearCardLongPress();
  cardLongPressSource = "pointer";
  cardLongPressStartX = e.clientX;
  cardLongPressStartY = e.clientY;
  cardLongPressItem = item;
  cardLongPressGroupId = groupId;
  cardLongPressTimer = window.setTimeout(() => {
    if (!cardLongPressItem) return;
    skipNextCardClickId = cardLongPressItem.id;
    openContextMenuAt(
      cardLongPressStartX,
      cardLongPressStartY,
      cardLongPressItem,
      cardLongPressGroupId,
    );
    clearCardLongPress();
  }, 520);
};

const onCardPointerMove = (e: PointerEvent) => {
  if (!cardLongPressTimer) return;
  if (cardLongPressSource !== "pointer") return;
  if (e.pointerType !== "touch") return;
  const dx = e.clientX - cardLongPressStartX;
  const dy = e.clientY - cardLongPressStartY;
  if (dx * dx + dy * dy > 256) clearCardLongPress();
};

const onCardPointerUp = () => {
  clearCardLongPress();
};

const handleDivCardContextMenu = (e: MouseEvent, widget: WidgetConfig) => {
  if (!store.isLogged) return;
  e.preventDefault();

  const proxyItem: NavItem = {
    id: widget.id,
    title: widget.data?.title || "div 卡片",
    url: widget.data?.url || "", // Ensure it has a URL field so it's treated as a link item
    ...widget.data,
  };

  contextMenuItem.value = proxyItem;
  contextMenuGroupId.value = undefined;
  openContextMenu(e, proxyItem, undefined);
};

const handleContextMenu = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  if (ignoreNextNativeContextMenu && e.type === "contextmenu") {
    ignoreNextNativeContextMenu = false;
    e.preventDefault();
    return;
  }
  openContextMenu(e, item, groupId);
};

const handleContextMenuPointerDown = (e: MouseEvent, item: NavItem, groupId?: string) => {
  if (!store.isLogged) return;
  ignoreNextNativeContextMenu = true;
  openContextMenu(e, item, groupId);
};

const closeContextMenu = () => {
  showContextMenu.value = false;
};

const onDocPointerDownCapture = (e: PointerEvent) => {
  if (!showContextMenu.value) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-grid-context-menu]")) return;
  closeContextMenu();
};

const handleMenuLanOpen = () => {
  const item = contextMenuItem.value;
  closeContextMenu();

  if (!item || !item.lanUrl) return;

  // 内网访问依然需要登录权限
  if (!store.isLogged) {
    showLoginModal.value = true;
    return;
  }

  window.open(item.lanUrl, "_blank");
};

const handleMenuWanOpen = () => {
  const item = contextMenuItem.value;
  closeContextMenu();
  if (!item || !item.url) return;
  window.open(item.url, "_blank");
};

const handleMenuOpen = (url: string | { url: string }) => {
  closeContextMenu();
  const target = typeof url === "string" ? url : url.url;
  if (!target) return;
  window.open(target, "_blank");
};

const handleMenuEdit = () => {
  if (contextMenuItem.value) {
    openEditModal(contextMenuItem.value, contextMenuGroupId.value);
  }
  closeContextMenu();
};

const handleMenuDelete = () => {
  const item = contextMenuItem.value;
  closeContextMenu();
  if (item) {
    openDeleteConfirm(item.id);
  }
};

// --- Delete Confirmation Logic ---
const showDeleteConfirm = ref(false);
const deleteType = ref<"item" | "group">("item");
const itemToDelete = ref<string | null>(null);
const groupToDelete = ref<string | null>(null);

const openDeleteConfirm = (id: string) => {
  deleteType.value = "item";
  itemToDelete.value = id;
  showDeleteConfirm.value = true;
};

const openGroupDeleteConfirm = (id: string) => {
  deleteType.value = "group";
  groupToDelete.value = id;
  showDeleteConfirm.value = true;
};

const confirmDelete = () => {
  if (deleteType.value === "item" && itemToDelete.value) {
    const isDivCard = store.widgets.some((w) => w.id === itemToDelete.value && w.type === "div-card");
    if (isDivCard) {
      deleteDivCardWidget(itemToDelete.value);
    } else {
      store.deleteItem(itemToDelete.value);
    }
  } else if (deleteType.value === "group" && groupToDelete.value) {
    store.deleteGroup(groupToDelete.value, true);
  }
  showDeleteConfirm.value = false;
  itemToDelete.value = null;
  groupToDelete.value = null;
};

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDownCapture, true);
  document.addEventListener("scroll", closeContextMenu, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDownCapture, true);
  document.removeEventListener("scroll", closeContextMenu, true);
  if (ipInterval) {
    clearInterval(ipInterval);
    ipInterval = null;
  }
});

// --- Group Settings ---
const activeGroupId = ref<string | null>(null);

const toggleGroupSettings = (id: string) => {
  activeGroupId.value = id;
  showGroupSettingsModal.value = true;
};

const checkMove = () => {
  return true;
};

const getLayoutConfig = (group: NavGroup) => {
  const showBg = group.showCardBackground ?? store.appConfig.showCardBackground;
  const layout = group.cardLayout || store.appConfig.cardLayout;
  const isHorizontal = layout === "horizontal";
  const isNoBg = showBg === false;

  const baseGap = group.gridGap || store.appConfig.gridGap;
  const gap = isNoBg ? Math.max(4, Math.round(baseGap * 0.6)) : baseGap;

  const baseSize = group.cardSize || store.appConfig.cardSize || 120;
  const ratio = baseSize / 120;

  const modeScale = isNoBg ? 0.6 : 1.0;
  const finalScale = ratio * modeScale;

  // Icon Size Logic
  const customIconSize = group.iconSize || store.appConfig.iconSize;
  let v_icon, h_icon;

  if (customIconSize) {
    // If explicit icon size is set, use it as base
    // Optimization: In vertical mode without card background, use the custom size directly
    if (isNoBg && !isHorizontal) {
      v_icon = customIconSize;
    } else {
      v_icon = customIconSize * modeScale;
    }
    h_icon = customIconSize * (40 / 48) * modeScale;
  } else {
    // Legacy behavior: scale with card size
    v_icon = 48 * finalScale;
    h_icon = 40 * finalScale;
  }

  let v_w = 120 * finalScale;
  let v_h = 128 * finalScale;

  // Optimization: Ensure container fits the icon in vertical no-bg mode
  if (isNoBg && !isHorizontal) {
    if (v_icon > v_w) v_w = v_icon + 8;
    const minH = v_icon + 32; // Icon + Text space
    if (minH > v_h) v_h = minH;
  }

  const h_w = 220 * finalScale;
  const h_h = 80 * finalScale;

  return {
    minWidth: isHorizontal ? h_w : v_w,
    height: isHorizontal ? h_h : v_h,
    iconSize: isHorizontal ? h_icon : v_icon,
    gap,
  };
};

// Close settings when clicking outside
// Note: In a real app we might use onClickOutside from @vueuse/core on the menu ref,
// but here we can just rely on the fact that clicking elsewhere (if not stopped) handles it?
// Actually, a global click listener or backdrop is safer.
// For now, let's use a simple window click listener or just rely on the toggle.
// Better: Use a transparent fixed inset div when menu is open to catch clicks.

const hitokoto = ref({ hitokoto: "加载中...", from: "" });
const fetchHitokoto = async () => {
  try {
    const res = await fetch("https://v1.hitokoto.cn/?c=i&c=d&c=k");
    hitokoto.value = await res.json();
  } catch {
    hitokoto.value = { hitokoto: "生活原本沉闷，但跑起来就有风。", from: "网络" };
  }
};

// --- 修复 IP 获取报错 ---
let ipInterval: number | null = null;
const ipInfo = ref({
  displayIp: "加载中...",
  realIp: "",
  location: "",
  isProxy: false,
  baiduLatency: "--",
  details: [] as string[], // 用于存储所有检测到的 IP
  clientIp: "",
  clientIpSource: "",
});

const isIpv6 = computed(() => {
  const ip = String(ipInfo.value.displayIp || "");
  return ip.includes(":");
});

const hasClientIp = computed(() => {
  const v = String(ipInfo.value.clientIp || "").trim();
  return !!v;
});

const showClientIp = computed(() => {
  if (!hasClientIp.value) return false;
  const display = String(ipInfo.value.displayIp || "").trim();
  const client = String(ipInfo.value.clientIp || "").trim();
  if (!display || !client) return false;
  return client !== display;
});

const ipTypeLabel = computed(() => (isIpv6.value ? "IPv6" : "IP"));

const copiedToast = ref("");
let copiedToastTimer: number | null = null;
const copyToClipboard = async (text: string) => {
  const value = String(text || "").trim();
  if (!value) return;
  if (value === "加载中..." || value === "检测中..." || value === "Error" || value === "获取失败")
    return;
  try {
    await navigator.clipboard.writeText(value);
    copiedToast.value = "已复制";
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      copiedToast.value = "已复制";
    } catch {
      copiedToast.value = "复制失败";
    }
  }

  if (copiedToastTimer) window.clearTimeout(copiedToastTimer);
  copiedToastTimer = window.setTimeout(() => {
    copiedToast.value = "";
    copiedToastTimer = null;
  }, 1200);
};

const formattedLocation = computed(() => {
  const loc = ipInfo.value.location;
  if (!loc) return "";
  const parts = loc.split(" ");
  let area = parts[0] || "";
  let isp = parts.length > 1 ? parts[1] : "";

  // Remove Province (e.g., "浙江省")
  area = area.replace(/^.+?省/, "");

  // Remove City if it's not the last part (e.g., "宁波市慈溪市" -> "慈溪市")
  area = area.replace(/^.+?市(?=.+)/, "");

  // Clean ISP (e.g., "电信ADSL" -> "电信")
  if (isp) {
    isp = isp.replace(/ADSL|宽带|光纤/gi, "");
  }

  return `${area} ${isp}`.trim();
});

const fetchIp = async (force = false) => {
  const CACHE_KEY = `flatnas_ip_cache:${networkScope}`;
  const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in ms
  const initialIsLanMode = isLanMode.value;
  store.ipFetchStatus = "loading";
  store.isLanModeInited = false;

  if (!force) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          ipInfo.value = data;
          const internalDomains = networkConfig.value.internalDomains;
          const hostnameIsLan = isInternalNetwork(window.location.hostname, internalDomains);
          const canTrustClientIp = data?.clientIpSource === "header";
          const clientIsLan =
            canTrustClientIp &&
            !!data?.clientIp &&
            isInternalNetwork(String(data.clientIp), internalDomains);
          isLanMode.value = hostnameIsLan || clientIsLan;
          store.ipFetchStatus = "success";
          store.isLanModeInited = true;
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to read IP cache", e);
    }
  }

  ipInfo.value = {
    displayIp: "检测中...",
    realIp: "",
    location: "",
    isProxy: false,
    baiduLatency: "...",
    details: [],
    clientIp: "",
    clientIpSource: "",
  };

  // 检测 223.5.5.5 延迟 (通过后端 /api/ping)
  fetch("/api/ping?target=223.5.5.5")
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        ipInfo.value.baiduLatency = data.latency;
      } else {
        ipInfo.value.baiduLatency = "Timeout";
      }
      updateCache();
    })
    .catch(() => {
      ipInfo.value.baiduLatency = "Error";
      updateCache();
    });

  try {
    const refreshParam = force ? "&refresh=1" : "";
    const res = await fetchWithTimeout(
      `/api/ip?ts=${Date.now()}${refreshParam}`,
      { method: "GET" },
      30000,
    );
    const data = await res.json();

    if (data.success) {
      ipInfo.value.displayIp = data.ip;
      ipInfo.value.location = data.location || "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";
      ipInfo.value.clientIpSource = data.clientIpSource || "";

      const internalDomains = networkConfig.value.internalDomains;
      const hostnameIsLan = isInternalNetwork(window.location.hostname, internalDomains);
      const canTrustClientIp = ipInfo.value.clientIpSource === "header";
      const clientIsLan =
        canTrustClientIp &&
        !!ipInfo.value.clientIp &&
        isInternalNetwork(String(ipInfo.value.clientIp), internalDomains);
      isLanMode.value = hostnameIsLan || clientIsLan;
      store.ipFetchStatus = "success";
    } else {
      ipInfo.value.displayIp = data.ip || "获取失败";
      ipInfo.value.location = "未知位置";
      ipInfo.value.clientIp = data.clientIp || "";
      ipInfo.value.clientIpSource = data.clientIpSource || "";
      isLanMode.value = initialIsLanMode;
      store.ipFetchStatus = "error";
    }
    store.isLanModeInited = true;
    updateCache();
  } catch (e) {
    console.error("IP Fetch Error", e);
    ipInfo.value.displayIp = "Error";
    isLanMode.value = initialIsLanMode;
    store.ipFetchStatus = "error";
    store.isLanModeInited = true;
    updateCache();
  }
};

const updateCache = () => {
  // Only cache if we have some meaningful data
  if (ipInfo.value.displayIp !== "检测中..." && ipInfo.value.baiduLatency !== "...") {
    localStorage.setItem(
      `flatnas_ip_cache:${networkScope}`,
      JSON.stringify({
        timestamp: Date.now(),
        data: ipInfo.value,
      }),
    );
  }
};

// --- 修复结束 ---

// Visitor Stats
const onlineDuration = ref("00:00:00");
const totalVisitors = ref(0);
const todayVisitors = ref(0);
let onlineTimer: ReturnType<typeof setInterval> | null = null;
let onlineStartTime = 0;
let onlineElapsedMs = 0;

const updateOnlineDuration = () => {
  const elapsed = onlineElapsedMs + (onlineStartTime ? Date.now() - onlineStartTime : 0);
  const diff = Math.floor(elapsed / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  onlineDuration.value = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const startOnlineTimer = () => {
  if (onlineTimer) clearInterval(onlineTimer);
  onlineStartTime = Date.now();
  updateOnlineDuration();
  onlineTimer = setInterval(() => {
    updateOnlineDuration();
  }, 5000);
};

const stopOnlineTimer = () => {
  if (onlineStartTime) {
    onlineElapsedMs += Date.now() - onlineStartTime;
    onlineStartTime = 0;
  }
  if (onlineTimer) clearInterval(onlineTimer);
  onlineTimer = null;
};

const handleFooterVisibilityChange = () => {
  if (!store.appConfig.showFooterStats) return;
  if (document.visibilityState === "hidden") stopOnlineTimer();
  else startOnlineTimer();
};

const recordVisit = async () => {
  try {
    const res = await fetch("/api/visitor/track", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      totalVisitors.value = data.totalVisitors;
      todayVisitors.value = data.todayVisitors;
    }
  } catch (e) {
    console.error("Failed to record visit", e);
  }
};

watch(
  () => store.appConfig.showFooterStats,
  (val) => {
    if (val) {
      onlineElapsedMs = 0;
      startOnlineTimer();
      document.addEventListener("visibilitychange", handleFooterVisibilityChange);
      recordVisit();
    } else {
      stopOnlineTimer();
      document.removeEventListener("visibilitychange", handleFooterVisibilityChange);
    }
  },
  { immediate: true },
);

onMounted(() => {
  fetchHitokoto();
  updateHour();
  if (daylightTimer) clearInterval(daylightTimer);
  daylightTimer = setInterval(updateHour, 60 * 1000);
});

onUnmounted(() => {
  if (daylightTimer) clearInterval(daylightTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  stopRain();
});
</script>

<template>
  <div class="flatnas-handshake-signal" style="display: none !important"></div>
  <div
    class="min-h-dvh relative overflow-hidden flex flex-col pt-[env(safe-area-inset-top)]"
    :class="{ 'empire-theme': store.appConfig.empireMode }"
  >
    <!-- ✨ Global Background Layer -->
    <div class="fixed inset-0 z-0 pointer-events-none select-none">
      <!-- Default Background (Gradient Clouds) -->
      <div
        v-if="!store.appConfig.empireMode && store.appConfig.solidBackgroundColor"
        class="absolute inset-0 transition-all duration-500"
        :style="{ backgroundColor: store.appConfig.solidBackgroundColor }"
      ></div>
      <div
        v-else-if="!store.appConfig.empireMode"
        class="absolute inset-0 transition-all duration-500"
        style="background-image: linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)"
      ></div>

      <!-- Empire Mode Background -->
      <div
        v-if="store.appConfig.empireMode"
        class="absolute inset-0 z-20"
        style="background: radial-gradient(circle at 50% 50%, #2a2a2a, #000000)"
      >
        <div
          class="absolute inset-0 opacity-30"
          :style="{ backgroundImage: `url('${store.getAssetUrl(empireBackgroundUrl)}')` }"
        ></div>
      </div>

      <!-- Desktop Image Layer -->
      <div
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat"
        :class="(store.appConfig.enableMobileWallpaper ?? true) ? 'hidden md:block' : 'block'"
        v-if="store.appConfig.background"
        :style="{
          backgroundImage: `url('${store.getAssetUrl(store.appConfig.background)}')`,
          filter: `blur(${store.appConfig.backgroundBlur ?? 0}px)`,
          opacity: isPcBgLoaded ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out, filter 0.3s ease-in-out',
        }"
      ></div>

      <!-- Mobile Image Layer -->
      <div
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat md:hidden"
        v-if="(store.appConfig.enableMobileWallpaper ?? true) && store.appConfig.mobileBackground"
        :style="{
          backgroundImage: `url('${store.getAssetUrl(store.appConfig.mobileBackground)}')`,
          filter: `blur(${store.appConfig.mobileBackgroundBlur ?? 0}px)`,
          opacity: isMobileBgLoaded ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out, filter 0.3s ease-in-out',
        }"
      ></div>

      <!-- 纹理平移图层 -->
      <div
        v-if="showRainEffect"
        class="absolute inset-[-20px] bg-cover bg-center bg-no-repeat animate-texture-pan pointer-events-none"
        :style="{ backgroundImage: `url('${store.getAssetUrl('/rain-texture.png')}')`, opacity: 0.15 }"
      ></div>

      <!-- 深度雾层 -->
      <div
        v-if="showFogEffect"
        class="absolute inset-0 bg-gradient-to-b from-black/30 to-black/60 animate-fog-fade pointer-events-none"
      ></div>

      <canvas
        ref="rainCanvasRef"
        class="absolute inset-0 pointer-events-none transition-opacity"
        :class="showRainEffect ? 'opacity-70' : 'opacity-0'"
      ></canvas>

      <!-- Desktop Mask Layer -->
      <div
        class="absolute inset-0 transition-all duration-300"
        :class="(store.appConfig.enableMobileWallpaper ?? true) ? 'hidden md:block' : 'block'"
        :style="{
          backgroundColor: `rgba(0,0,0,${effectiveBackgroundMask})`,
        }"
      ></div>

      <!-- Mobile Mask Layer -->
      <div
        class="absolute inset-0 transition-all duration-300 md:hidden"
        v-if="store.appConfig.enableMobileWallpaper ?? true"
        :style="{
          backgroundColor: `rgba(0,0,0,${effectiveMobileBackgroundMask})`,
        }"
      ></div>
    </div>

    <AppSidebar
      v-if="isSidebarEnabled"
      v-model:collapsed="sidebarCollapsed"
      class="fixed left-0 top-0 z-40 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]"
      :class="isMobile && sidebarCollapsed ? 'h-auto' : 'h-full'"
      :onOpenSettings="
        () => {
          if (!store.isLogged) {
            showLoginModal = true;
            return;
          }
          showSettingsModal = true;
        }
      "
      :onOpenEdit="
        () => {
          if (!store.isLogged) {
            showLoginModal = true;
            return;
          }
          isEditMode = !isEditMode;
        }
      "
    />

    <div
      class="flex-1 w-full p-4 md:p-8 transition-all pb-[calc(2rem+env(safe-area-inset-bottom))] md:pb-[calc(2.5rem+env(safe-area-inset-bottom))] relative z-10"
      ref="mainContainerRef"
      :style="{
        backgroundColor:
          store.appConfig.background || store.appConfig.solidBackgroundColor
            ? 'transparent'
            : '#f3f4f6',
        '--group-title-color': store.appConfig.groupTitleColor || '#ffffff',
        '--card-bg-color': store.appConfig.cardBgColor || 'transparent',
        '--card-border-color': store.appConfig.cardBorderColor || 'transparent',
        '--card-border-hover-color':
          store.appConfig.cardBorderColor && store.appConfig.cardBorderColor !== 'transparent'
            ? store.appConfig.cardBorderColor
            : store.appConfig.background || store.appConfig.solidBackgroundColor
              ? 'rgba(255, 255, 255, 0.35)'
              : 'rgba(15, 23, 42, 0.12)',
        paddingLeft:
          isSidebarEnabled && !isMobile ? (sidebarCollapsed ? '100px' : '288px') : undefined,
      }"
    >
      <div class="mx-auto transition-all duration-300" :style="{ maxWidth: mainContentMaxWidth }">
        <div
          class="flex flex-col xl:flex-row xl:justify-between items-center gap-6 relative flatnas-header-container"
          :class="isWebPaginationMode ? 'mb-4' : 'mb-4'"
        >
          <div
            class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 flex-shrink-0 z-30 transition-all duration-500"
            :style="{ order: isHeaderRowLayout && store.appConfig.titleAlign === 'right' ? 2 : 0 }"
          >
            <h1
              class="font-bold transition-all duration-300 whitespace-nowrap"
              :style="{
                fontSize: store.appConfig.titleSize + 'px',
                color: store.appConfig.titleColor,
                textShadow: store.appConfig.background ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
              }"
            >
              {{ store.appConfig.customTitle }}
            </h1>
            <div
              class="items-center bg-white/90 backdrop-blur border border-gray-200 shadow-sm rounded-full p-1 gap-1 h-8"
              :class="store.appConfig.hideHeaderOnMobile ? 'hidden xl:flex' : 'flex'"
            >
              <button
                @click="openSettings"
                class="xl:hidden w-6 h-6 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-all"
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
              <button
                v-if="store.isLogged"
                @click="isEditMode = !isEditMode"
                class="xl:hidden px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="
                  isEditMode
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                "
              >
                {{ isEditMode ? "完成" : "编辑" }}
              </button>
              <button
                @click="toggleForceMode"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="{
                  'bg-gray-100 text-gray-400 hover:bg-gray-200': forceMode === 'auto',
                  'bg-green-100 text-green-600 hover:bg-green-200': forceMode === 'lan',
                  'bg-blue-100 text-blue-600 hover:bg-blue-200': forceMode === 'wan',
                  'bg-yellow-100 text-yellow-700 hover:bg-yellow-200': forceMode === 'latency',
                }"
              >
                {{
                  forceMode === "auto"
                    ? "自动"
                    : forceMode === "lan"
                      ? "强制内网"
                      : forceMode === "wan"
                        ? "强制外网"
                        : "延迟判定"
                }}
              </button>
              <div
                class="flex items-center gap-2 px-3 h-full rounded-full text-[10px] font-medium cursor-pointer hover:bg-gray-100 transition-all select-none"
                @click="handleNetworkClick"
              >
                <template v-if="isChecking"
                  ><div
                    class="w-2 h-2 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"
                  ></div
                ></template>
                <template v-else
                  ><div
                    class="w-1.5 h-1.5 rounded-full"
                    :class="effectiveIsLan ? 'bg-green-500' : 'bg-blue-500'"
                  ></div>
                  <span :class="effectiveIsLan ? 'text-green-700' : 'text-blue-700'">{{
                    effectiveIsLan ? "内网" : "外网"
                  }}</span
                  ><span class="text-gray-400 border-l pl-2 ml-1">{{ latency }}ms</span></template
                >
              </div>
              <button
                @click="handleAuthAction"
                class="px-3 h-6 rounded-full text-[10px] font-bold transition-all"
                :class="[
                  store.isLogged
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-blue-500 hover:text-white',
                ]"
              >
                {{ store.isLogged ? "退出" : "登录" }}
              </button>
            </div>
          </div>

          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w5'))"
            class="w-full xl:absolute xl:left-1/2 xl:-translate-x-1/2 z-50 transition-all duration-300"
            :class="isWideLayout ? 'xl:w-[32rem]' : 'xl:w-64'"
          >
            <form
              class="mx-auto shadow-lg hover:shadow-xl transition-shadow rounded-full bg-white/90 backdrop-blur-md border border-white/40 flex items-center p-1 flatnas-search-form"
              :style="{
                width: '100%',
                height: '41px',
                backgroundColor: `rgba(255, 255, 255, ${searchBgAlpha})`,
                '--flatnas-search-text-color': searchTextColor,
                '--flatnas-search-placeholder-color': searchPlaceholderColor,
              }"
              @submit.prevent="doSearch"
              action="."
            >
              <input
                ref="searchInputRef"
                id="main-search-input"
                name="q"
                v-model="searchText"
                @keyup.enter="doSearch"
                @mousedown.stop
                type="search"
                role="searchbox"
                aria-label="搜索框"
                autocomplete="off"
                autofocus
                class="h-full pl-6 pr-4 rounded-full bg-transparent border-0 outline-none flatnas-search-input"
                :style="{ width: 'calc(100% - 33.75%)' }"
                :placeholder="
                  (engines.find((e) => e.key === effectiveEngine)?.label || '搜索') + ' 搜索...'
                "
              />
              <div class="flex items-center justify-end" :style="{ width: '33.75%' }">
                <select
                  v-model="effectiveEngine"
                  aria-label="搜索引擎"
                  class="h-[34px] px-3 py-0 bg-transparent rounded-full border border-gray-200 focus:border-blue-400 outline-none flatnas-search-select"
                  :style="{ width: 'calc(100%)', fontSize: '15px' }"
                  @click.stop
                >
                  <option v-for="e in engines" :key="e.key" :value="e.key">{{ e.label }}</option>
                </select>
              </div>
            </form>
          </div>

          <div
            class="flex gap-1 xl:gap-3 flex-shrink-0 z-10 items-center transition-all duration-500 flatnas-handshake-signal absolute left-0 top-0 w-full xl:w-auto xl:static opacity-80 hover:opacity-100 xl:opacity-100 pointer-events-none xl:pointer-events-auto"
            :style="{ order: isHeaderRowLayout && store.appConfig.titleAlign === 'right' ? 0 : 2 }"
          >
            <MiniPlayer
              v-if="checkVisible(store.widgets.find((w) => w.type === 'player'))"
              key="mini-player-static"
              class="mr-auto xl:mr-0 pointer-events-auto"
            />
            <button
              @click="openSettings"
              class="hidden xl:flex pointer-events-auto rounded-full text-white items-center justify-center backdrop-blur transition-all w-8 h-8 xl:w-10 xl:h-10 bg-transparent xl:bg-white/20 xl:hover:bg-white/40 border-0 xl:border xl:border-white/20 shadow-none xl:shadow-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="w-6 h-6"
              >
                <path
                  fill-rule="evenodd"
                  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567l-.091.549a.798.798 0 01-.517.608 7.45 7.45 0 00-.478.198.798.798 0 01-.796-.064l-.453-.324a1.875 1.875 0 00-2.416.2l-.043.044a1.875 1.875 0 00-.204 2.416l.325.454a.798.798 0 01.064.796 7.448 7.448 0 00-.198.478.798.798 0 01-.608.517l-.55.092a1.875 1.875 0 00-1.566 1.849v.044c0 .917.663 1.699 1.567 1.85l.549.091c.281.047.508.25.608.517.06.162.127.321.198.478a.798.798 0 01-.064.796l-.324.453a1.875 1.875 0 00.2 2.416l.044.043a1.875 1.875 0 002.416.204l.454-.325a.798.798 0 01.796-.064c.157.071.316.137.478.198.267.1.47.327.517.608l.092.55c.15.903.932 1.566 1.849 1.566h.044c.917 0 1.699-.663 1.85-1.567l.091-.549a.798.798 0 01.517-.608 7.52 7.52 0 00.478-.198.798.798 0 01.796.064l.453.324a1.875 1.875 0 002.416-.2l.043-.044a1.875 1.875 0 00.204-2.416l-.325-.454a.798.798 0 01-.064-.796c.071-.157.137-.316.198-.478.1-.267.327-.47.608-.517l.55-.092a1.875 1.875 0 001.566-1.849v-.044c0-.917-.663-1.699-1.567-1.85l-.549-.091a.798.798 0 01-.608-.517 7.507 7.507 0 00-.198-.478.798.798 0 01.064-.796l.324-.453a1.875 1.875 0 00-.2-2.416l-.044-.043a1.875 1.875 0 00-2.416-.204l-.454.325a.798.798 0 01-.796.064 7.462 7.462 0 00-.478-.198.798.798 0 01-.517-.608l-.092-.55a1.875 1.875 0 00-1.849-1.566h-.044zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
            <button
              v-if="store.isLogged"
              @click="isEditMode = !isEditMode"
              class="hidden xl:block pointer-events-auto rounded-lg text-sm font-medium transition-all"
              :class="
                isEditMode
                  ? 'bg-red-500 text-white px-4 py-2 shadow-sm'
                  : 'bg-transparent text-white/70 hover:text-white xl:bg-white xl:text-gray-700 xl:hover:bg-gray-50 px-2 py-1 xl:px-4 xl:py-2 xl:shadow-sm shadow-none'
              "
            >
              {{ isEditMode ? "完成" : "编辑" }}
            </button>
            <button
              v-if="store.isLogged && isEditMode"
              @click="addDivCardWidget"
              class="hidden xl:flex pointer-events-auto rounded-lg text-sm font-medium transition-all bg-blue-500 text-white px-4 py-2 shadow-sm hover:bg-blue-600"
            >
              新建卡片
            </button>
          </div>
        </div>

        <VueDraggable
          v-if="isWebPaginationMode"
          v-model="store.groups"
          class="mb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide py-1"
          :group="{ name: 'pagination-groups', pull: false, put: false }"
          :sort="isEditMode && !searchText"
          :disabled="!isEditMode || !!searchText"
          @end="() => store.saveData()"
        >
          <button
            v-for="group in displayGroups"
            :key="group.id"
            type="button"
            @click="activePaginationGroupId = group.id"
            class="shrink-0 h-9 px-3.5 rounded-xl text-sm font-medium backdrop-blur-md transition-colors border shadow-sm bg-white/10 text-white/75 hover:bg-white/15 hover:text-white/90 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-black/30"
            :class="
              activePaginationGroupId === group.id
                ? 'bg-white/22 border-white/35 text-white shadow-[0_6px_18px_rgba(0,0,0,0.18)] ring-1 ring-white/35'
                : 'border-white/12'
            "
          >
            {{ group.title }}
          </button>
        </VueDraggable>

        <div
          v-if="layoutData.length > 0"
          class="group-container transition-all"
          :style="{ marginBottom: (store.appConfig.groupGap ?? 30) + 'px' }"
        >
          <GridLayout
            v-model:layout="scaledLayoutData"
            :col-num="widgetColNum * gridScale"
            :row-height="scaledRowHeight"
            :is-draggable="isEditMode && !activeResizeWidgetId"
            :is-resizable="false"
            :vertical-compact="true"
            :use-css-transforms="true"
            :margin="gridMargin"
            @layout-updated="handleScaledLayoutUpdated"
            :class="[
              'text-white select-none transition-all duration-300',
              activeResizeWidgetId ? 'smooth-size' : '',
            ]"
          >
          <GridItem
            v-for="widget in layoutData"
            :key="widget.i"
            :x="scaleGridValue(widget.x)"
            :y="scaleGridValue(widget.y)"
            :w="scaleGridValue(widget.w)"
            :h="scaleGridValue(widget.h)"
            :i="widget.i"
            :drag-allow-from="isHandheld && isEditMode ? '.widget-drag-handle' : undefined"
            :drag-ignore-from="
              isEditMode
                ? isHandheld
                  ? 'a'
                  : undefined
                : undefined
            "
            class="transition-all duration-300 relative"
            :class="[
              isEditMode
                ? 'ring-2 ring-blue-400/50 rounded-2xl cursor-move hover:ring-blue-500'
                : '',
              widget.hideOnMobile ? 'hidden md:block' : '',
              activeResizeWidgetId === widget.id ? '!z-[1000]' : '',
              store.appConfig.empireMode && isEmpireCloudWidget(widget.type)
                ? 'empire-cloud-widget'
                : '',
            ]"
          >
            <button
              v-if="isEditMode && widget.type === 'div-card'"
              @click.stop="deleteDivCardWidget(widget.id)"
              class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-red-600 hover:scale-110 transition-all"
            >
              ✕
            </button>
            <button
              v-if="isEditMode"
              @click.stop="onWidgetHandleClick(widget)"
              @pointerdown="onWidgetHandlePointerDown"
              @pointermove="onWidgetHandlePointerMove"
              @pointerup="onWidgetHandlePointerUp"
              @pointercancel="onWidgetHandlePointerUp"
              class="widget-drag-handle absolute bottom-2 right-2 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg z-50 hover:bg-blue-600 hover:scale-110 transition-all touch-none"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                ></path>
              </svg>
            </button>

            <SizeSelector
              v-if="isEditMode && activeResizeWidgetId === widget.id"
              :current-col="widget.w || widget.colSpan || 1"
              :current-row="widget.h || widget.rowSpan || (widget.type === 'bookmarks' ? 2 : 1)"
              @select="(size) => handleSizeSelect(widget, size)"
            />
            <ClockWidget v-if="widget.type === 'clock'" :widget="widget" />
            <SimpleWeatherWidget v-else-if="widget.type === 'weather'" :widget="widget" />
            <CalendarWidget v-else-if="widget.type === 'calendar'" :widget="widget" />
            <MemoWidget v-else-if="widget.type === 'memo'" :widget="widget" />
            <TodoWidget v-else-if="widget.type === 'todo'" :widget="widget" />
            <MusicWidget v-else-if="widget.type === 'music'" :widget="widget" />
            <CalculatorWidget v-else-if="widget.type === 'calculator'" />
            <div
              v-else-if="widget.type === 'div-card'"
              @click.stop="handleDivCardClick(widget)"
              @contextmenu.prevent.stop="handleDivCardContextMenu($event, widget)"
              class="div-card-click-target w-full h-full p-3 rounded-2xl border text-white flex flex-col justify-center items-center text-center relative overflow-hidden group transition-all duration-300"
              :class="[
                widget.data?.backgroundImage
                  ? 'border-white/20 bg-white/10 backdrop-blur'
                  : 'border-transparent bg-transparent',
                store.appConfig.mouseHoverEffect === 'lift'
                  ? 'hover:-translate-y-1 hover:shadow-lg'
                  : store.appConfig.mouseHoverEffect === 'glow'
                    ? 'hover:shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                    : ''
              ]"
            >
              <!-- ✨ 背景图层 (高斯模糊 + 遮罩) -->
              <div
                v-if="widget.data?.backgroundImage"
                class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
              >
                <div
                  class="absolute inset-0 bg-cover bg-center transition-all duration-300"
                  :style="{
                    backgroundImage: `url('${store.getAssetUrl(widget.data.backgroundImage)}')`,
                    filter: `blur(${widget.data.backgroundBlur ?? 6}px)`,
                    transform: 'scale(1.1)',
                  }"
                ></div>
                <div
                  class="absolute inset-0"
                  :style="{
                    backgroundColor: `rgba(0,0,0,${widget.data.backgroundMask ?? 0.3})`,
                  }"
                ></div>
              </div>

              <!-- Icon -->
              <div
                v-if="widget.data?.icon"
                class="relative flex items-center justify-center flex-shrink-0 transition-all duration-300 z-10 mb-2"
                :style="{
                  width: ((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100)) + 'px',
                  height: ((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100)) + 'px',
                }"
              >
                <IconShape
                  :shape="store.appConfig.iconShape || 'circle'"
                  :size="((store.appConfig.iconSize || 48) * ((widget.data.iconSize || 100) / 100))"
                  :imgScale="100"
                  :bgClass="
                    widget.data.color &&
                    !widget.data.color.includes('sky') &&
                    widget.data.color !== '#000000' &&
                    widget.data.color !== 'bg-black'
                      ? widget.data.color
                      : 'bg-white'
                  "
                  :icon="processIcon(widget.data.icon)"
                  class="w-full h-full"
                  :class="widget.data.backgroundImage ? 'drop-shadow-lg' : ''"
                />
              </div>

              <div
                class="text-sm font-semibold tracking-wide relative z-10 truncate w-full px-2"
                :style="{
                  color: widget.data?.titleColor || '#ffffff',
                  textShadow: widget.data?.backgroundImage ? '0 2px 4px rgba(0,0,0,0.8)' : 'none',
                }"
              >
                {{ widget.data?.title || "div 卡片" }}
              </div>

              <div
                v-if="!widget.data?.url && !widget.data?.lanUrl && !widget.data?.icon"
                class="text-[10px] opacity-70 mt-1 relative z-10"
              >
                请在编辑模式下右键添加项目
              </div>
            </div>
            <div
              v-else-if="widget.type === 'ip'"
              class="w-full h-full p-3 rounded-2xl backdrop-blur border border-white/10 flex flex-col items-center transition-colors text-center text-white"
              :style="{
                backgroundColor: `rgba(0,0,0,${Math.min(0.85, Math.max(0.15, widget.opacity ?? 0.35))})`,
                color: '#fff',
              }"
            >
              <div
                v-if="ipInfo.location"
                class="text-[19px] font-medium sm:font-bold w-full truncate flex-1 flex items-center justify-center -mt-px"
                :title="ipInfo.location"
              >
                {{ formattedLocation }}
              </div>
              <div class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[14px] opacity-70 uppercase">{{ ipTypeLabel }}</span>
                <button
                  class="max-w-full font-mono font-medium sm:font-bold leading-tight text-center select-text break-all hover:opacity-90 transition-opacity"
                  :class="isIpv6 ? 'text-[18px] sm:text-xl' : 'text-2xl'"
                  type="button"
                  :title="isIpv6 ? '点击复制完整 IPv6' : '点击复制 IP'"
                  @click.stop="copyToClipboard(ipInfo.displayIp)"
                >
                  {{ ipInfo.displayIp }}
                </button>
              </div>

              <div
                v-if="showClientIp"
                class="flex items-center justify-center gap-2 w-full -mt-1"
                :title="`客户端IP来源: ${ipInfo.clientIpSource || '-'}`"
              >
                <span class="text-[11px] opacity-70 uppercase">CLIENT</span>
                <button
                  class="max-w-full text-[12px] font-mono font-medium opacity-90 select-text break-all hover:opacity-100 transition-opacity"
                  type="button"
                  title="点击复制客户端 IP"
                  @click.stop="copyToClipboard(ipInfo.clientIp)"
                >
                  {{ ipInfo.clientIp }}
                </button>
              </div>

              <div class="flex items-center justify-center gap-2 w-full flex-1">
                <span class="text-[12px] opacity-70 uppercase">PING测试</span>
                <div
                  class="text-base font-mono font-medium text-white/90 bg-white/20 backdrop-blur-sm border border-white/20 px-2 py-0.5 rounded"
                >
                  {{ ipInfo.baiduLatency }}
                </div>
                <button
                  @click="fetchIp(true)"
                  class="text-[12px] text-white/80 bg-white/20 px-2.5 py-0.5 rounded hover:bg-white/30 transition-colors"
                >
                  刷新
                </button>
              </div>

              <div v-if="copiedToast" class="text-[11px] opacity-80 -mt-1">
                {{ copiedToast }}
              </div>
            </div>
            <CountdownWidget v-else-if="widget.type === 'countdown'" :widget="widget" />
            <CountUpWidget v-else-if="widget.type === 'countup'" :widget="widget" />
            <IframeWidget
              v-else-if="widget.type === 'iframe'"
              :widget="widget"
              :is-lan-mode="effectiveIsLan"
              :is-edit-mode="isEditMode"
            />
            <BookmarkWidget v-else-if="widget.type === 'bookmarks'" :widget="widget" />
            <HotWidget v-else-if="widget.type === 'hot'" :widget="widget" />
            <ClockWeatherWidget v-else-if="widget.type === 'clockweather'" :widget="widget" />
            <AmapWeatherWidget v-else-if="widget.type === 'amap-weather'" :widget="widget" />
            <RssWidget v-else-if="widget.type === 'rss'" :widget="widget" />
            <DockerWidget v-else-if="widget.type === 'docker'" :widget="widget" />
            <SystemStatusWidget v-else-if="widget.type === 'system-status'" :widget="widget" />
            <CustomCssWidget v-else-if="widget.type === 'custom-css'" :widget="widget" />
            <FileTransferWidget v-else-if="widget.type === 'file-transfer'" :widget="widget" />
          </GridItem>
        </GridLayout>
        </div>

        <Transition name="fade">
          <div v-if="store.isLogged && isEditMode" class="flex justify-center mb-4 gap-4">
            <button
              data-testid="add-group-btn"
              @click="store.addGroup"
              class="bg-white/10 hover:bg-white/20 text-white backdrop-blur border border-white/20 px-6 py-2 rounded-full font-bold transition-all flex items-center gap-2 shadow-lg"
            >
              <span>➕</span> 新建分组
            </button>
          </div>
        </Transition>

        <VueDraggable
          v-model="store.groups"
          handle=".group-handle"
          :move="checkMove"
          :animation="300"
          :forceFallback="true"
          :disabled="!isEditMode || isWebPaginationMode"
          @end="() => store.saveData()"
          class="pb-20 flex flex-col transition-all"
          :style="{ gap: (store.appConfig.groupGap ?? 30) + 'px' }"
        >
          <div
            v-for="group in displayGroups"
            :key="group.id"
            class="group-container"
            :id="'group-' + group.id"
            v-show="!isWebPaginationMode || group.id === activePaginationGroupId"
          >
            <div
              class="flex items-center gap-3 mb-2 group-header relative transition-opacity duration-200"
              :class="{ 'opacity-0 hover:opacity-100': group.autoHideTitle }"
            >
              <div
                v-if="isEditMode"
                class="group-handle cursor-move text-white/50 hover:text-white p-1 select-none text-xl"
              >
                ⋮⋮
              </div>
              <h2
                class="text-xl font-bold shadow-text px-2 rounded transition-colors outline-none"
                :style="{
                  color:
                    group.titleColor ||
                    store.appConfig.groupTitleColor ||
                    'var(--group-title-color)',
                }"
              >
                {{ group.title }}
              </h2>

              <div class="flex items-center gap-2">
                <button
                  v-if="store.isLogged"
                  @click="openAddModal(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="添加卡片"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged"
                  @click.stop="toggleGroupSettings(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="分组设置"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>

                <button
                  v-if="store.isLogged && isEditMode"
                  @click="openGroupDeleteConfirm(group.id)"
                  class="w-7 h-7 rounded-full bg-white/10 hover:bg-red-500 hover:text-white text-white/50 flex items-center justify-center transition-all shadow-sm border border-white/10"
                  title="删除分组"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              <span
                v-if="group.preset"
                class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded border border-yellow-200"
              >
                预设
              </span>
            </div>

            <VueDraggable
              :model-value="group.items"
              @update:model-value="(newItems: NavItem[]) => onGroupItemsChange(group.id, newItems)"
              @end="() => store.saveData()"
              group="apps"
              :animation="200"
              :forceFallback="true"
              :disabled="!isEditMode || !!searchText"
              class="grid transition-all duration-300 min-h-[100px] rounded-xl"
              :class="
                isEditMode ? 'bg-white/5 border-2 border-dashed border-white/20 p-2 md:p-4' : ''
              "
              :style="{
                gap: getLayoutConfig(group).gap + 'px',
                gridTemplateColumns: `repeat(auto-fill, minmax(${getLayoutConfig(group).minWidth}px, 1fr))`,
              }"
              ghostClass="ghost"
            >
              <div
                v-for="item in group.items"
                :key="item.id"
                @click="handleCardClick(item)"
                @mousedown.right.prevent.stop="handleContextMenuPointerDown($event, item, group.id)"
                @contextmenu.prevent.stop="handleContextMenu($event, item, group.id)"
                @pointerdown="(e) => onCardPointerDown(e, item, group.id)"
                @pointermove="onCardPointerMove"
                @pointerup="onCardPointerUp"
                @pointercancel="onCardPointerUp"
                @touchstart="(e) => onCardTouchStart(e, item, group.id)"
                @touchmove="onCardTouchMove"
                @touchend="onCardTouchEnd"
                @touchcancel="onCardTouchEnd"
                class="card-item flex items-center justify-center cursor-pointer transition-all select-none relative group hover:z-[999]"
                :class="[
                  item.containerId && isUpdating.has(item.containerId)
                    ? 'opacity-50 pointer-events-none !cursor-not-allowed animate-pulse ring-2 ring-yellow-400'
                    : '',
                  isEditMode ? 'animate-pulse cursor-move ring-2 ring-blue-400' : '',
                  (group.cardLayout || store.appConfig.cardLayout) === 'horizontal'
                    ? 'flex-row px-4 py-3 gap-3 justify-start'
                    : 'flex-col justify-center',
                  (group.iconShape || store.appConfig.iconShape) === 'circle'
                    ? 'rounded-2xl'
                    : (group.iconShape || store.appConfig.iconShape) === 'rounded'
                      ? 'rounded-2xl'
                      : (group.iconShape || store.appConfig.iconShape) === 'leaf'
                        ? 'rounded-tl-3xl rounded-br-3xl rounded-tr-md rounded-bl-md'
                        : 'rounded-lg',
                  (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                    ? ''
                    : 'border backdrop-blur-sm',
                  store.appConfig.mouseHoverEffect === 'lift'
                    ? 'hover:-translate-y-1 hover:shadow-lg'
                    : store.appConfig.mouseHoverEffect === 'glow'
                      ? 'hover:shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                      : store.appConfig.mouseHoverEffect === 'none'
                        ? ''
                        : 'hover:scale-105 active:scale-95',
                ]"
                :style="{
                  height: getLayoutConfig(group).height + 'px',
                  backgroundColor:
                    (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                      ? 'transparent'
                      : group.cardBgColor || store.appConfig.cardBgColor || 'var(--card-bg-color)',
                  borderColor:
                    (group.showCardBackground ?? store.appConfig.showCardBackground) === false
                      ? 'transparent'
                      : 'var(--card-border-color)',
                }"
              >
                <!-- ✨ 背景图层 (高斯模糊 + 遮罩) -->
                <div
                  v-if="item.backgroundImage || group.backgroundImage"
                  class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
                >
                  <div
                    class="absolute inset-0 bg-cover bg-center transition-all duration-300"
                    :style="{
                      backgroundImage: `url('${store.getAssetUrl(item.backgroundImage || group.backgroundImage)}')`,
                      filter: `blur(${item.backgroundImage ? (item.backgroundBlur ?? 6) : (group.backgroundBlur ?? 6)}px)`,
                      transform: 'scale(1.1)',
                    }"
                  ></div>
                  <div
                    class="absolute inset-0"
                    :style="{
                      backgroundColor: `rgba(0,0,0,${item.backgroundImage ? (item.backgroundMask ?? 0.3) : (group.backgroundMask ?? 0.3)})`,
                    }"
                  ></div>
                </div>

                <!-- Docker Stats Background Bars -->
                <div
                  v-if="getContainerStatus(item)"
                  class="absolute inset-0 z-0 pointer-events-none overflow-hidden rounded-[inherit]"
                >
                  <!-- Update Dot (Top Left) -->
                  <div
                    v-if="
                      getContainerStatus(item)?.hasUpdate &&
                      (!item.containerId || !isUpdating.has(item.containerId))
                    "
                    class="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-red-500 z-50 shadow-[0_0_4px_rgba(239,68,68,0.8)] border border-white/40 animate-pulse"
                    title="Container Image Update Available"
                  ></div>

                  <!-- Updating Indicator -->
                  <div
                    v-if="item.containerId && isUpdating.has(item.containerId)"
                    class="absolute inset-0 z-[60] flex items-center justify-center bg-black/10 backdrop-blur-[1px]"
                  >
                    <div
                      class="animate-spin w-8 h-8 border-4 border-yellow-400 border-t-transparent rounded-full"
                    ></div>
                  </div>

                  <!-- CPU Bar (Top, Right to Left) -->
                  <div class="absolute top-0 right-0 w-full h-1/2 bg-transparent opacity-20">
                    <div
                      class="absolute top-0 right-0 h-full bg-blue-500 transition-all duration-1000 ease-out"
                      :style="{
                        width:
                          Math.min(
                            100,
                            Math.max(0, getContainerStatus(item)?.stats?.cpuPercent || 0),
                          ) + '%',
                      }"
                    ></div>
                  </div>
                  <!-- CPU Label -->
                  <div class="absolute top-1 right-4 opacity-40 select-none z-10">
                    <svg
                      class="w-8 h-8"
                      viewBox="0 0 1024 1024"
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      p-id="8931"
                    >
                      <path
                        d="M719.768116 237.449275H304.231884a59.362319 59.362319 0 0 0-59.362319 59.362319v415.536232a59.362319 59.362319 0 0 0 59.362319 59.362319h415.536232a59.362319 59.362319 0 0 0 59.362319-59.362319V296.811594a59.362319 59.362319 0 0 0-59.362319-59.362319z m0 474.898551H304.231884V296.811594h415.536232v415.536232z m267.130435-237.449275a29.681159 29.681159 0 0 0 0-59.362319h-103.884058v-89.043478h103.884058a29.681159 29.681159 0 0 0 0-59.362319h-103.884058v-50.265044A78.313739 78.313739 0 0 0 801.391304 133.565217H764.289855V29.681159a29.681159 29.681159 0 0 0-59.362319 0v103.884058h-89.043478V29.681159a29.681159 29.681159 0 0 0-59.362319 0v103.884058h-89.043478V29.681159a29.681159 29.681159 0 0 0-59.362319 0v103.884058h-37.101449C173.516058 133.565217 126.144928 167.698551 126.144928 216.865391V267.130435H37.101449a29.681159 29.681159 0 0 0 0 59.362319h89.043479v89.043478H37.101449a29.681159 29.681159 0 0 0 0 59.362319h89.043479v89.043478H37.101449a29.681159 29.681159 0 0 0 0 59.362319h89.043479v89.043478H37.101449a29.681159 29.681159 0 0 0 0 59.362319h89.043479v23.937855A100.826899 100.826899 0 0 0 222.608696 890.434783H259.710145v103.884058a29.681159 29.681159 0 0 0 59.362319 0v-103.884058h89.043478v103.884058a29.681159 29.681159 0 0 0 59.362319 0v-103.884058h89.043478v103.884058a29.681159 29.681159 0 0 0 59.362319 0v-103.884058h37.101449c49.092638 0 81.623188-45.694145 81.623189-94.786783V771.710145h103.884058a29.681159 29.681159 0 0 0 0-59.362319h-103.884058v-89.043478h103.884058a29.681159 29.681159 0 0 0 0-59.362319h-103.884058v-89.043478h103.884058zM823.652174 801.391304a29.681159 29.681159 0 0 1-29.68116 29.68116H215.188406a29.681159 29.681159 0 0 1-29.68116-29.68116V222.608696a29.681159 29.681159 0 0 1 29.68116-29.68116h578.782608a29.681159 29.681159 0 0 1 29.68116 29.68116v578.782608z"
                        fill="#465975"
                        p-id="8932"
                      ></path>
                    </svg>
                  </div>

                  <!-- Memory Bar (Bottom, Left to Right) -->
                  <div class="absolute bottom-0 left-0 w-full h-1/2 bg-transparent opacity-20">
                    <div
                      class="absolute top-0 left-0 h-full bg-green-500 transition-all duration-1000 ease-out"
                      :style="{
                        width:
                          Math.min(
                            100,
                            Math.max(0, getContainerStatus(item)?.stats?.memPercent || 0),
                          ) + '%',
                      }"
                    ></div>
                  </div>
                  <!-- MEM Label -->
                  <div
                    class="absolute bottom-1 left-1/2 -translate-x-1/2 opacity-40 select-none z-10"
                  >
                    <svg
                      class="w-8 h-8"
                      viewBox="0 0 1024 1024"
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      p-id="4800"
                    >
                      <path
                        d="M85.333333 213.333333a42.666667 42.666667 0 0 0-42.666666 42.666667v384a42.666667 42.666667 0 0 0 42.666666 42.666667v85.333333a42.666667 42.666667 0 0 0 42.666667 42.666667h316.330667l42.666666-42.666667h50.005334l42.666666 42.666667H896a42.666667 42.666667 0 0 0 42.666667-42.666667v-85.333333a42.666667 42.666667 0 0 0 42.666666-42.666667V256a42.666667 42.666667 0 0 0-42.666666-42.666667H85.333333z m768 469.333334v42.666666h-238.336l-42.666666-42.666666H853.333333z m-401.664 0l-42.666666 42.666666H170.666667v-42.666666h281.002666zM128 597.333333V298.666667h768v298.666666H128z m85.333333-213.333333h85.333334v128H213.333333V384z m256 0H384v128h85.333333V384z m85.333334 0h85.333333v128h-85.333333V384z m256 0h-85.333334v128h85.333334V384z"
                        fill="#465975"
                        p-id="4801"
                      ></path>
                    </svg>
                  </div>
                </div>

                <div
                  v-if="isEditMode && item.isPublic"
                  class="absolute bottom-1 right-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 z-20"
                >
                  公开
                </div>

                <div
                  class="relative flex items-center justify-center flex-shrink-0 transition-all duration-300 relative z-10"
                  v-if="(group.iconShape || store.appConfig.iconShape) !== 'hidden'"
                  :style="{
                    width: getLayoutConfig(group).iconSize + 'px',
                    height: getLayoutConfig(group).iconSize + 'px',
                  }"
                >
                  <div
                    class="absolute inset-0 overflow-hidden flex items-center justify-center rounded-[inherit]"
                  >
                    <IconShape
                      :shape="group.iconShape || store.appConfig.iconShape"
                      :size="getLayoutConfig(group).iconSize"
                      :imgScale="item.iconSize"
                      :bgClass="
                        item.color &&
                        !item.color.includes('sky') &&
                        item.color !== '#000000' &&
                        item.color !== 'bg-black'
                          ? item.color
                          : 'bg-white'
                      "
                      :icon="processIcon(item.icon || '')"
                      class="transition-all duration-300 relative z-10 w-full h-full"
                      :class="item.backgroundImage || group.backgroundImage ? 'drop-shadow-lg' : ''"
                    />
                  </div>

                  <!-- Container Status Indicator -->
                  <div
                    v-if="getContainerStatus(item)"
                    class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white z-20"
                    :class="
                      getContainerStatus(item)?.state === 'running' ? 'bg-green-500' : 'bg-gray-400'
                    "
                    :title="getContainerStatus(item)?.state"
                  ></div>

                  <!-- Backup Url Badges -->
                  <!-- 外网备用地址 (左上角, 蓝色) -->
                  <div
                    v-if="item.backupUrls && item.backupUrls.length > 0"
                    class="absolute -top-1 -left-4 z-20 flex flex-col gap-0.5 pointer-events-auto"
                  >
                    <div
                      v-for="(url, idx) in item.backupUrls"
                      :key="'wan-' + idx"
                      @click.stop="openBackupUrl(url)"
                      class="flex items-center justify-center rounded-full bg-blue-600 text-white font-sans font-bold cursor-pointer hover:scale-110 hover:bg-blue-500 transition-all shadow-sm border border-white/50"
                      :style="{
                        width: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        height: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        fontSize: Math.max(10, getLayoutConfig(group).iconSize * 0.14) + 'px',
                        lineHeight: 1,
                      }"
                      :title="
                        typeof url === 'string' ? '外网: ' + url : url.name || '外网: ' + url.url
                      "
                    >
                      {{ idx + 1 }}
                    </div>
                  </div>

                  <!-- 内网备用地址 (右上角, 绿色) -->
                  <div
                    v-if="item.backupLanUrls && item.backupLanUrls.length > 0"
                    class="absolute -top-1 -right-4 z-20 flex flex-col gap-0.5 pointer-events-auto"
                  >
                    <div
                      v-for="(url, idx) in item.backupLanUrls"
                      :key="'lan-' + idx"
                      @click.stop="openBackupUrl(url)"
                      class="flex items-center justify-center rounded-full bg-green-600 text-white font-sans font-bold cursor-pointer hover:scale-110 hover:bg-green-500 transition-all shadow-sm border border-white/50"
                      :style="{
                        width: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        height: Math.max(16, getLayoutConfig(group).iconSize * 0.22) + 'px',
                        fontSize: Math.max(10, getLayoutConfig(group).iconSize * 0.14) + 'px',
                        lineHeight: 1,
                      }"
                      :title="
                        typeof url === 'string' ? '内网: ' + url : url.name || '内网: ' + url.url
                      "
                    >
                      {{ idx + 1 }}
                    </div>
                  </div>
                </div>

                <!-- Horizontal Mode: 3-Line Custom Text -->
                <div
                  v-if="(group.cardLayout || store.appConfig.cardLayout) === 'horizontal'"
                  class="flex-1 flex flex-col h-full justify-center gap-0.5 overflow-hidden relative z-10"
                >
                  <!-- Line 1 (Top) -->
                  <div
                    :class="[
                      !item.description1 && !item.description2 && !item.description3
                        ? 'text-left'
                        : 'text-xs',
                      'truncate font-medium leading-tight flex justify-between items-center',
                    ]"
                    :style="{
                      color:
                        item.titleColor ||
                        (item.backgroundImage || group.backgroundImage
                          ? '#ffffff'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                      fontSize: group.cardTitleSize ? group.cardTitleSize + 'px' : undefined,
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                      opacity:
                        item.description1 || (!item.description2 && !item.description3) ? 1 : 0.5,
                    }"
                  >
                    <span class="truncate flex-1">{{ item.description1 || item.title }}</span>
                  </div>

                  <!-- Docker Stats Info -->
                  <div
                    v-if="getContainerStatus(item)"
                    class="flex flex-col gap-0.5 text-[10px] mt-0.5 w-full opacity-90 leading-none font-mono"
                    :style="{
                      color:
                        item.titleColor ||
                        (item.backgroundImage || group.backgroundImage
                          ? '#ffffff'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#374151'),
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    <div class="flex justify-between items-center" title="Network I/O (RX/TX)">
                      <span class="font-bold opacity-70">NET</span>
                      <span class="font-mono truncate ml-1">
                        <template v-if="getContainerStatus(item)?.stats">
                          ↓{{ formatBytes(getContainerStatus(item)?.stats?.netIO?.rx || 0, 0) }}/s
                        </template>
                        <template v-else>--</template>
                      </span>
                    </div>
                    <div class="flex justify-between items-center" title="Block I/O (Read/Write)">
                      <span class="font-bold opacity-70">IO</span>
                      <span class="font-mono truncate ml-1">
                        <template v-if="getContainerStatus(item)?.stats">
                          R{{
                            formatBytes(getContainerStatus(item)?.stats?.blockIO?.read || 0, 0)
                          }}/s
                        </template>
                        <template v-else>--</template>
                      </span>
                    </div>
                  </div>

                  <!-- Line 2 (Middle) -->
                  <div
                    class="text-[10px] truncate leading-tight opacity-80"
                    :style="{
                      color:
                        item.backgroundImage || group.backgroundImage
                          ? '#e5e7eb'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#4b5563',
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    {{ item.description2 || "" }}
                  </div>

                  <!-- Line 3 (Bottom) -->
                  <div
                    class="text-[10px] truncate leading-tight opacity-70"
                    :style="{
                      color:
                        item.backgroundImage || group.backgroundImage
                          ? '#d1d5db'
                          : group.cardTitleColor || store.appConfig.cardTitleColor || '#6b7280',
                      textShadow:
                        item.backgroundImage || group.backgroundImage
                          ? '0 1px 2px rgba(0,0,0,0.8)'
                          : 'none',
                    }"
                  >
                    {{ item.description3 || "" }}
                  </div>
                </div>

                <!-- Vertical Mode: Standard Title -->
                <span
                  v-else
                  class="font-medium truncate relative z-10"
                  :class="'text-center px-2 w-full'"
                  :style="{
                    color:
                      item.titleColor ||
                      (item.backgroundImage || group.backgroundImage
                        ? '#ffffff'
                        : group.cardTitleColor || store.appConfig.cardTitleColor || '#111827'),
                    fontSize: group.cardTitleSize ? group.cardTitleSize + 'px' : undefined,
                    textShadow:
                      item.backgroundImage || group.backgroundImage
                        ? '0 2px 4px rgba(0,0,0,0.8)'
                        : 'none',
                  }"
                >
                  {{ item.title }}
                </span>
              </div>
            </VueDraggable>
          </div>
        </VueDraggable>
      </div>
    </div>

    <!-- Footer -->
    <footer
      class="w-full z-10 relative shrink-0 px-8 transition-all flex items-center pb-[env(safe-area-inset-bottom)]"
      :class="[
        !store.appConfig.footerHeight ? 'pt-6' : '',
        isMobile
          ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]'
          : !store.appConfig.footerHeight
            ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
            : '',
      ]"
      :style="{
        height: store.appConfig.footerHeight ? store.appConfig.footerHeight + 'px' : 'auto',
        marginBottom: (store.appConfig.footerMarginBottom || 0) + 'px',
      }"
    >
      <div
        class="mx-auto flex justify-between items-center w-full"
        :class="{ 'flex-col gap-6': isMobile }"
        :style="{
          maxWidth: (store.appConfig.footerWidth || 1280) + 'px',
          fontSize: (store.appConfig.footerFontSize || 12) + 'px',
        }"
      >
        <!-- Left: Visitor Stats -->
        <div
          class="flex-1 flex items-center justify-start gap-4"
          :class="{ '!justify-center order-last': isMobile }"
        >
          <!-- Connection Status -->
          <div
            v-if="false"
            class="flex items-center gap-2 opacity-80 select-none"
            :title="store.isConnected ? '已连接到服务器' : '与服务器断开连接'"
          >
            <div
              class="w-2 h-2 rounded-full transition-colors duration-300"
              :class="
                store.isConnected
                  ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
                  : 'bg-red-500 animate-pulse'
              "
            ></div>
            <span
              class="text-xs font-mono font-bold"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
              >{{ store.isConnected ? "LIVE" : "OFFLINE" }}</span
            >
          </div>

          <div
            v-if="store.appConfig.showFooterStats"
            class="flex gap-4 opacity-60 select-none"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          >
            <div class="flex flex-col gap-1">
              <span>访客记录</span>
              <span class="font-mono">{{ totalVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>今日访客</span>
              <span class="font-mono">{{ todayVisitors }}</span>
            </div>
            <div class="w-px bg-current opacity-30"></div>
            <div class="flex flex-col gap-1">
              <span>在线时长</span>
              <span class="font-mono">{{ onlineDuration }}</span>
            </div>
          </div>
        </div>

        <!-- Center: Custom HTML -->
        <div class="flex-1 flex justify-center px-4">
          <div
            v-if="store.appConfig.footerHtml"
            v-html="sanitizedFooterHtml"
            class="text-center opacity-60"
            :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-500'"
          ></div>
        </div>

        <!-- Right: Quote -->
        <div class="flex-1 flex justify-end" :class="{ '!justify-center order-first': isMobile }">
          <div
            v-if="checkVisible(store.widgets.find((w) => w.id === 'w7'))"
            class="text-right max-w-md cursor-pointer hover:opacity-80 transition-opacity select-none"
            :class="{ '!text-center': isMobile }"
            @click="fetchHitokoto"
            title="点击刷新"
          >
            <p
              class="font-serif italic mb-1 opacity-70"
              :class="store.appConfig.background ? 'text-white shadow-text' : 'text-gray-600'"
              style="font-size: 1.25em"
            >
              “ {{ hitokoto.hitokoto }} ”
            </p>
            <p
              class="opacity-70"
              :class="store.appConfig.background ? 'text-white/80 shadow-text' : 'text-gray-400'"
            >
              —— {{ hitokoto.from }}
            </p>
          </div>
        </div>
      </div>
    </footer>

    <!-- Group Settings Overlay -->
    <GroupSettingsModal
      v-if="showGroupSettingsModal"
      v-model:show="showGroupSettingsModal"
      :groupId="activeGroupId"
    />

    <EditModal
      v-if="showEditModal"
      v-model:show="showEditModal"
      :data="currentEditItem"
      :groupId="currentGroupId"
      @save="handleSave"
    />
    <SettingsModal v-if="showSettingsModal" v-model:show="showSettingsModal" />
    <LoginModal v-if="showLoginModal" v-model:show="showLoginModal" />

    <!-- Context Menu -->
    <div
      v-show="showContextMenu"
      ref="contextMenuRef"
      data-grid-context-menu
      class="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] overflow-hidden"
      :style="{ top: contextMenuPosition.y + 'px', left: contextMenuPosition.x + 'px' }"
      @click.stop
      role="menu"
    >
      <div
        v-if="contextMenuItem?.lanUrl"
        @click="handleMenuLanOpen"
        class="px-4 py-2 hover:bg-green-50 text-green-700 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
        role="menuitem"
        :aria-label="'内网访问 ' + (contextMenuItem.title || '')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <span class="text-[14px] truncate">内网访问</span>
      </div>
      <!-- Backup LAN URLs -->
      <template v-if="contextMenuItem?.backupLanUrls && contextMenuItem.backupLanUrls.length > 0">
        <div
          v-for="(url, index) in contextMenuItem.backupLanUrls"
          :key="'backup-lan-' + index"
          @click="handleMenuOpen(url)"
          class="px-4 py-2 hover:bg-green-50 text-green-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <span class="text-[14px] truncate">{{ typeof url === "string" ? "备用内网 " + (index + 1) : url.name || "备用内网 " + (index + 1) }}</span>
        </div>
      </template>

      <div
        v-if="contextMenuItem?.url"
        @click="handleMenuWanOpen"
        class="px-4 py-2 hover:bg-blue-50 text-blue-700 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
        role="menuitem"
        :aria-label="'外网访问 ' + (contextMenuItem.title || '')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <span class="text-[14px] truncate">外网访问</span>
      </div>
      <!-- Backup WAN URLs -->
      <template v-if="contextMenuItem?.backupUrls && contextMenuItem.backupUrls.length > 0">
        <div
          v-for="(url, index) in contextMenuItem.backupUrls"
          :key="'backup-wan-' + index"
          @click="handleMenuOpen(url)"
          class="px-4 py-2 hover:bg-blue-50 text-blue-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span class="text-[14px] truncate">{{ typeof url === "string" ? "备用外网 " + (index + 1) : url.name || "备用外网 " + (index + 1) }}</span>
        </div>
      </template>

      <!-- Docker Actions -->
      <template v-if="contextMenuItem?.containerId || contextMenuItem?.containerName">
        <div
          v-if="getContainerStatus(contextMenuItem)?.hasUpdate && !isItemUpdating(contextMenuItem)"
          @click="
            handleDockerAction(contextMenuItem, 'update');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-yellow-50 text-yellow-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-[14px] truncate">升级镜像</span>
        </div>

        <div
          v-if="getContainerStatus(contextMenuItem)?.state === 'running'"
          @click="
            handleDockerAction(contextMenuItem, 'stop');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
          <span class="text-[14px] truncate">停止容器</span>
        </div>
        <div
          v-else
          @click="
            handleDockerAction(contextMenuItem, 'start');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-green-50 text-green-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-[14px] truncate">启动容器</span>
        </div>

        <div
          @click="
            handleDockerAction(contextMenuItem, 'restart');
            closeContextMenu();
          "
          class="px-4 py-2 hover:bg-blue-50 text-blue-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-b border-gray-100 truncate"
          role="menuitem"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-[14px] truncate">重启容器</span>
        </div>
      </template>

      <div
        @click="handleMenuEdit"
        class="px-4 py-2 hover:bg-blue-50 text-gray-700 cursor-pointer flex items-center gap-3 text-sm transition-colors"
        role="menuitem"
        aria-label="编辑卡片"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span class="text-[14px] truncate">编辑卡片</span>
      </div>
      <div
        @click="handleMenuDelete"
        class="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer flex items-center gap-3 text-sm transition-colors border-t border-gray-100"
        role="menuitem"
        aria-label="删除卡片"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span class="text-[14px] truncate">删除卡片</span>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="showDeleteConfirm = false"
    >
      <div
        class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm transform transition-all scale-100 border border-gray-100"
      >
        <h3 class="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
          <span class="text-red-500 text-xl">⚠️</span> 删除确认
        </h3>
        <p class="text-gray-600 mb-6">
          确定要删除这个{{ deleteType === "group" ? "分组" : "卡片" }}吗？此操作无法撤销。
        </p>
        <div class="flex justify-end gap-3">
          <button
            @click="showDeleteConfirm = false"
            class="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 font-medium transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            class="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium shadow-sm transition-colors flex items-center gap-1"
          >
            <span>🗑️</span> 删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ghost {
  opacity: 0.4;
  background: rgba(255, 255, 255, 0.5);
  border: 2px dashed #9ca3af;
}
.shadow-text {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.flatnas-search-input,
.flatnas-search-select {
  color: var(--flatnas-search-text-color, #111827);
}
.flatnas-search-input::placeholder {
  color: var(--flatnas-search-placeholder-color, rgba(107, 114, 128, 1));
}
.card-item {
  border-color: var(--card-border-color);
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease,
    transform 200ms ease;
}
.card-item:hover {
  border-color: var(--card-border-hover-color);
}
[contenteditable]:focus {
  background-color: rgba(255, 255, 255, 0.2);
}
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.weather-texture-layer {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.25'/%3E%3C/svg%3E");
  background-size: 240px 240px;
  mix-blend-mode: screen;
  animation: weather-texture-pan 18s linear infinite;
}

.weather-fog-layer {
  background-image:
    radial-gradient(circle at 20% 30%, rgba(200, 220, 255, 0.35), transparent 55%),
    radial-gradient(circle at 70% 60%, rgba(180, 210, 255, 0.4), transparent 60%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(120, 140, 170, 0.35));
  filter: blur(12px);
  animation: weather-fog-drift 22s ease-in-out infinite;
}

@keyframes weather-texture-pan {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 240px 240px;
  }
}

@keyframes weather-fog-drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-3%, 2%, 0);
  }
}

:deep(path[class*="fill-sky-100"]),
:deep(path[class*="fill-blue-100"]),
:deep(path[class*="fill-blue-50"]),
:deep(path[class*="fill-gray-100"]),
:deep(path[class*="fill-purple-100"]),
:deep(path[class*="fill-green-100"]),
:deep(path[class*="fill-red-100"]),
:deep(path[class*="fill-yellow-100"]),
:deep(path[class*="fill-orange-100"]) {
  fill: #ffffff !important;
}

.empire-theme {
  --group-title-color: #ffd700 !important;
  --card-title-color: #ffd700 !important;
  color: #ffd700 !important;
}

.empire-theme :deep(.text-gray-900),
.empire-theme :deep(.text-gray-800),
.empire-theme :deep(.text-gray-700),
.empire-theme :deep(.text-gray-600),
.empire-theme :deep(.text-gray-500),
.empire-theme :deep(.text-gray-400) {
  color: #ffd700 !important;
}

.empire-theme :deep(.bg-white) {
  backdrop-filter: blur(10px);
}

.empire-theme :deep(.bg-gray-50) {
  background-color: rgba(0, 0, 0, 0.2) !important;
}

.empire-theme :deep(svg) {
  color: #ffd700 !important;
  fill: currentColor;
}

.empire-theme :deep(.border-gray-200),
.empire-theme :deep(.border-gray-100) {
  border-color: rgba(255, 215, 0, 0.2) !important;
}

/* Force background override for ALL widget root elements */
.empire-theme .vgl-item > * {
  background-color: #000000 !important;
  background-image:
    url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4af37' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"),
    radial-gradient(circle at 50% 50%, #2a2a2a, #000000) !important;
  border: 1px solid rgba(255, 215, 0, 0.6) !important;
  box-shadow:
    inset 0 0 20px rgba(0, 0, 0, 0.8),
    0 0 10px rgba(255, 215, 0, 0.2) !important;
}

/* Hide original backgrounds of inner elements */
.empire-theme .vgl-item > * > [class*="bg-"],
.empire-theme .vgl-item > * > [class*="bg-gradient-"],
.empire-theme :deep(.bg-white),
.empire-theme :deep(.bg-white\/80),
.empire-theme :deep(.bg-yellow-100\/90),
.empire-theme :deep(.bg-gradient-to-br) {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

/* Ensure backdrop-blur doesn't make things white */
.empire-theme :deep(.backdrop-blur),
.empire-theme :deep(.backdrop-blur-md),
.empire-theme :deep(.backdrop-blur-sm) {
  backdrop-filter: none !important;
}

/* Specific fix for Calendar, Todo, Bookmarks which use specific classes */
.empire-theme .vgl-item :deep(.bg-white\/90),
.empire-theme .vgl-item :deep(.bg-white\/50),
.empire-theme .vgl-item :deep(.hover\:bg-white:hover) {
  background-color: transparent !important;
}

/* Fix for Memo Widget */
.empire-theme :deep(.bg-yellow-100\/90) {
  background-color: transparent !important;
  border-color: transparent !important;
}

/* Ensure text visibility on the dark background */
.empire-theme :deep(.text-gray-900),
.empire-theme :deep(.text-gray-800),
.empire-theme :deep(.text-gray-700),
.empire-theme :deep(.text-gray-600),
.empire-theme :deep(.text-gray-500),
.empire-theme :deep(.text-gray-400),
.empire-theme :deep(.text-gray-300) {
  color: #ffd700 !important;
}

/* Fix for Todo Widget input area */
.empire-theme :deep(.bg-gray-50),
.empire-theme :deep(.focus\:bg-white:focus),
.empire-theme :deep(input),
.empire-theme :deep(textarea) {
  background-color: rgba(255, 255, 255, 0.05) !important;
  color: #ffd700 !important;
  border-color: rgba(255, 215, 0, 0.3) !important;
}

/* Fix for buttons and active states */
.empire-theme :deep(.bg-blue-50),
.empire-theme :deep(.bg-blue-100),
.empire-theme :deep(.bg-red-50),
.empire-theme :deep(.bg-red-100),
.empire-theme :deep(.bg-orange-50),
.empire-theme :deep(.bg-green-100),
.empire-theme :deep(.hover\:bg-gray-100:hover),
.empire-theme :deep(.hover\:bg-gray-200:hover) {
  background-color: rgba(255, 215, 0, 0.1) !important;
  color: #ffd700 !important;
  border-color: rgba(255, 215, 0, 0.2) !important;
}

/* Fix for specific text colors (Blue/Red/Green usually used for links/status) */
.empire-theme :deep(.text-blue-600),
.empire-theme :deep(.text-blue-500),
.empire-theme :deep(.text-blue-400),
.empire-theme :deep(.text-red-600),
.empire-theme :deep(.text-red-500),
.empire-theme :deep(.text-green-600),
.empire-theme :deep(.text-orange-600) {
  color: #ffd700 !important;
  text-shadow: 0 0 5px rgba(255, 215, 0, 0.3);
}

/* Calendar Today Highlight */
.empire-theme :deep(.text-red-600.font-bold) {
  color: #ff4500 !important;
  text-shadow: 0 0 10px rgba(255, 69, 0, 0.5);
}

/* Docker Status Bars */
.empire-theme :deep(.bg-gray-200) {
  background-color: rgba(255, 255, 255, 0.1) !important;
}
/* Weather Animations */
.animate-texture-pan {
  animation: texturePan 15s linear infinite;
}
.animate-fog-fade {
  animation: fogFade 8s ease-in-out infinite alternate;
}
@keyframes texturePan {
  0% { background-position: 0 0; }
  100% { background-position: 100% 100%; }
}
@keyframes fogFade {
  0% { opacity: 0.3; }
  100% { opacity: 0.7; }
}
</style>
