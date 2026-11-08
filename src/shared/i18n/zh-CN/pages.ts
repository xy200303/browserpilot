export const zhPages = {
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
