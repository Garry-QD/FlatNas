import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import GridPanel from '../src/components/GridPanel.vue'
import { useMainStore } from '../src/stores/main'

describe('GridPanel add-group button visibility', () => {
  it('hidden when not in edit mode', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(GridPanel, { global: { plugins: [pinia] } })
    const store = useMainStore()
    store.isLogged = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="add-group-btn"]').exists()).toBe(false)
  })

  it('visible when edit mode enabled', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    const wrapper = mount(GridPanel, { global: { plugins: [pinia] } })
    const store = useMainStore()
    store.isLogged = true
    // enable edit mode
    // @ts-ignore
    wrapper.vm.isEditMode = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="add-group-btn"]').exists()).toBe(true)
  })
})
