package browserpilot

import (
	"context"
	"strings"
	"testing"
)

func TestLaunchWithEndpointConnectsWithoutSpawning(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	if bp.Owned() {
		t.Fatal("给端点连上的实例不是自己拉起来的，Close 不该关窗口")
	}

	page, err := bp.NewPage(context.Background(), "")
	if err != nil {
		t.Fatalf("NewPage 失败：%v", err)
	}
	if page.ID() != "tab-test" || page.Env() != DefaultEnv {
		t.Fatalf("页面信息不对：%s %s", page.ID(), page.Env())
	}
	calls := fake.recorded()
	if len(calls) != 1 || calls[0].Name != "tab_open" {
		t.Fatalf("调用记录不对：%#v", calls)
	}
	if url, ok := calls[0].Args["url"]; !ok || url != "" {
		t.Fatalf("空 url 也要发：%#v", calls[0].Args)
	}

	if err := bp.Close(); err != nil {
		t.Fatalf("Close 失败：%v", err)
	}
	for _, call := range fake.recorded() {
		if call.Name == "env_close" {
			t.Fatal("连别人的实例时不该关任何窗口")
		}
	}
}

func TestLaunchWithEnvAndHeadless(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(),
		WithEndpoint(fake.endpoint()),
		WithEnv("env-default"),
		WithHeadless(true),
	)
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	calls := fake.recorded()
	if len(calls) == 0 || calls[0].Name != "env_open" {
		t.Fatalf("headless 应该先开环境：%#v", calls)
	}
	if calls[0].Args["env"] != "env-default" || calls[0].Args["headless"] != true {
		t.Fatalf("env_open 参数不对：%#v", calls[0].Args)
	}
}

func TestHeadlessFalseDoesNotOpenWindow(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()), WithHeadless(false))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()
	for _, call := range fake.recorded() {
		if call.Name == "env_open" {
			t.Fatal("headless=false 时不该主动开窗，那会把用户的窗口拉到前台")
		}
	}
}

func TestLaunchWithCustomEnv(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()), WithEnv("env-work"))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	if bp.EnvID() != "env-work" {
		t.Fatalf("环境不对：%s", bp.EnvID())
	}
	if _, err := bp.NewPage(context.Background(), "https://example.com"); err != nil {
		t.Fatalf("NewPage 失败：%v", err)
	}
	args := fake.recorded()[0].Args
	if args["env"] != "env-work" || args["url"] != "https://example.com" {
		t.Fatalf("tab_open 参数不对：%#v", args)
	}
}

func TestConnectWithEndpoint(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Connect(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Connect 失败：%v", err)
	}
	defer bp.Close()

	if bp.Owned() {
		t.Fatal("Connect 永远不是自己拉起来的")
	}
	if bp.AppVersion() != "" {
		t.Fatalf("连别人实例时不该猜版本：%q", bp.AppVersion())
	}
	if bp.SDKVersion() != SDKVersion {
		t.Fatalf("SDK 版本不对：%s", bp.SDKVersion())
	}
	if bp.EnvID() != DefaultEnv {
		t.Fatalf("默认环境不对：%s", bp.EnvID())
	}
}

func TestConnectWithoutLiveEndpoint(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	dead := Endpoint{URL: fake.endpoint().URL, Token: "wrong"}
	_, err := Connect(context.Background(), WithEndpoint(dead))
	if !IsTransportError(err) {
		t.Fatalf("期望传输错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "没有响应") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}

func TestPagesAndEnvironments(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	pages, err := bp.Pages(context.Background())
	if err != nil || len(pages) != 1 {
		t.Fatalf("Pages 不对：%#v %v", pages, err)
	}
	if pages[0].ID() != "tab-test" || pages[0].Env() != "env-default" {
		t.Fatalf("页面字段不对：%s %s", pages[0].ID(), pages[0].Env())
	}

	envs, err := bp.Environments(context.Background())
	if err != nil || len(envs) != 1 {
		t.Fatalf("Environments 不对：%#v %v", envs, err)
	}
	if envs[0].ID != "env-default" || !envs[0].WindowOpen {
		t.Fatalf("环境字段不对：%#v", envs[0])
	}
}

func TestEnvironmentHandle(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	env := bp.Environment("env-a")
	if env.ID() != "env-a" {
		t.Fatalf("环境 ID 不对：%s", env.ID())
	}
	ctx := context.Background()
	if err := env.Open(ctx, true); err != nil {
		t.Fatalf("Open 失败：%v", err)
	}
	page, err := env.NewPage(ctx, "https://example.com")
	if err != nil {
		t.Fatalf("NewPage 失败：%v", err)
	}
	if page.Env() != "env-a" {
		t.Fatalf("页面环境不对：%s", page.Env())
	}
	if err := env.Close(ctx); err != nil {
		t.Fatalf("Close 失败：%v", err)
	}

	calls := fake.recorded()
	names := []string{"env_open", "tab_open", "env_close"}
	if len(calls) != len(names) {
		t.Fatalf("调用数不对：%#v", calls)
	}
	for index, name := range names {
		if calls[index].Name != name {
			t.Fatalf("第 %d 个应该是 %s，实际 %s", index, name, calls[index].Name)
		}
		if calls[index].Args["env"] != "env-a" {
			t.Fatalf("%s 的 env 不对：%#v", name, calls[index].Args)
		}
	}
}

func TestRawCallPassesThrough(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	defer bp.Close()

	data, err := bp.Call(context.Background(), "page_scroll", map[string]any{"tabId": "tab-test", "direction": "up"})
	if err != nil {
		t.Fatalf("Call 失败：%v", err)
	}
	if data["ok"] != true {
		t.Fatalf("载荷不对：%#v", data)
	}
	calls := fake.recorded()
	if len(calls) != 1 {
		t.Fatalf("期望 1 次调用，实际 %d", len(calls))
	}
	if calls[0].Name != "page_scroll" {
		t.Fatalf("工具名不对：%s", calls[0].Name)
	}
	if !equalArgs(calls[0].Args, map[string]any{"tabId": "tab-test", "direction": "up"}) {
		t.Fatalf("原始参数被改了：%#v", calls[0].Args)
	}
}

func TestCallAfterCloseIsTransportError(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	bp, err := Launch(context.Background(), WithEndpoint(fake.endpoint()))
	if err != nil {
		t.Fatalf("Launch 失败：%v", err)
	}
	if err := bp.Close(); err != nil {
		t.Fatalf("第一次 Close 失败：%v", err)
	}
	if err := bp.Close(); err != nil {
		t.Fatalf("Close 应该可以重复调用：%v", err)
	}
	if _, err := bp.Call(context.Background(), "tab_list", nil); !IsTransportError(err) {
		t.Fatalf("关掉之后应该是传输错误，实际 %v", err)
	}
}

func TestInvalidTargetIsRejected(t *testing.T) {
	fake := startFakeServer(t, fakeServerOptions{})
	page := newTestPage(fake)

	err := page.Click(context.Background(), 42)
	if err == nil || !strings.Contains(err.Error(), "定位目标") {
		t.Fatalf("非法定位目标应该明确报错，实际 %v", err)
	}
	if len(fake.recorded()) != 0 {
		t.Fatal("非法目标不该发请求")
	}
}

func TestErrorHelpers(t *testing.T) {
	if !IsToolError(newToolError("page_click", map[string]any{"error": "坏了"})) {
		t.Fatal("工具错误没认出来")
	}
	if IsToolError(newTransportError("连不上")) {
		t.Fatal("传输错误被判成工具错误")
	}
	if !IsInstallError(AssetForError(t)) {
		t.Fatal("安装错误没认出来")
	}
	if !IsNotFoundError(newNotFoundError("没找到")) {
		t.Fatal("未找到错误没认出来")
	}
	toolError := newToolError("page_click", map[string]any{"error": "坏了", "errorShot": "/tmp/x.png"})
	if toolError.ScreenshotPath() != "/tmp/x.png" {
		t.Fatalf("现场截图路径没读出来：%s", toolError.ScreenshotPath())
	}
}

// AssetForError 借不支持的平台造一个安装错误。
func AssetForError(t *testing.T) error {
	t.Helper()
	_, err := AssetFor("0.19.0", "win32", "arm64")
	return err
}
