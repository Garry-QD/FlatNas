<script setup lang="ts">
import { onMounted, watch } from 'vue'
import GridPanel from './components/GridPanel.vue'
import { useMainStore } from './stores/main'

const store = useMainStore()

watch(
  () => store.appConfig.customTitle,
  (newTitle) => {
    document.title = newTitle || 'FlatNas'
  },
  { immediate: true }
)

watch(
  () => store.appConfig.customCss,
  (newCss) => {
    let style = document.getElementById('custom-css')
    if (!style) {
      style = document.createElement('style')
      style.id = 'custom-css'
      document.head.appendChild(style)
    }
    style.innerHTML = newCss || ''
  },
  { immediate: true }
)

onMounted(() => {
  const style = document.createElement('style')
  style.id = 'devtools-hider'
  style.innerHTML = `
    #vue-devtools-anchor,
    .vue-devtools__anchor,
    .vue-devtools__trigger,
    [data-v-inspector-toggle] {
      display: none !important;
    }
  `
  document.head.appendChild(style)
})
</script>

<template>
  <GridPanel />
</template>