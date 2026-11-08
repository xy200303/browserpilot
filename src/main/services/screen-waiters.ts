/** 录屏工具和 screen:* IPC 之间的等待表，单独放一个模块，避免启动时加载整个工具目录。 */
export const screenWaiters = new Map<string, { resolve: (path: string) => void; reject: (error: Error) => void }>()
export const screenStartWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
