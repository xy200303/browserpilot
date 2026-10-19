export type MotionNS = typeof import('motion')

let motionP: Promise<MotionNS> | null = null

export const loadMotion = (): Promise<MotionNS> => (motionP ??= import('motion'))

let lenisP: Promise<typeof import('lenis')> | null = null
const loadLenis = () => (lenisP ??= import('lenis'))

export const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const EASE = [0.16, 1, 0.3, 1] as const

export const hasFinePointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

/** 平滑滚动（Lenis）。返回停止函数；只在精确指针 + 未开启减少动效时启用。 */
export async function initSmoothScroll(offset = -72): Promise<() => void> {
  if (prefersReduced() || !hasFinePointer()) return () => {}
  const { default: Lenis } = await loadLenis()
  const lenis = new Lenis({
    lerp: 0.12,
    wheelMultiplier: 1,
    smoothWheel: true,
    autoRaf: true,
    anchors: { offset }
  })
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]')
    if (!(a instanceof HTMLAnchorElement)) return
    const id = a.getAttribute('href')!.slice(1)
    const el = id ? document.getElementById(id) : document.body
    if (!el) return
    e.preventDefault()
    lenis.scrollTo(el, { offset })
  }
  document.addEventListener('click', onClick)
  return () => {
    document.removeEventListener('click', onClick)
    lenis.destroy()
  }
}
