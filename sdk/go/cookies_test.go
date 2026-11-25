package browserpilot

import (
	"context"
	"strings"
	"testing"
)

func TestCookiesExportImportAndClear(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"cookie_list": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "cookies": []map[string]any{{
					"name": "sid", "value": "abc", "domain": ".example.com",
					"path": "/", "secure": true, "httpOnly": true, "session": true,
				}}}, nil
			},
		},
	})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()
	ctx := context.Background()

	items, err := bp.Cookies(ctx, "env-default", "")
	if err != nil {
		t.Fatalf("Cookies 失败：%v", err)
	}
	if len(items) != 1 || items[0]["name"] != "sid" {
		t.Fatalf("导出的 cookie 不对：%#v", items)
	}
	listCall := lastRecordedCall(t, fake)
	if listCall.Name != "cookie_list" || listCall.Args["env"] != "env-default" {
		t.Fatalf("cookie_list 参数不对：%#v", listCall)
	}
	if _, ok := listCall.Args["tabId"]; ok {
		t.Fatalf("cookie 工具不认 tabId：%#v", listCall.Args)
	}

	written, err := bp.AddCookies(ctx, items, "env-default")
	if err != nil || written != 1 {
		t.Fatalf("AddCookies 不对：%d %v", written, err)
	}
	setCall := lastRecordedCall(t, fake)
	if setCall.Name != "cookie_set" || setCall.Args["name"] != "sid" || setCall.Args["env"] != "env-default" {
		t.Fatalf("cookie_set 参数不对：%#v", setCall)
	}
	if _, ok := setCall.Args["session"]; ok {
		t.Fatalf("session 字段应该丢掉：%#v", setCall.Args)
	}

	// 空的可选字段不发：domain 是 nil、path 是空串，secure=false 要保留。
	written, err = bp.AddCookies(ctx, []map[string]any{{
		"name": "uid", "value": "x", "domain": nil, "path": "", "secure": false,
	}}, "env-default")
	if err != nil || written != 1 {
		t.Fatalf("第二组 cookie 不对：%d %v", written, err)
	}
	second := lastRecordedCall(t, fake).Args
	if _, ok := second["domain"]; ok {
		t.Fatalf("nil 的可选字段应该丢掉：%#v", second)
	}
	if _, ok := second["path"]; ok {
		t.Fatalf("空的可选字段应该丢掉：%#v", second)
	}
	if second["secure"] != false {
		t.Fatalf("false 的布尔字段不能丢：%#v", second)
	}

	if err := bp.ClearCookies(ctx, "sid", "", "", false, "env-default"); err != nil {
		t.Fatalf("ClearCookies 失败：%v", err)
	}
	clearCall := lastRecordedCall(t, fake)
	if clearCall.Name != "cookie_remove" {
		t.Fatalf("工具名不对：%s", clearCall.Name)
	}
	// 只给 name 时 App 不认，SDK 要先查 domain 再删。
	if !equalArgs(clearCall.Args, map[string]any{"name": "sid", "domain": ".example.com", "env": "env-default"}) {
		t.Fatalf("cookie_remove 参数不对：%#v", clearCall.Args)
	}

	if err := bp.ClearCookies(ctx, "", "", "", false, "env-default"); err == nil {
		t.Fatal("没有范围时应该报错")
	} else if !strings.Contains(err.Error(), "至少要给") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}

func TestClearCookiesByNameWhenAbsentDoesNothing(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"cookie_list": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "cookies": []map[string]any{}}, nil
			},
		},
	})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	if err := bp.ClearCookies(context.Background(), "nope", "", "", false, "env-default"); err != nil {
		t.Fatalf("ClearCookies 失败：%v", err)
	}
	for _, call := range fake.recorded() {
		if call.Name == "cookie_remove" {
			t.Fatalf("没有这个 cookie 时不该发 cookie_remove：%#v", call)
		}
	}
}

func TestPageCookiesBindEnvWithoutTabID(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"cookie_list": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "cookies": []map[string]any{{
					"name": "sid", "value": "abc", "domain": ".example.com",
				}}}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	if _, err := page.Cookies(ctx, ""); err != nil {
		t.Fatalf("Page.Cookies 失败：%v", err)
	}
	listCall := lastRecordedCall(t, fake)
	if listCall.Name != "cookie_list" {
		t.Fatalf("工具名不对：%s", listCall.Name)
	}
	if !equalArgs(listCall.Args, map[string]any{"env": "env-default"}) {
		t.Fatalf("Page.Cookies 应该只带 env，不带 tabId：%#v", listCall.Args)
	}

	if _, err := page.AddCookies(ctx, []map[string]any{{"name": "sid", "value": "abc"}}); err != nil {
		t.Fatalf("Page.AddCookies 失败：%v", err)
	}
	setCall := lastRecordedCall(t, fake)
	if setCall.Name != "cookie_set" || setCall.Args["env"] != "env-default" {
		t.Fatalf("Page.AddCookies 参数不对：%#v", setCall.Args)
	}
	if _, ok := setCall.Args["tabId"]; ok {
		t.Fatalf("Page.AddCookies 不该带 tabId：%#v", setCall.Args)
	}

	if err := page.ClearCookies(ctx, "sid", "", "", false); err != nil {
		t.Fatalf("Page.ClearCookies 失败：%v", err)
	}
	clearCall := lastRecordedCall(t, fake)
	if clearCall.Name != "cookie_remove" || clearCall.Args["domain"] != ".example.com" || clearCall.Args["env"] != "env-default" {
		t.Fatalf("Page.ClearCookies 参数不对：%#v", clearCall)
	}
	if _, ok := clearCall.Args["tabId"]; ok {
		t.Fatalf("Page.ClearCookies 不该带 tabId：%#v", clearCall.Args)
	}
}
