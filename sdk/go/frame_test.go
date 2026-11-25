package browserpilot

import (
	"context"
	"strings"
	"testing"
	"time"
)

const (
	testFrameA = "https://frame.example.com/login"
	testFrameB = "https://other.example.com/child"
)

func frameScriptValue(value any) fakeHandler {
	return func(map[string]any, []fakeCall) (map[string]any, error) {
		return map[string]any{"ok": true, "value": value}, nil
	}
}

func lastRecordedCall(t *testing.T, fake *fakeServer) fakeCall {
	t.Helper()
	calls := fake.recorded()
	if len(calls) == 0 {
		t.Fatal("没有任何工具调用")
	}
	return calls[len(calls)-1]
}

func TestFramesListsIframes(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": frameScriptValue([]map[string]any{
				{"src": testFrameA, "name": "login", "selector": "iframe#login"},
				{"src": testFrameB, "name": "", "selector": "iframe"},
			}),
		},
	})
	page := newTestPage(fake)

	frames, err := page.Frames(context.Background())
	if err != nil {
		t.Fatalf("Frames 失败：%v", err)
	}
	if len(frames) != 2 {
		t.Fatalf("期望 2 个 frame，实际 %d", len(frames))
	}
	if frames[0].URL != testFrameA || frames[1].URL != testFrameB {
		t.Fatalf("frame URL 不对：%#v", frames)
	}
	if frames[0].Name != "login" || frames[0].Selector != "iframe#login" {
		t.Fatalf("frame 字段不对：%#v", frames[0])
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_script" {
		t.Fatalf("列 frame 应该走 page_script，实际 %s", call.Name)
	}
	if source := stringField(call.Args, "source"); !strings.Contains(source, "querySelectorAll('iframe')") {
		t.Fatalf("枚举脚本不对：%s", source)
	}
}

func TestFrameLocatorResolvesIframeSrc(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": frameScriptValue(map[string]any{"src": testFrameA, "name": "login"}),
		},
	})
	page := newTestPage(fake)

	frame, err := page.FrameLocator(context.Background(), "iframe#login")
	if err != nil {
		t.Fatalf("FrameLocator 失败：%v", err)
	}
	if frame.URL != testFrameA || frame.Selector != "iframe#login" || frame.Name != "login" {
		t.Fatalf("FrameLocator 字段不对：%#v", frame)
	}
	if frame.Match() != testFrameA {
		t.Fatalf("Match 不对：%s", frame.Match())
	}
}

func TestFrameLocatorMissingListsFrames(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				if strings.Contains(stringField(args, "source"), "querySelectorAll('iframe')") {
					return map[string]any{"ok": true, "value": []map[string]any{
						{"src": testFrameA, "name": "login", "selector": "#login"},
					}}, nil
				}
				return map[string]any{"ok": true, "value": nil}, nil
			},
		},
	})
	page := newTestPage(fake)

	_, err := page.FrameLocator(context.Background(), "iframe#nope")
	if !IsNotFoundError(err) {
		t.Fatalf("期望未找到错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "没找到 iframe") || !strings.Contains(err.Error(), testFrameA) {
		t.Fatalf("错误里应该列出已有 frame：%s", err.Error())
	}
}

func TestFrameLocatorClickAndFillPassFrame(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": frameScriptValue(map[string]any{"src": testFrameA, "name": ""}),
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	frame, err := page.FrameLocator(ctx, "iframe#login")
	if err != nil {
		t.Fatalf("FrameLocator 失败：%v", err)
	}
	if err := frame.Locator("#ok").Click(ctx); err != nil {
		t.Fatalf("frame 点击失败：%v", err)
	}
	click := lastRecordedCall(t, fake)
	if click.Name != "page_click" {
		t.Fatalf("工具名不对：%s", click.Name)
	}
	if click.Args["frame"] != testFrameA || click.Args["selector"] != "#ok" {
		t.Fatalf("点击参数没带 frame：%#v", click.Args)
	}

	if err := frame.Locator("#user").Fill(ctx, "小明"); err != nil {
		t.Fatalf("frame 输入失败：%v", err)
	}
	fill := lastRecordedCall(t, fake)
	if fill.Name != "page_type" || fill.Args["frame"] != testFrameA || fill.Args["via"] != "inject" {
		t.Fatalf("输入参数没带 frame：%#v", fill.Args)
	}
}

func TestFrameCountRunsScriptInsideFrame(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{"page_script": frameScriptValue(3)},
	})
	page := newTestPage(fake)

	count, err := page.Frame(testFrameA).Count(context.Background(), "#row")
	if err != nil || count != 3 {
		t.Fatalf("frame count 不对：%d %v", count, err)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_script" || call.Args["frame"] != testFrameA {
		t.Fatalf("应该带着 frame 跑 page_script：%#v", call)
	}
	if source := stringField(call.Args, "source"); !strings.Contains(source, "querySelectorAll") {
		t.Fatalf("计数脚本不对：%s", source)
	}
}

func TestFrameTextAndVisible(t *testing.T) {
	values := []any{2, "登录", true}
	index := 0
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
				value := values[index]
				index++
				return map[string]any{"ok": true, "value": value}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()
	frame := page.Frame(testFrameA)

	count, err := frame.Count(ctx, "#row")
	if err != nil || count != 2 {
		t.Fatalf("count 不对：%d %v", count, err)
	}
	text, err := frame.TextContent(ctx, "#row")
	if err != nil || text != "登录" {
		t.Fatalf("textContent 不对：%q %v", text, err)
	}
	visible, err := frame.IsVisible(ctx, "#row")
	if err != nil || !visible {
		t.Fatalf("isVisible 不对：%v %v", visible, err)
	}
	for _, call := range fake.recorded() {
		if call.Args["frame"] != testFrameA {
			t.Fatalf("读取没进 frame：%#v", call.Args)
		}
	}
}

func TestFrameWaitForPollsUntilAppears(t *testing.T) {
	probes := 0
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
				probes++
				value := 0
				if probes >= 3 {
					value = 1
				}
				return map[string]any{"ok": true, "value": value}, nil
			},
		},
	})
	page := newTestPage(fake)

	err := page.Frame(testFrameA).WaitFor(context.Background(), "#ok",
		WithWaitTimeout(2*time.Second), WithPollInterval(10*time.Millisecond))
	if err != nil {
		t.Fatalf("frame waitFor 失败：%v", err)
	}
	if probes < 3 {
		t.Fatalf("应该轮询到第 3 次，实际 %d 次", probes)
	}
	if call := lastRecordedCall(t, fake); call.Args["frame"] != testFrameA {
		t.Fatalf("等待没进 frame：%#v", call.Args)
	}
}

func TestPageWaitForFrameSkipsPageWait(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{"page_script": frameScriptValue(1)},
	})
	page := newTestPage(fake)

	err := page.WaitFor(context.Background(), page.Frame(testFrameA).Locator("#ok"),
		WithWaitTimeout(time.Second), WithPollInterval(10*time.Millisecond))
	if err != nil {
		t.Fatalf("page.waitFor(frame) 失败：%v", err)
	}
	if got := countCall(callNames(fake), "page_wait"); got != 0 {
		t.Fatalf("frame 里的等待不该走 page_wait，实际 %d 次", got)
	}
	if call := lastRecordedCall(t, fake); call.Args["frame"] != testFrameA {
		t.Fatalf("等待没进 frame：%#v", call.Args)
	}
}

func TestWaitForFunctionPollsAndReturnsValue(t *testing.T) {
	values := []any{false, 0, "ready"}
	index := 0
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
				value := values[index]
				index++
				return map[string]any{"ok": true, "value": value}, nil
			},
		},
	})
	page := newTestPage(fake)

	value, err := page.WaitForFunction(context.Background(), "document.title",
		WithWaitTimeout(2*time.Second), WithPollInterval(10*time.Millisecond))
	if err != nil {
		t.Fatalf("WaitForFunction 失败：%v", err)
	}
	if value != "ready" {
		t.Fatalf("返回值不对：%#v", value)
	}
	source := stringField(lastRecordedCall(t, fake).Args, "source")
	if !strings.Contains(source, "document.title") {
		t.Fatalf("表达式没进脚本：%s", source)
	}
	if !strings.Contains(source, `typeof value === 'function'`) {
		t.Fatalf("函数形式没包出来：%s", source)
	}
}

func TestWaitForFunctionTimesOut(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{"page_script": frameScriptValue(false)},
	})
	page := newTestPage(fake)

	_, err := page.WaitForFunction(context.Background(), "false",
		WithWaitTimeout(60*time.Millisecond), WithPollInterval(5*time.Millisecond))
	if !IsNotFoundError(err) {
		t.Fatalf("期望未找到错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "条件一直没成立") {
		t.Fatalf("超时文案不对：%s", err.Error())
	}
}

func TestFrameWaitForFunctionRunsInFrame(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{"page_script": frameScriptValue(true)},
	})
	page := newTestPage(fake)

	value, err := page.Frame(testFrameA).WaitForFunction(context.Background(),
		`document.readyState === "complete"`,
		WithWaitTimeout(time.Second), WithPollInterval(5*time.Millisecond))
	if err != nil {
		t.Fatalf("frame WaitForFunction 失败：%v", err)
	}
	if value != true {
		t.Fatalf("返回值不对：%#v", value)
	}
	if call := lastRecordedCall(t, fake); call.Args["frame"] != testFrameA {
		t.Fatalf("条件没在 frame 里跑：%#v", call.Args)
	}
}

func TestClickFailureExplainsElementInIframe(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				if strings.Contains(stringField(args, "source"), "querySelectorAll('iframe')") {
					return map[string]any{"ok": true, "value": []map[string]any{
						{"src": testFrameA, "name": "login", "selector": "iframe#login"},
					}}, nil
				}
				return map[string]any{"ok": true, "value": 1}, nil
			},
			"page_click": func(map[string]any, []fakeCall) (map[string]any, error) {
				return nil, newError(CodeBrowserPilotError, "DOM Error while querying", nil)
			},
		},
	})
	page := newTestPage(fake)

	err := page.Click(context.Background(), "#submit")
	if !IsToolError(err) {
		t.Fatalf("错误码应该还是工具错误，实际 %v", err)
	}
	message := err.Error()
	for _, want := range []string{"DOM Error while querying", "iframe", "FrameLocator"} {
		if !strings.Contains(message, want) {
			t.Fatalf("失败解释里缺 %q：%s", want, message)
		}
	}
}

func TestClickFailureMentionsOverlayWhenNoFrame(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				if strings.Contains(stringField(args, "source"), "querySelectorAll('iframe')") {
					return map[string]any{"ok": true, "value": []map[string]any{}}, nil
				}
				return map[string]any{"ok": true, "value": 0}, nil
			},
			"page_click": func(map[string]any, []fakeCall) (map[string]any, error) {
				return nil, newError(CodeBrowserPilotError, "元素被挡住", nil)
			},
			"page_overlay": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "overlays": []map[string]any{{"kind": "mask"}}}, nil
			},
		},
	})
	page := newTestPage(fake)

	err := page.Click(context.Background(), "#submit")
	if !IsToolError(err) {
		t.Fatalf("期望工具错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "遮罩") {
		t.Fatalf("应该提示遮罩：%s", err.Error())
	}
}

func TestSelectInsideFrameUsesScript(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{"page_script": frameScriptValue("北京")},
	})
	page := newTestPage(fake)

	err := page.Select(context.Background(), LocatorSpec{Selector: "#city", Frame: testFrameA}, "北京")
	if err != nil {
		t.Fatalf("frame select 失败：%v", err)
	}
	if got := countCall(callNames(fake), "page_select"); got != 0 {
		t.Fatalf("frame 里不该走 page_select，实际 %d 次", got)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_script" || call.Args["frame"] != testFrameA {
		t.Fatalf("frame select 应该走 page_script：%#v", call)
	}
	if source := stringField(call.Args, "source"); !strings.Contains(source, "dispatchEvent") {
		t.Fatalf("select 脚本没派发事件：%s", source)
	}
}

func TestTabBindsToThatTab(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	page, err := bp.Tab(context.Background(), "tab-test")
	if err != nil {
		t.Fatalf("Tab 失败：%v", err)
	}
	if page.ID() != "tab-test" || page.Env() != DefaultEnv {
		t.Fatalf("标签绑定不对：%s %s", page.ID(), page.Env())
	}
	if err := page.Locator("#a").Click(context.Background()); err != nil {
		t.Fatalf("点击失败：%v", err)
	}
	if call := lastRecordedCall(t, fake); call.Args["tabId"] != "tab-test" {
		t.Fatalf("动作没落到绑定的标签：%#v", call.Args)
	}
}

func TestTabMissingListsExistingIDs(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	_, err = bp.Tab(context.Background(), "tab-missing")
	if !IsNotFoundError(err) {
		t.Fatalf("期望未找到错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "tab-test") {
		t.Fatalf("错误里应该列出已有 id：%s", err.Error())
	}
}

func TestFrameLocatorsCarryFrame(t *testing.T) {
	page := newTestPage(startFakeServer(t, fakeServerOptions{}))
	frame := page.Frame(testFrameA)

	if spec := frame.Locator("#ok").Spec(); spec.Frame != testFrameA || spec.Selector != "#ok" {
		t.Fatalf("Locator 没带 frame：%#v", spec)
	}
	if spec := frame.XPath("//button[1]").Spec(); spec.Frame != testFrameA || spec.XPath != "//button[1]" {
		t.Fatalf("XPath 没带 frame：%#v", spec)
	}
	text := frame.GetByText("登录").Spec()
	if text.Frame != testFrameA || text.Text != "登录" {
		t.Fatalf("GetByText 没带 frame：%#v", text)
	}
	role := frame.GetByRole("button", Name("登录")).Spec()
	if role.Frame != testFrameA || role.Role != "button" || role.Name != "登录" {
		t.Fatalf("GetByRole 没带 frame：%#v", role)
	}
}

func TestPageReadMethodsDelegateToFrame(t *testing.T) {
	values := []any{3, "登录", true}
	index := 0
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
				value := values[index]
				index++
				return map[string]any{"ok": true, "value": value}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()
	target := LocatorSpec{Selector: "#row", Frame: testFrameA}

	if count, err := page.Count(ctx, target); err != nil || count != 3 {
		t.Fatalf("page.Count(frame) 不对：%d %v", count, err)
	}
	if text, err := page.TextContent(ctx, target); err != nil || text != "登录" {
		t.Fatalf("page.TextContent(frame) 不对：%q %v", text, err)
	}
	if visible, err := page.IsVisible(ctx, target); err != nil || !visible {
		t.Fatalf("page.IsVisible(frame) 不对：%v %v", visible, err)
	}
	if got := countCall(callNames(fake), "page_query"); got != 0 {
		t.Fatalf("frame 里不该走 page_query，实际 %d 次", got)
	}
	for _, call := range fake.recorded() {
		if call.Args["frame"] != testFrameA {
			t.Fatalf("读取没进 frame：%#v", call.Args)
		}
	}
}

func TestFrameWaitForText(t *testing.T) {
	probes := 0
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
				probes++
				return map[string]any{"ok": true, "value": probes >= 2}, nil
			},
		},
	})
	page := newTestPage(fake)

	if err := page.Frame(testFrameA).WaitFor(context.Background(), page.GetByText("完成"),
		WithWaitTimeout(time.Second), WithPollInterval(5*time.Millisecond)); err != nil {
		t.Fatalf("按文字等 frame 失败：%v", err)
	}
	if probes < 2 {
		t.Fatalf("应该轮询两次，实际 %d 次", probes)
	}
	source := stringField(lastRecordedCall(t, fake).Args, "source")
	if !strings.Contains(source, "innerText") {
		t.Fatalf("纯文本应该查 innerText：%s", source)
	}
}

func TestFrameStringAndMatch(t *testing.T) {
	frame := newFrame(nil, "", "login", "iframe[name=login]")
	if frame.Match() != srcdocURL {
		t.Fatalf("没有 src 应该用 about:srcdoc：%s", frame.Match())
	}
	if frame.String() != "Frame(login)" {
		t.Fatalf("String 不对：%s", frame.String())
	}
}

func TestFrameScreenshotIsRejected(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	frame := page.Frame("editor")

	if _, err := page.Screenshot(context.Background(), WithScreenshotTarget(frame.Locator("#chart"))); err == nil {
		t.Fatal("frame 里的元素截图应该直接报错")
	} else if !IsNotFoundError(err) {
		t.Fatalf("应该是 NotFoundError：%v", err)
	} else if !strings.Contains(err.Error(), "frame 里的元素截图") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}
