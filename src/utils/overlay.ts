export const OVERLAY_SELECTOR = 'vite-error-overlay'

export function queryOverlay(root: Document | ShadowRoot = document): HTMLElement | null {
  // Direct element tag used by Vite overlay
  const el = root.querySelector(OVERLAY_SELECTOR) as HTMLElement | null
  return el
}

export function isOverlayVisible(el: HTMLElement | null = queryOverlay()): boolean {
  if (!el) return false
  const style = window.getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

export function waitForAppearance(timeoutMs = 5000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const existing = queryOverlay()
    if (existing && isOverlayVisible(existing)) return resolve(existing)

    const timeout = setTimeout(() => {
      obs.disconnect()
      reject(new Error('overlay_appearance_timeout'))
    }, timeoutMs)

    const obs = new MutationObserver(() => {
      const el = queryOverlay()
      if (el && isOverlayVisible(el)) {
        clearTimeout(timeout)
        obs.disconnect()
        resolve(el)
      }
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
  })
}

export function waitForDisappearance(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = queryOverlay()
    if (!isOverlayVisible(el)) return resolve()

    const timeout = setTimeout(() => {
      obs.disconnect()
      reject(new Error('overlay_disappearance_timeout'))
    }, timeoutMs)

    const obs = new MutationObserver(() => {
      const cur = queryOverlay()
      if (!isOverlayVisible(cur)) {
        clearTimeout(timeout)
        obs.disconnect()
        resolve()
      }
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
  })
}

export function attachErrorCapture() {
  const logs: Array<{ type: string; message: string; stack?: string }> = []
  const record = (type: string, err: any) => {
    const entry = { type, message: String(err?.message || err), stack: String(err?.stack || '') }
    logs.push(entry)
    console.error('[dev-error]', entry)
  }
  window.addEventListener('error', (e) => record('error', e.error || e.message))
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => record('unhandledrejection', e.reason))
  ;(window as any).__devErrorLogs = logs
}

export async function ensureOverlayHandled() {
  try {
    await waitForAppearance(1000)
    // Give Vite some room, then wait for it to disappear
    await waitForDisappearance(15000)
  } catch (e) {
    // If overlay persists, we still capture errors for diagnostics
  }
}
