export type MotionNS = typeof import('motion')

let motionP: Promise<MotionNS> | null = null

export const loadMotion = (): Promise<MotionNS> => (motionP ??= import('motion'))

export const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const EASE = [0.16, 1, 0.3, 1] as const

export const hasFinePointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
