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
