import { describe, it, expect } from 'vitest'
import { createApp } from 'vue'
import SettingsModal from '@/components/SettingsModal.vue'

describe('SettingsModal', () => {
  it('imports and mounts without error', () => {
    expect(SettingsModal).toBeDefined()
    const app = createApp(SettingsModal, { show: false })
    const el = document.createElement('div')
    document.body.appendChild(el)
    app.mount(el)
    app.unmount()
    expect(true).toBe(true)
  })
})

