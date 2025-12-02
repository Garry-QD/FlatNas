<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

const isPlaying = ref(false)
const audioRef = ref<HTMLAudioElement | null>(null)
const musicList = ref<string[]>([])
const currentSongName = ref('加载中...')
const titleWrapRef = ref<HTMLElement | null>(null)
const titleTextRef = ref<HTMLElement | null>(null)
const marqueeEnabled = ref(false)
const marqueeDuration = ref('3s')
const marqueeTo = ref('0px')

// 📜 播放历史管理
const history = ref<string[]>([])
const historyIndex = ref(-1)

// 🎶 智能 URL 处理
const getMusicUrl = (fileName: string) => {
  if (!fileName || fileName === '加载中...' || fileName === '无音乐') return undefined
  return `/music/${encodeURIComponent(fileName).replace(/'/g, '%27')}`
}

// 📥 获取列表
const fetchMusicList = async () => {
  try {
    const res = await fetch('/api/music-list')
    const files = await res.json()
    if (files.length > 0) {
      musicList.value = files
      // 初始化播放第一首
      const firstSong = files[Math.floor(Math.random() * files.length)]
      currentSongName.value = firstSong
      history.value = [firstSong]
      historyIndex.value = 0
    } else {
      currentSongName.value = '无音乐'
    }
  } catch (e) {
    currentSongName.value = '获取失败'
  }
}

// ⏭️ 切歌 (下一首)
const playNext = () => {
  if (musicList.value.length <= 1) return
  
  // 如果在历史记录中不是最新的，直接前进
  if (historyIndex.value < history.value.length - 1) {
    historyIndex.value++
    currentSongName.value = history.value[historyIndex.value] || ''
  } else {
    // 否则随机新歌
    let nextSong = currentSongName.value
    while(nextSong === currentSongName.value) {
      nextSong = musicList.value[Math.floor(Math.random() * musicList.value.length)] || ''
    }
    currentSongName.value = nextSong
    history.value.push(nextSong)
    historyIndex.value++
  }
  
  playAudio()
}

// ⏮️ 上一首
const playPrev = () => {
  if (historyIndex.value > 0) {
    historyIndex.value--
    currentSongName.value = history.value[historyIndex.value] || ''
    playAudio()
  }
}

// 🔊 播放逻辑封装
const playAudio = () => {
  setTimeout(() => {
    if (audioRef.value) {
      audioRef.value.load()
      const promise = audioRef.value.play()
      if (promise !== undefined) {
        promise
          .then(() => { isPlaying.value = true })
          .catch((e) => {
            console.error('[MiniPlayer] Play failed:', e)
            isPlaying.value = false
          })
      }
    }
  }, 100)
}

const handleError = (e: Event) => {
  const target = e.target as HTMLAudioElement
  console.error('[MiniPlayer] Audio error:', target.error, target.src)
  isPlaying.value = false
}

// ⏯️ 播放控制
const toggleMusic = async () => {
  const player = audioRef.value
  if (!player) return
  if (isPlaying.value) {
    player.pause()
    isPlaying.value = false
  } else {
    // if (player.readyState === 0 || player.error) player.load() // playAudio/toggle already handles loading implicitly via play or manual load
    try {
       // 如果是暂停状态直接 play，如果是出错状态可能需要 load
       if (player.error) player.load()
       await player.play()
       isPlaying.value = true
    } catch (e) {
      console.error('[MiniPlayer] Toggle play failed:', e)
      player.load() // 失败尝试重载
      // 再次尝试播放可能会导致死循环，这里只 load
    }
  }
}

const setupMarquee = () => {
  const wrap = titleWrapRef.value
  const text = titleTextRef.value
  if (!wrap || !text) { marqueeEnabled.value = false; return }
  const overflow = text.scrollWidth - wrap.clientWidth
  if (overflow > 0 && isPlaying.value) {
    marqueeEnabled.value = true
    const seconds = Math.max(overflow / 50, 2)
    marqueeDuration.value = seconds + 's'
    marqueeTo.value = '-' + overflow + 'px'
  } else {
    marqueeEnabled.value = false
  }
}

// 监听歌曲变化和播放状态，更新跑马灯
watch([currentSongName, isPlaying], async () => {
  await nextTick()
  setupMarquee()
})

let mountTimer: ReturnType<typeof setTimeout>

onMounted(() => { 
  console.log('[MiniPlayer] Mounted')
  // 延迟加载，避免因父组件重渲染导致的快速卸载重挂引发的请求 Abort
  mountTimer = setTimeout(() => {
    fetchMusicList(); 
    setTimeout(setupMarquee, 200) 
  }, 500)
})

onUnmounted(() => {
  console.log('[MiniPlayer] Unmounted')
  if (mountTimer) clearTimeout(mountTimer)
})
</script>

<template>
  <div class="h-10 w-[160px] px-0 rounded-full bg-transparent flex items-center gap-2 transition-all group select-none relative -left-[5px]">
    
    <audio 
      ref="audioRef"
      preload="none"
      :src="getMusicUrl(currentSongName)"
      @ended="playNext"
      @error="handleError"
    ></audio>

    <button 
      @click="toggleMusic" 
      class="w-10 h-10 flex-shrink-0 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40 hover:text-white transition-all active:scale-95 text-white backdrop-blur border border-white/20 shadow-sm"
    >
      <svg v-if="isPlaying" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
        <path fill-rule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clip-rule="evenodd" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 pl-0.5">
        <path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
      </svg>
    </button>

    <div ref="titleWrapRef" class="flex-1 overflow-hidden text-xs font-medium text-white text-shadow flex flex-col justify-center min-w-0 h-full py-0.5" :title="currentSongName">
      <span ref="titleTextRef" class="mb-0.5" :style="marqueeEnabled ? { '--marquee-to': marqueeTo, animation: `marqueeX ${marqueeDuration} linear infinite alternate`, display: 'inline-block', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }">{{ currentSongName.replace(/\.(mp3|flac|wav|m4a)$/i, '') }}</span>
      <div class="flex items-center w-full pr-0">
        <span class="text-[12px] opacity-70 origin-left truncate w-auto mr-auto">{{ isPlaying ? '正在播放' : '已暂停' }}</span>
        <div class="flex items-center gap-0.5 flex-shrink-0 origin-right">
          <button 
            @click="playPrev" 
            class="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            title="上一首"
            :disabled="historyIndex <= 0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M9.195 18.44c1.25.713 2.805-.19 2.805-1.629v-2.81l7.82 4.466c1.25.713 2.805-.19 2.805-1.629V7.162c0-1.44-1.555-2.342-2.805-1.628l-7.82 4.466v-2.81c0-1.44-1.555-2.343-2.805-1.629l-7.108 4.062c-1.26.72-1.26 2.536 0 3.256l7.108 4.061z" />
            </svg>
          </button>
          <button 
            @click="playNext" 
            class="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            title="下一首"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
              <path d="M5.055 7.06C3.805 6.347 2.25 7.25 2.25 8.69v8.122c0 1.44 1.555 2.342 2.805 1.628L12.875 14v2.81c0 1.44 1.555 2.343 2.805 1.629l7.108-4.061c1.26-.72 1.26-2.536 0-3.256l-7.108-4.062c-1.25-.713-2.805.19-2.805 1.629V11.5L5.055 7.06z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-shadow { text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
@keyframes marqueeX { 0% { transform: translateX(0); } 100% { transform: translateX(var(--marquee-to)); } }
</style>
