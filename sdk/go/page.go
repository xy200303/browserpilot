package browserpilot

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Target 是一次动作要落到的元素：CSS 选择器字符串、*Locator，或者直接写一份 LocatorSpec。
type Target = any

// Clip 是截图裁剪区域，坐标和尺寸都用 CSS 像素。
type Clip struct {
	// X 是裁剪区域左上角的横坐标。
	X float64
	// Y 是裁剪区域左上角的纵坐标。
	Y float64
	// Width 是裁剪宽度。
	Width float64
	// Height 是裁剪高度。
	Height float64
}

type clickOptions struct {
	button  string
	count   int
	timeout time.Duration
	via     string
}

// ClickOption 修饰一次点击。
type ClickOption func(*clickOptions)

// WithButton 选鼠标键：left / right。
func WithButton(button string) ClickOption {
	return func(options *clickOptions) { options.button = button }
}

// WithClickCount 点几下，2 就是双击。
func WithClickCount(count int) ClickOption {
	return func(options *clickOptions) { options.count = count }
}

// WithClickTimeout 给这一次点击单独设超时。
func WithClickTimeout(timeout time.Duration) ClickOption {
	return func(options *clickOptions) { options.timeout = timeout }
}

// WithVia 指定点击通道：cdp / native / inject / pointer。
func WithVia(via string) ClickOption {
	return func(options *clickOptions) { options.via = via }
}

type pressOptions struct {
	via string
}

// PressOption 修饰一次按键。
type PressOption func(*pressOptions)

// WithPressVia 指定按键通道：cdp / native。
func WithPressVia(via string) PressOption {
	return func(options *pressOptions) { options.via = via }
}

type waitOptions struct {
	state   string
	timeout time.Duration
	poll    time.Duration
}

// WaitOption 修饰一次等待。
type WaitOption func(*waitOptions)

// WithState 选等出现还是等消失：appear / gone。
func WithState(state string) WaitOption {
	return func(options *waitOptions) { options.state = state }
}

// WithWaitTimeout 设等待上限。
func WithWaitTimeout(timeout time.Duration) WaitOption {
	return func(options *waitOptions) { options.timeout = timeout }
}

// WithPollInterval 设轮询间隔；selector / xpath 走原生等待时用不到。
func WithPollInterval(interval time.Duration) WaitOption {
	return func(options *waitOptions) { options.poll = interval }
}

type scrollOptions struct {
	direction string
	target    Target
	until     Target
}

// ScrollOption 修饰一次滚动。
type ScrollOption func(*scrollOptions)

// WithScrollDirection 选方向：up / down。
func WithScrollDirection(direction string) ScrollOption {
	return func(options *scrollOptions) { options.direction = direction }
}

// WithScrollTarget 在某个容器里滚。
func WithScrollTarget(target Target) ScrollOption {
	return func(options *scrollOptions) { options.target = target }
}

// WithScrollUntil 一直滚到目标能被点到为止。
func WithScrollUntil(target Target) ScrollOption {
	return func(options *scrollOptions) { options.until = target }
}

type consoleOptions struct {
	clear bool
	limit int
}

// ConsoleOption 修饰一次控制台日志读取。
type ConsoleOption func(*consoleOptions)

// WithClear 先清空再返回：清了就拿到空列表。
func WithClear(clear bool) ConsoleOption {
	return func(options *consoleOptions) { options.clear = clear }
}

// WithConsoleLimit 限制条数，默认 100。
func WithConsoleLimit(limit int) ConsoleOption {
	return func(options *consoleOptions) { options.limit = limit }
}

type evaluateOptions struct {
	frame string
}

// EvaluateOption 修饰一次 page_script。
type EvaluateOption func(*evaluateOptions)

// WithFrame 在指定 frame 里执行，不传就是主框架。
func WithFrame(frame string) EvaluateOption {
	return func(options *evaluateOptions) { options.frame = frame }
}

type screenshotOptions struct {
	path     string
	target   Target
	clip     *Clip
	grid     bool
	edgeOnly bool
}

// ScreenshotOption 修饰一次截图。
type ScreenshotOption func(*screenshotOptions)

// WithPath 让截图顺手存一份到本地文件。
func WithPath(path string) ScreenshotOption {
	return func(options *screenshotOptions) { options.path = path }
}

// WithGrid 打开 App 画的坐标网格。SDK 默认关掉：那是给人估坐标用的，脚本里是噪点。
func WithGrid(grid bool) ScreenshotOption {
	return func(options *screenshotOptions) { options.grid = grid }
}

// WithEdgeOnly 只框出元素边缘，不填充。
func WithEdgeOnly(edgeOnly bool) ScreenshotOption {
	return func(options *screenshotOptions) { options.edgeOnly = edgeOnly }
}

// WithClip 只截一块区域。
func WithClip(clip Clip) ScreenshotOption {
	return func(options *screenshotOptions) { options.clip = &clip }
}

// WithScreenshotTarget 只截某个元素，target 的写法和 Click 一样。
func WithScreenshotTarget(target Target) ScreenshotOption {
	return func(options *screenshotOptions) { options.target = target }
}

// Page 对应一个 tab- 标签页。所有动作都带着它的 tabId 发给 App。
type Page struct {
	transport *Transport
	id        string
	env       string
}

// NewPage 直接构造一个页面。常规路径是从 BrowserPilot.NewPage 或 Environment.NewPage 拿。
func NewPage(transport *Transport, id, env string) *Page {
	return &Page{transport: transport, id: id, env: env}
}

// ID 是全局唯一的 tab- 标识。
func (p *Page) ID() string { return p.id }

// Env 是这页所在的环境（一套 cookie / 登录态）。
func (p *Page) Env() string { return p.env }

// Call 是原始工具入口，参数里自动带上 tabId。SDK 没封装的工具都从这里走。
func (p *Page) Call(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	result, err := p.raw(ctx, tool, args, 0)
	if err != nil {
		return nil, err
	}
	return result.Data, nil
}

func (p *Page) raw(ctx context.Context, tool string, args map[string]any, timeout time.Duration) (*CallResult, error) {
	merged := make(map[string]any, len(args)+1)
	merged["tabId"] = p.id
	for key, value := range args {
		merged[key] = value
	}
	if timeout > 0 {
		return p.transport.call(ctx, tool, merged, timeout)
	}
	return p.transport.Call(ctx, tool, merged)
}

func (p *Page) call(ctx context.Context, tool string, args map[string]any, timeout time.Duration) (map[string]any, error) {
	result, err := p.raw(ctx, tool, args, timeout)
	if err != nil {
		return nil, err
	}
	return result.Data, nil
}

// ---------- 导航 ----------

// Goto 打开地址。page_navigate 内部已经等到 load 完成，不用再补等待。
func (p *Page) Goto(ctx context.Context, url string) error {
	_, err := p.call(ctx, "page_navigate", map[string]any{"url": url}, 0)
	return err
}

// Reload 重新加载当前页。
func (p *Page) Reload(ctx context.Context) error {
	_, err := p.call(ctx, "page_reload", nil, 0)
	return err
}

// Back 后退一页。
func (p *Page) Back(ctx context.Context) error {
	_, err := p.call(ctx, "page_back", nil, 0)
	return err
}

// Forward 前进一页。
func (p *Page) Forward(ctx context.Context) error {
	_, err := p.call(ctx, "page_forward", nil, 0)
	return err
}

// WaitForLoad 等 did-stop-loading。跳转和点链接之后比 sleep 可靠。
func (p *Page) WaitForLoad(ctx context.Context) error {
	_, err := p.call(ctx, "page_wait_load", map[string]any{"timeout": 15}, 0)
	return err
}

// URL 返回当前地址。
func (p *Page) URL(ctx context.Context) (string, error) {
	url, _, err := p.info(ctx)
	return url, err
}

// Title 返回当前标题。
func (p *Page) Title(ctx context.Context) (string, error) {
	_, title, err := p.info(ctx)
	return title, err
}

// ---------- 定位 ----------

// GetByRole 按 ARIA role 找，可以再配 Name 指定可访问名。
func (p *Page) GetByRole(role string, opts ...RoleOption) *Locator {
	spec := LocatorSpec{Role: role}
	for _, apply := range opts {
		if apply != nil {
			apply(&spec)
		}
	}
	return NewLocator(p, spec)
}

// GetByText 按页面上看得见的文字找。
func (p *Page) GetByText(text string, opts ...TextOption) *Locator {
	spec := LocatorSpec{Text: text}
	for _, apply := range opts {
		if apply != nil {
			apply(&spec)
		}
	}
	return NewLocator(p, spec)
}

// GetByLabel 按控件的 label 找。
func (p *Page) GetByLabel(label string) *Locator {
	return NewLocator(p, LocatorSpec{Label: label})
}

// GetByPlaceholder 按输入框的占位文字找。
func (p *Page) GetByPlaceholder(placeholder string) *Locator {
	return NewLocator(p, LocatorSpec{Placeholder: placeholder})
}

// GetByTestID 按 data-testid 之类的测试标识找。
func (p *Page) GetByTestID(testID string) *Locator {
	return NewLocator(p, LocatorSpec{TestID: testID})
}

// Locator 用 CSS 选择器找。
func (p *Page) Locator(selector string) *Locator {
	return NewLocator(p, LocatorSpec{Selector: selector})
}

// XPath 用 XPath 表达式找。
func (p *Page) XPath(xpath string) *Locator {
	return NewLocator(p, LocatorSpec{XPath: xpath})
}

// ---------- 动作 ----------

// Click 按 text → role+name → selector/xpath → testId/alt 的顺序找目标并点一下。
func (p *Page) Click(ctx context.Context, target Target, opts ...ClickOption) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	options := clickOptions{}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := actionArgs(spec)
	if options.button != "" {
		args["button"] = options.button
	}
	if options.count != 0 {
		args["count"] = options.count
	}
	if options.via != "" {
		args["via"] = options.via
	}
	_, err = p.call(ctx, "page_click", args, options.timeout)
	return err
}

// Fill 覆盖式输入。selector/xpath 一次 inject 搞定；
// label / placeholder / role 走「聚焦 → 全选 → 粘贴」三步，因为 page_type 只在光标处插入。
func (p *Page) Fill(ctx context.Context, target Target, value string) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	mode, args, err := typePlan(spec)
	if err != nil {
		return err
	}
	if mode == typeModeInject {
		args["text"] = value
		args["via"] = "inject"
		_, err := p.call(ctx, "page_type", args, 0)
		return err
	}
	args["text"] = ""
	if _, err := p.call(ctx, "page_type", args, 0); err != nil {
		return err
	}
	if err := p.pressSelectAll(ctx); err != nil {
		return err
	}
	args["text"] = value
	args["entry"] = "paste"
	_, err = p.call(ctx, "page_type", args, 0)
	return err
}

// Type 在光标处追加，不清空。
func (p *Page) Type(ctx context.Context, target Target, value string) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	_, args, err := typePlan(spec)
	if err != nil {
		return err
	}
	args["text"] = value
	_, err = p.call(ctx, "page_type", args, 0)
	return err
}

// Press 把快捷键发进页面，例如 Control+Enter；不会触发窗口自己的新建/关闭标签。
func (p *Page) Press(ctx context.Context, shortcut string, opts ...PressOption) error {
	options := pressOptions{}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"shortcut": shortcut}
	if options.via != "" {
		args["via"] = options.via
	}
	_, err := p.call(ctx, "page_key", args, 0)
	return err
}

// Hover 把鼠标移到目标上。
func (p *Page) Hover(ctx context.Context, target Target) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	_, err = p.call(ctx, "page_hover", actionArgs(spec), 0)
	return err
}

// Select 选下拉框的一项，只支持 selector / xpath。
func (p *Page) Select(ctx context.Context, target Target, option string) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	located := locateFields(spec)
	if located == nil {
		return newNotFoundError("selectOption 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	located["option"] = option
	_, err = p.call(ctx, "page_select", located, 0)
	return err
}

// Scroll 滚页面，可以指定容器和目标。
func (p *Page) Scroll(ctx context.Context, opts ...ScrollOption) error {
	options := scrollOptions{direction: "down"}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"direction": options.direction}
	if options.target != nil {
		spec, err := specOf(options.target)
		if err != nil {
			return err
		}
		for key, value := range locateFields(spec) {
			args[key] = value
		}
	}
	if options.until != nil {
		spec, err := specOf(options.until)
		if err != nil {
			return err
		}
		if spec.Selector != "" {
			args["untilSelector"] = spec.Selector
		}
		if spec.XPath != "" {
			args["untilXpath"] = spec.XPath
		}
	}
	_, err := p.call(ctx, "page_scroll", args, 0)
	return err
}

// ScrollTo 滚到目标能被点到为止，只支持 selector / xpath。
func (p *Page) ScrollTo(ctx context.Context, target Target) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	args := map[string]any{"direction": "down"}
	switch {
	case spec.Selector != "":
		args["untilSelector"] = spec.Selector
	case spec.XPath != "":
		args["untilXpath"] = spec.XPath
	default:
		return newNotFoundError("scrollTo 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	_, err = p.call(ctx, "page_scroll", args, 0)
	return err
}

// ---------- 等待 ----------

// WaitFor 等元素出现/消失。
//
// selector/xpath 走 page_wait（原生，最快）；文本走 page_find 轮询；
// role+name 走无障碍树轮询。label / placeholder 没有对应通道，请改写成 selector。
func (p *Page) WaitFor(ctx context.Context, target Target, opts ...WaitOption) error {
	spec, err := specOf(target)
	if err != nil {
		return err
	}
	options := waitOptions{state: "appear", timeout: 10 * time.Second}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	if native := waitArgs(spec, options.state, options.timeout); native != nil {
		_, err := p.call(ctx, "page_wait", native, 0)
		return err
	}
	if spec.Text != "" {
		return p.pollText(ctx, spec.Text, options.state, options.timeout, options.poll)
	}
	if spec.Role != "" && spec.Name != "" {
		return p.pollSnapshot(ctx, spec.Name, options.state, options.timeout, options.poll)
	}
	return newNotFoundError(
		"waitFor 不支持 " + describe(spec) + "：用 selector / xpath / getByText / getByRole 都能等，" +
			"label 和 placeholder 请改写成 selector。")
}

// WaitForText 等页面上出现这段文字，用 Ctrl+F 的原生查找，不走 DOM。
func (p *Page) WaitForText(ctx context.Context, text string, opts ...WaitOption) error {
	options := waitOptions{state: "appear", timeout: 10 * time.Second}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	return p.pollText(ctx, text, options.state, options.timeout, options.poll)
}

// ExpectText 是 WaitForText 的别名，读起来更像断言。
func (p *Page) ExpectText(ctx context.Context, text string, opts ...WaitOption) error {
	return p.WaitForText(ctx, text, opts...)
}

// ---------- 读取 ----------

// Count 数匹配到几个，只支持 selector / xpath。
func (p *Page) Count(ctx context.Context, target Target) (int, error) {
	spec, err := specOf(target)
	if err != nil {
		return 0, err
	}
	located := locateFields(spec)
	if located == nil {
		return 0, newNotFoundError("count 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	data, err := p.call(ctx, "page_query", located, 0)
	if err != nil {
		return 0, err
	}
	return toInt(data["total"]), nil
}

// IsVisible 判断是否至少有一个匹配是可点的，只支持 selector / xpath。
func (p *Page) IsVisible(ctx context.Context, target Target) (bool, error) {
	spec, err := specOf(target)
	if err != nil {
		return false, err
	}
	located := locateFields(spec)
	if located == nil {
		return false, newNotFoundError("isVisible 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	data, err := p.call(ctx, "page_query", located, 0)
	if err != nil {
		return false, err
	}
	for _, item := range mapList(data["matches"]) {
		if hittable, ok := item["hittable"].(bool); ok && hittable {
			return true, nil
		}
	}
	return false, nil
}

// TextContent 读目标的文字，只支持 selector / xpath。
func (p *Page) TextContent(ctx context.Context, target Target) (string, error) {
	spec, err := specOf(target)
	if err != nil {
		return "", err
	}
	located := locateFields(spec)
	if located == nil {
		return "", newNotFoundError("textContent 只支持 selector 或 xpath，收到 " + describe(spec))
	}
	data, err := p.call(ctx, "page_inspect", located, 0)
	if err != nil {
		return "", err
	}
	return stringField(data, "text"), nil
}

// Content 返回当前 DOM。
func (p *Page) Content(ctx context.Context) (string, error) {
	return p.ContentKind(ctx, "dom")
}

// ContentKind 选拿什么 HTML：dom 是当前文档，response 是这次导航的原始 HTML。
func (p *Page) ContentKind(ctx context.Context, kind string) (string, error) {
	if kind == "" {
		kind = "dom"
	}
	data, err := p.call(ctx, "page_source", map[string]any{"kind": kind}, 0)
	if err != nil {
		return "", err
	}
	return stringField(data, "html"), nil
}

// Snapshot 返回无障碍树文本，Agent 看页面主要靠它。
func (p *Page) Snapshot(ctx context.Context) (string, error) {
	data, err := p.call(ctx, "page_snapshot", nil, 0)
	if err != nil {
		return "", err
	}
	return stringField(data, "snapshot"), nil
}

// CDP 直接下发一条 CDP 命令，返回原始结果。
//
//	page.CDP(ctx, "Emulation.setTimezoneOverride", map[string]any{"timezoneId": "America/New_York"})
//	metrics, err := page.CDP(ctx, "Page.getLayoutMetrics", nil)
func (p *Page) CDP(ctx context.Context, method string, params map[string]any) (any, error) {
	results, err := p.CDPBatch(ctx, []CDPCommand{{Method: method, Params: params}})
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil
	}
	return results[0], nil
}

// CDPCommand 是 CDPBatch 里的一条命令。Delay 是这条命令之后等多久，上限 5 秒。
type CDPCommand struct {
	Method string
	Params map[string]any
	Delay  time.Duration
}

// CDPBatch 一次下发多条命令，共用同一个 debugger 会话。中间某条失败会返回错误，前面的已经生效。
func (p *Page) CDPBatch(ctx context.Context, commands []CDPCommand) ([]any, error) {
	payload := make([]map[string]any, 0, len(commands))
	for _, command := range commands {
		item := map[string]any{"method": command.Method}
		if command.Params != nil {
			item["params"] = command.Params
		}
		if command.Delay > 0 {
			delay := command.Delay
			if delay > 5*time.Second {
				delay = 5 * time.Second
			}
			// 工具那边 delay 的单位是秒
			item["delay"] = delay.Seconds()
		}
		payload = append(payload, item)
	}
	data, err := p.call(ctx, "page_cdp_batch", map[string]any{"commands": payload}, 0)
	if err != nil {
		return nil, err
	}
	raw, _ := data["results"].([]any)
	return raw, nil
}

// Evaluate 在页面里执行 JS，返回值原样回来。传函数不行，Go 这边只能传源码字符串；
// 想跑函数体就自己写成 `(() => { ... })()` 的形式。
func (p *Page) Evaluate(ctx context.Context, source string, opts ...EvaluateOption) (any, error) {
	options := evaluateOptions{}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"source": source}
	if options.frame != "" {
		args["frame"] = options.frame
	}
	data, err := p.call(ctx, "page_script", args, 0)
	if err != nil {
		return nil, err
	}
	return data["value"], nil
}

// ConsoleLogs 把最近的控制台消息捞出来。MCP 是无状态 POST，没有事件订阅，只能轮询。
func (p *Page) ConsoleLogs(ctx context.Context, opts ...ConsoleOption) ([]map[string]any, error) {
	options := consoleOptions{limit: 100}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	if options.clear {
		_, err := p.call(ctx, "page_console", map[string]any{"action": "clear"}, 0)
		return nil, err
	}
	data, err := p.call(ctx, "page_console", map[string]any{"limit": options.limit}, 0)
	if err != nil {
		return nil, err
	}
	return mapList(data["messages"]), nil
}

// ---------- 截图 ----------

// Screenshot 返回图片字节。App 那边也会存一份，路径在载荷里。
// 默认 grid:false——App 默认会画坐标网格，脚本里那是噪点。
func (p *Page) Screenshot(ctx context.Context, opts ...ScreenshotOption) ([]byte, error) {
	options := screenshotOptions{grid: false}
	for _, apply := range opts {
		if apply != nil {
			apply(&options)
		}
	}
	args := map[string]any{"grid": options.grid}
	if options.edgeOnly {
		args["edgeOnly"] = true
	}
	if options.target != nil {
		spec, err := specOf(options.target)
		if err != nil {
			return nil, err
		}
		for key, value := range locateFields(spec) {
			args[key] = value
		}
	}
	if options.clip != nil {
		args["x"] = options.clip.X
		args["y"] = options.clip.Y
		args["width"] = options.clip.Width
		args["height"] = options.clip.Height
	}

	result, err := p.raw(ctx, "page_screenshot", args, 0)
	if err != nil {
		return nil, err
	}
	if result.Image == nil {
		return nil, newToolError("page_screenshot", map[string]any{"ok": false, "error": "截图没有返回图片内容"})
	}
	if options.path != "" {
		if err := os.WriteFile(options.path, result.Image.Data, 0o644); err != nil {
			return nil, newError(CodeBrowserPilotError, "写不了 "+options.path, err)
		}
	}
	return result.Image.Data, nil
}

// ---------- 生命周期 ----------

// BringToFront 把这个标签切到前台。
func (p *Page) BringToFront(ctx context.Context) error {
	_, err := p.call(ctx, "tab_activate", map[string]any{"tabId": p.id}, 0)
	return err
}

// Close 关掉这个标签。
func (p *Page) Close(ctx context.Context) error {
	_, err := p.call(ctx, "tab_close", map[string]any{"tabId": p.id}, 0)
	return err
}

// String 为了日志里看得懂。
func (p *Page) String() string { return "Page(" + p.id + ")" }

// ---------- 内部 ----------

func (p *Page) info(ctx context.Context) (string, string, error) {
	// tab_list 不接受 tabId，这里直接走 transport，和 Node SDK 一致。
	result, err := p.transport.Call(ctx, "tab_list", map[string]any{})
	if err != nil {
		return "", "", err
	}
	for _, item := range mapList(result.Data["tabs"]) {
		if stringField(item, "id") == p.id {
			return stringField(item, "url"), stringField(item, "title"), nil
		}
	}
	return "", "", newNotFoundError("标签 " + p.id + " 已经不在了")
}

func (p *Page) pressSelectAll(ctx context.Context) error {
	// page_type 只会在光标处插入，要覆盖得先全选。macOS 用 Meta，其他平台用 Control。
	shortcut := "Control+A"
	if isDarwin() {
		shortcut = "Meta+A"
	}
	return p.Press(ctx, shortcut)
}

func (p *Page) pollText(ctx context.Context, text, state string, timeout, poll time.Duration) error {
	if poll <= 0 {
		poll = 300 * time.Millisecond
	}
	// 无论怎么退出都要收掉 Ctrl+F 的高亮，否则页面上会一直亮着。
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_, _ = p.Call(stopCtx, "page_find", map[string]any{"stop": true})
	}()

	deadline := time.Now().Add(timeout)
	for {
		data, err := p.call(ctx, "page_find", map[string]any{"text": text}, 0)
		if err != nil {
			return err
		}
		// page_find 返回 { matches, active }；total 兜底兼容旧载荷
		present := toInt(firstNonNil(data["matches"], data["total"])) > 0
		if state == "gone" {
			if !present {
				return nil
			}
		} else if present {
			return nil
		}
		if time.Now().After(deadline) {
			if state == "gone" {
				return newNotFoundError(fmt.Sprintf("等了 %s，页面上还出现「%s」", secondsString(timeout), text))
			}
			return newNotFoundError(fmt.Sprintf("等了 %s，页面上没出现「%s」", secondsString(timeout), text))
		}
		if err := p.sleep(ctx, poll); err != nil {
			return err
		}
	}
}

// pollSnapshot 等 role+name 出现。page_wait 不认 role，只能轮询无障碍树。
// 命中条件是名字出现在树里——比 DOM 准确，但一页大表格会比较费。
func (p *Page) pollSnapshot(ctx context.Context, name, state string, timeout, poll time.Duration) error {
	if poll <= 0 {
		poll = 500 * time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	for {
		tree, err := p.Snapshot(ctx)
		if err != nil {
			return err
		}
		present := strings.Contains(tree, name)
		if state == "gone" {
			if !present {
				return nil
			}
		} else if present {
			return nil
		}
		if time.Now().After(deadline) {
			if state == "gone" {
				return newNotFoundError(fmt.Sprintf("等了 %s，无障碍树里还出现「%s」", secondsString(timeout), name))
			}
			return newNotFoundError(fmt.Sprintf("等了 %s，无障碍树里没出现「%s」", secondsString(timeout), name))
		}
		if err := p.sleep(ctx, poll); err != nil {
			return err
		}
	}
}

func (p *Page) sleep(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return newTransportError("等待被取消："+ctx.Err().Error(), ctx.Err())
	case <-timer.C:
		return nil
	}
}

func specOf(target Target) (LocatorSpec, error) {
	switch value := target.(type) {
	case string:
		return LocatorSpec{Selector: value}, nil
	case *Locator:
		if value != nil {
			return value.spec, nil
		}
	case Locator:
		return value.spec, nil
	case LocatorSpec:
		return value, nil
	}
	return LocatorSpec{}, newError(CodeBrowserPilotError, "定位目标必须是 CSS 选择器字符串、*Locator 或 LocatorSpec", nil)
}

// stringField 把载荷里的字段读成字符串。JSON 数字解出来是 float64，这里统一收口。
func stringField(data map[string]any, key string) string {
	value, ok := data[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(typed)
	}
	return fmt.Sprint(value)
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func toInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		if parsed, err := strconv.Atoi(typed); err == nil {
			return parsed
		}
	}
	return 0
}

// mapList 把载荷里的对象数组转成 []map[string]any，类型不对的项直接跳过。
func mapList(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if record, ok := item.(map[string]any); ok {
			out = append(out, record)
		}
	}
	return out
}

// secondsString 把时长写成工具参数里那种「5s」。
func secondsString(duration time.Duration) string {
	return strconv.FormatFloat(duration.Seconds(), 'f', -1, 64) + "s"
}
