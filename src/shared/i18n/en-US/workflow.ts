import type { MessageShape } from '../shape'
import type { zhWorkflow } from '../zh-CN/workflow'

export const enWorkflow: MessageShape<typeof zhWorkflow> = {
  workflow: {
    node: {
      start: 'Start', end: 'End', goto: 'Open', click: 'Click', fill: 'Fill', select: 'Select',
      press: 'Key', scroll: 'Scroll', swipe: 'Swipe', stroke: 'Stroke', upload: 'Upload',
      handoff: 'Handoff', script: 'Page script', code: 'Code', cdp: 'CDP', httpRequest: 'Request',
      extract: 'Extract', export: 'Export', ifElse: 'Branch', loop: 'Loop', captcha: 'Captcha',
      wait: 'Wait', download: 'Download'
    },
    op: { contains: 'contains', is: 'equals', empty: 'is empty', notEmpty: 'is not empty', locator: 'page has' },
    err: {
      selfLoop: 'A node cannot connect to itself',
      duplicate: 'This edge already exists',
      merge: 'This node already has an incoming edge',
      cycle: 'That would create a cycle',
      startUndeletable: 'The start node cannot be deleted',
      saveFailed: 'Could not save',
      exportFailed: 'Export failed'
    },
    defaults: { loopBody: 'Loop body', exportFile: 'export.csv', param: 'param', output: 'output', result: 'result', input: 'input' },
    sel: {
      url: 'Current URL', title: 'Current title', tabId: 'Tab id', env: 'Environment id',
      loopIndex: 'Loop index', loopItem: 'Loop item', param: 'Param {{name}}', variable: 'Current value'
    },
    port: { input: 'Input', output: 'Output', from: 'Output port', enterLoop: 'Enter loop', doubleClick: 'Double click to enter', pick: 'Pick upstream output', outputNamed: 'Output' },
    field: {
      title: 'Title', paramName: 'Name', displayName: 'Label', type: 'Type', options: 'Options',
      required: 'Required', remove: 'Remove', addParam: 'Add parameter', addOutput: 'Add output', name: 'Name',
      value: 'Value', headers: 'Headers', rows: 'Rows', content: 'Content', direction: 'Direction',
      up: 'Up', down: 'Down', left: 'Left', right: 'Right', path: 'Path (SVG d)',
      canvasWidth: 'Canvas width', canvasHeight: 'Canvas height', text: 'Text', roleName: 'Role and name (button Submit)',
      compare: 'Compare with', writeMode: 'Input mode', typeChar: 'Type keys', paste: 'Paste',
      until: 'Until', engine: 'Engine', auto: 'Auto', cv: 'Built-in vision', onnx: 'ONNX model',
      retries: 'Retries', waitFor: 'Wait for', appear: 'Appear', gone: 'Disappear', timeout: 'Timeout (s)',
      hint: 'Message', method: 'Method', address: 'Address', body: 'Request body', pageScript: 'Page script',
      code: 'Code', regex: 'Regex', filename: 'File name', canvasX: 'Canvas X', canvasY: 'Canvas Y',
      option: 'Option', key: 'Shortcut', url: 'Address', message: 'Message',
      number: 'Number', time: 'Time', timeRange: 'Time range', single: 'Single choice', multi: 'Multiple choice',
      boolean: 'Boolean', object: 'Object', array: 'Array'
    },
    loop: { onFail: 'When a round fails', stop: 'Stop the workflow', keepGoing: 'Record and continue' },
    add: { step: 'Add next step', branch: 'Add branch', connect: 'Connect here' },
    btn: { deleteNode: 'Delete node', close: 'Close', export: 'Export' },
    hint: {
      elseBranch: 'ELSE runs when no branch matches.',
      canvas: 'Drag from an output port to the next node. Select an edge and press Delete to remove it. Each branch of a condition is its own port.',
      panel: 'Pick a node to edit its inputs and outputs. Inputs come from upstream outputs.'
    },
    run: {
      collapse: 'Hide runs', recent: 'Recent runs', none: 'No runs yet',
      ok: 'ok', failed: 'failed', node: 'node {{name}}', screenshot: 'Screenshot: {{path}}'
    }
  }
}
