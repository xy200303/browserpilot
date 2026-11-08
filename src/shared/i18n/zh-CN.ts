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
  },
  shell: {
    screen: {
      noMp4: '这次没能写成 mp4',
      notStarted: '录屏没有开始',
      badge: '录屏'
    },
    tabs: {
      scrollLeft: '向左滚动',
      scrollRight: '向右滚动',
      new: '新标签',
      close: '关闭',
      mute: '静音',
      unmute: '取消静音',
      untitled: '新标签页',
      untitledShort: '新'
    },
    window: {
      minimize: '最小化',
      restore: '还原',
      maximize: '最大化',
      close: '关闭'
    },
    env: {
      editTitle: '编辑环境名称和备注'
    },
    find: {
      placeholder: '在当前页查找',
      action: '查找',
      close: '关闭查找'
    },
    error: {
      offline: '网络连接已断开',
      notFound: '找不到这个网站',
      refused: '连接被拒绝',
      timeout: '连接超时',
      cert: '证书有问题',
      generic: '无法访问此网站',
      code: '错误代码 {{code}}',
      retry: '重试',
      back: '返回上一页',
      hint: {
        offline: '检查网线、Wi-Fi 或代理设置，然后重试。',
        notFound: '检查网址拼写，或确认域名是否仍然存在。',
        refused: '目标服务器拒绝了连接，可能服务没有启动或端口不对。',
        timeout: '服务器没有在预期时间内响应，稍后重试。',
        cert: '网站证书无法验证。不要在这种页面输入密码或支付信息。',
        changed: '网络连接发生了变化，重试通常可以恢复。',
        fallback: '页面加载失败，可以重试或返回上一页。'
      }
    },
    workflow: {
      missing: '没有这个工作流。'
    },
    common: {
      close: '关闭',
      cancel: '取消',
      ok: '确定'
    }
  },
  address: {
    kind: {
      market: '工作流',
      settings: '设置',
      downloads: '下载',
      runs: '运行记录',
      history: '历史记录',
      bookmarks: '书签'
    },
    placeholder: '在 {{engine}} 中搜索，或输入网址',
    searchTitle: '{{query}} - {{engine}} 搜索',
    nav: {
      back: '后退',
      forward: '前进',
      stop: '停止加载',
      reload: '刷新'
    },
    bookmark: {
      add: '添加书签',
      remove: '取消书签',
      menu: '收藏夹'
    },
    downloads: '下载',
    market: '工作流',
    menu: '菜单'
  },
  menu: {
    newEnv: '新建环境',
    copyAgentPrompt: '复制 Agent 提示词',
    devtools: '开发者工具',
    startScreen: '开始录屏',
    stopScreen: '停止录屏',
    history: '历史记录',
    bookmarks: '书签',
    searchTabs: '搜索标签页',
    reopenTab: '重新打开关闭的标签页',
    settings: '设置',
    copyTabPrompt: '复制标签提示词',
    newTabBelow: '在下方新建标签页',
    addToGroup: '将标签页添加到新组',
    removeFromGroup: '移出分组',
    reload: '刷新',
    duplicateTab: '复制标签页',
    pin: '固定标签页',
    unpin: '取消固定标签页',
    muteTab: '使标签页静音',
    unmuteTab: '取消标签页静音',
    hibernateTab: '休眠标签页',
    hibernateOthers: '休眠其他标签页',
    closeTab: '关闭标签页',
    closeOthers: '关闭其他标签页',
    closeBelow: '关闭以下标签页',
    verticalOn: '打开垂直标签页',
    verticalOff: '关闭垂直标签页',
    group: {
      title: '加入分组',
      detail: '输入分组名称。已有同名分组时，这个标签会放进那一组。',
      placeholder: '分组名称'
    }
  },
  downloads: {
    title: '下载',
    clear: '清除已完成',
    empty: '还没有下载。网页里下载的文件、右键另存的媒体、Agent 保存的文件都会出现在这里。',
    progress: '下载中 {{done}}{{total}}{{pct}}',
    paused: '已暂停 {{done}}',
    completed: '{{done}} · 已完成',
    cancelled: '已取消',
    failed: '失败：{{error}}',
    failedPlain: '失败',
    action: {
      pause: '暂停',
      resume: '继续',
      cancel: '取消',
      retry: '重试',
      open: '打开',
      show: '打开所在文件夹',
      copyLink: '复制下载链接'
    }
  },
  history: {
    title: '历史记录',
    count: '{{count}} 条',
    today: '今天',
    yesterday: '昨天',
    date: '{{year}} 年 {{month}} 月 {{day}} 日',
    deleteOne: '删除这条记录',
    refresh: '刷新',
    clear: '清空历史',
    confirmClear: '确认清空这个环境',
    placeholder: '搜索标题或网址',
    empty: '还没有历史记录',
    noMatch: '没有匹配的记录',
    emptyHint: '打开网页后，记录会出现在这里。',
    footer: '历史记录只保存在本机，按环境隔离；最多保留 3000 条。'
  },
  bookmarks: {
    title: '书签',
    count: '{{count}} 条',
    clear: '清空书签',
    confirmClear: '确认清空这个环境',
    placeholder: '搜索书签',
    empty: '还没有书签',
    emptyHint: '在网页上按 Ctrl+D，或点地址栏右侧的星标。',
    noMatch: '没有匹配的书签',
    delete: '删除书签',
    footer: '书签只保存在本机，按环境隔离。'
  },
  rail: {
    newTab: '新建标签页',
    closeOthers: '关闭其他标签',
    pin: '固定标签栏',
    unpin: '取消固定标签栏',
    options: '标签选项'
  },
  env: {
    missing: '找不到这套环境。',
    edit: '编辑环境',
    name: '名称',
    remark: '备注',
    remarkPlaceholder: '这套环境用来做什么',
    saving: '保存中…',
    save: '保存'
  },
  about: {
    version: '版本 {{version}}',
    tagline: '给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。'
  },
  suggestions: {
    kind: {
      search: '搜索',
      bookmark: '书签',
      history: '历史',
      tab: '标签'
    },
    filter: '筛选搜索：',
    tabs: '标签页',
    noMatch: '没有匹配的记录'
  },
  panels: {
    manageBookmarks: '管理书签',
    bar: '收藏夹栏',
    emptyBookmarks: '还没有收藏的网页',
    current: '当前',
    tabSearchPlaceholder: '搜索标签页',
    tabSearchEmpty: '没有匹配的标签页',
    tabSearchHint: '↑↓ 选择 · Enter 打开 · Esc 关闭'
  }
} as const

export type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>
}
