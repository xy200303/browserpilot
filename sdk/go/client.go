// Package browserpilot 用 Playwright 的样子驱动 BrowserPilot 桌面浏览器。
//
// SDK 不自带浏览器引擎，它连的是本机那扇 BrowserPilot 窗口：登录态、书签、密码都还在，
// Agent 和脚本操作的是同一套 cookie。隔离单位是「环境」（env-），不是进程。
//
//	bp, err := browserpilot.Launch(ctx)
//	if err != nil {
//		log.Fatal(err)
//	}
//	defer bp.Close()
//
//	page, err := bp.NewPage(ctx, "")
//	if err != nil {
//		log.Fatal(err)
//	}
//	if err := page.Goto(ctx, "https://example.com"); err != nil {
//		log.Fatal(err)
//	}
//	if err := page.GetByRole("button", browserpilot.Name("登录")).Click(ctx); err != nil {
//		log.Fatal(err)
//	}
package browserpilot

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"
)

// DefaultEnv 是默认环境，登录态就在里面。
const DefaultEnv = "env-default"

type launchOptions struct {
	env           string
	headless      *bool
	timeout       time.Duration
	exe           string
	version       string
	endpoint      *Endpoint
	offline       bool
	strictVersion bool
	onDownload    func(Progress)
	log           func(string)
}

// Option 配置 Launch / Connect。和时间有关的选项一律用 time.Duration。
type Option func(*launchOptions)

// WithEnv 指定用哪套环境。默认 env-default。
func WithEnv(id string) Option {
	return func(options *launchOptions) { options.env = id }
}

// WithHeadless 把窗口切成无头（窗口仍然存在，只是不显示）。
func WithHeadless(headless bool) Option {
	return func(options *launchOptions) { options.headless = &headless }
}

// WithTimeout 设等 App 起来的时长，默认 60 秒。第一次下载不占这个时间。
func WithTimeout(timeout time.Duration) Option {
	return func(options *launchOptions) { options.timeout = timeout }
}

// WithExe 显式指定 App 可执行文件，优先于 BROWSERPILOT_EXE。
func WithExe(path string) Option {
	return func(options *launchOptions) { options.exe = path }
}

// WithVersion 指定要装的 App 版本，默认跟 SDK 同号。
func WithVersion(version string) Option {
	return func(options *launchOptions) { options.version = version }
}

// WithEndpoint 直接连一个已知端点，跳过发现流程，也不启动任何进程。
func WithEndpoint(endpoint Endpoint) Option {
	return func(options *launchOptions) { options.endpoint = &endpoint }
}

// WithOffline 只找不下载。
func WithOffline(offline bool) Option {
	return func(options *launchOptions) { options.offline = offline }
}

// WithStrictVersion 在已装版本和 SDK 对不上时报错而不是警告。
func WithStrictVersion(strict bool) Option {
	return func(options *launchOptions) { options.strictVersion = strict }
}

// WithDownloadProgress 收下载进度。
func WithDownloadProgress(onProgress func(Progress)) Option {
	return func(options *launchOptions) { options.onDownload = onProgress }
}

// WithLogger 收过程日志。「连上实例」「下载 xx」这类信息都从这里出去。
func WithLogger(log func(string)) Option {
	return func(options *launchOptions) { options.log = log }
}

func newLaunchOptions(opts []Option) *launchOptions {
	options := &launchOptions{env: DefaultEnv, timeout: 60 * time.Second}
	for _, apply := range opts {
		if apply != nil {
			apply(options)
		}
	}
	if options.timeout <= 0 {
		options.timeout = 60 * time.Second
	}
	if options.log == nil && OSEnv()("BROWSERPILOT_DEBUG") != "" {
		options.log = func(message string) {
			_, _ = fmt.Fprintln(os.Stderr, "[browserpilot] "+message)
		}
	}
	return options
}

func (o *launchOptions) logf() func(string) {
	if o.log == nil {
		return func(string) {}
	}
	return o.log
}

// Environment 是一套 cookie / 登录态，Playwright 的 browser context 对应它。
// 不带窗口；窗口由 Open 打开。
type Environment struct {
	client *BrowserPilot
	id     string
}

// ID 是 env- 开头的环境标识。
func (e *Environment) ID() string { return e.id }

// Open 打开这套环境的窗口。已经开着就按这次的显示方式切换。
func (e *Environment) Open(ctx context.Context, headless bool) error {
	_, err := e.client.Call(ctx, "env_open", map[string]any{"env": e.id, "headless": headless})
	return err
}

// Close 关窗但保留登录态。
func (e *Environment) Close(ctx context.Context) error {
	_, err := e.client.Call(ctx, "env_close", map[string]any{"env": e.id})
	return err
}

// NewPage 在这套环境里开一个新标签。
func (e *Environment) NewPage(ctx context.Context, url string) (*Page, error) {
	data, err := e.client.Call(ctx, "tab_open", map[string]any{"env": e.id, "url": url})
	if err != nil {
		return nil, err
	}
	return NewPage(e.client.transport, stringField(data, "tabId"), e.id), nil
}

// Pages 列出这套环境里的标签。
func (e *Environment) Pages(ctx context.Context) ([]*Page, error) {
	pages, err := e.client.Pages(ctx)
	if err != nil {
		return nil, err
	}
	own := make([]*Page, 0, len(pages))
	for _, page := range pages {
		if page.env == e.id {
			own = append(own, page)
		}
	}
	return own, nil
}

// EnvironmentInfo 是 env_list 里的一项。
type EnvironmentInfo struct {
	// ID 是 env- 开头的标识。
	ID string `json:"id"`
	// Name 是用户起的名字。
	Name string `json:"name"`
	// Remark 是备注。
	Remark string `json:"remark"`
	// WindowOpen 表示这套环境的窗口现在开着。
	WindowOpen bool `json:"windowOpen"`
	// Headless 表示窗口是无头的。
	Headless bool `json:"headless"`
}

// owned 记着 SDK 自己开了哪些环境：Close 只收拾这些。
type owned struct {
	mu   sync.Mutex
	envs map[string]struct{}
}

func (o *owned) add(env string) {
	o.mu.Lock()
	o.envs[env] = struct{}{}
	o.mu.Unlock()
}

func (o *owned) list() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	envs := make([]string, 0, len(o.envs))
	for env := range o.envs {
		envs = append(envs, env)
	}
	return envs
}

// BrowserPilot 是一个可用的 App 连接。它要么连的是一个已经在跑的实例，
// 要么是 SDK 自己拉起来的那份；后者闭包时只关自己开的环境。
type BrowserPilot struct {
	transport  *Transport
	envID      string
	appVersion string
	owned      *owned
}

// EnvID 返回默认环境。
func (bp *BrowserPilot) EnvID() string { return bp.envID }

// SDKVersion 返回本 SDK 的版本。
func (bp *BrowserPilot) SDKVersion() string { return SDKVersion }

// AppVersion 返回 App 版本。只有 SDK 自己装的那份才知道；连别人实例时是空串。
func (bp *BrowserPilot) AppVersion() string { return bp.appVersion }

// Transport 返回底层传输层，需要自己拼请求时用。
func (bp *BrowserPilot) Transport() *Transport { return bp.transport }

// Owned 表示这份 App 是不是 SDK 自己拉起来的。
// 是的话 Close 会关掉自己开的环境；连别人实例时什么也不做。
func (bp *BrowserPilot) Owned() bool { return bp.owned != nil }

// Call 是原始工具调用入口，参数原样透传，SDK 没封装的工具都从这里走。
func (bp *BrowserPilot) Call(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	result, err := bp.transport.Call(ctx, tool, args)
	if err != nil {
		return nil, err
	}
	return result.Data, nil
}

// NewPage 在默认环境里开一个新标签。url 传空串就是新标签页。
func (bp *BrowserPilot) NewPage(ctx context.Context, url string) (*Page, error) {
	return bp.newPageIn(ctx, bp.envID, url)
}

func (bp *BrowserPilot) newPageIn(ctx context.Context, env, url string) (*Page, error) {
	if bp.owned != nil {
		bp.owned.add(env)
	}
	data, err := bp.Call(ctx, "tab_open", map[string]any{"env": env, "url": url})
	if err != nil {
		return nil, err
	}
	return NewPage(bp.transport, stringField(data, "tabId"), env), nil
}

// Pages 列出所有标签，跨环境。
func (bp *BrowserPilot) Pages(ctx context.Context) ([]*Page, error) {
	data, err := bp.Call(ctx, "tab_list", nil)
	if err != nil {
		return nil, err
	}
	tabs := mapList(data["tabs"])
	pages := make([]*Page, 0, len(tabs))
	for _, tab := range tabs {
		pages = append(pages, NewPage(bp.transport, stringField(tab, "id"), stringField(tab, "envId")))
	}
	return pages, nil
}

// Environments 列出本机所有环境。
func (bp *BrowserPilot) Environments(ctx context.Context) ([]EnvironmentInfo, error) {
	data, err := bp.Call(ctx, "env_list", nil)
	if err != nil {
		return nil, err
	}
	envs := mapList(data["envs"])
	infos := make([]EnvironmentInfo, 0, len(envs))
	for _, env := range envs {
		windowOpen, _ := env["windowOpen"].(bool)
		headless, _ := env["headless"].(bool)
		infos = append(infos, EnvironmentInfo{
			ID:         stringField(env, "id"),
			Name:       stringField(env, "name"),
			Remark:     stringField(env, "remark"),
			WindowOpen: windowOpen,
			Headless:   headless,
		})
	}
	return infos, nil
}

// Environment 拿到一套环境的句柄，不需要它已经开窗。
func (bp *BrowserPilot) Environment(id string) *Environment {
	return &Environment{client: bp, id: id}
}

// Close 收拾自己开的东西，然后断开连接。
//
// App 是用户日常在用的浏览器：连的是别人的实例时什么都不做，
// 只有 SDK 自己拉起来的那份才关窗口（关完最后一个窗口 App 自己退出）。
// Subscription 是一份事件订阅。从 C 里读，不用了调 Close。
type Subscription struct {
	C    <-chan EventRecord
	stop context.CancelFunc
}

// Close 结束订阅并关闭 C。
func (s *Subscription) Close() {
	if s.stop != nil {
		s.stop()
	}
}

// Subscribe 订阅事件。ctx 取消或调用 Close 结束。
//
// 内部是长轮询循环，自动带 seq 续传；遇到位置失效（reset）会从当前位置继续。
func (bp *BrowserPilot) Subscribe(ctx context.Context, opts EventWaitOptions) *Subscription {
	runCtx, cancel := context.WithCancel(ctx)
	events := make(chan EventRecord, 64)
	go func() {
		defer close(events)
		since := opts.Since
		for {
			if runCtx.Err() != nil {
				return
			}
			result, err := bp.transport.WaitEvents(runCtx, EventWaitOptions{
				Since: since,
				Types: opts.Types,
				Env:   opts.Env,
				TabID: opts.TabID,
				Wait:  opts.Wait,
				Limit: opts.Limit,
			})
			if err != nil {
				return
			}
			seq := result.Seq
			since = &seq
			for _, event := range result.Events {
				select {
				case events <- event:
				case <-runCtx.Done():
					return
				}
			}
		}
	}()
	return &Subscription{C: events, stop: cancel}
}

func (bp *BrowserPilot) Close() error {
	if bp.owned != nil {
		for _, env := range bp.owned.list() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_, _ = bp.transport.Call(ctx, "env_close", map[string]any{"env": env})
			cancel()
		}
	}
	return bp.transport.Close()
}

// Connect 连上一个已经跑着的 BrowserPilot，不启动任何进程。
// 没有实例时返回 TransportError，适合「必须用用户当前这扇窗口」的场景。
func Connect(ctx context.Context, opts ...Option) (*BrowserPilot, error) {
	options := newLaunchOptions(opts)

	endpoint := Endpoint{}
	if options.endpoint != nil {
		endpoint = *options.endpoint
	} else {
		saved, err := ReadEndpoint("")
		if err != nil {
			return nil, err
		}
		endpoint = saved
	}

	transport := NewTransport(endpoint)
	if !transport.Ping(ctx) {
		return nil, newTransportError(endpoint.URL + " 没有响应。BrowserPilot 可能已经关了。")
	}
	return &BrowserPilot{transport: transport, envID: options.env}, nil
}

// Launch 拿到一个可用的 BrowserPilot：
// 已经在跑就连上去，没跑就找到装好的那份拉起来，一份都找不到才下载。
func Launch(ctx context.Context, opts ...Option) (*BrowserPilot, error) {
	options := newLaunchOptions(opts)
	logf := options.logf()

	// 0. 给了端点就直接用，不发现也不启动。
	if options.endpoint != nil {
		return connectEndpoint(ctx, *options.endpoint, options)
	}

	// 1. 已经有一个实例在跑：直接连，绝不拉起第二个（单实例锁会让它自己退出）。
	if options.exe == "" {
		if running := runningEndpoint(ctx); running != nil {
			logf("连上已经在跑的实例 " + running.URL)
			return connectEndpoint(ctx, *running, options)
		}
	}

	// 2. 找一份能用的，必要时下载。
	app, err := LocateApp(EnsureOptions{Exe: options.exe, Version: options.version})
	if err != nil {
		return nil, err
	}
	if app == nil {
		app, err = EnsureApp(ctx, EnsureOptions{
			Exe:        options.exe,
			Version:    options.version,
			Offline:    options.offline,
			OnDownload: options.onDownload,
			Log:        options.log,
		})
		if err != nil {
			return nil, err
		}
	}

	strictVersion := options.strictVersion || OSEnv()("BROWSERPILOT_STRICT_VERSION") == "1"
	if strictVersion && app.Version != "" && app.Version != APPVersion {
		return nil, newInstallError(fmt.Sprintf(
			"SDK 对应 v%s，本机装的是 v%s（BROWSERPILOT_STRICT_VERSION 生效）", APPVersion, app.Version))
	}
	if app.Source == SourceDownloaded {
		logf(fmt.Sprintf("装了 v%s 到 %s", app.Version, app.Exe))
	} else {
		logf("用已有的 " + app.Exe)
	}

	// 3. 拉起来并等它就绪。
	if err := spawnApp(app.Exe); err != nil {
		return nil, err
	}
	endpoint, err := waitForEndpoint(ctx, options.timeout, logf)
	if err != nil {
		return nil, err
	}
	transport := NewTransport(endpoint)
	if options.headless != nil {
		if err := applyHeadless(ctx, transport, options.env, *options.headless); err != nil {
			return nil, err
		}
	}

	ownedEnvs := &owned{envs: map[string]struct{}{options.env: {}}}
	return &BrowserPilot{
		transport:  transport,
		envID:      options.env,
		appVersion: app.Version,
		owned:      ownedEnvs,
	}, nil
}

func connectEndpoint(ctx context.Context, endpoint Endpoint, options *launchOptions) (*BrowserPilot, error) {
	transport := NewTransport(endpoint)
	if !transport.Ping(ctx) {
		return nil, newTransportError(endpoint.URL + " 没有响应")
	}
	if options.headless != nil {
		if err := applyHeadless(ctx, transport, options.env, *options.headless); err != nil {
			return nil, err
		}
	}
	return &BrowserPilot{transport: transport, envID: options.env}, nil
}

func applyHeadless(ctx context.Context, transport *Transport, env string, headless bool) error {
	// headless=false 时不主动开窗：那会把用户正在用的窗口拉到前台。
	if !headless {
		return nil
	}
	_, err := transport.Call(ctx, "env_open", map[string]any{"env": env, "headless": true})
	return err
}

func runningEndpoint(ctx context.Context) *Endpoint {
	endpoint, err := ReadEndpoint("")
	if err != nil {
		return nil
	}
	if !NewTransport(endpoint).Ping(ctx) {
		return nil
	}
	return &endpoint
}

// spawnApp 把 App 拉起来。进程要独立于脚本：脚本崩了不能把用户日常在用的浏览器带走。
// Stdio 留空就是接 /dev/null，子进程也不会占住父进程的终端。
func spawnApp(exe string) error {
	command := exec.Command(exe)
	if err := command.Start(); err != nil {
		return newInstallError("拉不起来 "+exe, err)
	}
	return command.Process.Release()
}

func waitForEndpoint(ctx context.Context, timeout time.Duration, logf func(string)) (Endpoint, error) {
	deadline := time.Now().Add(timeout)
	file := MCPFilePath()
	announced := false
	for {
		if endpoint, err := ReadEndpoint(file); err == nil {
			if NewTransport(endpoint).Ping(ctx) {
				return endpoint, nil
			}
		}
		if time.Now().After(deadline) {
			return Endpoint{}, newInstallError(fmt.Sprintf(
				"等了 %ds，BrowserPilot 还没把 %s 写好或者端口不通。"+
					"打开 BrowserPilot 的 设置 → 通用，确认 MCP 是开着的。", int(timeout/time.Second), file))
		}
		if !announced {
			announced = true
			logf("等 BrowserPilot 起来…")
		}
		timer := time.NewTimer(300 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Endpoint{}, newTransportError("等 BrowserPilot 起来的过程中被取消："+ctx.Err().Error(), ctx.Err())
		case <-timer.C:
		}
	}
}
