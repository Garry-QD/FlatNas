<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const time = ref('')
const date = ref('')
const weather = ref({ temp: '--', city: '定位中...', text: '...' })
const isNight = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// 映射天气类型
const weatherType = computed(() => {
  const text = weather.value.text
  if (text.includes('雨')) return 'rain'
  if (text.includes('雪')) return 'snow'
  if (text.includes('云') || text.includes('阴')) return 'cloudy'
  if (text.includes('晴')) return isNight.value ? 'clear-night' : 'sunny'
  return 'default'
})

// 计算背景样式
const bgClass = computed(() => {
  switch (weatherType.value) {
    case 'sunny':
      return 'bg-gradient-to-br from-blue-400 via-blue-300 to-orange-200'
    case 'clear-night':
      return 'bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900'
    case 'cloudy':
      return 'bg-gradient-to-br from-slate-400 via-slate-300 to-gray-200'
    case 'rain':
      return 'bg-gradient-to-br from-slate-700 via-blue-900 to-slate-800'
    case 'snow':
      return 'bg-gradient-to-br from-blue-100 via-white to-blue-50'
    default:
      return 'bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500'
  }
})

// 更新时间
const updateTime = () => {
  const now = new Date()
  time.value = now.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  date.value = now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })

  const hour = now.getHours()
  isNight.value = hour < 6 || hour >= 18
}

// 获取天气
const fetchWeather = async () => {
  try {
    // 改用后端接口获取位置，解决 HTTPS 下 Mixed Content 问题
    const ipRes = await fetch('/api/ip')
    if (!ipRes.ok) throw new Error('IP API Error')
    const ipData = await ipRes.json()

    let city = '本地'
    if (ipData.success && ipData.location) {
      // 简单处理一下 location，去掉多余的信息（如运营商）
      // 例如 "浙江省宁波市 电信" -> "浙江省宁波市"
      city = ipData.location.split(' ')[0]
    }

    weather.value = {
      temp: '26',
      city: city,
      text: '晴',
    }
  } catch {
    console.warn('[Weather] 获取失败，转为离线模式')
    weather.value = { temp: '22', city: '本地', text: '舒适' }
  }
}

onMounted(() => {
  updateTime()
  fetchWeather()
  timer = setInterval(updateTime, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div
    class="h-full w-full relative overflow-hidden text-white group select-none transition-all duration-500"
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
        <div class="absolute bottom-8 left-[-10%] w-24 h-16 opacity-30 animate-float-slower">
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
    </div>

    <!-- 玻璃质感遮罩 -->
    <div
      class="absolute inset-0 bg-black/5 backdrop-blur-[0px] group-hover:backdrop-blur-[2px] transition-all duration-500"
    ></div>

    <!-- 内容区域 -->
    <div class="relative z-10 h-full flex flex-col justify-between p-3 sm:p-4">
      <!-- 顶部：日期与时间 -->
      <div class="flex flex-col">
        <div class="flex items-center justify-between">
          <span
            class="text-[10px] sm:text-xs font-bold tracking-widest uppercase bg-white/10 px-1.5 py-0.5 rounded backdrop-blur-md border border-white/10 shadow-sm"
            >{{ date }}</span
          >
          <div
            v-if="weatherType === 'sunny' || weatherType === 'clear-night'"
            class="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
          ></div>
        </div>
        <div
          class="mt-1 sm:mt-2 text-4xl sm:text-5xl font-bold tracking-tighter drop-shadow-lg font-mono leading-none bg-gradient-to-b from-white to-white/80 bg-clip-text text-transparent"
        >
          {{ time }}
        </div>
      </div>

      <!-- 底部：天气详情 -->
      <div class="flex items-end justify-between pb-0.5">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-1.5">
            <svg
              class="w-3.5 h-3.5 opacity-80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span
              class="text-xs sm:text-sm font-medium drop-shadow-sm truncate max-w-[60px] sm:max-w-[80px]"
              >{{ weather.city }}</span
            >
          </div>
          <span class="text-[10px] sm:text-xs opacity-75 pl-5 font-light">{{ weather.text }}</span>
        </div>
        <div class="flex flex-col items-end">
          <div
            class="text-3xl sm:text-4xl font-bold tracking-tight drop-shadow-xl leading-none scale-150 origin-bottom-right"
          >
            {{ weather.temp }}<span class="text-lg sm:text-2xl align-top">°</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'Monaco', 'Consolas', monospace;
}

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

@keyframes float-slower {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(15px);
  }
}
.animate-float-slower {
  animation: float-slower 12s ease-in-out infinite;
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
</style>
