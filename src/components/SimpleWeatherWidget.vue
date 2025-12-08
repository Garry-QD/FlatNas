<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useMainStore } from "../stores/main";
import type { WidgetConfig } from "@/types";
import { cityData } from "@/utils/cityData";

const props = defineProps<{
  widget?: WidgetConfig;
}>();

const store = useMainStore();
const showCityInput = ref(false);
const customCityInput = ref("");
const selectedProvince = ref("");

const getInitialCity = () => {
  if (props.widget?.data?.city) return props.widget.data.city;
  try {
    const cachedCity = localStorage.getItem("flatnas_auto_city");
    if (cachedCity) {
      const data = JSON.parse(cachedCity);
      return data.city;
    }
  } catch (e) {
    // ignore error
  }
  return "定位中...";
};

const weather = ref({
  temp: "--",
  city: getInitialCity(),
  text: "...",
  humidity: "",
  today: { min: "", max: "" },
});
const isNight = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

// Initialize input
if (props.widget?.data?.city) {
  customCityInput.value = props.widget.data.city;
}

const saveCity = () => {
  try {
    if (props.widget) {
      if (!props.widget.data) props.widget.data = {};
      const newCity = customCityInput.value.trim();
      props.widget.data.city = newCity;
      fetchWeather();
    }
  } catch (e) {
    console.error("Failed to save city", e);
  } finally {
    showCityInput.value = false;
  }
};

// 映射天气类型
const weatherType = computed(() => {
  const text = weather.value.text;
  if (text.includes("雨")) return "rain";
  if (text.includes("雪")) return "snow";
  if (text.includes("雾") || text.includes("霾")) return "fog";
  if (text.includes("云") || text.includes("阴")) return "cloudy";
  if (text.includes("晴")) return isNight.value ? "clear-night" : "sunny";
  return "default";
});

// 计算背景样式
const bgClass = computed(() => {
  switch (weatherType.value) {
    case "sunny":
      return "bg-gradient-to-br from-blue-400 via-blue-300 to-orange-200";
    case "clear-night":
      return "bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900";
    case "cloudy":
      return "bg-gradient-to-br from-slate-400 via-slate-300 to-gray-200";
    case "rain":
      return "bg-gradient-to-br from-slate-700 via-blue-900 to-slate-800";
    case "snow":
      return "bg-gradient-to-br from-blue-100 via-white to-blue-50";
    case "fog":
      return "bg-gradient-to-br from-gray-500 via-slate-400 to-zinc-400";
    default:
      return "bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500";
  }
});

const updateTime = () => {
  const hour = new Date().getHours();
  isNight.value = hour < 6 || hour >= 18;
};

const isCacheValid = (timestamp: number, duration: number) => {
  return Date.now() - timestamp < duration;
};

// 获取天气
const fetchWeather = async () => {
  try {
    let city = "本地";

    // 优先使用自定义城市
    if (props.widget?.data?.city) {
      city = props.widget.data.city;
    } else {
      // 尝试从缓存读取自动定位城市 (缓存 1 小时)
      const cachedCity = localStorage.getItem("flatnas_auto_city");
      let useCache = false;
      if (cachedCity) {
        try {
          const data = JSON.parse(cachedCity);
          if (isCacheValid(data.timestamp, 60 * 60 * 1000)) {
            city = data.city;
            useCache = true;
          }
        } catch (e) {
          localStorage.removeItem("flatnas_auto_city");
        }
      }

      if (!useCache) {
        // 否则使用 IP 定位
        const ipRes = await fetch("/api/ip");
        if (!ipRes.ok) throw new Error("IP API Error");
        const ipData = await ipRes.json();

        if (ipData.success && ipData.location) {
          let loc = ipData.location.split(" ")[0];
          loc = loc.replace(/^(?:.*?省|.*?自治区|.*?特别行政区)/, "");
          const match = loc.match(/^(.*?[市州盟地区])/);
          if (match) {
            loc = match[1];
          }
          city = loc;

          // 保存定位缓存
          localStorage.setItem(
            "flatnas_auto_city",
            JSON.stringify({
              city: city,
              timestamp: Date.now(),
            }),
          );
        }
      }
    }

    // 检查天气缓存 (缓存 20 分钟)
    const cachedWeather = localStorage.getItem(`flatnas_weather_${city}`);
    if (cachedWeather) {
      try {
        const data = JSON.parse(cachedWeather);
        if (isCacheValid(data.timestamp, 20 * 60 * 1000)) {
          weather.value = data.weather;
          return;
        }
      } catch (e) {
        localStorage.removeItem(`flatnas_weather_${city}`);
      }
    }

    let url = `/api/weather?city=${encodeURIComponent(city)}`;
    if (store.appConfig.weatherApiUrl) {
      url = store.appConfig.weatherApiUrl;
      if (url.includes("{city}")) {
        url = url.replace("{city}", encodeURIComponent(city));
      }
    }

    const weatherRes = await fetch(url);
    if (!weatherRes.ok) throw new Error("Weather API Error");
    const weatherData = await weatherRes.json();

    if (weatherData.success && weatherData.data) {
      weather.value = {
        temp: weatherData.data.temp,
        city: city,
        text: weatherData.data.text,
        humidity: weatherData.data.humidity,
        today: weatherData.data.today,
      };

      // 保存天气缓存
      localStorage.setItem(
        `flatnas_weather_${city}`,
        JSON.stringify({
          weather: weather.value,
          timestamp: Date.now(),
        }),
      );
    }
  } catch (e) {
    console.warn("[Weather] 获取失败，转为离线模式", e);
    weather.value = { ...weather.value, temp: "22", city: "本地", text: "舒适" };
  }
};

onMounted(() => {
  updateTime();
  fetchWeather();
  timer = setInterval(updateTime, 60000); // 每分钟更新一次昼夜状态
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div
    class="h-full w-full relative overflow-hidden text-white group select-none transition-all duration-500 rounded-2xl"
  >
    <!-- 动态背景层 -->
    <div class="absolute inset-0 transition-colors duration-1000 ease-in-out" :class="bgClass">
      <!-- 晴天动画 -->
      <div
        v-if="weatherType === 'sunny'"
        class="absolute -top-10 -right-10 w-48 h-48 opacity-30 animate-spin-slow"
      >
        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="20" fill="yellow" />
          <path
            d="M50 10V20 M50 80V90 M10 50H20 M80 50H90 M22 22L29 29 M71 71L78 78 M22 78L29 71 M71 29L78 22"
            stroke="yellow"
            stroke-width="4"
            stroke-linecap="round"
          />
        </svg>
      </div>

      <!-- 夜晚动画 -->
      <div v-if="weatherType === 'clear-night'" class="absolute inset-0">
        <div class="absolute top-10 right-10 w-16 h-16 text-yellow-100 opacity-80 animate-pulse">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"
            />
          </svg>
        </div>
        <div
          class="star absolute top-1/4 left-1/4 w-1 h-1 bg-white rounded-full animate-twinkle"
        ></div>
        <div
          class="star absolute top-3/4 right-1/3 w-1 h-1 bg-white rounded-full animate-twinkle delay-75"
        ></div>
        <div
          class="star absolute bottom-1/4 left-1/3 w-1 h-1 bg-white rounded-full animate-twinkle delay-150"
        ></div>
      </div>

      <!-- 多云动画 -->
      <div v-if="weatherType === 'cloudy'" class="absolute inset-0 overflow-hidden">
        <div class="absolute top-4 right-[-20%] w-32 h-20 opacity-40 animate-float-slow">
          <svg viewBox="0 0 24 24" fill="currentColor" class="text-white">
            <path
              d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"
            />
          </svg>
        </div>
      </div>

      <!-- 下雨动画 -->
      <div
        v-if="weatherType === 'rain'"
        class="absolute inset-0 flex justify-around items-start overflow-hidden opacity-50"
      >
        <div
          v-for="i in 6"
          :key="i"
          class="w-0.5 h-16 bg-gradient-to-b from-transparent to-white animate-rain"
          :style="{ animationDelay: `${Math.random()}s`, opacity: Math.random() }"
        ></div>
      </div>

      <!-- 雪天动画 -->
      <div v-if="weatherType === 'snow'" class="absolute inset-0 overflow-hidden">
        <div
          v-for="i in 12"
          :key="i"
          class="absolute w-1.5 h-1.5 bg-white rounded-full animate-snow opacity-80"
          :style="{
            left: `${Math.random() * 100}%`,
            top: '-10px',
            animationDelay: `${Math.random() * 5}s`,
            animationDuration: `${3 + Math.random() * 4}s`,
          }"
        ></div>
      </div>

      <!-- 雾天动画 -->
      <div v-if="weatherType === 'fog'" class="absolute inset-0 overflow-hidden">
        <div
          class="absolute bottom-0 left-[-50%] w-[200%] h-[60%] bg-white/20 blur-[40px] animate-fog-flow"
        ></div>
        <div
          class="absolute bottom-[-20%] left-[-20%] w-[150%] h-[50%] bg-white/10 blur-[30px] animate-fog-flow-reverse"
        ></div>
      </div>
    </div>

    <!-- 玻璃质感遮罩 -->
    <div
      class="absolute inset-0 bg-black/5 backdrop-blur-[0px] group-hover:backdrop-blur-[2px] transition-all duration-500"
    ></div>

    <!-- 内容区域 -->
    <div class="relative z-10 h-full flex flex-col items-center justify-center p-4">
      <div class="text-4xl sm:text-5xl font-bold tracking-tighter drop-shadow-lg mb-2">
        {{ weather.temp }}°
      </div>
      <div class="text-sm sm:text-base font-medium opacity-90 flex items-center gap-2">
        <span>{{ weather.text }}</span>
        <span class="w-1 h-1 rounded-full bg-white/50"></span>
        <span>{{ weather.city }}</span>
      </div>
      <div
        v-if="weather.today && weather.today.min"
        class="mt-2 text-xs opacity-75 flex items-center gap-2"
      >
        <span>{{ weather.today.min }}° / {{ weather.today.max }}°</span>
      </div>
    </div>

    <!-- 设置按钮 -->
    <div
      v-if="props.widget && store.isLogged"
      class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20"
    >
      <button
        @click.stop="showCityInput = true"
        class="p-1.5 bg-black/10 text-white/70 hover:text-white rounded-full hover:bg-black/30 backdrop-blur-md transition-colors"
        title="设置城市"
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
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
          />
        </svg>
      </button>
    </div>

    <!-- 城市输入弹窗 -->
    <Teleport to="body">
      <div
        v-if="showCityInput"
        class="fixed inset-0 bg-black/60 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4"
        @click.stop
      >
        <div
          class="bg-gray-900/90 p-6 rounded-2xl border border-white/10 shadow-2xl max-w-sm w-full backdrop-blur-xl"
        >
          <div class="text-lg font-medium mb-4 text-white">设置城市</div>
          <input
            v-model="customCityInput"
            @keyup.enter="saveCity"
            placeholder="输入城市 (为空自动)"
            class="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/40 text-left outline-none focus:bg-white/20 focus:border-white/40 mb-4 transition-all"
            autofocus
          />

          <!-- 城市选择区域 -->
          <div class="mb-6 w-full">
            <!-- 模式切换/面包屑 -->
            <div class="flex items-center gap-2 mb-2 text-sm">
              <button
                @click="selectedProvince = ''"
                class="text-white/50 hover:text-white transition-colors"
                :class="{ 'font-bold text-white': !selectedProvince }"
              >
                省份/地区
              </button>
              <span v-if="selectedProvince" class="text-white/30">/</span>
              <span v-if="selectedProvince" class="text-white font-bold">{{
                selectedProvince
              }}</span>
            </div>

            <!-- 省份列表 -->
            <div
              v-if="!selectedProvince"
              class="grid grid-cols-5 gap-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar"
            >
              <button
                v-for="(cities, province) in cityData"
                :key="province"
                @click="selectedProvince = province"
                class="px-1 py-1.5 bg-white/5 hover:bg-white/20 text-white/70 hover:text-white rounded text-xs transition-colors truncate border border-white/5 hover:border-white/20"
              >
                {{ province }}
              </button>
            </div>

            <!-- 城市列表 -->
            <div
              v-else
              class="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar"
            >
              <button
                v-for="city in cityData[selectedProvince]"
                :key="city"
                @click="
                  customCityInput = city;
                  saveCity();
                "
                class="px-1 py-1.5 bg-white/5 hover:bg-white/20 text-white/70 hover:text-white rounded text-xs transition-colors truncate border border-white/5 hover:border-white/20"
              >
                {{ city }}
              </button>
            </div>
          </div>

          <div class="flex gap-3 justify-end">
            <button
              @click="showCityInput = false"
              class="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm transition-colors"
            >
              取消
            </button>
            <button
              @click="saveCity"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors font-medium shadow-lg shadow-blue-900/20"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 动画定义 */
@keyframes spin-slow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.animate-spin-slow {
  animation: spin-slow 20s linear infinite;
}

@keyframes float-slow {
  0%,
  100% {
    transform: translateX(0) translateY(0);
  }
  50% {
    transform: translateX(-10px) translateY(5px);
  }
}
.animate-float-slow {
  animation: float-slow 8s ease-in-out infinite;
}

@keyframes rain {
  0% {
    transform: translateY(-100px);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  100% {
    transform: translateY(200px);
    opacity: 0;
  }
}
.animate-rain {
  animation: rain 1.5s linear infinite;
}

@keyframes snow {
  0% {
    transform: translateY(0) translateX(0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  100% {
    transform: translateY(300px) translateX(20px);
    opacity: 0;
  }
}
.animate-snow {
  animation: snow linear infinite;
}

@keyframes twinkle {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}
.animate-twinkle {
  animation: twinkle 3s ease-in-out infinite;
}

@keyframes fog-flow {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(-10%);
  }
  100% {
    transform: translateX(0);
  }
}
.animate-fog-flow {
  animation: fog-flow 20s ease-in-out infinite;
}

@keyframes fog-flow-reverse {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(10%);
  }
  100% {
    transform: translateX(0);
  }
}
.animate-fog-flow-reverse {
  animation: fog-flow-reverse 15s ease-in-out infinite;
}
</style>
