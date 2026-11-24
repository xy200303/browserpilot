package browserpilot

import (
	"context"
	"fmt"
)

// 按用途分组的工具入口。每个方法就是一次工具调用，参数名和工具一致，
// 返回载荷里的字段，不额外包一层。
//
//	envs, err := bp.Envs().List(ctx)
//	_, err = bp.Workflows().Run(ctx, "每日签到", map[string]any{"user": "a"})

type api struct{ bp *BrowserPilot }

func (a api) call(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	clean := make(map[string]any, len(args))
	for key, value := range args {
		if value != nil {
			clean[key] = value
		}
	}
	return a.bp.Call(ctx, tool, clean)
}

func tabString(tab any) (string, error) {
	switch typed := tab.(type) {
	case string:
		return typed, nil
	case *Page:
		return typed.id, nil
	}
	return "", fmt.Errorf("需要一个 tab id 或者 *Page")
}

// Envs 是环境（一套 cookie 和登录态，对应一扇窗口）。
type Envs struct{ api }

func (bp *BrowserPilot) Envs() Envs { return Envs{api{bp: bp}} }

func (e Envs) List(ctx context.Context) ([]map[string]any, error) {
	data, err := e.call(ctx, "env_list", nil)
	if err != nil {
		return nil, err
	}
	return mapList(data["envs"]), nil
}

// Create 新建环境并打开窗口。remark 必填：写清楚这套环境是干什么的。
func (e Envs) Create(ctx context.Context, name, remark string) (map[string]any, error) {
	return e.call(ctx, "env_create", map[string]any{"name": name, "remark": remark})
}

func (e Envs) Open(ctx context.Context, env string, headless bool) (map[string]any, error) {
	return e.call(ctx, "env_open", map[string]any{"env": env, "headless": headless})
}

// Close 关窗口，但保留登录态和标签会话。
func (e Envs) Close(ctx context.Context, env string) (map[string]any, error) {
	return e.call(ctx, "env_close", map[string]any{"env": env})
}

func (e Envs) Front(ctx context.Context, env string) (map[string]any, error) {
	return e.call(ctx, "env_front", map[string]any{"env": env})
}

func (e Envs) Update(ctx context.Context, env string, fields map[string]any) (map[string]any, error) {
	args := map[string]any{"env": env}
	for key, value := range fields {
		args[key] = value
	}
	return e.call(ctx, "env_update", args)
}

func (e Envs) Headless(ctx context.Context, env string, headless bool) (map[string]any, error) {
	return e.call(ctx, "env_headless", map[string]any{"env": env, "headless": headless})
}

// Delete 删环境 = 删目录，登录态一起没。默认环境不能删。
func (e Envs) Delete(ctx context.Context, env string) (map[string]any, error) {
	return e.call(ctx, "env_delete", map[string]any{"env": env})
}

// Export 导出 cookie，用来在别的机器上复现登录态。
func (e Envs) Export(ctx context.Context, env, path string) (map[string]any, error) {
	return e.call(ctx, "env_export", map[string]any{"env": env, "path": path})
}

func (e Envs) Import(ctx context.Context, path, env string) (map[string]any, error) {
	return e.call(ctx, "env_import", map[string]any{"path": path, "env": env})
}

// Tabs 是所有窗口里的标签。
type Tabs struct{ api }

func (bp *BrowserPilot) Tabs() Tabs { return Tabs{api{bp: bp}} }

func (t Tabs) List(ctx context.Context) ([]map[string]any, error) {
	data, err := t.call(ctx, "tab_list", nil)
	if err != nil {
		return nil, err
	}
	return mapList(data["tabs"]), nil
}

func (t Tabs) Open(ctx context.Context, env, url string) (map[string]any, error) {
	return t.call(ctx, "tab_open", map[string]any{"env": env, "url": url})
}

func (t Tabs) Close(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return t.call(ctx, "tab_close", map[string]any{"tabId": id})
}

func (t Tabs) Activate(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return t.call(ctx, "tab_activate", map[string]any{"tabId": id})
}

func (t Tabs) CloseOthers(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return t.call(ctx, "tab_close_others", map[string]any{"tabId": id})
}

// Settings 是全局设置（语言、标签布局、并发数、休眠时间等）。
type Settings struct{ api }

func (bp *BrowserPilot) Settings() Settings { return Settings{api{bp: bp}} }

func (s Settings) Get(ctx context.Context) (map[string]any, error) {
	data, err := s.call(ctx, "settings_get", nil)
	if err != nil {
		return nil, err
	}
	if settings, ok := data["settings"].(map[string]any); ok {
		return settings, nil
	}
	return map[string]any{}, nil
}

func (s Settings) Update(ctx context.Context, fields map[string]any) (map[string]any, error) {
	return s.call(ctx, "settings_set", fields)
}

// Workflows 是保存在本机的工作流。
type Workflows struct{ api }

func (bp *BrowserPilot) Workflows() Workflows { return Workflows{api{bp: bp}} }

func (w Workflows) List(ctx context.Context) ([]map[string]any, error) {
	data, err := w.call(ctx, "workflow_list", nil)
	if err != nil {
		return nil, err
	}
	return mapList(data["workflows"]), nil
}

func (w Workflows) Run(ctx context.Context, name string, inputs map[string]any) (map[string]any, error) {
	if inputs == nil {
		inputs = map[string]any{}
	}
	return w.call(ctx, "workflow_run", map[string]any{"name": name, "inputs": inputs})
}

func (w Workflows) RunBatch(ctx context.Context, name string, rows []map[string]any) (map[string]any, error) {
	return w.call(ctx, "workflow_batch", map[string]any{"name": name, "rows": rows})
}

func (w Workflows) Export(ctx context.Context, name, path string) (map[string]any, error) {
	return w.call(ctx, "workflow_export", map[string]any{"name": name, "path": path})
}

func (w Workflows) Import(ctx context.Context, path string) (map[string]any, error) {
	return w.call(ctx, "workflow_import", map[string]any{"path": path})
}

func (w Workflows) Delete(ctx context.Context, name string) (map[string]any, error) {
	return w.call(ctx, "workflow_delete", map[string]any{"name": name})
}

func (w Workflows) Write(ctx context.Context, workflow map[string]any) (map[string]any, error) {
	return w.call(ctx, "workflow_write", workflow)
}

// Record 的 action 是 start / stop / cancel；录制期间的工具调用会变成工作流节点。
func (w Workflows) Record(ctx context.Context, action string, name string) (map[string]any, error) {
	args := map[string]any{"action": action}
	if name != "" {
		args["name"] = name
	}
	return w.call(ctx, "workflow_record", args)
}

// Net 是按标签抓包，和 page.CDP 共用同一个 debugger 租约。
type Net struct{ api }

func (bp *BrowserPilot) Net() Net { return Net{api{bp: bp}} }

func (n Net) Start(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return n.call(ctx, "net_start", map[string]any{"tabId": id})
}

func (n Net) Stop(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return n.call(ctx, "net_stop", map[string]any{"tabId": id})
}

func (n Net) List(ctx context.Context, tab any, urlContains string) ([]map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	args := map[string]any{"tabId": id}
	if urlContains != "" {
		args["urlContains"] = urlContains
	}
	data, err := n.call(ctx, "net_list", args)
	if err != nil {
		return nil, err
	}
	return mapList(data["requests"]), nil
}

func (n Net) Get(ctx context.Context, reqID string) (map[string]any, error) {
	return n.call(ctx, "net_get", map[string]any{"reqId": reqID})
}

func (n Net) Export(ctx context.Context, tab any, path string) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	args := map[string]any{"tabId": id}
	if path != "" {
		args["path"] = path
	}
	return n.call(ctx, "net_export", args)
}

// Mock 拦截这个标签的请求并返回假数据；rules 的字段和 net_mock 工具一致。
func (n Net) Mock(ctx context.Context, tab any, rules []map[string]any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return n.call(ctx, "net_mock", map[string]any{"tabId": id, "rules": rules})
}

func (n Net) MockOff(ctx context.Context, tab any) (map[string]any, error) {
	id, err := tabString(tab)
	if err != nil {
		return nil, err
	}
	return n.call(ctx, "net_mock_off", map[string]any{"tabId": id})
}

// History 是每套环境自己的浏览记录。
type History struct{ api }

func (bp *BrowserPilot) History() History { return History{api{bp: bp}} }

func (h History) List(ctx context.Context, env, query string, limit int) ([]map[string]any, error) {
	args := map[string]any{"env": env}
	if query != "" {
		args["query"] = query
	}
	if limit > 0 {
		args["limit"] = limit
	}
	data, err := h.call(ctx, "history_list", args)
	if err != nil {
		return nil, err
	}
	return mapList(data["history"]), nil
}

func (h History) Remove(ctx context.Context, env string, filter map[string]any) (int, error) {
	args := map[string]any{"env": env}
	for key, value := range filter {
		args[key] = value
	}
	data, err := h.call(ctx, "history_remove", args)
	if err != nil {
		return 0, err
	}
	return toInt(data["removed"]), nil
}

// Bookmarks 是每套环境自己的书签。
type Bookmarks struct{ api }

func (bp *BrowserPilot) Bookmarks() Bookmarks { return Bookmarks{api{bp: bp}} }

func (b Bookmarks) List(ctx context.Context, env, query string) ([]map[string]any, error) {
	args := map[string]any{"env": env}
	if query != "" {
		args["query"] = query
	}
	data, err := b.call(ctx, "bookmark_list", args)
	if err != nil {
		return nil, err
	}
	return mapList(data["bookmarks"]), nil
}

func (b Bookmarks) Add(ctx context.Context, env, url, title string) (map[string]any, error) {
	args := map[string]any{"env": env, "url": url}
	if title != "" {
		args["title"] = title
	}
	return b.call(ctx, "bookmark_add", args)
}

func (b Bookmarks) Remove(ctx context.Context, env string, filter map[string]any) (int, error) {
	args := map[string]any{"env": env}
	for key, value := range filter {
		args[key] = value
	}
	data, err := b.call(ctx, "bookmark_remove", args)
	if err != nil {
		return 0, err
	}
	return toInt(data["removed"]), nil
}

// Downloads 是下载记录和下载目录。
type Downloads struct{ api }

func (bp *BrowserPilot) Downloads() Downloads { return Downloads{api{bp: bp}} }

// List 的 wait 是等活跃下载完成的秒数，最多 120。
func (d Downloads) List(ctx context.Context, wait float64) ([]map[string]any, error) {
	args := map[string]any{"action": "list"}
	if wait > 0 {
		args["wait"] = wait
	}
	data, err := d.call(ctx, "download", args)
	if err != nil {
		return nil, err
	}
	return mapList(data["downloads"]), nil
}

func (d Downloads) Directory(ctx context.Context) (map[string]any, error) {
	return d.call(ctx, "download", map[string]any{"action": "dir"})
}

func (d Downloads) SetDirectory(ctx context.Context, path string) (map[string]any, error) {
	return d.call(ctx, "download", map[string]any{"action": "dir", "path": path})
}

func (d Downloads) Act(ctx context.Context, action, id string) (map[string]any, error) {
	args := map[string]any{"action": action}
	if id != "" {
		args["id"] = id
	}
	return d.call(ctx, "download", args)
}

// Network 是每套环境自己的出口：代理、UA、语言、WebRTC 策略。
type Network struct{ api }

func (bp *BrowserPilot) Network() Network { return Network{api{bp: bp}} }

func (n Network) Get(ctx context.Context, env string) (map[string]any, error) {
	return n.call(ctx, "network_get", map[string]any{"env": env})
}

func (n Network) Set(ctx context.Context, env string, fields map[string]any) (map[string]any, error) {
	args := map[string]any{"env": env}
	for key, value := range fields {
		args[key] = value
	}
	return n.call(ctx, "network_set", args)
}
