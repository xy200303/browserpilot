import type { WorkflowNode } from './types'

const hostPattern = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export function workflowSite(nodes: WorkflowNode[] | undefined): string {
  if (!nodes) return ''
  for (const node of nodes) {
    const data = node.data
    for (const text of [data.url, data.code, data.source]) {
      if (typeof text !== 'string') continue
      const match = text.match(hostPattern)
      if (!match) continue
      try {
        return new URL(match[0]).origin
      } catch {
        /* 这段不是网址 */
      }
    }
    if (data.type === 'loop' && Array.isArray(data.nodes)) {
      const nested = workflowSite(data.nodes as WorkflowNode[])
      if (nested) return nested
    }
  }
  return ''
}

export function siteLogo(site: string): string {
  if (!site) return ''
  try {
    const origin = site.includes('://') ? new URL(site).origin : new URL(`https://${site}`).origin
    return `${origin}/favicon.ico`
  } catch {
    return ''
  }
}
