<script setup lang="ts">
import { onMounted, watch, computed } from "vue";
import GridPanel from "./components/GridPanel.vue";
import { useMainStore } from "./stores/main";
import { useWindowScroll, useWindowSize } from "@vueuse/core";

const store = useMainStore();
const { y } = useWindowScroll();
const { height } = useWindowSize();

const showBackToTop = computed(() => y.value > height.value);

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
};

watch(
  () => store.appConfig.customTitle,
  (newTitle) => {
    document.title = newTitle || "FlatNas";
  },
  { immediate: true },
);

watch(
  () => store.appConfig.customCss,
  (newCss) => {
    let style = document.getElementById("custom-css");
    if (!style) {
      style = document.createElement("style");
      style.id = "custom-css";
      document.head.appendChild(style);
    }
    style.innerHTML = newCss || "";
  },
  { immediate: true },
);

watch(
  [() => store.appConfig.customJs, () => store.appConfig.customJsDisclaimerAgreed],
  ([newJs, agreed]) => {
    const scriptId = "custom-js-injection";
    let script = document.getElementById(scriptId);
    if (script) script.remove();

    if (agreed && newJs) {
      try {
        script = document.createElement("script");
        script.id = scriptId;
        script.textContent = newJs;
        document.body.appendChild(script);
      } catch (e) {
        console.error("Custom JS Injection Failed:", e);
      }
    }
  },
  { immediate: true },
);

onMounted(() => {
  const style = document.createElement("style");
  style.id = "devtools-hider";
  style.innerHTML = `
    #vue-devtools-anchor,
    .vue-devtools__anchor,
    .vue-devtools__trigger,
    [data-v-inspector-toggle] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
});
</script>

<template>
  <GridPanel />

  <Transition name="fade-up">
    <button
      v-if="showBackToTop"
      @click="scrollToTop"
      class="fixed bottom-6 right-6 z-[100] w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white shadow-lg flex items-center justify-center hover:bg-white/40 active:scale-95 transition-all cursor-pointer"
      title="返回首页"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 drop-shadow-md"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2.5"
          d="M5 10l7-7m0 0l7 7m-7-7v18"
        />
      </svg>
    </button>
  </Transition>
</template>

<style>
.fade-up-enter-active,
.fade-up-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
