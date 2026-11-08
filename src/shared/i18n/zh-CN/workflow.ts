export const zhWorkflow = {
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
      retries: '重试次数', waitFor: '等到', appear: '出现', gone: '消失', timeout: '超时（秒）', settle: '等待页面稳定',
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
