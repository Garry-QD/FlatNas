import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GridPanel from '../src/components/GridPanel.vue'
import { useMainStore } from '../src/stores/main'

describe('Group title color CSS variable', () => {
  it('injects CSS var when appConfig changes', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(GridPanel, { global: { plugins: [pinia] } })
    const store = useMainStore()
    store.appConfig.groupTitleColor = '#ff4757'
    await wrapper.vm.$nextTick()
    const root = wrapper.find('div')
    const value = (root.element as HTMLElement).style.getPropertyValue('--group-title-color')
    expect(value).toBe('#ff4757')
  })
})

