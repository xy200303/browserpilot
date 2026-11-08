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
  },
  market: {
    run: '执行',
    running: '执行中',
    runFailed: '执行失败',
    runDone: '执行完了',
    noParams: '这次没有参数。',
    copiedPrompt: '已复制给 Agent 的说明',
    copyFailed: '复制失败',
    giveToAgent: '交给 Agent',
    runs: '运行记录',
    timeFrom: '开始',
    timeTo: '结束',
    timeSeparator: '至'
  },
  marketPage: {
    all: '全部',
    noDescription: '没有说明',
    catalogError: '目录连不上 GitHub',
    searchPlaceholder: '搜索工作流',
    installedCount: '已安装 {{count}}',
    import: '导入',
    importing: '导入中',
    installedOnly: '已安装',
    catalog: '目录',
    noMatch: '没有匹配的工作流',
    noneInstalled: '还没有安装工作流',
    noneAvailable: '没有可安装的工作流',
    install: '安装',
    installing: '安装中',
    delete: '删除',
    deleting: '删除中',
    deleteTitle: '删除工作流',
    deleteDetail: '从本机删除「{{name}}」。目录里的还可以再安装。',
    importTitle: '导入',
    importDetail: '从 GitHub 地址安装，或从本机选择一份 JSON。',
    importOnline: '在线导入',
    importUrlPlaceholder: 'GitHub 上的工作流 JSON 地址',
    importLocal: '本地导入',
    pickJson: '选择本机 JSON',
    back: '返回',
    openCanvas: '打开画布',
    export: '导出',
    installedNotice: '已安装 {{name}}',
    importedNotice: '已导入 {{name}}',
    deletedNotice: '已删除 {{name}}',
    exportedNotice: '已导出 {{name}}',
    installFailed: '安装失败',
    importFailed: '导入失败',
    deleteFailed: '删除失败',
    exportFailed: '导出失败'
  },
  settings2: {
    env: {
      search: '搜索环境或网站',
      new: '新建',
      title: '环境',
      detail: '一套环境里可以登录多个网站。新建的窗口都是有头的，关掉窗口不会清掉登录。',
      noMatch: '没有匹配的环境',
      empty: '还没有环境',
      initial: '环',
      open: '打开',
      show: '显示',
      statusHeadless: '无头窗口开着',
      statusHeaded: '有头窗口开着',
      statusClosed: '窗口没打开',
      sites: '{{count}} 个网站',
      noSites: '还没有打开过的网站',
      back: '返回',
      name: '名称',
      remark: '备注',
      save: '保存',
      delete: '删除',
      websites: '网站',
      noSitesDetail: '还没有打开过的网站。',
      cookieOn: 'Cookie 还在',
      cookieOff: '没有 Cookie',
      deleteTitle: '删除环境',
      deleteDetail: '从本机删除「{{name}}」。这套里的登录会一起去掉。',
      newTitle: '新建环境',
      newDetail: '新建的窗口是有头的。关掉窗口不会清掉登录。',
      create: '新建',
      headless: '无头',
      headed: '有头',
      notOpen: '未打开'
    },
    net: {
      title: '抓包',
      detail: '当前网页标签上的请求。正文里的 Cookie 只留在本机。',
      empty: '还没有记录。让 Agent 对这个标签调用 net_start。'
    },
    privacy: {
      title: '隐私与数据',
      scope: '只影响当前环境「{{env}}」。',
      clearTitle: '清除浏览数据',
      history: '浏览历史',
      cookies: 'Cookie 与站点数据',
      cache: '缓存',
      clearSelected: '清除所选数据',
      clearing: '正在清除…',
      confirmClear: '确认清除',
      cleared: '已清除所选数据。',
      clearHint: '清除 Cookie 会让这个环境里的网站退出登录；缓存清了以后页面需要重新加载。',
      permissions: '站点权限',
      clearAll: '清除全部',
      none: '还没有记住的站点权限。',
      allow: '允许',
      deny: '拒绝',
      revoke: '撤销',
      permissionHint: '页面请求摄像头、麦克风、通知、位置时，会弹系统对话框；勾选「记住这次选择」后出现在这里。',
      perm: {
        media: '摄像头 / 麦克风',
        geolocation: '位置',
        notifications: '通知',
        clipboard: '剪贴板',
        display: '屏幕共享',
        midi: 'MIDI 设备',
        pointerLock: '鼠标锁定',
        fullscreen: '全屏',
        openExternal: '打开外部应用'
      }
    },
    passwords: {
      title: '密码',
      detail: '网页登录时自动记下账号密码，下次打开同一个网站自动填入。按环境隔离，只保存在本机。',
      protect: '密码保护',
      checking: '检查系统密钥…',
      secure: '系统密钥环已启用',
      insecure: '系统没有可用的密钥环，密码只做本机编码',
      checkingShort: '检查中',
      encrypted: '已加密',
      plain: '未加密',
      revealFailed: '（解不出来：系统密钥环不可用或已经变化）',
      insecureDetail: 'Ubuntu 服务器这类没有 gnome-keyring / kwallet 的系统会走这条路：文件还在本机，但能读到这个用户目录的人就能解出密码。建议关掉「自动保存」，或装好密钥环后重启应用；已经保存的密码在这里删掉即可。',
      autoSave: '自动保存',
      autoSaveDetail: '提交登录表单时记下来。关掉后不再新增，已保存的仍然可以填。',
      autoFill: '自动填充',
      autoFillDetail: '打开登录页时填进账号和密码，页面里已经输入过就不覆盖。',
      empty: '还没有保存的密码。在当前环境里登录一次就会出现在这里。',
      noUsername: '（没填账号）',
      hide: '隐藏',
      show: '显示',
      delete: '删除',
      clear: '清空这套环境的密码'
    },
    general: {
      searchEngine: '搜索引擎',
      searchEngineDetail: '新标签页打开这个搜索引擎的首页。地址栏里输入文字时，也用它来搜索。',
      tabLayout: '标签栏',
      tabLayoutDetail: '顶部是横条。左侧是竖排，靠近时盖住网页展开，点顶部固定后网页才让开。',
      top: '顶部',
      left: '左侧',
      downloadDir: '下载位置',
      downloadDirDetail: '网页下载、Agent 保存的图片/视频、窗口录屏都默认放这里。不改就是系统下载目录（Windows 的「下载」、macOS / Linux 的 Downloads）。',
      systemDir: '系统下载目录',
      choose: '选择…',
      resetDefault: '恢复默认',
      toolMode: '工具列表',
      toolModeDetail: 'Agent 能看到的工具。按需搜索只先给核心工具，其它用 search_tools 查；全部则一次给全，占上下文更多。',
      search: '按需搜索',
      full: '全部',
      connect: '接入 Agent',
      connectDetail: '复制一段提示词给 Agent：里面带 MCP 地址和口令、skill 和命令行工具的安装方法。',
      copyPrompt: '复制提示词',
      mcp: 'MCP',
      mcpDetail: '只听 127.0.0.1。关掉后再打开会换一次端口上的服务。',
      field: {
        address: '监听地址',
        port: '端口',
        endpoint: '端点',
        concurrency: '批量并发上限',
        headlessLimit: '无头窗口上限'
      }
    },
    about: {
      title: '关于',
      tagline: '给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。',
      version: '当前版本',
      versionDetail: '安装包里的版本号'
    }
  },
  workflow: {
    node: {
      start: '开始', end: '结束', goto: '打开', click: '点击', fill: '填写', select: '选择',
      press: '按键', scroll: '滚动', swipe: '滑动', stroke: '落笔', upload: '上传',
      handoff: '交接', script: '页面脚本', code: '代码', cdp: 'CDP', httpRequest: '请求',
      extract: '提取', export: '导出', ifElse: '判断', loop: '循环', captcha: '验证码',
      wait: '等待', download: '下载'
    },
    op: { contains: '包含', is: '等于', empty: '为空', notEmpty: '不为空', locator: '页面上有' },
    err: {
      selfLoop: '不能连到自己',
      duplicate: '这条线已经有了',
      merge: '这个节点已经有进入的线，不能汇合',
      cycle: '这样会成环',
      startUndeletable: '开始节点不能删除',
      saveFailed: '没能保存',
      exportFailed: '导出失败'
    },
    defaults: { loopBody: '循环体', exportFile: '导出.csv', param: '参数', output: '输出', result: '结果', input: '输入' },
    sel: {
      url: '当前网址', title: '当前标题', tabId: '标签编号', env: '环境编号',
      loopIndex: '循环序号', loopItem: '循环当前项', param: '参数 {{name}}', variable: '当前变量'
    },
    port: { input: '输入', output: '输出', from: '从哪个端点连出', enterLoop: '进入循环', doubleClick: '双击进入', pick: '选择上游产出', outputNamed: '输出' },
    field: {
      title: '标题', paramName: '参数名', displayName: '显示名', type: '类型', options: '选项',
      required: '必填', remove: '删除', addParam: '添加参数', addOutput: '添加输出', name: '名称',
      value: '取值', headers: '表头', rows: '行', content: '内容', direction: '方向',
      up: '上', down: '下', left: '左', right: '右', path: '路径（SVG d）',
      canvasWidth: '画布宽', canvasHeight: '画布高', text: '文字', roleName: '角色名称（如 button 提交）',
      compare: '比较值', writeMode: '写入方式', typeChar: '逐字输入', paste: '粘贴',
      until: '直到', engine: '识别引擎', auto: '自动', cv: '内置视觉', onnx: 'ONNX 模型',
      retries: '重试次数', waitFor: '等到', appear: '出现', gone: '消失', timeout: '超时（秒）',
      hint: '提示', method: '方法', address: '地址', body: '请求正文', pageScript: '页面脚本',
      code: '代码', regex: '正则', filename: '文件名', canvasX: '画布 X', canvasY: '画布 Y',
      option: '选项', key: '按键', url: '地址', message: '提示',
      number: '数字', time: '时间', timeRange: '时间范围', single: '单选', multi: '复选',
      boolean: '布尔', object: '对象', array: '数组'
    },
    loop: { onFail: '一轮失败时', stop: '整个流程停下', keepGoing: '记下错误，继续下一轮' },
    add: { step: '添加下一步', branch: '添加分支', connect: '接到这个端点' },
    btn: { deleteNode: '删除节点', close: '关闭', export: '导出' },
    hint: {
      elseBranch: '都不成立时走 ELSE。',
      canvas: '从右侧端点拖到下一个节点左侧。选中连线后按 Delete 删除。判断的每个分支是一个端点。',
      panel: '点一个节点，在这里改输入和输出。输入从上游产出里选。'
    },
    run: {
      collapse: '收起运行记录', recent: '最近运行', none: '还没跑过',
      ok: '成功', failed: '失败', node: '节点 {{name}}', screenshot: '现场截图：{{path}}'
    }
  }
} as const

export type MessageShape<T> = {
  [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]>
}
