export const zhCN = {
  app: {
    name: 'BrowserPilot'
  },
  settings: {
    title: '设置',
    sections: {
      env: '环境',
      net: '抓包',
      general: '通用',
      passwords: '密码',
      privacy: '隐私',
      about: '关于'
    },
    general: {
      title: '通用',
      detail: '这些选项保存在本机，改完即生效。',
      language: {
        title: '界面语言',
        detail: '只影响界面。工具描述和报错走模型侧，始终是英文，避免同一份提示词随语言翻倍。',
        auto: '跟随系统'
      }
    }
  }
} as const

export type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>
}
