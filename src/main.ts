import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { attachErrorCapture, ensureOverlayHandled } from './utils/overlay'


const app = createApp(App)

app.use(createPinia())

app.mount('#app')

if (import.meta.env.DEV) {
  attachErrorCapture()
  ensureOverlayHandled()
}
