import { describe, it, expect, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import GridPanel from '@/components/GridPanel.vue'

describe('GridPanel', () => {
  it('imports and mounts with Pinia without error', () => {
    expect(GridPanel).toBeDefined()
    vi.spyOn(window, 'open').mockImplementation(() => null as any)
    const app = createApp(GridPanel)
    app.use(createPinia())
    const el = document.createElement('div')
    document.body.appendChild(el)
    app.mount(el)
    app.unmount()
    expect(true).toBe(true)
  })
})

