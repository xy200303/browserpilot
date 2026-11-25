/** cookie 的导出与注入。掉登录时不用重扫，把上次导出的 cookie 注回去就行。 */
import type { ToolPayload } from './errors.js'

export type CookieCall = (tool: string, args: Record<string, unknown>) => Promise<ToolPayload>

export async function listCookies(
  call: CookieCall,
  options: { env?: string; domain?: string } = {}
): Promise<Array<Record<string, unknown>>> {
  const args: Record<string, unknown> = {}
  if (options.env) args.env = options.env
  if (options.domain) args.domain = options.domain
  const data = await call('cookie_list', args)
  return (data.cookies as Array<Record<string, unknown>> | undefined) ?? []
}

export async function addCookies(
  call: CookieCall,
  cookies: Array<Record<string, unknown>> | Record<string, unknown>,
  options: { env?: string } = {}
): Promise<number> {
  const items = Array.isArray(cookies) ? cookies : [cookies]
  let written = 0
  for (const item of items) {
    const payload: Record<string, unknown> = { ...item }
    delete payload.session
    for (const key of ['domain', 'path', 'secure', 'httpOnly', 'expirationDate', 'url']) {
      if (payload[key] == null) delete payload[key]
    }
    if (!payload.name || payload.value == null) throw new Error('cookie 至少要 name 和 value')
    if (options.env) payload.env = options.env
    await call('cookie_set', payload)
    written += 1
  }
  return written
}

export async function clearCookies(
  call: CookieCall,
  options: { name?: string; domain?: string; url?: string; all?: boolean; env?: string } = {}
): Promise<void> {
  if (!options.name && !options.domain && !options.url && !options.all) {
    throw new Error('clearCookies 至少要给 name / domain / url，或者 all: true')
  }
  const args: Record<string, unknown> = {}
  if (options.name) args.name = options.name
  if (options.domain) args.domain = options.domain
  if (options.url) args.url = options.url
  if (options.all) args.all = true
  if (options.env) args.env = options.env

  if (options.name && !options.domain && !options.url && !options.all) {
    // App 要 url+name 或 domain 或 all；只给 name 时先查一下这个 cookie 在哪些域上。
    const current = await listCookies(call, { env: options.env })
    const domains = [
      ...new Set(
        current
          .filter((item) => item.name === options.name && item.domain)
          .map((item) => String(item.domain))
      )
    ]
    for (const domain of domains) await call('cookie_remove', { ...args, domain })
    return
  }
  await call('cookie_remove', args)
}
