package browserpilot

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func numberOf(t *testing.T, args map[string]any, key string) float64 {
	t.Helper()
	value, ok := args[key].(float64)
	if !ok {
		t.Fatalf("%s 不是数字：%#v", key, args)
	}
	return value
}

func TestPageDialogs(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_dialog": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				if args["action"] == "list" {
					return map[string]any{
						"ok":     true,
						"policy": map[string]any{"accept": false},
						"dialogs": []map[string]any{{
							"type": "confirm", "message": "继续吗",
						}},
					}, nil
				}
				return map[string]any{
					"ok": true, "action": args["action"], "once": args["once"], "answered": "confirm",
				}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	dialogs, err := page.Dialogs(ctx)
	if err != nil {
		t.Fatalf("Dialogs 失败：%v", err)
	}
	if len(dialogs) != 1 || dialogs[0]["type"] != "confirm" {
		t.Fatalf("dialogs 不对：%#v", dialogs)
	}
	listCall := lastRecordedCall(t, fake)
	if listCall.Name != "page_dialog" || listCall.Args["action"] != "list" || listCall.Args["tabId"] != "tab-test" {
		t.Fatalf("page_dialog list 参数不对：%#v", listCall)
	}
	if _, ok := listCall.Args["once"]; ok {
		t.Fatalf("list 不该带 once：%#v", listCall.Args)
	}

	data, err := page.AcceptDialog(ctx, WithOnce(true), WithPromptText("确认"))
	if err != nil {
		t.Fatalf("AcceptDialog 失败：%v", err)
	}
	acceptCall := lastRecordedCall(t, fake)
	if acceptCall.Name != "page_dialog" || acceptCall.Args["action"] != "accept" {
		t.Fatalf("AcceptDialog 工具/动作不对：%#v", acceptCall)
	}
	if acceptCall.Args["once"] != true || acceptCall.Args["promptText"] != "确认" {
		t.Fatalf("once / promptText 丢了：%#v", acceptCall.Args)
	}
	if data["answered"] != "confirm" {
		t.Fatalf("AcceptDialog 应返回原始载荷：%#v", data)
	}

	// 不传选项就别乱发 once / promptText，App 用默认策略。
	if _, err := page.AcceptDialog(ctx); err != nil {
		t.Fatalf("AcceptDialog 无选项失败：%v", err)
	}
	plainCall := lastRecordedCall(t, fake)
	if _, ok := plainCall.Args["once"]; ok {
		t.Fatalf("once=false 不该发：%#v", plainCall.Args)
	}
	if _, ok := plainCall.Args["promptText"]; ok {
		t.Fatalf("没设 promptText 不该发：%#v", plainCall.Args)
	}

	// 显式空串是「把 prompt 清空后确定」，和没设不一样。
	if _, err := page.AcceptDialog(ctx, WithPromptText("")); err != nil {
		t.Fatalf("AcceptDialog 空 promptText 失败：%v", err)
	}
	emptyCall := lastRecordedCall(t, fake)
	if value, ok := emptyCall.Args["promptText"]; !ok || value != "" {
		t.Fatalf("显式空 promptText 应该照发：%#v", emptyCall.Args)
	}

	if err := page.DismissDialog(ctx, WithOnce(true), WithPromptText("不要")); err != nil {
		t.Fatalf("DismissDialog 失败：%v", err)
	}
	dismissCall := lastRecordedCall(t, fake)
	if dismissCall.Args["action"] != "dismiss" || dismissCall.Args["once"] != true {
		t.Fatalf("DismissDialog 参数不对：%#v", dismissCall.Args)
	}
	if _, ok := dismissCall.Args["promptText"]; ok {
		t.Fatalf("dismiss 不该带 promptText：%#v", dismissCall.Args)
	}
}

func TestDialogsFallsBackToListField(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_dialog": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "list": []map[string]any{{"type": "alert"}}}, nil
			},
		},
	})
	page := newTestPage(fake)

	dialogs, err := page.Dialogs(context.Background())
	if err != nil {
		t.Fatalf("Dialogs 失败：%v", err)
	}
	if len(dialogs) != 1 || dialogs[0]["type"] != "alert" {
		t.Fatalf("没有兼容 list 字段：%#v", dialogs)
	}
}

func TestPageUpload(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_upload": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "tabId": args["tabId"]}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	paths := []string{`C:\tmp\a.pdf`, "b.png"}
	if err := page.Upload(ctx, paths, page.Locator("input[type=file]").Pierce()); err != nil {
		t.Fatalf("Upload 失败：%v", err)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_upload" || call.Args["tabId"] != "tab-test" {
		t.Fatalf("page_upload 参数不对：%#v", call)
	}
	if got, ok := call.Args["paths"].([]any); !ok || !reflect.DeepEqual(got, []any{`C:\tmp\a.pdf`, "b.png"}) {
		t.Fatalf("paths 不对：%#v", call.Args["paths"])
	}
	if call.Args["selector"] != "input[type=file]" || call.Args["pierce"] != true {
		t.Fatalf("目标没带上：%#v", call.Args)
	}

	// target 可选：不传就让 App 找第一个 file input。
	if err := page.Upload(ctx, []string{"c.txt"}); err != nil {
		t.Fatalf("无目标 Upload 失败：%v", err)
	}
	call = lastRecordedCall(t, fake)
	if _, ok := call.Args["selector"]; ok {
		t.Fatalf("无目标时不该带 selector：%#v", call.Args)
	}
	if _, ok := call.Args["xpath"]; ok {
		t.Fatalf("无目标时不该带 xpath：%#v", call.Args)
	}

	// xpath 目标同样能表达，且不该混进 selector。
	if err := page.Upload(ctx, []string{"c2.txt"}, page.XPath("//input[@type='file']")); err != nil {
		t.Fatalf("xpath Upload 失败：%v", err)
	}
	call = lastRecordedCall(t, fake)
	if call.Args["xpath"] != "//input[@type='file']" {
		t.Fatalf("xpath 目标没带上：%#v", call.Args)
	}
	if _, ok := call.Args["selector"]; ok {
		t.Fatalf("xpath 目标不该带 selector：%#v", call.Args)
	}

	// nil 切片要发成 []，不是 JSON null，否则 App 的数组校验会拒绝。
	if err := page.Upload(ctx, nil); err != nil {
		t.Fatalf("nil paths 失败：%v", err)
	}
	call = lastRecordedCall(t, fake)
	if got, ok := call.Args["paths"].([]any); !ok || len(got) != 0 {
		t.Fatalf("nil paths 应该发空数组：%#v", call.Args["paths"])
	}

	// 表达不了的定位器别静默落到第一个输入框上。
	before := len(fake.recorded())
	err := page.Upload(ctx, []string{"d.txt"}, page.GetByText("选择文件"))
	if err == nil || !IsNotFoundError(err) {
		t.Fatalf("text 目标应该报 not_found，收到 %v", err)
	}
	if len(fake.recorded()) != before {
		t.Fatal("表达不了的目标不该发请求")
	}
}

func TestPageOverlays(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_overlay": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				if args["action"] == "dismiss" {
					return map[string]any{"ok": true, "dismissed": 2}, nil
				}
				return map[string]any{"ok": true, "overlays": []map[string]any{
					{"kind": "iframe", "selector": "iframe.ad"},
					{"kind": "mask", "selector": ".cookie-mask"},
				}}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	overlays, err := page.Overlays(ctx)
	if err != nil {
		t.Fatalf("Overlays 失败：%v", err)
	}
	if len(overlays) != 2 || overlays[0]["selector"] != "iframe.ad" {
		t.Fatalf("overlays 不对：%#v", overlays)
	}
	listCall := lastRecordedCall(t, fake)
	if listCall.Name != "page_overlay" || listCall.Args["action"] != "list" {
		t.Fatalf("overlay list 参数不对：%#v", listCall)
	}

	data, err := page.DismissOverlays(ctx)
	if err != nil {
		t.Fatalf("DismissOverlays 失败：%v", err)
	}
	dismissCall := lastRecordedCall(t, fake)
	if dismissCall.Args["action"] != "dismiss" {
		t.Fatalf("overlay dismiss 参数不对：%#v", dismissCall)
	}
	if intOf(t, data["dismissed"]) != 2 {
		t.Fatalf("dismiss 载荷丢了：%#v", data)
	}
}

func TestPageFind(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_find": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "matches": 3, "active": 1}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	data, err := page.Find(ctx, "登录")
	if err != nil {
		t.Fatalf("Find 失败：%v", err)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_find" || call.Args["text"] != "登录" {
		t.Fatalf("page_find 参数不对：%#v", call)
	}
	if call.Args["forward"] != true {
		t.Fatalf("forward 默认应该向下：%#v", call.Args)
	}
	if _, ok := call.Args["findNext"]; ok {
		t.Fatalf("默认不该跳下一个：%#v", call.Args)
	}
	if intOf(t, data["matches"]) != 3 || intOf(t, data["active"]) != 1 {
		t.Fatalf("匹配数不对：%#v", data)
	}

	if _, err := page.Find(ctx, "登录", WithFindForward(false), WithFindNext()); err != nil {
		t.Fatalf("Find 选项失败：%v", err)
	}
	call = lastRecordedCall(t, fake)
	if call.Args["forward"] != false || call.Args["findNext"] != true {
		t.Fatalf("forward / findNext 不对：%#v", call.Args)
	}

	if err := page.FindStop(ctx); err != nil {
		t.Fatalf("FindStop 失败：%v", err)
	}
	stopCall := lastRecordedCall(t, fake)
	if stopCall.Name != "page_find" || stopCall.Args["stop"] != true {
		t.Fatalf("page_find stop 参数不对：%#v", stopCall)
	}
	if _, ok := stopCall.Args["text"]; ok {
		t.Fatalf("stop 不该带 text：%#v", stopCall.Args)
	}
}

func TestPageInspect(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_inspect": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "kind": "video", "tag": "video"}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	data, err := page.Inspect(ctx, page.XPath("//video").Pierce())
	if err != nil {
		t.Fatalf("Inspect 失败：%v", err)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_inspect" || call.Args["xpath"] != "//video" || call.Args["pierce"] != true {
		t.Fatalf("page_inspect 参数不对：%#v", call)
	}
	if data["kind"] != "video" {
		t.Fatalf("识别结果丢了：%#v", data)
	}

	if _, err := page.InspectAt(ctx, 120, 340); err != nil {
		t.Fatalf("InspectAt 失败：%v", err)
	}
	pointCall := lastRecordedCall(t, fake)
	if numberOf(t, pointCall.Args, "x") != 120 || numberOf(t, pointCall.Args, "y") != 340 {
		t.Fatalf("坐标不对：%#v", pointCall.Args)
	}
	if _, ok := pointCall.Args["selector"]; ok {
		t.Fatalf("按坐标不该带 selector：%#v", pointCall.Args)
	}

	before := len(fake.recorded())
	if _, err := page.Inspect(ctx); err == nil {
		t.Fatal("没有目标时应该报错，而不是随便查一个元素")
	}
	if _, err := page.Inspect(ctx, page.GetByText("视频")); err == nil || !IsNotFoundError(err) {
		t.Fatalf("text 目标应该报 not_found，收到 %v", err)
	}
	if len(fake.recorded()) != before {
		t.Fatal("参数不成立时不该发请求")
	}
}

func TestPageWatch(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"page_watch": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "changed": false, "before": `{"text":"旧价格"}`}, nil
			},
		},
	})
	page := newTestPage(fake)
	ctx := context.Background()

	data, err := page.Watch(ctx, "#price")
	if err != nil {
		t.Fatalf("Watch 失败：%v", err)
	}
	call := lastRecordedCall(t, fake)
	if call.Name != "page_watch" || call.Args["selector"] != "#price" {
		t.Fatalf("page_watch 参数不对：%#v", call)
	}
	if numberOf(t, call.Args, "timeout") != 30 || numberOf(t, call.Args, "interval") != 0.5 {
		t.Fatalf("默认 timeout / interval 不对：%#v", call.Args)
	}
	if data["changed"] != false {
		t.Fatalf("超时应该是 changed=false：%#v", data)
	}

	if _, err := page.Watch(ctx, page.Locator("#price").Pierce(),
		WithWatchTimeout(5*time.Second), WithWatchInterval(time.Second)); err != nil {
		t.Fatalf("Watch 选项失败：%v", err)
	}
	call = lastRecordedCall(t, fake)
	if call.Args["pierce"] != true {
		t.Fatalf("pierce 丢了：%#v", call.Args)
	}
	if numberOf(t, call.Args, "timeout") != 5 || numberOf(t, call.Args, "interval") != 1 {
		t.Fatalf("timeout / interval 不对：%#v", call.Args)
	}

	before := len(fake.recorded())
	if _, err := page.Watch(ctx, page.GetByText("价格")); err == nil || !IsNotFoundError(err) {
		t.Fatalf("text 目标应该报 not_found，收到 %v", err)
	}
	if len(fake.recorded()) != before {
		t.Fatal("表达不了的目标不该发请求")
	}
}

func TestPageLockUnlockHandoff(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)
	ctx := context.Background()

	if err := page.Lock(ctx); err != nil {
		t.Fatalf("Lock 失败：%v", err)
	}
	lockCall := lastRecordedCall(t, fake)
	if lockCall.Name != "page_lock" || lockCall.Args["tabId"] != "tab-test" {
		t.Fatalf("page_lock 参数不对：%#v", lockCall)
	}
	if len(lockCall.Args) != 1 {
		t.Fatalf("page_lock 只该带 tabId：%#v", lockCall.Args)
	}

	if err := page.Unlock(ctx); err != nil {
		t.Fatalf("Unlock 失败：%v", err)
	}
	unlockCall := lastRecordedCall(t, fake)
	if unlockCall.Name != "page_unlock" || unlockCall.Args["tabId"] != "tab-test" {
		t.Fatalf("page_unlock 参数不对：%#v", unlockCall)
	}

	if err := page.Handoff(ctx, "请完成验证码"); err != nil {
		t.Fatalf("Handoff 失败：%v", err)
	}
	handoffCall := lastRecordedCall(t, fake)
	if handoffCall.Name != "page_handoff" || handoffCall.Args["message"] != "请完成验证码" {
		t.Fatalf("page_handoff 参数不对：%#v", handoffCall)
	}

	if err := page.Handoff(ctx, ""); err != nil {
		t.Fatalf("空 message Handoff 失败：%v", err)
	}
	emptyCall := lastRecordedCall(t, fake)
	if value, ok := emptyCall.Args["message"]; !ok || value != "" {
		t.Fatalf("message 是必填字段，空串也要发：%#v", emptyCall.Args)
	}
}

func TestBrowserSessions(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"session_list": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "sessions": []map[string]any{{
					"env": "env-work", "activeUrl": "https://example.com",
				}}}, nil
			},
			"session_save": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "env": args["env"], "tabs": 3}, nil
			},
			"session_restore": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "env": args["env"], "opened": 2}, nil
			},
			"session_clear": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "env": args["env"], "cleared": true}, nil
			},
		},
	})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()
	ctx := context.Background()

	sessions, err := bp.Sessions(ctx, "env-work")
	if err != nil {
		t.Fatalf("Sessions 失败：%v", err)
	}
	if len(sessions) != 1 || sessions[0]["env"] != "env-work" {
		t.Fatalf("sessions 不对：%#v", sessions)
	}
	listCall := lastRecordedCall(t, fake)
	if listCall.Name != "session_list" || listCall.Args["env"] != "env-work" {
		t.Fatalf("session_list 参数不对：%#v", listCall)
	}
	if _, ok := listCall.Args["tabId"]; ok {
		t.Fatalf("session 工具不认 tabId：%#v", listCall.Args)
	}

	saved, err := bp.SaveSession(ctx, "env-work")
	if err != nil {
		t.Fatalf("SaveSession 失败：%v", err)
	}
	if intOf(t, saved["tabs"]) != 3 {
		t.Fatalf("SaveSession 载荷丢了：%#v", saved)
	}
	if call := lastRecordedCall(t, fake); call.Name != "session_save" || call.Args["env"] != "env-work" {
		t.Fatalf("session_save 参数不对：%#v", call)
	}

	restored, err := bp.RestoreSession(ctx, "env-work")
	if err != nil {
		t.Fatalf("RestoreSession 失败：%v", err)
	}
	if intOf(t, restored["opened"]) != 2 {
		t.Fatalf("RestoreSession 载荷丢了：%#v", restored)
	}
	if call := lastRecordedCall(t, fake); call.Name != "session_restore" || call.Args["env"] != "env-work" {
		t.Fatalf("session_restore 参数不对：%#v", call)
	}

	cleared, err := bp.ClearSession(ctx, "env-work")
	if err != nil {
		t.Fatalf("ClearSession 失败：%v", err)
	}
	if cleared["cleared"] != true {
		t.Fatalf("ClearSession 载荷丢了：%#v", cleared)
	}
	if call := lastRecordedCall(t, fake); call.Name != "session_clear" || call.Args["env"] != "env-work" {
		t.Fatalf("session_clear 参数不对：%#v", call)
	}

	// env 为空时不发空串，让 App 用自己的默认环境。
	if _, err := bp.Sessions(ctx, ""); err != nil {
		t.Fatalf("Sessions 空 env 失败：%v", err)
	}
	if call := lastRecordedCall(t, fake); call.Args["env"] != nil {
		t.Fatalf("空 env 不该发：%#v", call.Args)
	}
}

func TestBrowserClipboard(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"clipboard_read": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "text": "来自剪贴板"}, nil
			},
			"clipboard_write": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "length": 2}, nil
			},
		},
	})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()
	ctx := context.Background()

	text, err := bp.ClipboardRead(ctx)
	if err != nil {
		t.Fatalf("ClipboardRead 失败：%v", err)
	}
	if text != "来自剪贴板" {
		t.Fatalf("剪贴板文本不对：%q", text)
	}
	readCall := lastRecordedCall(t, fake)
	if readCall.Name != "clipboard_read" {
		t.Fatalf("clipboard_read 工具名不对：%#v", readCall)
	}
	if _, ok := readCall.Args["tabId"]; ok {
		t.Fatalf("剪贴板工具不认 tabId：%#v", readCall.Args)
	}

	data, err := bp.ClipboardWrite(ctx, "秘密")
	if err != nil {
		t.Fatalf("ClipboardWrite 失败：%v", err)
	}
	writeCall := lastRecordedCall(t, fake)
	if writeCall.Name != "clipboard_write" || writeCall.Args["text"] != "秘密" {
		t.Fatalf("clipboard_write 参数不对：%#v", writeCall)
	}
	if intOf(t, data["length"]) != 2 {
		t.Fatalf("clipboard_write 载荷丢了：%#v", data)
	}
}

func TestBrowserPermissionsAndPasswords(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"permission_list": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "permissions": []map[string]any{{
					"id": "perm-1", "permission": "camera", "decision": "allow",
				}}}, nil
			},
			"password_list": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "passwords": []map[string]any{{
					"origin": "https://example.com", "username": "小明",
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

	permissions, err := bp.Permissions(ctx, "env-work")
	if err != nil {
		t.Fatalf("Permissions 失败：%v", err)
	}
	if len(permissions) != 1 || permissions[0]["permission"] != "camera" {
		t.Fatalf("permissions 不对：%#v", permissions)
	}
	permissionCall := lastRecordedCall(t, fake)
	if permissionCall.Name != "permission_list" || permissionCall.Args["env"] != "env-work" {
		t.Fatalf("permission_list 参数不对：%#v", permissionCall)
	}
	if _, ok := permissionCall.Args["tabId"]; ok {
		t.Fatalf("permission 工具不认 tabId：%#v", permissionCall.Args)
	}

	passwords, err := bp.Passwords(ctx, "env-work")
	if err != nil {
		t.Fatalf("Passwords 失败：%v", err)
	}
	if len(passwords) != 1 || passwords[0]["username"] != "小明" {
		t.Fatalf("passwords 不对：%#v", passwords)
	}
	passwordCall := lastRecordedCall(t, fake)
	if passwordCall.Name != "password_list" || passwordCall.Args["env"] != "env-work" {
		t.Fatalf("password_list 参数不对：%#v", passwordCall)
	}
	if _, ok := passwordCall.Args["tabId"]; ok {
		t.Fatalf("password 工具不认 tabId：%#v", passwordCall.Args)
	}
}

func TestBrowserPermissionsListFallback(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{
		Handlers: map[string]fakeHandler{
			"permission_list": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "list": []map[string]any{{"permission": "microphone"}}}, nil
			},
			"password_list": func(map[string]any, []fakeCall) (map[string]any, error) {
				return map[string]any{"ok": true, "list": []map[string]any{{"username": "old"}}}, nil
			},
		},
	})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()
	ctx := context.Background()

	permissions, err := bp.Permissions(ctx, "env-default")
	if err != nil {
		t.Fatalf("Permissions 失败：%v", err)
	}
	if len(permissions) != 1 || permissions[0]["permission"] != "microphone" {
		t.Fatalf("没有兼容 list 字段：%#v", permissions)
	}

	passwords, err := bp.Passwords(ctx, "env-default")
	if err != nil {
		t.Fatalf("Passwords 失败：%v", err)
	}
	if len(passwords) != 1 || passwords[0]["username"] != "old" {
		t.Fatalf("没有兼容 list 字段：%#v", passwords)
	}
}
