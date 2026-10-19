import type { Directive } from 'vue'
import { loadMotion, prefersReduced } from './engine'

type Controls = { stop: () => void } | null
const teardowns = new WeakMap<HTMLElement, () => void>()

export const vPress: Directive<HTMLElement> = {
  mounted(el) {
    if (prefersReduced()) return
    let ctrl: Controls = null
    let alive = true
    const to = async (scale: number, stiffness: number, damping: number) => {
      const { animate } = await loadMotion()
      if (!alive) return
      ctrl?.stop()
      ctrl = animate(el, { scale }, { type: 'spring', stiffness, damping })
    }
    const down = () => to(0.975, 720, 34)
    const up = () => to(1, 420, 24)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    teardowns.set(el, () => {
      alive = false
      ctrl?.stop()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', up)
    })
  },
  unmounted(el) {
    teardowns.get(el)?.()
    teardowns.delete(el)
  }
}

export const vLift: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    if (prefersReduced()) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const dist = typeof binding.value === 'number' ? binding.value : 3
    let ctrl: Controls = null
    let alive = true
    const to = async (y: number, stiffness: number, damping: number) => {
      const { animate } = await loadMotion()
      if (!alive) return
      ctrl?.stop()
      ctrl = animate(el, { y }, { type: 'spring', stiffness, damping })
    }
    const enter = () => to(-dist, 300, 26)
    const leave = () => to(0, 260, 24)
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    teardowns.set(el, () => {
      alive = false
      ctrl?.stop()
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
    })
  },
  unmounted(el) {
    teardowns.get(el)?.()
    teardowns.delete(el)
  }
}

/** v-spot：把指针位置写进元素上的 --mx / --my，供 CSS 画卡片内跟随高光。 */
export const vSpot: Directive<HTMLElement> = {
  mounted(el) {
    let raf = 0
    const move = (e: PointerEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    el.addEventListener('pointermove', move, { passive: true })
    teardowns.set(el, () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
    })
  },
  unmounted(el) {
    teardowns.get(el)?.()
    teardowns.delete(el)
  }
}
