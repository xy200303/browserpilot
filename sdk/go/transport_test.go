package browserpilot

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestPageCallCarriesTabID(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	if err := page.Goto(context.Background(), "https://example.com"); err != nil {
		t.Fatalf("Goto 失败：%v", err)
	}

	calls := fake.recorded()
	if len(calls) != 1 {
		t.Fatalf("期望 1 次调用，实际 %d", len(calls))
	}
	if calls[0].Name != "page_navigate" {
		t.Fatalf("工具名不对：%s", calls[0].Name)
	}
	want := map[string]any{"tabId": "tab-test", "url": "https://example.com"}
	if !reflect.DeepEqual(calls[0].Args, want) {
		t.Fatalf("参数不对：%#v", calls[0].Args)
	}
}

func TestWrongTokenIsTransportError(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	wrong := Endpoint{URL: fake.endpoint().URL, API: fake.endpoint().API, Token: "wrong"}

	if NewTransport(wrong).Ping(context.Background()) {
		t.Fatal("token 不对时探活应该失败")
	}
	if _, err := Launch(context.Background(), WithEndpoint(wrong)); !IsTransportError(err) {
		t.Fatalf("期望传输错误，实际 %v", err)
	}
}

func TestUnknownToolIsToolError(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_click": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": false, "error": "没有 page_click 这个工具"}, nil
			},
		},
	})
	page := newTestPage(fake)

	err := page.Click(context.Background(), "#go")
	if !IsToolError(err) {
		t.Fatalf("期望工具错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "没有 page_click 这个工具") {
		t.Fatalf("错误文案丢了：%s", err.Error())
	}
}

func TestWaitEventsLongPoll(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	transport := NewTransport(fake.endpoint())
	ctx := context.Background()

	since := int64(100)
	fake.pushEvent("page.console", map[string]any{"message": "hi"})
	result, err := transport.WaitEvents(ctx, EventWaitOptions{Since: &since, Wait: 500 * time.Millisecond})
	if err != nil {
		t.Fatalf("取事件失败：%v", err)
	}
	if len(result.Events) != 1 || result.Events[0].Type != "page.console" {
		t.Fatalf("事件不对：%#v", result.Events)
	}

	next := result.Seq
	empty, err := transport.WaitEvents(ctx, EventWaitOptions{Since: &next, Wait: 120 * time.Millisecond})
	if err != nil {
		t.Fatalf("空轮询失败：%v", err)
	}
	if len(empty.Events) != 0 || !empty.Timeout {
		t.Fatalf("期望超时且没有事件：%#v", empty)
	}
}

func TestEndpointWithoutAPIIsInstallError(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "mcp.json")
	if err := writeFile(file, `{"url":"http://127.0.0.1:1/mcp","token":"t"}`); err != nil {
		t.Fatalf("造端点文件失败：%v", err)
	}
	_, err := ReadEndpoint(file)
	if !IsInstallError(err) {
		t.Fatalf("期望安装错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "/api") {
		t.Fatalf("错误文案没提 /api：%s", err.Error())
	}
}

var errElementCovered = errors.New("元素被遮住了")

func TestToolErrorIsToolKind(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_click": func(map[string]any, []fakeCall) (map[string]any, error) {
				return nil, errElementCovered
			},
		},
	})
	page := newTestPage(fake)

	err := page.Click(context.Background(), "#go")
	if err == nil {
		t.Fatal("期望报错")
	}
	if !IsToolError(err) {
		t.Fatalf("期望工具错误，实际 %v", err)
	}
	if IsTransportError(err) {
		t.Fatal("工具失败不是传输错误")
	}
	toolError, ok := err.(*Error)
	if !ok {
		t.Fatalf("期望 *Error，实际 %T", err)
	}
	if toolError.Tool != "page_click" {
		t.Fatalf("工具名不对：%s", toolError.Tool)
	}
	if !strings.Contains(err.Error(), "遮住了") {
		t.Fatalf("错误文案丢了：%s", err.Error())
	}
	if toolError.Payload["control"] != "shared" {
		t.Fatalf("载荷没保留：%#v", toolError.Payload)
	}
}

func TestClosedTransportRejectsCalls(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	transport := NewTransport(fake.endpoint())
	if err := transport.Close(); err != nil {
		t.Fatalf("Close 失败：%v", err)
	}
	_, err := transport.Call(context.Background(), "tab_list", nil)
	if !IsTransportError(err) {
		t.Fatalf("期望传输错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "已经关了") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}

func TestToolsListing(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	tools := NewTransport(fake.endpoint()).Tools(context.Background())
	if len(tools) != 1 || tools[0].Name != "page_click" {
		t.Fatalf("工具列表不对：%#v", tools)
	}
}

func TestReadEndpoint(t *testing.T) {
	missing := t.TempDir() + "/mcp.json"
	if _, err := ReadEndpoint(missing); !IsTransportError(err) {
		t.Fatalf("缺文件时应该是传输错误，实际 %v", err)
	}

	broken := t.TempDir() + "/mcp.json"
	if err := writeFile(broken, "not json"); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadEndpoint(broken); !IsTransportError(err) {
		t.Fatalf("坏 JSON 应该是传输错误，实际 %v", err)
	}

	valid := t.TempDir() + "/mcp.json"
	if err := writeFile(valid, `{"url":"http://127.0.0.1:1/mcp","api":"http://127.0.0.1:1/api","token":"t"}`); err != nil {
		t.Fatal(err)
	}
	endpoint, err := ReadEndpoint(valid)
	if err != nil {
		t.Fatalf("读端点失败：%v", err)
	}
	if endpoint.API != "http://127.0.0.1:1/api" || endpoint.Token != "t" {
		t.Fatalf("端点内容不对：%#v", endpoint)
	}
}
