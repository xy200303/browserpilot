package browserpilot

/*
iframe 里的定位、读取和等待。

App 的定位工具只能按「frame URL 的一段」进 iframe（page_click / page_type / page_hover /
page_script 有 frame 参数），所以 Frame 记住自己的 URL 片段：

  - 点击、输入、悬停：把 frame 传给对应工具，由 App 自己算坐标；
  - 计数、文本、可见性、等待：用 page_script 在这个 frame 里执行，不碰主文档。

同一个 URL 的多个 iframe 会命中第一个，这是 App 的匹配规则；需要精确定位时用更长的 URL 片段。
*/

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// srcdocURL 是 iframe 没有 src（srcdoc、脚本写入）时 Electron 给的 frame URL。
const srcdocURL = "about:srcdoc"

// framesSource 在主文档里列 iframe：跨域也能列，因为读的是父文档里的 <iframe> 元素。
const framesSource = `(() => Array.from(document.querySelectorAll('iframe')).map((el) => ({
  src: el.src || el.getAttribute('src') || '',
  name: el.name || '',
  selector: el.id ? '#' + el.id : (el.name ? 'iframe[name="' + el.name + '"]' : 'iframe')
})))()`

// frameResolveSource 按选择器读出一个 iframe 的 src / name；%s 是 JSON 编码后的选择器。
const frameResolveSource = `(() => {
  const el = document.querySelector(%s);
  if (!el) return null;
  return { src: el.src || el.getAttribute('src') || '', name: el.name || '' };
})()`

// Frame 是一个 iframe。用 Page.FrameLocator 或 Page.Frames 拿，也可以用 Page.Frame 直接按 URL 片段构造。
type Frame struct {
	// URL 是这个 frame 的地址，也是传给 App 的匹配片段。
	URL string
	// Name 是 <iframe name>，没写就是空串。
	Name string
	// Selector 是当初用来定位这个 iframe 元素的选择器，用 Page.Frame 构造时为空。
	Selector string

	page *Page
}

func newFrame(page *Page, url, name, selector string) *Frame {
	return &Frame{page: page, URL: url, Name: name, Selector: selector}
}

// Match 返回传给 App 的 frame 片段。没有 src 的 iframe 统一用 about:srcdoc。
func (f *Frame) Match() string {
	if f == nil || f.URL == "" {
		return srcdocURL
	}
	return f.URL
}

// Page 返回这个 frame 所属的页面。
func (f *Frame) Page() *Page {
	if f == nil {
		return nil
	}
	return f.page
}

// String 为了日志里看得懂。
func (f *Frame) String() string {
	if f == nil {
		return "Frame(about:blank)"
	}
	label := f.URL
	if label == "" {
		label = f.Name
	}
	if label == "" {
		label = f.Selector
	}
	if label == "" {
		label = "about:blank"
	}
	return "Frame(" + label + ")"
}

// ---------- Page 上的 iframe 入口 ----------

// Frames 列出主文档里的 iframe（跨域的也能列，读的是父文档的 <iframe> 元素）。
func (p *Page) Frames(ctx context.Context) ([]*Frame, error) {
	value, err := p.Evaluate(ctx, framesSource)
	if err != nil {
		return nil, err
	}
	items, ok := value.([]any)
	if !ok {
		return []*Frame{}, nil
	}
	frames := make([]*Frame, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		frames = append(frames, newFrame(p,
			stringField(record, "src"),
			stringField(record, "name"),
			stringField(record, "selector")))
	}
	return frames, nil
}

// FrameLocator 按 iframe 元素的选择器进入它，例如 page.FrameLocator(ctx, "iframe#editor")。
// 找不到时列出页面现有的 frame——只看 URL 分不清是哪个，得让人能照着改。
func (p *Page) FrameLocator(ctx context.Context, selector string) (*Frame, error) {
	value, err := p.Evaluate(ctx, fmt.Sprintf(frameResolveSource, jsQuote(selector)))
	if err != nil {
		return nil, err
	}
	if info, ok := value.(map[string]any); ok {
		return newFrame(p, stringField(info, "src"), stringField(info, "name"), selector), nil
	}

	frames, framesErr := p.Frames(ctx)
	if framesErr != nil {
		frames = nil
	}
	known := make([]string, 0, len(frames))
	for _, frame := range frames {
		label := frame.URL
		if label == "" {
			label = frame.Name
		}
		if label == "" {
			label = "about:blank"
		}
		known = append(known, label)
	}
	listing := "（没有）"
	if len(known) > 0 {
		listing = strings.Join(known, "、")
	}
	return nil, newNotFoundError("没找到 iframe「" + selector + "」；页面现有 frame：" + listing)
}

// Frame 按 URL 片段直接取 frame，等价于 App 工具的 frame 参数，不查 DOM。
func (p *Page) Frame(urlFragment string) *Frame {
	return newFrame(p, urlFragment, "", "")
}

// ---------- 定位 ----------

// Locator 用 CSS 选择器在这个 frame 里找。
func (f *Frame) Locator(selector string) *Locator {
	return NewLocator(f.page, LocatorSpec{Selector: selector, Frame: f.Match()})
}

// XPath 用 XPath 表达式在这个 frame 里找。
func (f *Frame) XPath(xpath string) *Locator {
	return NewLocator(f.page, LocatorSpec{XPath: xpath, Frame: f.Match()})
}

// GetByText 按 frame 里看得见的文字找。
func (f *Frame) GetByText(text string, opts ...TextOption) *Locator {
	spec := LocatorSpec{Text: text}
	for _, apply := range opts {
		if apply != nil {
			apply(&spec)
		}
	}
	spec.Frame = f.Match()
	return NewLocator(f.page, spec)
}

// GetByRole 按 ARIA role 找，可以再配 Name 指定可访问名。
func (f *Frame) GetByRole(role string, opts ...RoleOption) *Locator {
	spec := LocatorSpec{Role: role}
	for _, apply := range opts {
		if apply != nil {
			apply(&spec)
		}
	}
	spec.Frame = f.Match()
	return NewLocator(f.page, spec)
}

// ---------- 执行 ----------

// Evaluate 在这个 frame 里跑 JS，返回值原样回来。跨域也能跑，因为走的是 App 的调试通道。
func (f *Frame) Evaluate(ctx context.Context, source string) (any, error) {
	return f.evaluate(ctx, source)
}

// evaluate 是这个 frame 内部的执行入口。
func (f *Frame) evaluate(ctx context.Context, source string) (any, error) {
	if f == nil || f.page == nil {
		return nil, newError(CodeBrowserPilotError, "frame 没有绑定页面", nil)
	}
	return f.page.Evaluate(ctx, source, WithFrame(f.Match()))
}

// ---------- 读取 ----------

// Count 数 frame 里匹配到几个，只支持 selector / xpath。
func (f *Frame) Count(ctx context.Context, target Target) (int, error) {
	spec, err := specOf(target)
	if err != nil {
		return 0, err
	}
	expr, err := frameCountExpr(spec)
	if err != nil {
		return 0, err
	}
	value, err := f.evaluate(ctx, "(() => { try { return "+expr+"; } catch (error) { return 0; } })()")
	if err != nil {
		return 0, err
	}
	return toInt(value), nil
}

// TextContent 读 frame 里目标的文字，只支持 selector / xpath。
func (f *Frame) TextContent(ctx context.Context, target Target) (string, error) {
	spec, err := specOf(target)
	if err != nil {
		return "", err
	}
	expr, err := frameFirstExpr(spec)
	if err != nil {
		return "", err
	}
	source := "(() => { try { const el = " + expr +
		`; return el ? (el.innerText || el.textContent || "") : ""; } catch (error) { return ""; } })()`
	value, err := f.evaluate(ctx, source)
	if err != nil {
		return "", err
	}
	return valueString(value), nil
}

// IsVisible 判断 frame 里的目标是不是真的占地方、没被 visibility / display 藏起来。
func (f *Frame) IsVisible(ctx context.Context, target Target) (bool, error) {
	spec, err := specOf(target)
	if err != nil {
		return false, err
	}
	expr, err := frameFirstExpr(spec)
	if err != nil {
		return false, err
	}
	source := "(() => { try { const el = " + expr +
		`; if (!el) return false; const rect = el.getBoundingClientRect();` +
		` const style = getComputedStyle(el);` +
		` return Boolean(rect.width && rect.height) && style.visibility !== "hidden" && style.display !== "none";` +
		` } catch (error) { return false; } })()`
	value, err := f.evaluate(ctx, source)
	if err != nil {
		return false, err
	}
	visible, _ := value.(bool)
	return visible, nil
}

// ---------- 等待 ----------

// WaitFor 等 frame 里的元素出现或消失。
//
// page_wait 不进 frame，所以这里用 page_script 轮询：selector / xpath 数个数，
// 纯文本查 document.body.innerText。默认等 10 秒、200ms 探一次。
func (f *Frame) WaitFor(ctx context.Context, target Target, opts ...WaitOption) error {
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
	if options.state != "appear" && options.state != "gone" {
		return newError(CodeBrowserPilotError, "state 只能是 appear 或 gone，收到 "+options.state, nil)
	}
	poll := options.poll
	if poll <= 0 {
		poll = 200 * time.Millisecond
	}

	// 只给了文字时 DOM 里没有可数的东西，退回 innerText 包含判断。
	textOnly := spec.Text != "" && spec.Selector == "" && spec.XPath == ""
	var probe string
	if textOnly {
		probe = `(() => { const text = document.body ? (document.body.innerText || "") : "";` +
			` return text.indexOf(` + jsQuote(spec.Text) + `) !== -1; })()`
	} else {
		expr, err := frameCountExpr(spec)
		if err != nil {
			return err
		}
		probe = "(() => { try { return " + expr + "; } catch (error) { return 0; } })()"
	}

	deadline := time.Now().Add(options.timeout)
	for {
		value, err := f.evaluate(ctx, probe)
		if err != nil {
			return err
		}
		present := truthy(value)
		if !textOnly {
			present = toInt(value) > 0
		}
		if present == (options.state == "appear") {
			return nil
		}
		if time.Now().After(deadline) {
			verb := "没"
			if options.state == "gone" {
				verb = "还"
			}
			return newNotFoundError("等了 " + secondsString(options.timeout) +
				"，iframe「" + f.Match() + "」里" + verb + "出现 " + describe(spec))
		}
		if err := f.page.sleep(ctx, poll); err != nil {
			return err
		}
	}
}

// WaitForFunction 在这个 frame 里轮询 JS 条件，返回使它为真的那个值。
func (f *Frame) WaitForFunction(ctx context.Context, expression string, opts ...WaitForFunctionOption) (any, error) {
	if f == nil || f.page == nil {
		return nil, newError(CodeBrowserPilotError, "frame 没有绑定页面", nil)
	}
	combined := make([]WaitForFunctionOption, 0, len(opts)+1)
	combined = append(combined, opts...)
	// frame 放最后，确保不会被调用方误传的 WithFrame 覆盖。
	combined = append(combined, WithFrame(f.Match()))
	return f.page.WaitForFunction(ctx, expression, combined...)
}

// ---------- 内部 ----------

// frameFirstExpr 是在 frame 文档里拿到第一个匹配节点的 JS 表达式。
func frameFirstExpr(spec LocatorSpec) (string, error) {
	if spec.Selector != "" {
		return "document.querySelector(" + jsQuote(spec.Selector) + ")", nil
	}
	if spec.XPath != "" {
		return "document.evaluate(" + jsQuote(spec.XPath) +
			", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue", nil
	}
	return "", newNotFoundError("frame 内只支持 selector / xpath，收到 " + describe(spec))
}

// frameCountExpr 是在 frame 文档里数匹配个数的 JS 表达式。
func frameCountExpr(spec LocatorSpec) (string, error) {
	if spec.Selector != "" {
		return "document.querySelectorAll(" + jsQuote(spec.Selector) + ").length", nil
	}
	if spec.XPath != "" {
		return "document.evaluate(" + jsQuote(spec.XPath) +
			", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength", nil
	}
	return "", newNotFoundError("frame 内只支持 selector / xpath，收到 " + describe(spec))
}

// jsQuote 把值编码成 JS 字符串字面量。用 JSON 是因为它的转义 JS 全认。
func jsQuote(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(encoded)
}

func valueString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}
