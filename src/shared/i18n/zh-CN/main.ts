export const zhMain = {
  main: {
    perm: {
      media: '摄像头和麦克风',
      geolocation: '位置',
      notifications: '通知',
      clipboard: '剪贴板',
      display: '屏幕共享',
      midi: 'MIDI 设备',
      pointerLock: '鼠标锁定',
      fullscreen: '全屏',
      openExternal: '打开外部应用'
    },
    prompt: {
      title: '站点权限',
      message: '{{origin}} 想使用{{permission}}',
      detail: '只影响这套环境，其它环境单独设置。',
      remember: '记住这次选择',
      allow: '允许',
      deny: '拒绝'
    },
    menu: {
      openInNewTab: '在新标签页中打开',
      copyLink: '复制链接地址',
      viewImage: '在新标签页中打开图片',
      saveImageAs: '图片存储为…',
      copyImage: '复制图片',
      copyImageAddress: '复制图片地址',
      saveVideoAs: '视频存储为…',
      saveAudioAs: '音频存储为…',
      cut: '剪切',
      copy: '复制',
      paste: '粘贴',
      selectAll: '全选',
      reload: '重新加载',
      viewSource: '查看页面源代码',
      inspect: '检查',
      nativeMenu: '网页自带菜单'
    },
    dialog: {
      saveAs: '存储为',
      allFiles: '所有文件',
      selectDownloadDir: '选择下载目录',
      exportWorkflow: '导出工作流',
      importWorkflow: '导入工作流',
      json: 'JSON 文件'
    },
    label: {
      mp4: 'MP4 视频',
      m4a: '音频',
      png: 'PNG 图片',
      jpg: 'JPEG 图片',
      jpeg: 'JPEG 图片',
      webp: 'WebP 图片',
      gif: 'GIF 图片',
      svg: 'SVG 图片',
      mp3: 'MP3 音频'
    },
    err: {
      noEnv: '没有这套环境 {{id}}',
      headlessLimit: '无头窗口已达上限 {{limit}}',
      noWorkflow: '没有这个工作流 {{id}}',
      noTab: '没有这个标签 {{id}}',
      downloadFailed: '下载失败',
      saveFailed: '保存失败',
      notPage: '只有网页标签能这样操作'
    },
    placeholder: {
      unnamedFile: '未命名文件',
      newEnv: '新环境',
      noRemark: '未填写备注'
    },
    paramHint: {
      number: '数字',
      time: '时间，写成 2026-09-30 11:58',
      timeRange: '时间范围，写成 2026-09-30 11:58 ~ 2026-09-30 18:00',
      select: '可选：{{options}}',
      selectAny: '单选',
      checkbox: '多选，用逗号分隔：{{options}}',
      checkboxAny: '多选，用逗号分隔',
      text: '文本'
    },
    lock: {
      working: 'Agent 正在操作浏览器',
      takeOver: '接管'
    },
    screen: {
      notStarted: '录屏没有开始',
      notMp4: '没能写成 mp4'
    },
    agent: {
      runInstalled: '让 BrowserPilot 执行已经装好的工作流：{{name}}。',
      runHint: '调用 workflow_run，name 为「{{name}}」。',
      inputs: 'inputs 使用下面这些值（按名字对应，不要自己编）：\n{{list}}',
      noParams: '这个工作流没有参数。',
      unlock: '做完后调用 page_unlock。'
    }
  }
} as const
