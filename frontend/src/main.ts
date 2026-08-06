import "./assets/main.css";
import "./assets/grid-layout.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import { createAppI18n } from "./plugins/i18n";
import App from "./App.vue";
import { useMainStore } from "./stores/main";
import { useI18nStore } from "./stores/i18n";
import { attachErrorCapture, ensureOverlayHandled } from "./utils/overlay";
import { installFetchUrlPatch } from "./utils/runtimeUrls";
import { installNetworkFetchPatch } from "./utils/networkFetch";

if (typeof document !== "undefined" && typeof navigator !== "undefined") {
  const ua = navigator.userAgent || "";
  const isHarmony = /(harmonyos|hongmeng|hm os)/i.test(ua);
  const isHuawei = /(huaweibrowser|huawei)/i.test(ua);
  const isAlook = /alook/i.test(ua);
  if (isHarmony || isHuawei) {
    document.documentElement.classList.add("harmony-os");
  }
  if (isAlook) {
    document.documentElement.classList.add("alook-browser");
  }
}

installFetchUrlPatch();
installNetworkFetchPatch();

const app = createApp(App);
const pinia = createPinia();
const i18n = createAppI18n();

app.use(pinia);
app.use(i18n);

// 初始化 i18n 语言设置
const i18nStore = useI18nStore();
i18nStore.initLocale();

app.mount("#app");

const bootstrap = async () => {
  // Initialize store once after mount so the shell UI can render even if
  // the sync pipeline is slow or temporarily blocked.
  const store = useMainStore();
  try {
    await store.init();
  } catch (error) {
    console.error("Initial store init failed", error);
  }
};

if (import.meta.env.DEV) {
  attachErrorCapture();
  ensureOverlayHandled();
}

void bootstrap();
