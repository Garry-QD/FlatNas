import "./assets/main.css";
import "./assets/grid-layout.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { useMainStore } from "./stores/main";
import { attachErrorCapture, ensureOverlayHandled } from "./utils/overlay";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// Initialize store globally to ensure configuration is loaded
const store = useMainStore();
store.init();

app.mount("#app");

if (import.meta.env.DEV) {
  attachErrorCapture();
  ensureOverlayHandled();
}
