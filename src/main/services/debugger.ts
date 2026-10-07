import type { Debugger, WebContents } from 'electron'

type Lease = { count: number; listening: boolean }

const leases = new Map<number, Lease>()

function leaseOf(wc: WebContents): Lease {
  let lease = leases.get(wc.id)
  if (!lease) {
    lease = { count: 0, listening: false }
    leases.set(wc.id, lease)
  }
  return lease
}

export function isDebuggerAttached(wc: WebContents): boolean {
  return wc.debugger.isAttached()
}

export async function acquireDebugger(wc: WebContents): Promise<Debugger> {
  const lease = leaseOf(wc)
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3')
  }
  lease.count += 1
  return wc.debugger
}

export function releaseDebugger(wc: WebContents): void {
  const lease = leaseOf(wc)
  lease.count = Math.max(0, lease.count - 1)
  if (lease.count === 0 && wc.debugger.isAttached()) {
    try {
      wc.debugger.detach()
    } catch {
      /* already detached */
    }
  }
}

export async function withDebugger<T>(wc: WebContents, fn: (dbg: Debugger) => Promise<T>): Promise<T> {
  const dbg = await acquireDebugger(wc)
  try {
    return await fn(dbg)
  } finally {
    releaseDebugger(wc)
  }
}

export function holdDebugger(wc: WebContents): Debugger {
  const lease = leaseOf(wc)
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  lease.count += 1
  return wc.debugger
}

const listeners = new Map<number, Array<(method: string, params: unknown) => void>>()

export function onDebuggerMessage(
  wc: WebContents,
  listener: (method: string, params: unknown) => void
): void {
  let list = listeners.get(wc.id)
  if (!list) {
    list = []
    listeners.set(wc.id, list)
    wc.debugger.on('message', (_event, method, params) => {
      for (const fn of listeners.get(wc.id) ?? []) fn(method, params)
    })
    wc.once('destroyed', () => listeners.delete(wc.id))
  }
  list.push(listener)
}
