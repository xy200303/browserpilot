/**
 * 按用途分组的工具入口，省得到处写 `bp.call('workflow_run', ...)`。
 *
 * 每个方法就是一次工具调用：参数名和工具一致，返回载荷里的字段，不额外包一层。
 */
export type Caller = {
  call(name: string, args?: Record<string, unknown>, options?: { timeout?: number }): Promise<Record<string, unknown>>
}

export type TabLike = string | { id: string }

const tabId = (tab: TabLike): string => (typeof tab === 'string' ? tab : tab.id)

class Api {
  constructor(protected readonly client: Caller) {}

  protected call(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) if (value !== undefined) clean[key] = value
    return this.client.call(tool, clean)
  }
}

export class Environments extends Api {
  async list(): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('env_list')).envs as Array<Record<string, unknown>>) ?? []
  }

  /** 新建环境并打开窗口。remark 必填：写清楚这套环境是干什么的。 */
  create(name: string, remark: string): Promise<Record<string, unknown>> {
    return this.call('env_create', { name, remark })
  }

  open(env: string, headless?: boolean): Promise<Record<string, unknown>> {
    return this.call('env_open', { env, headless })
  }

  /** 关窗口，但保留登录态和标签会话。 */
  close(env: string): Promise<Record<string, unknown>> {
    return this.call('env_close', { env })
  }

  front(env: string, tab?: TabLike): Promise<Record<string, unknown>> {
    return this.call('env_front', { env, tabId: tab === undefined ? undefined : tabId(tab) })
  }

  update(env: string, patch: { name?: string; remark?: string }): Promise<Record<string, unknown>> {
    return this.call('env_update', { env, ...patch })
  }

  headless(env: string, headless = true): Promise<Record<string, unknown>> {
    return this.call('env_headless', { env, headless })
  }

  /** 删环境 = 删目录，登录态一起没。默认环境不能删。 */
  delete(env: string): Promise<Record<string, unknown>> {
    return this.call('env_delete', { env })
  }

  /** 导出 cookie，用来在别的机器上复现登录态。 */
  export(env: string, path?: string): Promise<Record<string, unknown>> {
    return this.call('env_export', { env, path })
  }

  import(path: string, env?: string): Promise<Record<string, unknown>> {
    return this.call('env_import', { path, env })
  }
}

export class Tabs extends Api {
  async list(): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('tab_list')).tabs as Array<Record<string, unknown>>) ?? []
  }

  open(options: { env?: string; url?: string; group?: string } = {}): Promise<Record<string, unknown>> {
    return this.call('tab_open', { env: options.env, url: options.url, groupId: options.group })
  }

  close(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('tab_close', { tabId: tabId(tab) })
  }

  activate(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('tab_activate', { tabId: tabId(tab) })
  }

  mute(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('tab_mute', { tabId: tabId(tab) })
  }

  restore(): Promise<Record<string, unknown>> {
    return this.call('tab_restore')
  }

  duplicate(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('tab_duplicate', { tabId: tabId(tab) })
  }

  closeOthers(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('tab_close_others', { tabId: tabId(tab) })
  }
}

export class Groups extends Api {
  async list(): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('group_list')).groups as Array<Record<string, unknown>>) ?? []
  }

  create(env: string, name: string, color?: string): Promise<Record<string, unknown>> {
    return this.call('group_create', { env, name, color })
  }

  update(env: string, id: string, patch: { name?: string; color?: string }): Promise<Record<string, unknown>> {
    return this.call('group_update', { env, id, ...patch })
  }

  delete(env: string, id: string): Promise<Record<string, unknown>> {
    return this.call('group_delete', { env, id })
  }

  /** group 传 undefined 表示移出分组。 */
  assign(tab: TabLike, group?: string): Promise<Record<string, unknown>> {
    return this.call('tab_group', { tabId: tabId(tab), groupId: group })
  }
}

export class Settings extends Api {
  async get(): Promise<Record<string, unknown>> {
    return ((await this.call('settings_get')).settings as Record<string, unknown>) ?? {}
  }

  update(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('settings_set', fields)
  }
}

export class Workflows extends Api {
  async list(): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('workflow_list')).workflows as Array<Record<string, unknown>>) ?? []
  }

  run(name: string, inputs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.call('workflow_run', { name, inputs })
  }

  runBatch(name: string, rows: Array<Record<string, unknown>>, env?: string): Promise<Record<string, unknown>> {
    return this.call('workflow_batch', { name, rows, env })
  }

  export(name: string, path?: string): Promise<Record<string, unknown>> {
    return this.call('workflow_export', { name, path })
  }

  import(path: string): Promise<Record<string, unknown>> {
    return this.call('workflow_import', { path })
  }

  delete(name: string): Promise<Record<string, unknown>> {
    return this.call('workflow_delete', { name })
  }

  write(workflow: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('workflow_write', workflow)
  }

  update(name: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('workflow_update', { name, ...patch })
  }

  /** action: start / stop / cancel。录制期间的工具调用会变成工作流节点。 */
  record(action: 'start' | 'stop' | 'cancel', name?: string): Promise<Record<string, unknown>> {
    return this.call('workflow_record', { action, name })
  }
}

export class Net extends Api {
  start(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('net_start', { tabId: tabId(tab) })
  }

  stop(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('net_stop', { tabId: tabId(tab) })
  }

  async list(tab: TabLike, urlContains?: string): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('net_list', { tabId: tabId(tab), urlContains })).requests as Array<Record<string, unknown>>) ?? []
  }

  get(reqId: string): Promise<Record<string, unknown>> {
    return this.call('net_get', { reqId })
  }

  export(tab: TabLike, path?: string): Promise<Record<string, unknown>> {
    return this.call('net_export', { tabId: tabId(tab), path })
  }

  mock(tab: TabLike, rules: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    return this.call('net_mock', { tabId: tabId(tab), rules })
  }

  mockOff(tab: TabLike): Promise<Record<string, unknown>> {
    return this.call('net_mock_off', { tabId: tabId(tab) })
  }
}

export class History extends Api {
  async list(env: string, options: { query?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('history_list', { env, ...options })).history as Array<Record<string, unknown>>) ?? []
  }

  async remove(env: string, filter: { id?: string; url?: string; all?: boolean } = {}): Promise<number> {
    return Number((await this.call('history_remove', { env, ...filter })).removed ?? 0)
  }
}

export class Bookmarks extends Api {
  async list(env: string, query?: string): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('bookmark_list', { env, query })).bookmarks as Array<Record<string, unknown>>) ?? []
  }

  add(env: string, url: string, title?: string): Promise<Record<string, unknown>> {
    return this.call('bookmark_add', { env, url, title })
  }

  async remove(env: string, filter: { id?: string; url?: string; all?: boolean } = {}): Promise<number> {
    return Number((await this.call('bookmark_remove', { env, ...filter })).removed ?? 0)
  }
}

export class Downloads extends Api {
  /** wait 是等活跃下载完成的秒数，最多 120。 */
  async list(wait?: number): Promise<Array<Record<string, unknown>>> {
    return ((await this.call('download', { action: 'list', wait })).downloads as Array<Record<string, unknown>>) ?? []
  }

  directory(): Promise<Record<string, unknown>> {
    return this.call('download', { action: 'dir' })
  }

  setDirectory(path: string): Promise<Record<string, unknown>> {
    return this.call('download', { action: 'dir', path })
  }

  private act(action: string, id?: string): Promise<Record<string, unknown>> {
    return this.call('download', { action, id })
  }

  open(id: string): Promise<Record<string, unknown>> {
    return this.act('open', id)
  }

  show(id: string): Promise<Record<string, unknown>> {
    return this.act('show', id)
  }

  copy(id: string): Promise<Record<string, unknown>> {
    return this.act('copy', id)
  }

  pause(id: string): Promise<Record<string, unknown>> {
    return this.act('pause', id)
  }

  resume(id: string): Promise<Record<string, unknown>> {
    return this.act('resume', id)
  }

  cancel(id: string): Promise<Record<string, unknown>> {
    return this.act('cancel', id)
  }

  retry(id: string): Promise<Record<string, unknown>> {
    return this.act('retry', id)
  }

  remove(id: string): Promise<Record<string, unknown>> {
    return this.act('remove', id)
  }

  clear(): Promise<Record<string, unknown>> {
    return this.act('clear')
  }
}

export class Network extends Api {
  /** 每套环境自己的出口：代理、UA、语言、WebRTC 策略。 */
  get(env: string): Promise<Record<string, unknown>> {
    return this.call('network_get', { env })
  }

  set(
    env: string,
    options: {
      proxy?: Record<string, unknown>
      userAgent?: string
      acceptLanguages?: string
      timezone?: string
      locale?: string
      webrtcPolicy?: string
    } = {}
  ): Promise<Record<string, unknown>> {
    return this.call('network_set', { env, ...options })
  }
}
