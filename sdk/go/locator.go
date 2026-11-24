package browserpilot

import (
	"context"
	"fmt"
	"time"
)

/*
一个定位器最终会变成工具参数。BrowserPilot 的工具不是每个都支持全部定位方式：
点击支持 text / role+name / xpath / selector，输入只支持 label / placeholder / xpath / selector。
所以这里保留「用户想怎么找」，由各个动作自己决定能不能表达。
*/

// LocatorSpec 是一份定位描述，Locator 只是它的一个包装。
type LocatorSpec struct {
	// Role 是 ARIA role，例如 button、textbox。
	Role string
	// Name 是 role 的可访问名。
	Name string
	// NameMatch 是 exact 或 contains，空表示让 App 自己决定。
	NameMatch string
	// Text 是页面上看得见的文字。
	Text string
	// TextMatch 是 exact 或 contains，空表示让 App 自己决定。
	TextMatch string
	// Label 是控件的关联标签。
	Label string
	// Placeholder 是输入框的占位文字。
	Placeholder string
	// TestID 是 data-testid 之类的测试标识。
	TestID string
	// Alt 是图片的替代文字。
	Alt string
	// Selector 是 CSS 选择器。
	Selector string
	// XPath 是 XPath 表达式。
	XPath string
	// Within 是缩小范围的 CSS 容器，支持 :has-text()。
	Within string
	// Index 是多个匹配时取第几个，从 0 开始；nil 表示不指定。
	Index *int
	// Pierce 表示进 shadow DOM 和同源 iframe 里找。
	Pierce bool
}

// LocatorOption 修饰一个定位描述，GetByRole / GetByText 共用。
type LocatorOption func(*LocatorSpec)

// RoleOption 是 LocatorOption 的别名，读起来更像 role 专用。
type RoleOption = LocatorOption

// TextOption 是 LocatorOption 的别名，给 getByText 用。
type TextOption = LocatorOption

// Name 给 role 定位器指定可访问名，等价于 Playwright 的 { name }。
func Name(name string) LocatorOption {
	return func(spec *LocatorSpec) {
		spec.Name = name
	}
}

// Exact 控制名字/文本是否精确匹配。不传就是包含匹配。
func Exact(exact bool) LocatorOption {
	return func(spec *LocatorSpec) {
		match := "contains"
		if exact {
			match = "exact"
		}
		spec.NameMatch = match
		spec.TextMatch = match
	}
}

// describe 给人看的描述，用在报错里。
func describe(spec LocatorSpec) string {
	switch {
	case spec.Role != "":
		if spec.Name != "" {
			return "role=" + spec.Role + " name=" + spec.Name
		}
		return "role=" + spec.Role
	case spec.Text != "":
		return "text=" + spec.Text
	case spec.Label != "":
		return "label=" + spec.Label
	case spec.Placeholder != "":
		return "placeholder=" + spec.Placeholder
	case spec.TestID != "":
		return "testId=" + spec.TestID
	case spec.Alt != "":
		return "alt=" + spec.Alt
	case spec.XPath != "":
		return "xpath=" + spec.XPath
	case spec.Selector != "":
		return "selector=" + spec.Selector
	}
	return "空定位器"
}

// actionArgs 是 page_click / page_hover 的定位字段。
// 顺序按工具建议：text 优先，然后 role+name，再然后 selector / xpath / testId / alt。
func actionArgs(spec LocatorSpec) map[string]any {
	args := make(map[string]any, 4)
	switch {
	case spec.Text != "":
		args["text"] = spec.Text
		if spec.TextMatch != "" {
			args["textMatch"] = spec.TextMatch
		}
	case spec.Role != "":
		args["role"] = spec.Role
		if spec.Name != "" {
			args["name"] = spec.Name
		}
		if spec.NameMatch != "" {
			args["nameMatch"] = spec.NameMatch
		}
	case spec.Selector != "":
		args["selector"] = spec.Selector
		if spec.Pierce {
			args["pierce"] = true
		}
	case spec.XPath != "":
		args["xpath"] = spec.XPath
		if spec.Pierce {
			args["pierce"] = true
		}
	case spec.TestID != "":
		args["testId"] = spec.TestID
	case spec.Alt != "":
		args["alt"] = spec.Alt
	}
	if spec.Within != "" {
		args["within"] = spec.Within
	}
	if spec.Index != nil {
		args["index"] = *spec.Index
	}
	return args
}

// locateFields 是只认 selector / xpath 的工具用的字段，返回 nil 表示这个定位器表达不了。
func locateFields(spec LocatorSpec) map[string]any {
	if spec.Selector != "" {
		fields := map[string]any{"selector": spec.Selector}
		if spec.Pierce {
			fields["pierce"] = true
		}
		return fields
	}
	if spec.XPath != "" {
		fields := map[string]any{"xpath": spec.XPath}
		if spec.Pierce {
			fields["pierce"] = true
		}
		return fields
	}
	return nil
}

const (
	// typeModeInject 一次调用搞定：page_type 的 inject 直接写值，就是 Playwright fill 的语义。
	typeModeInject = "inject"
	// typeModeFocus 只能聚焦再插入：先清空再写，需要三步。
	typeModeFocus = "focus"
)

// typePlan 决定输入走 inject 还是一次聚焦。
// page_type 只认 label / placeholder / xpath / selector；
// role+name 的输入框，它的可访问名一般就是 label 或 placeholder，退一步用它当 label。
func typePlan(spec LocatorSpec) (string, map[string]any, error) {
	if spec.Selector != "" {
		args := map[string]any{"selector": spec.Selector}
		if spec.Pierce {
			args["pierce"] = true
		}
		return typeModeInject, args, nil
	}
	if spec.XPath != "" {
		args := map[string]any{"xpath": spec.XPath}
		if spec.Pierce {
			args["pierce"] = true
		}
		return typeModeInject, args, nil
	}
	if spec.Label != "" {
		return typeModeFocus, map[string]any{"label": spec.Label}, nil
	}
	if spec.Placeholder != "" {
		return typeModeFocus, map[string]any{"placeholder": spec.Placeholder}, nil
	}
	if spec.Role == "textbox" || spec.Role == "searchbox" || spec.Role == "combobox" {
		if spec.Name != "" {
			return typeModeFocus, map[string]any{"label": spec.Name}, nil
		}
	}
	return "", nil, newError(CodeBrowserPilotError, fmt.Sprintf(
		"无法输入 %s：page_type 只支持 selector、xpath、label、placeholder，"+
			"以及 role=textbox/searchbox/combobox 且带 name 的定位器。", describe(spec)), nil)
}

// waitArgs 是 page_wait 的参数：它只认 xpath / selector，返回 nil 表示这个定位器得靠轮询。
func waitArgs(spec LocatorSpec, state string, timeout time.Duration) map[string]any {
	args := map[string]any{"state": state, "timeout": timeout.Seconds()}
	if spec.Selector != "" {
		args["selector"] = spec.Selector
		if spec.Pierce {
			args["pierce"] = true
		}
		return args
	}
	if spec.XPath != "" {
		args["xpath"] = spec.XPath
		if spec.Pierce {
			args["pierce"] = true
		}
		return args
	}
	return nil
}

// Locator 是链式定位器。每个动作都落在当前页面上，页面上唯一匹配才算成功（工具本身就这么要求）。
type Locator struct {
	page *Page
	spec LocatorSpec
}

// NewLocator 把一份定位描述绑到页面上。一般不用直接调，从 Page 的 GetBy* / Locator 拿。
func NewLocator(page *Page, spec LocatorSpec) *Locator {
	return &Locator{page: page, spec: spec}
}

// Page 返回这个定位器所在的页面。
func (l *Locator) Page() *Page { return l.page }

// Spec 返回这份定位描述，可以再交给 Page 的方法用。
func (l *Locator) Spec() LocatorSpec { return l.spec }

// Nth 在多个匹配里取第 index 个，从 0 开始。
func (l *Locator) Nth(index int) *Locator {
	spec := l.spec
	spec.Index = &index
	return NewLocator(l.page, spec)
}

// First 等价于 Nth(0)。
func (l *Locator) First() *Locator { return l.Nth(0) }

// Within 在某个容器里找。
func (l *Locator) Within(selector string) *Locator {
	spec := l.spec
	spec.Within = selector
	return NewLocator(l.page, spec)
}

// Pierce 进 shadow DOM 和同源 iframe 里找。
func (l *Locator) Pierce() *Locator {
	spec := l.spec
	spec.Pierce = true
	return NewLocator(l.page, spec)
}

// Click 点一下。
func (l *Locator) Click(ctx context.Context, opts ...ClickOption) error {
	return l.page.Click(ctx, l.spec, opts...)
}

// DblClick 双击。
func (l *Locator) DblClick(ctx context.Context) error {
	return l.page.Click(ctx, l.spec, WithClickCount(2))
}

// Fill 覆盖式输入，Playwright 语义。
func (l *Locator) Fill(ctx context.Context, value string) error {
	return l.page.Fill(ctx, l.spec, value)
}

// Type 在光标处追加，不清空。
func (l *Locator) Type(ctx context.Context, value string) error {
	return l.page.Type(ctx, l.spec, value)
}

// Hover 把鼠标移上去。
func (l *Locator) Hover(ctx context.Context) error {
	return l.page.Hover(ctx, l.spec)
}

// SelectOption 选下拉框的一项。
func (l *Locator) SelectOption(ctx context.Context, option string) error {
	return l.page.Select(ctx, l.spec, option)
}

// ScrollIntoView 滚到目标能被点到为止。
func (l *Locator) ScrollIntoView(ctx context.Context) error {
	return l.page.ScrollTo(ctx, l.spec)
}

// WaitFor 等元素出现或消失。
func (l *Locator) WaitFor(ctx context.Context, opts ...WaitOption) error {
	return l.page.WaitFor(ctx, l.spec, opts...)
}

// Count 数匹配到几个。
func (l *Locator) Count(ctx context.Context) (int, error) {
	return l.page.Count(ctx, l.spec)
}

// IsVisible 判断是否至少有一个匹配是可点的。
func (l *Locator) IsVisible(ctx context.Context) (bool, error) {
	return l.page.IsVisible(ctx, l.spec)
}

// TextContent 读目标的文字。
func (l *Locator) TextContent(ctx context.Context) (string, error) {
	return l.page.TextContent(ctx, l.spec)
}

// Screenshot 只截这个元素。
func (l *Locator) Screenshot(ctx context.Context, opts ...ScreenshotOption) ([]byte, error) {
	return l.page.Screenshot(ctx, append(append([]ScreenshotOption{}, opts...), WithScreenshotTarget(l.spec))...)
}

// String 为了日志里看得懂。
func (l *Locator) String() string {
	return "Locator(" + describe(l.spec) + ")"
}
