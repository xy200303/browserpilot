package browserpilot

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestClickMapping(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	if err := page.GetByText("登录").Click(ctx); err != nil {
		t.Fatalf("text 点击失败：%v", err)
	}
	if err := page.GetByRole("button", Name("登录")).Click(ctx); err != nil {
		t.Fatalf("role 点击失败：%v", err)
	}
	if err := page.Locator("#submit").Click(ctx); err != nil {
		t.Fatalf("selector 点击失败：%v", err)
	}
	if err := page.GetByRole("button", Name("登录")).Nth(2).Click(ctx); err != nil {
		t.Fatalf("index 点击失败：%v", err)
	}
	if err := page.GetByTestID("submit").Within("#form").Click(ctx); err != nil {
		t.Fatalf("testId 点击失败：%v", err)
	}
	if err := page.Click(ctx, "#direct"); err != nil {
		t.Fatalf("字符串目标点击失败：%v", err)
	}

	calls := fake.recorded()
	if len(calls) != 6 {
		t.Fatalf("期望 6 次调用，实际 %d", len(calls))
	}
	for _, call := range calls {
		if call.Args["tabId"] != "tab-test" {
			t.Fatalf("%s 没带 tabId：%#v", call.Name, call.Args)
		}
	}
	if calls[0].Args["text"] != "登录" {
		t.Fatalf("text 优先没生效：%#v", calls[0].Args)
	}
	if _, ok := calls[0].Args["role"]; ok {
		t.Fatalf("text 定位器不该再带 role：%#v", calls[0].Args)
	}
	if calls[1].Args["role"] != "button" || calls[1].Args["name"] != "登录" {
		t.Fatalf("role+name 不对：%#v", calls[1].Args)
	}
	if calls[2].Args["selector"] != "#submit" {
		t.Fatalf("selector 不对：%#v", calls[2].Args)
	}
	if intOf(t, calls[3].Args["index"]) != 2 {
		t.Fatalf("index 不对：%#v", calls[3].Args)
	}
	if calls[4].Args["testId"] != "submit" || calls[4].Args["within"] != "#form" {
		t.Fatalf("testId/within 不对：%#v", calls[4].Args)
	}
	if calls[5].Args["selector"] != "#direct" {
		t.Fatalf("字符串目标没当成 selector：%#v", calls[5].Args)
	}
}

func TestClickOrderSkipsRoleWhenTextPresent(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	err := page.Click(context.Background(), LocatorSpec{Role: "button", Text: "登录"})
	if err != nil {
		t.Fatalf("点击失败：%v", err)
	}
	args := fake.recorded()[0].Args
	if args["text"] != "登录" {
		t.Fatalf("应该按 text 走：%#v", args)
	}
}

func TestFillSelectorIsOneInjectCall(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.Fill(context.Background(), "#name", "小明"); err != nil {
		t.Fatalf("fill 失败：%v", err)
	}
	calls := fake.recorded()
	if len(calls) != 1 {
		t.Fatalf("期望 1 次调用，实际 %d", len(calls))
	}
	// page_type 底层是 Input.insertText，inject 才是覆盖语义。
	want := map[string]any{"tabId": "tab-test", "selector": "#name", "text": "小明", "via": "inject"}
	if !equalArgs(calls[0].Args, want) {
		t.Fatalf("参数不对：%#v", calls[0].Args)
	}
}

func TestFillLabelIsThreeCalls(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.GetByLabel("账号").Fill(context.Background(), "小明"); err != nil {
		t.Fatalf("fill 失败：%v", err)
	}
	calls := fake.recorded()
	names := make([]string, 0, len(calls))
	for _, call := range calls {
		names = append(names, call.Name)
	}
	if strings.Join(names, ",") != "page_type,page_key,page_type" {
		t.Fatalf("调用顺序不对：%v", names)
	}
	if calls[0].Args["text"] != "" {
		t.Fatalf("第一步应该是空文本聚焦：%#v", calls[0].Args)
	}
	shortcut, _ := calls[1].Args["shortcut"].(string)
	if !strings.HasSuffix(shortcut, "+A") {
		t.Fatalf("第二步应该全选：%#v", calls[1].Args)
	}
	wantShortcut := "Control+A"
	if runtime.GOOS == "darwin" {
		wantShortcut = "Meta+A"
	}
	if shortcut != wantShortcut {
		t.Fatalf("全选快捷键不对：%s", shortcut)
	}
	if calls[2].Args["entry"] != "paste" || calls[2].Args["text"] != "小明" {
		t.Fatalf("第三步应该是粘贴：%#v", calls[2].Args)
	}
	if calls[2].Args["label"] != "账号" {
		t.Fatalf("label 定位丢了：%#v", calls[2].Args)
	}
}

func TestTypeAppendsWithoutVia(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.GetByLabel("账号").Type(context.Background(), "小明"); err != nil {
		t.Fatalf("type 失败：%v", err)
	}
	calls := fake.recorded()
	if len(calls) != 1 {
		t.Fatalf("期望 1 次调用，实际 %d", len(calls))
	}
	if calls[0].Args["label"] != "账号" {
		t.Fatalf("label 丢了：%#v", calls[0].Args)
	}
	if _, ok := calls[0].Args["via"]; ok {
		t.Fatalf("type 不该带 via：%#v", calls[0].Args)
	}
	if calls[0].Args["text"] != "小明" {
		t.Fatalf("text 丢了：%#v", calls[0].Args)
	}
}

func TestWaitForNativeSelector(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.WaitFor(context.Background(), ".done", WithState("appear"), WithWaitTimeout(3*time.Second)); err != nil {
		t.Fatalf("waitFor 失败：%v", err)
	}
	calls := fake.recorded()
	if len(calls) != 1 {
		t.Fatalf("原生等待应该只发一次，实际 %d", len(calls))
	}
	if calls[0].Name != "page_wait" {
		t.Fatalf("工具名不对：%s", calls[0].Name)
	}
	if calls[0].Args["selector"] != ".done" {
		t.Fatalf("selector 丢了：%#v", calls[0].Args)
	}
	if calls[0].Args["state"] != "appear" {
		t.Fatalf("state 丢了：%#v", calls[0].Args)
	}
	if seconds, ok := calls[0].Args["timeout"].(float64); !ok || seconds != 3 {
		t.Fatalf("timeout 不对：%#v", calls[0].Args)
	}
}

func TestWaitForRolePollsSnapshot(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.GetByRole("button", Name("登录")).WaitFor(context.Background()); err != nil {
		t.Fatalf("waitFor 失败：%v", err)
	}
	calls := fake.recorded()
	if len(calls) == 0 {
		t.Fatal("应该至少调一次 page_snapshot")
	}
	if calls[0].Name != "page_snapshot" {
		t.Fatalf("role 应该走无障碍树轮询，实际 %s", calls[0].Name)
	}
}

func TestWaitForLabelReportsNotFound(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	err := page.GetByLabel("账号").WaitFor(context.Background())
	if !IsNotFoundError(err) {
		t.Fatalf("期望未找到错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "label") {
		t.Fatalf("错误里应该有定位描述：%s", err.Error())
	}
	if len(fake.recorded()) != 0 {
		t.Fatal("不该发任何请求")
	}
}

func TestWaitForTextPollsThenStopsFind(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_find": func(args map[string]any, calls []fakeCall) (map[string]any, error) {
				if stop, _ := args["stop"].(bool); stop {
					return map[string]any{"ok": true, "stopped": true}, nil
				}
				seen := 0
				for _, call := range calls {
					if call.Name != "page_find" {
						continue
					}
					if stop, _ := call.Args["stop"].(bool); stop {
						continue
					}
					seen++
				}
				total := 0
				if seen > 1 {
					total = 3
				}
				return map[string]any{"ok": true, "matches": total, "active": 1}, nil
			},
		},
	})
	page := newTestPage(fake)

	if err := page.WaitForText(context.Background(), "完成", WithWaitTimeout(5*time.Second), WithPollInterval(10*time.Millisecond)); err != nil {
		t.Fatalf("waitForText 失败：%v", err)
	}
	finds := make([]fakeCall, 0)
	for _, call := range fake.recorded() {
		if call.Name == "page_find" {
			finds = append(finds, call)
		}
	}
	if len(finds) < 3 {
		t.Fatalf("应该查了两次再收尾，实际 %d 次", len(finds))
	}
	if stop, _ := finds[len(finds)-1].Args["stop"].(bool); !stop {
		t.Fatalf("最后一次应该是 stop:true，实际 %#v", finds[len(finds)-1].Args)
	}
}

func TestWaitForTextTimesOut(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_find": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "matches": 0, "active": 0}, nil
			},
		},
	})
	page := newTestPage(fake)

	err := page.ExpectText(context.Background(), "永远不出现", WithWaitTimeout(60*time.Millisecond), WithPollInterval(10*time.Millisecond))
	if !IsNotFoundError(err) {
		t.Fatalf("期望未找到错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "永远不出现") {
		t.Fatalf("错误里应该有文本：%s", err.Error())
	}
}

func TestScreenshotGridOffAndBytes(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	image, err := page.Screenshot(context.Background())
	if err != nil {
		t.Fatalf("截图失败：%v", err)
	}
	args := fake.recorded()[0].Args
	if args["grid"] != false {
		t.Fatalf("默认必须关掉坐标网格：%#v", args)
	}
	if string(image) != "png-bytes" {
		t.Fatalf("图片字节不对：%q", string(image))
	}

	target := filepath.Join(t.TempDir(), "a.png")
	if _, err := page.Screenshot(context.Background(), WithPath(target)); err != nil {
		t.Fatalf("带路径的截图失败：%v", err)
	}
	written, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("截图没落盘：%v", err)
	}
	if string(written) != "png-bytes" {
		t.Fatalf("落盘内容不对：%q", string(written))
	}

	if _, err := page.Screenshot(context.Background(), WithGrid(true), WithClip(Clip{X: 1, Y: 2, Width: 30, Height: 40})); err != nil {
		t.Fatalf("裁剪截图失败：%v", err)
	}
	calls := fake.recorded()
	clipArgs := calls[len(calls)-1].Args
	if clipArgs["grid"] != true || intOf(t, clipArgs["width"]) != 30 {
		t.Fatalf("grid/clip 不对：%#v", clipArgs)
	}
}

func TestCountIsVisibleTextContent(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	count, err := page.Count(ctx, "#item")
	if err != nil || count != 2 {
		t.Fatalf("count 不对：%d %v", count, err)
	}
	visible, err := page.IsVisible(ctx, "#item")
	if err != nil || !visible {
		t.Fatalf("isVisible 不对：%v %v", visible, err)
	}
	text, err := page.TextContent(ctx, "#item")
	if err != nil || text != "按钮文字" {
		t.Fatalf("textContent 不对：%q %v", text, err)
	}

	if _, err := page.Count(ctx, page.GetByText("按钮")); !IsNotFoundError(err) {
		t.Fatalf("text 定位器应该报未找到，实际 %v", err)
	}
	if _, err := page.IsVisible(ctx, page.GetByLabel("账号")); !IsNotFoundError(err) {
		t.Fatalf("label 定位器应该报未找到，实际 %v", err)
	}
	if _, err := page.TextContent(ctx, page.GetByRole("button")); !IsNotFoundError(err) {
		t.Fatalf("role 定位器应该报未找到，实际 %v", err)
	}
}

func TestSelectOnlySelectorOrXPath(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.Select(context.Background(), "#city", "北京"); err != nil {
		t.Fatalf("select 失败：%v", err)
	}
	args := fake.recorded()[0].Args
	if args["selector"] != "#city" || args["option"] != "北京" {
		t.Fatalf("select 参数不对：%#v", args)
	}
	if err := page.Select(context.Background(), page.GetByText("城市"), "北京"); !IsNotFoundError(err) {
		t.Fatalf("非 selector 应该报未找到，实际 %v", err)
	}
}

func TestNavigationTools(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	if err := page.Reload(ctx); err != nil {
		t.Fatalf("reload 失败：%v", err)
	}
	if err := page.Back(ctx); err != nil {
		t.Fatalf("back 失败：%v", err)
	}
	if err := page.Forward(ctx); err != nil {
		t.Fatalf("forward 失败：%v", err)
	}
	if err := page.WaitForLoad(ctx); err != nil {
		t.Fatalf("waitForLoad 失败：%v", err)
	}
	if err := page.BringToFront(ctx); err != nil {
		t.Fatalf("bringToFront 失败：%v", err)
	}
	if err := page.Close(ctx); err != nil {
		t.Fatalf("close 失败：%v", err)
	}

	calls := fake.recorded()
	names := []string{"page_reload", "page_back", "page_forward", "page_wait_load", "tab_activate", "tab_close"}
	if len(calls) != len(names) {
		t.Fatalf("调用数不对：%#v", calls)
	}
	for index, name := range names {
		if calls[index].Name != name {
			t.Fatalf("第 %d 个应该是 %s，实际 %s", index, name, calls[index].Name)
		}
	}
	if intOf(t, calls[3].Args["timeout"]) != 15 {
		t.Fatalf("waitForLoad 默认 15 秒：%#v", calls[3].Args)
	}
	if calls[4].Args["tabId"] != "tab-test" || calls[5].Args["tabId"] != "tab-test" {
		t.Fatalf("标签操作应该带 tabId：%#v", calls)
	}
}

func TestPageURLAndTitle(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	url, err := page.URL(ctx)
	if err != nil || url != "https://example.com" {
		t.Fatalf("URL 不对：%s %v", url, err)
	}
	title, err := page.Title(ctx)
	if err != nil || title != "Example" {
		t.Fatalf("标题不对：%s %v", title, err)
	}
	// tab_list 不接受 tabId，这里必须原样发空参数。
	for _, call := range fake.recorded() {
		if call.Name != "tab_list" {
			t.Fatalf("工具名不对：%s", call.Name)
		}
		if len(call.Args) != 0 {
			t.Fatalf("tab_list 不该带参数：%#v", call.Args)
		}
	}
}

func TestContentSnapshotEvaluateConsole(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	html, err := page.Content(ctx)
	if err != nil || html != "<html></html>" {
		t.Fatalf("content 不对：%q %v", html, err)
	}
	if _, err := page.ContentKind(ctx, "response"); err != nil {
		t.Fatalf("content(response) 失败：%v", err)
	}
	snapshot, err := page.Snapshot(ctx)
	if err != nil || snapshot != "button 登录" {
		t.Fatalf("snapshot 不对：%q %v", snapshot, err)
	}
	value, err := page.Evaluate(ctx, "1+1")
	if err != nil || toInt(value) != 42 {
		t.Fatalf("evaluate 不对：%v %v", value, err)
	}
	messages, err := page.ConsoleLogs(ctx)
	if err != nil || len(messages) != 1 || messages[0]["message"] != "boom" {
		t.Fatalf("consoleLogs 不对：%#v %v", messages, err)
	}
	if cleared, err := page.ConsoleLogs(ctx, WithClear(true)); err != nil || len(cleared) != 0 {
		t.Fatalf("清空控制台不对：%#v %v", cleared, err)
	}

	calls := fake.recorded()
	if calls[1].Args["kind"] != "response" {
		t.Fatalf("content kind 没传：%#v", calls[1].Args)
	}
	if calls[3].Args["source"] != "1+1" {
		t.Fatalf("evaluate source 没传：%#v", calls[3].Args)
	}
	if calls[len(calls)-1].Args["action"] != "clear" {
		t.Fatalf("清空动作不对：%#v", calls[len(calls)-1].Args)
	}
}

func TestPressAndScrollAndHover(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	if err := page.Press(ctx, "Control+Enter"); err != nil {
		t.Fatalf("press 失败：%v", err)
	}
	if err := page.Hover(ctx, "#menu"); err != nil {
		t.Fatalf("hover 失败：%v", err)
	}
	if err := page.Scroll(ctx, WithScrollDirection("up"), WithScrollTarget("#list"), WithScrollUntil("#bottom")); err != nil {
		t.Fatalf("scroll 失败：%v", err)
	}
	if err := page.ScrollTo(ctx, "#bottom"); err != nil {
		t.Fatalf("scrollTo 失败：%v", err)
	}
	if err := page.ScrollTo(ctx, page.GetByLabel("底部")); !IsNotFoundError(err) {
		t.Fatalf("scrollTo 非 selector 应该报未找到，实际 %v", err)
	}

	calls := fake.recorded()
	if calls[0].Args["shortcut"] != "Control+Enter" {
		t.Fatalf("快捷键没传：%#v", calls[0].Args)
	}
	if calls[1].Args["selector"] != "#menu" {
		t.Fatalf("hover 目标不对：%#v", calls[1].Args)
	}
	scroll := calls[2].Args
	if scroll["direction"] != "up" || scroll["selector"] != "#list" || scroll["untilSelector"] != "#bottom" {
		t.Fatalf("scroll 参数不对：%#v", scroll)
	}
	scrollTo := calls[3].Args
	if scrollTo["direction"] != "down" || scrollTo["untilSelector"] != "#bottom" {
		t.Fatalf("scrollTo 参数不对：%#v", scrollTo)
	}
}

func TestFillRoleTextboxUsesNameAsLabel(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.GetByRole("textbox", Name("账号")).Fill(context.Background(), "小明"); err != nil {
		t.Fatalf("fill 失败：%v", err)
	}
	calls := fake.recorded()
	if len(calls) != 3 {
		t.Fatalf("textbox 的 name 退化成 label，应该走三步：%#v", calls)
	}
	if calls[0].Args["label"] != "账号" {
		t.Fatalf("role 的 name 没当成 label：%#v", calls[0].Args)
	}
}

func TestFillUnsupportedLocator(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	err := page.Fill(context.Background(), page.GetByText("文字"), "值")
	if err == nil || !strings.Contains(err.Error(), "无法输入") {
		t.Fatalf("应该明确说没法输入，实际 %v", err)
	}
	if len(fake.recorded()) != 0 {
		t.Fatal("表达不了的定位器不该发请求")
	}
}

func TestDblClickAndPageCall(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	if err := page.Locator("#row").DblClick(ctx); err != nil {
		t.Fatalf("双击失败：%v", err)
	}
	if _, err := page.Call(ctx, "page_console", map[string]any{"limit": 5}); err != nil {
		t.Fatalf("原始调用失败：%v", err)
	}

	calls := fake.recorded()
	if intOf(t, calls[0].Args["count"]) != 2 {
		t.Fatalf("双击应该是 count=2：%#v", calls[0].Args)
	}
	if calls[1].Args["tabId"] != "tab-test" || intOf(t, calls[1].Args["limit"]) != 5 {
		t.Fatalf("Page.Call 没自动带 tabId：%#v", calls[1].Args)
	}
}

func intOf(t *testing.T, value any) int {
	t.Helper()
	if value == nil {
		t.Fatal("字段不存在")
	}
	return toInt(value)
}

func equalArgs(got, want map[string]any) bool {
	if len(got) != len(want) {
		return false
	}
	for key, value := range want {
		if got[key] != value {
			return false
		}
	}
	return true
}
