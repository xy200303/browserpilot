package browserpilot

/*
弹窗、上传、遮罩、查找、监听、人工交接，以及浏览器级的会话、剪贴板、权限和密码。

这些接口补的是「别让页面卡住、别让 Agent 硬闯」的那部分能力：

  - App 默认自动应答 alert / confirm / prompt，标签不会因为一个弹窗停住；
    确实需要点「确定」时，先用 AcceptDialog 改策略（WithOnce 只作用于下一个弹窗）。
  - 文件上传走 file input 注入，不弹系统选择框；目标可以按 selector / xpath 指定，
    不指定就是页面上第一个文件输入框。
  - 遮罩会让点击落空，Overlays 先看清楚挡着什么，DismissOverlays 只收广告和常见关闭按钮。
  - Find 是 Ctrl+F 的语义，Watch 把「等一次变化」变成一个调用；
    两者都不改页面内容。
  - Lock / Handoff 把控制权交回给人：一个只是罩遮罩，一个真的暂停这一步。

浏览器级的那几个按环境走，和 cookie 一样不带 tabId。
*/

import (
	"context"
	"time"
)

// ---------- 弹窗 ----------

type dialogOptions struct {
	once       bool
	promptText *string
}

// DialogOption 修饰一次弹窗策略设置。
type DialogOption func(*dialogOptions)

// WithOnce 让这次策略只作用于下一个弹窗，处理完就回到默认策略。
// 默认策略一直是「自动应答」：alert 关掉、confirm 取消、prompt 返回 null。
func WithOnce(once bool) DialogOption {
	return func(options *dialogOptions) { options.once = once }
}

// WithPromptText 给 prompt 弹窗填文本；空串也会照发，App 不会把它当成「没填」。
// 这个选项只对 AcceptDialog 有意义，DismissDialog 不会把它发出去。
func WithPromptText(text string) DialogOption {
	return func(options *dialogOptions) { options.promptText = &text }
}

func newDialogArgs(action string, opts []DialogOption) map[string]any {
	options := dialogOptions{}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"action": action}
	if options.once {
		args["once"] = true
	}
	if action == "accept" && options.promptText != nil {
		args["promptText"] = *options.promptText
	}
	return args
}

// Dialogs 看最近的弹窗和当前策略（policy / pending / dialogs）。
//
// 默认策略是自动应答，页面不会卡住；这里主要是事后查「刚才弹了什么」，
// 需要改变下一个弹窗的结果时再用 AcceptDialog / DismissDialog。
func (p *Page) Dialogs(ctx context.Context) ([]map[string]any, error) {
	data, err := p.call(ctx, "page_dialog", map[string]any{"action": "list"}, 0)
	if err != nil {
		return nil, err
	}
	return mapListField(data, "dialogs", "list"), nil
}

// AcceptDialog 让弹窗点「确定」：confirm 返回 true，prompt 返回文本，
// alert 仍然只是被关掉。配合 WithOnce(true) 只影响下一个弹窗。
func (p *Page) AcceptDialog(ctx context.Context, opts ...DialogOption) (map[string]any, error) {
	return p.call(ctx, "page_dialog", newDialogArgs("accept", opts), 0)
}

// DismissDialog 让弹窗走「取消」：confirm 返回 false，prompt 返回 null。
func (p *Page) DismissDialog(ctx context.Context, opts ...DialogOption) error {
	_, err := p.call(ctx, "page_dialog", newDialogArgs("dismiss", opts), 0)
	return err
}

// ---------- 上传 ----------

// Upload 把本地文件塞进 file input，不弹系统选择框。
//
// target 可选：传 selector / xpath（可以再 .Pierce()）就上传到那个输入框，
// 不传就是页面上第一个文件输入框。路径由 App 读，Go 这边不检查文件存不存在。
func (p *Page) Upload(ctx context.Context, paths []string, target ...Target) error {
	if paths == nil {
		paths = []string{}
	}
	args := map[string]any{"paths": paths}
	if len(target) > 0 && target[0] != nil {
		spec, err := specOf(target[0])
		if err != nil {
			return err
		}
		located, err := pageLocateFields("upload", spec)
		if err != nil {
			return err
		}
		for key, value := range located {
			args[key] = value
		}
	}
	_, err := p.call(ctx, "page_upload", args, 0)
	return err
}

// ---------- 遮罩 ----------

// Overlays 列出挡住页面的广告 iframe、全屏遮罩和弹层，带各自的位置矩形。
func (p *Page) Overlays(ctx context.Context) ([]map[string]any, error) {
	data, err := p.call(ctx, "page_overlay", map[string]any{"action": "list"}, 0)
	if err != nil {
		return nil, err
	}
	return mapListField(data, "overlays", "list"), nil
}

// DismissOverlays 隐藏常见广告 iframe、点掉常见关闭按钮；不动页面正文。
// 拿不准时先 Overlays 看一眼再收，知道自己在关什么。
func (p *Page) DismissOverlays(ctx context.Context) (map[string]any, error) {
	return p.call(ctx, "page_overlay", map[string]any{"action": "dismiss"}, 0)
}

// ---------- 查找 ----------

type findOptions struct {
	forward  bool
	findNext bool
}

// FindOption 修饰一次页面内查找。
type FindOption func(*findOptions)

// WithFindForward 选查找方向：true 向下（默认），false 向上。
func WithFindForward(forward bool) FindOption {
	return func(options *findOptions) { options.forward = forward }
}

// WithFindNext 从当前命中跳到下一个，而不是重新开始查找。
func WithFindNext() FindOption {
	return func(options *findOptions) { options.findNext = true }
}

// Find 在页面里找文字，相当于 Ctrl+F，返回匹配数和当前序号。
//
// forward 默认向下；WithFindNext 跳到下一个匹配。查找高亮会一直留在页面上，
// 不用了记得 FindStop，否则下次截图还会看到它。
func (p *Page) Find(ctx context.Context, text string, opts ...FindOption) (map[string]any, error) {
	options := findOptions{forward: true}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"text": text, "forward": options.forward}
	if options.findNext {
		args["findNext"] = true
	}
	return p.call(ctx, "page_find", args, 0)
}

// FindStop 清掉查找高亮，不改变页面内容。
func (p *Page) FindStop(ctx context.Context) error {
	_, err := p.call(ctx, "page_find", map[string]any{"stop": true}, 0)
	return err
}

// ---------- 识别与监听 ----------

// Inspect 识别一个元素是什么：video / image / canvas / audio / link / input / text，
// 顺便给出地址（src / href / poster）、标签名、位置和文字。
//
// 只支持 selector / xpath；按截图坐标反查用 InspectAt。
func (p *Page) Inspect(ctx context.Context, target ...Target) (map[string]any, error) {
	if len(target) == 0 || target[0] == nil {
		return nil, newError(CodeBrowserPilotError,
			"Inspect 需要一个 selector / xpath 目标；按坐标反查用 InspectAt(ctx, x, y)", nil)
	}
	spec, err := specOf(target[0])
	if err != nil {
		return nil, err
	}
	located, err := pageLocateFields("inspect", spec)
	if err != nil {
		return nil, err
	}
	return p.call(ctx, "page_inspect", located, 0)
}

// InspectAt 按视口坐标（CSS 像素）反查那一点下面是什么元素。
// 从截图算出坐标后先 Inspect 一遍，确认点的确实是想点的东西。
func (p *Page) InspectAt(ctx context.Context, x, y float64) (map[string]any, error) {
	return p.call(ctx, "page_inspect", map[string]any{"x": x, "y": y}, 0)
}

type watchOptions struct {
	timeout  time.Duration
	interval time.Duration
}

// WatchOption 修饰一次元素监听。
type WatchOption func(*watchOptions)

// WithWatchTimeout 设监听上限，默认 30 秒，App 最多接受 120 秒。
func WithWatchTimeout(timeout time.Duration) WatchOption {
	return func(options *watchOptions) { options.timeout = timeout }
}

// WithWatchInterval 设轮询间隔，默认 0.5 秒，App 允许 0.2～5 秒。
func WithWatchInterval(interval time.Duration) WatchOption {
	return func(options *watchOptions) { options.interval = interval }
}

// Watch 盯住一个元素，文字或位置变化时返回前后快照；超时返回变化前的那份。
//
// 返回的 changed 为 false 表示等到超时都没变，不是错误——很多页面本来就不会变。
// 只支持 selector / xpath；比反复 Count + sleep 更省事，也比轮询 DOM 更少干扰页面。
func (p *Page) Watch(ctx context.Context, target Target, opts ...WatchOption) (map[string]any, error) {
	spec, err := specOf(target)
	if err != nil {
		return nil, err
	}
	located, err := pageLocateFields("watch", spec)
	if err != nil {
		return nil, err
	}
	options := watchOptions{timeout: 30 * time.Second, interval: 500 * time.Millisecond}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	located["timeout"] = options.timeout.Seconds()
	located["interval"] = options.interval.Seconds()
	// 工具本身要等 timeout 秒，客户端得比它多等一点，别在自己的超时上先断掉。
	return p.call(ctx, "page_watch", located, options.timeout+10*time.Second)
}

// ---------- 人工交接 ----------

// Lock 在当前标签上罩一层「Agent 正在操作」的遮罩，用户点按钮就能接管。
// 它只挡视线、不暂停任务；要让人完成一步，用 Handoff。
func (p *Page) Lock(ctx context.Context) error {
	_, err := p.call(ctx, "page_lock", nil, 0)
	return err
}

// Unlock 撤掉遮罩，把页面交回用户。
func (p *Page) Unlock(ctx context.Context) error {
	_, err := p.call(ctx, "page_unlock", nil, 0)
	return err
}

// Handoff 暂停，把这一步交给人，message 告诉他需要做什么（登录、验证码、确认订单）。
// 用户看完页面不会自动重新上锁，Agent 的下一动作才会。
func (p *Page) Handoff(ctx context.Context, message string) error {
	_, err := p.call(ctx, "page_handoff", map[string]any{"message": message}, 0)
	return err
}

// ---------- 会话 ----------

func sessionArgs(env string) map[string]any {
	args := map[string]any{}
	if env != "" {
		args["env"] = env
	}
	return args
}

// Sessions 列出已保存的标签会话。关窗时 App 会自动存一份，下次打开同一环境时恢复。
// env 传空串就是所有环境。
func (bp *BrowserPilot) Sessions(ctx context.Context, env string) ([]map[string]any, error) {
	data, err := bp.Call(ctx, "session_list", sessionArgs(env))
	if err != nil {
		return nil, err
	}
	return mapListField(data, "sessions", "list"), nil
}

// SaveSession 把当前打开的标签存成这套环境的会话。
// 环境窗口没开时工具会报错——没有标签可存。
func (bp *BrowserPilot) SaveSession(ctx context.Context, env string) (map[string]any, error) {
	return bp.Call(ctx, "session_save", sessionArgs(env))
}

// RestoreSession 按会话重开标签：窗口没开就顺带开，已经开着的标签不重复开，最多 20 个。
func (bp *BrowserPilot) RestoreSession(ctx context.Context, env string) (map[string]any, error) {
	return bp.Call(ctx, "session_restore", sessionArgs(env))
}

// ClearSession 删掉保存的会话，下次开窗从空开始；当前标签和历史记录都不动。
func (bp *BrowserPilot) ClearSession(ctx context.Context, env string) (map[string]any, error) {
	return bp.Call(ctx, "session_clear", sessionArgs(env))
}

// ---------- 剪贴板 ----------

// ClipboardRead 读系统剪贴板里的文本。内容可能是密码或验证码，别写进日志、别外发。
func (bp *BrowserPilot) ClipboardRead(ctx context.Context) (string, error) {
	data, err := bp.Call(ctx, "clipboard_read", nil)
	if err != nil {
		return "", err
	}
	return stringField(data, "text"), nil
}

// ClipboardWrite 把文本写进系统剪贴板，返回载荷里有写入长度。
// 需要往页面粘贴一长串内容时，比逐字输入稳。
func (bp *BrowserPilot) ClipboardWrite(ctx context.Context, text string) (map[string]any, error) {
	return bp.Call(ctx, "clipboard_write", map[string]any{"text": text})
}

// ---------- 权限与密码 ----------

// Permissions 列出这套环境记住的站点权限（摄像头、麦克风、通知、位置等）和当时的决定。
// 拿到相机打不开、通知不弹时，先看这里是不是被拒过。
func (bp *BrowserPilot) Permissions(ctx context.Context, env string) ([]map[string]any, error) {
	data, err := bp.Call(ctx, "permission_list", sessionArgs(env))
	if err != nil {
		return nil, err
	}
	return mapListField(data, "permissions", "list"), nil
}

// Passwords 列出这套环境保存的登录信息，只有站点和账号，不含密码。
// 用它判断一个站点能不能自动填；真正的密码始终留在 App 里。
func (bp *BrowserPilot) Passwords(ctx context.Context, env string) ([]map[string]any, error) {
	data, err := bp.Call(ctx, "password_list", sessionArgs(env))
	if err != nil {
		return nil, err
	}
	return mapListField(data, "passwords", "list"), nil
}

// ---------- 内部 ----------

// pageLocateFields 是只认 selector / xpath 的页面工具共用的定位收口。
// 这些工具都没有 frame 参数，带 Frame 的定位器不能悄悄落到主文档上。
func pageLocateFields(tool string, spec LocatorSpec) (map[string]any, error) {
	if spec.Frame != "" {
		return nil, newNotFoundError(tool + " 不支持 iframe 里的定位：这个工具没有 frame 参数，" +
			"只能在主文档里找")
	}
	located := locateFields(spec)
	if located == nil {
		return nil, newNotFoundError(tool + " 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	return located, nil
}

// mapListField 按顺序取第一个存在的对象数组字段，兼容不同版本 App 的字段名；
// 字段缺失时返回空切片，调用方不用再判 nil。
func mapListField(data map[string]any, keys ...string) []map[string]any {
	for _, key := range keys {
		value, ok := data[key]
		if !ok || value == nil {
			continue
		}
		if items := mapList(value); items != nil {
			return items
		}
	}
	return []map[string]any{}
}
