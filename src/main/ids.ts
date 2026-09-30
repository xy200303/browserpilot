import { randomBytes } from 'crypto'

const used = new Set<string>()

export function createId(prefix: string): string {
  let id = ''
  do {
    id = `${prefix}-${randomBytes(6).toString('hex')}`
  } while (used.has(id))
  used.add(id)
  return id
}

export function rememberId(id: string): void {
  used.add(id)
}
