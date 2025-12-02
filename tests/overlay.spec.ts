import { describe, it, expect } from 'vitest'
import { queryOverlay, isOverlayVisible, waitForAppearance, waitForDisappearance } from '../src/utils/overlay'

describe('vite-error-overlay utils', () => {
  it('queryOverlay returns null when not present', () => {
    const el = queryOverlay()
    expect(el).toBeNull()
  })

  it('appearance and disappearance waits resolve', async () => {
    const el = document.createElement('vite-error-overlay')
    el.style.display = 'none'
    document.body.appendChild(el)
    // Initially not visible
    expect(isOverlayVisible(el)).toBe(false)
    // Make visible then await appearance
    setTimeout(() => { el.style.display = 'block' }, 10)
    const appeared = await waitForAppearance(1000)
    expect(appeared).toBe(el)
    // Now hide and await disappearance
    setTimeout(() => { el.style.display = 'none' }, 10)
    await expect(waitForDisappearance(1000)).resolves.toBeUndefined()
  })
})
