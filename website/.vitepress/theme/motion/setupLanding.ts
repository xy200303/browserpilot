import { nextTick, watch, type Ref } from 'vue'
import { EASE, hasFinePointer, initSmoothScroll, loadMotion, prefersReduced } from './engine'

type Faq = { q: string; a: string }

export type LandingRefs = {
  heroEl: Ref<HTMLElement | null>
  demoFrame: Ref<HTMLElement | null>
  progressEl: Ref<HTMLElement | null>
  railEl: Ref<HTMLElement | null>
  tabsEl: Ref<HTMLElement | null>
  panelEl: Ref<HTMLElement | null>
  finalEl: Ref<HTMLElement | null>
  spotEl: Ref<HTMLElement | null>
  mode: Ref<string>
  faqs: Faq[]
}

/**
 * 首页动效底座：Lenis 平滑滚动、点阵视差、逐段入场、数字滚动、
 * Tab 下划线弹簧、FAQ 高度过渡、收尾光斑。
 * 返回清理函数；prefers-reduced-motion 下只保留静态布局。
 */
export async function setupLanding(refs: LandingRefs): Promise<() => void> {
  const faqLd = document.createElement('script')
  faqLd.id = 'faq-jsonld'
  faqLd.type = 'application/ld+json'
  faqLd.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: refs.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  })
  document.head.appendChild(faqLd)

  const teardowns: (() => void)[] = []
  let stopScroll: (() => void) | null = null
  let observer: IntersectionObserver | null = null
  let fallbackTimer = 0

  const cleanup = () => {
    for (const off of teardowns) off()
    stopScroll?.()
    observer?.disconnect()
    window.clearTimeout(fallbackTimer)
    faqLd.remove()
  }

  const reduced = prefersReduced()
  if (!reduced) {
    try {
      stopScroll = await initSmoothScroll(-72)
    } catch {
      stopScroll = null
    }
  }

  const M = await loadMotion().catch(() => null)
  if (!M) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.reveal-pre'))) {
      el.classList.remove('reveal-pre')
    }
    return cleanup
  }
  const { animate, inView, scroll } = M

  if (!reduced) {
  /* 滚动入场：首屏不参与，视口下方的元素淡入上移 12px */
  const targets = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
  for (const el of targets) {
    if (el.getBoundingClientRect().top > window.innerHeight * 0.94) el.classList.add('reveal-pre')
  }
  const show = (el: HTMLElement) => {
    const delay = (parseFloat(el.style.transitionDelay) || 0) / 1000
    el.style.transitionDelay = ''
    el.classList.remove('reveal-pre')
    animate(el, { opacity: [0, 1], y: [12, 0] }, { duration: 0.66, delay, easing: EASE })
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        show(entry.target as HTMLElement)
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
  )
  for (const el of targets) {
    if (el.classList.contains('reveal-pre')) observer.observe(el)
  }
  fallbackTimer = window.setTimeout(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.reveal-pre'))) {
      if (el.getBoundingClientRect().top < window.innerHeight * 1.1) show(el)
    }
  }, 2500)
  }

  /* 三步导轨：线从左画出来，三个节点依次点亮 */
  const rail = refs.railEl.value
  if (rail && !reduced) {
    const line = rail.querySelector<HTMLElement>('.rail-line')
    const dots = Array.from(rail.querySelectorAll<HTMLElement>('.rail-dot'))
    if (line) line.style.transform = 'scaleX(0)'
    for (const d of dots) d.style.transform = 'scale(0)'
    teardowns.push(
      inView(
        rail,
        () => {
          if (line) animate(line, { scaleX: [0, 1] }, { duration: 0.95, easing: EASE })
          dots.forEach((d, i) =>
            animate(d, { scale: [0, 1] }, { type: 'spring', stiffness: 430, damping: 22, delay: 0.1 + i * 0.13 })
          )
        },
        { amount: 0.6 }
      )
    )
  }

  /* 阅读进度：2px 细线，整页滚动进度直接驱动 */
  const bar = refs.progressEl.value
  if (bar && !reduced) {
    teardowns.push(scroll(animate(bar, { scaleX: [0, 1] }, { ease: 'linear' })))
  }

  /* 首屏点阵随滚动缓慢上移 */
  const hero = refs.heroEl.value
  const field = hero?.querySelector<HTMLElement>('.dot-field')
  if (hero && field && !reduced && hasFinePointer()) {
    teardowns.push(
      scroll(animate(field, { y: [0, -64] }, { ease: 'linear' }), {
        target: hero,
        offset: ['start start', 'end start']
      })
    )
  }

  /* 窗口从 1.04 收到 1，做出“浮上来”的层次 */
  if (!reduced) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.demo-frame .window, .step .window, .shot .window'))) {
      teardowns.push(
        inView(el, () => animate(el, { scale: [1.04, 1], opacity: [0, 1] }, { duration: 0.72, easing: EASE }), {
          amount: 0.2
        })
      )
    }
  }

  /* 演示窗口的指针倾斜：幅度很小，回到 0 也走弹簧 */
  const frame = refs.demoFrame.value
  if (frame && !reduced && hasFinePointer()) {
    let ctrl: { stop: () => void } | null = null
    const aim = (rx: number, ry: number, stiffness = 150) => {
      ctrl?.stop()
      ctrl = animate(frame, { rotateX: rx, rotateY: ry }, { type: 'spring', stiffness, damping: 22 })
    }
    const onMove = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect()
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      const cx = Math.max(-1, Math.min(1, nx))
      const cy = Math.max(-1, Math.min(1, ny))
      aim(-cy * 2.2, cx * 2.8)
    }
    const reset = () => aim(0, 0, 190)
    window.addEventListener('pointermove', onMove, { passive: true })
    frame.addEventListener('pointerleave', reset)
    teardowns.push(() => {
      ctrl?.stop()
      window.removeEventListener('pointermove', onMove)
      frame.removeEventListener('pointerleave', reset)
    })
  }

  /* 数字条：进入视口时从 0 滚到目标值 */
  if (!reduced) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.stat strong'))) {
      const m = (el.textContent ?? '').trim().match(/^(\d+(?:\.\d+)?)(.*)$/)
      if (!m) continue
      const target = Number(m[1])
      const suffix = m[2]
      const dec = (m[1].split('.')[1] ?? '').length
      el.textContent = (0).toFixed(dec) + suffix
      teardowns.push(
        inView(
          el,
          () =>
            animate(0, target, {
              duration: 1.15,
              easing: EASE,
              onUpdate: (v: number) => {
                el.textContent = v.toFixed(dec) + suffix
              }
            }),
          { amount: 'all' }
        )
      )
    }
  }

  /* 三种用法：下划线指示器用弹簧滑动 */
  const tabs = refs.tabsEl.value
  if (tabs) {
    const tabBar = tabs.querySelector<HTMLElement>('.tab-bar')
    if (tabBar) {
      const place = (animated: boolean) => {
        const on = tabs.querySelector<HTMLElement>('.tab.on')
        if (!on) return
        const a = tabs.getBoundingClientRect()
        const b = on.getBoundingClientRect()
        const x = b.left - a.left
        if (animated && !reduced) {
          animate(tabBar, { x, width: b.width }, { type: 'spring', stiffness: 430, damping: 34 })
        } else {
          Object.assign(tabBar.style, { transform: `translateX(${x}px)`, width: `${b.width}px` })
        }
      }
      place(false)
      teardowns.push(
        watch(refs.mode, () =>
          nextTick(() => {
            place(true)
            const panel = refs.panelEl.value
            if (panel && !reduced) animate(panel, { opacity: [0, 1], y: [8, 0] }, { duration: 0.34, easing: EASE })
          })
        )
      )
      const onResize = () => place(false)
      window.addEventListener('resize', onResize)
      teardowns.push(() => window.removeEventListener('resize', onResize))
    }
  }

  /* FAQ：把 details 的原生瞬开改成高度 + 透明度过渡 */
  if (!reduced) {
    for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>('.faq-item'))) {
      const body = d.querySelector<HTMLElement>('p')
      if (!body) continue
      const onClick = (e: MouseEvent) => {
        if (!(e.target as Element).closest('summary')) return
        e.preventDefault()
        body.style.overflow = 'hidden'
        if (d.open) {
          animate(body, { height: [`${body.offsetHeight}px`, '0px'], opacity: [1, 0] }, { duration: 0.24, easing: EASE }).then(() => {
            d.open = false
            body.style.overflow = ''
            body.style.height = ''
            body.style.opacity = ''
          })
        } else {
          d.open = true
          animate(body, { height: ['0px', `${body.offsetHeight}px`], opacity: [0, 1] }, { duration: 0.3, easing: EASE }).then(() => {
            body.style.overflow = ''
            body.style.height = ''
          })
        }
      }
      d.addEventListener('click', onClick)
      teardowns.push(() => d.removeEventListener('click', onClick))
    }
  }

  /* 收尾深色带：柔和光斑跟随指针 */
  const fin = refs.finalEl.value
  const spot = refs.spotEl.value
  if (fin && spot && !reduced && hasFinePointer()) {
    let ctrl: { stop: () => void } | null = null
    const to = (x: number, y: number, opacity: number, stiffness: number) => {
      ctrl?.stop()
      ctrl = animate(spot, { x, y, opacity }, { type: 'spring', stiffness, damping: 26 })
    }
    const onMove = (e: PointerEvent) => {
      const r = fin.getBoundingClientRect()
      to(e.clientX - r.left, e.clientY - r.top, 1, 130)
    }
    const onLeave = () => to(0, 0, 0, 90)
    fin.addEventListener('pointermove', onMove, { passive: true })
    fin.addEventListener('pointerleave', onLeave)
    teardowns.push(() => {
      ctrl?.stop()
      fin.removeEventListener('pointermove', onMove)
      fin.removeEventListener('pointerleave', onLeave)
    })
  }

  return cleanup
}
