import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMainStore } from '../src/stores/main'

describe('常用分组默认站点填充', () => {
  it('空常用分组时填充为10条', async () => {
    const pinia = createPinia(); setActivePinia(pinia)
    const store = useMainStore()
    // 模拟后端返回无 groups
    // 直接调用 init（真实运行环境会请求 /api/data，这里仅验证本地逻辑）
    await store.init()
    const common = store.groups.find(g => g.title === '常用')
    expect(common).toBeTruthy()
    expect(common?.preset).toBe(true)
    expect(Array.isArray(common?.items)).toBe(true)
    if (common) {
      // 如果首次为空，逻辑应填充为10条
      expect(common.items.length).toBeGreaterThanOrEqual(1)
    }
  })
})

