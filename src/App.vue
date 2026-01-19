<script setup lang="ts">
import { onMounted, watch, computed } from "vue";
import GridPanel from "./components/GridPanel.vue";
import { useMainStore } from "./stores/main";
import { useWindowScroll, useWindowSize } from "@vueuse/core";

const store = useMainStore();
const { y } = useWindowScroll();
const { width: windowWidth, height: windowHeight } = useWindowSize();

const showBackToTop = computed(() => y.value > windowHeight.value);

// Auto-detect ultrawide screen
const checkUltrawide = () => {
  if (!store.appConfig.autoUltrawide) return;

  const windowRatio = windowWidth.value / windowHeight.value;
  const screenRatio = window.screen.width / window.screen.height;
  // 21:9 ≈ 2.33, 32:9 ≈ 3.55
  // Consider ultrawide if either ratio > 2.3
  if (windowRatio > 2.3 || screenRatio > 2.3) {
    store.isExpandedMode = true;
  }
};

// Check on resize and config change
watch(
  [windowWidth, windowHeight, () => store.appConfig.autoUltrawide],
  () => {
    checkUltrawide();
  },
  { immediate: true },
);

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
    const raw = String(newCss || "");
    const build = (input: string) => {
      const src = String(input || "");
      const re = /\/\*\s*@(?<tag>[a-zA-Z_-]+)\s*\*\/([\s\S]*?)\/\*\s*@end\s*\*\//g;
      const blocks: Array<{ tag: string; body: string }> = [];
      const base = src.replace(re, (...args) => {
        const groups = args[args.length - 1] as { tag?: string } | undefined;
        const tag = String(groups?.tag || "").toLowerCase();
        const body = String(args[1] || "");
        if (tag) blocks.push({ tag, body });
        return "";
      });

      const extra = blocks
        .map((b) => {
          const body = String(b.body || "").trim();
          if (!body) return "";
          if (b.tag === "mobile") return `@media (max-width: 768px) {\n${body}\n}`;
          if (b.tag === "desktop") return `@media (min-width: 769px) {\n${body}\n}`;
          if (b.tag === "dark") return `@media (prefers-color-scheme: dark) {\n${body}\n}`;
          if (b.tag === "light") return `@media (prefers-color-scheme: light) {\n${body}\n}`;
          return body;
        })
        .filter(Boolean)
        .join("\n\n");

      return [base.trim(), extra.trim()].filter(Boolean).join("\n\n");
    };

    const css = build(raw);
    let style = document.getElementById("custom-css") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "custom-css";
      document.head.appendChild(style);
    }
    style.textContent = css;
  },
  { immediate: true },
);

type CustomHooks = {
  init?: (ctx: CustomCtx) => void | Promise<void>;
  update?: (ctx: CustomCtx) => void | Promise<void>;
  destroy?: (ctx: CustomCtx) => void | Promise<void>;
};

type CustomCtx = {
  store: ReturnType<typeof useMainStore>;
  root: HTMLElement | null;
  query: (selector: string) => Element | null;
  queryAll: (selector: string) => Element[];
  onCleanup: (fn: () => void) => void;
  on: (type: string, handler: (ev: CustomEvent) => void) => () => void;
  emit: (type: string, detail?: unknown) => void;
};

const customJsRuntime = (() => {
  const scriptId = "custom-js-injection";
  const cleanupFns: Array<() => void> = [];
  let hooks: CustomHooks | null = null;
  let observer: MutationObserver | null = null;
  let updateTimer: number | null = null;
  let pendingRegister: CustomHooks | null = null;
  let currentNonce = 0;

  const getRoot = () => (document.getElementById("app") as HTMLElement | null) || null;
  const clearUpdateTimer = () => {
    if (updateTimer) window.clearTimeout(updateTimer);
    updateTimer = null;
  };

  const ctx: CustomCtx = {
    store,
    get root() {
      return getRoot();
    },
    query(selector: string) {
      return getRoot()?.querySelector(selector) || null;
    },
    queryAll(selector: string) {
      return Array.from(getRoot()?.querySelectorAll(selector) || []);
    },
    onCleanup(fn: () => void) {
      if (typeof fn === "function") cleanupFns.push(fn);
    },
    on(type: string, handler: (ev: CustomEvent) => void) {
      const t = `flatnas:${type}`;
      const wrapped = (e: Event) => handler(e as CustomEvent);
      window.addEventListener(t, wrapped as EventListener);
      const off = () => window.removeEventListener(t, wrapped as EventListener);
      cleanupFns.push(off);
      return off;
    },
    emit(type: string, detail?: unknown) {
      window.dispatchEvent(new CustomEvent(`flatnas:${type}`, { detail }));
    },
  };

  const removeScript = () => {
    const existing = document.getElementById(scriptId);
    if (existing) existing.remove();
  };

  const doDestroy = async () => {
    clearUpdateTimer();
    if (observer) observer.disconnect();
    observer = null;
    try {
      await hooks?.destroy?.(ctx);
    } catch (e) {
      console.error("Custom JS destroy failed:", e);
    }
    hooks = null;
    while (cleanupFns.length) {
      const fn = cleanupFns.pop();
      try {
        fn?.();
      } catch {}
    }
    removeScript();
  };

  const scheduleUpdate = () => {
    clearUpdateTimer();
    updateTimer = window.setTimeout(async () => {
      updateTimer = null;
      try {
        await hooks?.update?.(ctx);
      } catch (e) {
        console.error("Custom JS update failed:", e);
      }
    }, 120);
  };

  const ensureObserver = () => {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!hooks?.update) return;
      scheduleUpdate();
    });
    observer.observe(getRoot() || document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    cleanupFns.push(() => observer?.disconnect());
  };

  const setRegister = () => {
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.FlatNasCustomRegister === "function") return;
    w.FlatNasCustomRegister = (h: unknown) => {
      if (!h || typeof h !== "object") return;
      pendingRegister = h as CustomHooks;
    };
  };

  const adoptHooks = async (h: CustomHooks | null) => {
    hooks = h;
    if (!hooks) return;
    try {
      await hooks.init?.(ctx);
    } catch (e) {
      console.error("Custom JS init failed:", e);
    }
    ensureObserver();
    scheduleUpdate();
  };

  const apply = async (code: string, agreed: boolean) => {
    currentNonce++;
    const nonce = currentNonce;
    await doDestroy();
    setRegister();
    pendingRegister = null;

    (window as unknown as Record<string, unknown>).FlatNasCustomCtx = ctx;

    const src = String(code || "").trim();
    if (!agreed || !src) return;

    const looksModule =
      /^\s*\/\/\s*@module\b/m.test(src) ||
      /(^|\n)\s*import\s.+from\s+["'][^"']+["']/m.test(src) ||
      /(^|\n)\s*export\s+/m.test(src);

    const script = document.createElement("script");
    script.id = scriptId;
    if (looksModule) script.type = "module";

    const suffix = "\n;globalThis.FlatNasCustomRegister?.(globalThis.FlatNasCustom);";
    if (looksModule) {
      script.textContent = `${src}${suffix}`;
    } else {
      const needsWrapper = /(^|[^\w$])await\b/.test(src);
      if (needsWrapper) {
        const wrapped = `;(async () => {\ntry {\n${src}\n} catch (e) {\nconsole.error('Custom JS execution failed:', e);\n}\n})();`;
        script.textContent = `${wrapped}${suffix}`;
      } else {
        script.textContent = `${src}${suffix}`;
      }
    }

    const adoptFromWindow = () => {
      const w = window as unknown as Record<string, unknown>;
      const fallback = (w.FlatNasCustom as CustomHooks | undefined) || null;
      const next = (pendingRegister || fallback) as CustomHooks | null;
      pendingRegister = null;
      if (nonce !== currentNonce) return;
      void adoptHooks(next);
    };

    script.onload = adoptFromWindow;
    script.onerror = (e) => {
      console.error("Custom JS script failed:", e);
    };

    document.body.appendChild(script);
    window.setTimeout(adoptFromWindow, 0);
  };

  return { apply, destroy: doDestroy };
})();

watch(
  [() => store.appConfig.customJs, () => store.appConfig.customJsDisclaimerAgreed],
  ([newJs, agreed]) => {
    void customJsRuntime.apply(String(newJs || ""), Boolean(agreed));
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

  <!-- Global Audio Element for persistent playback across groups -->
  <audio id="flatnas-global-audio" style="display: none" crossorigin="anonymous"></audio>
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
