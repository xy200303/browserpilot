export function popoverPosition(x: number, y: number, width: number, minTop = 8, reserve = 320): { left: number; top: number } {
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8))
  const top = Math.min(Math.max(y + 6, minTop), Math.max(8, window.innerHeight - reserve))
  return { left, top }
}
