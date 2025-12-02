<script setup lang="ts">
import { onMounted } from 'vue'
import GridPanel from './components/GridPanel.vue'

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