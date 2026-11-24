package browserpilot

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// 一个假的 MCP 端点，用来验证 SDK 发出的工具调用。
// 行为照着 src/main/services/McpService.ts 抄：Bearer 鉴权、每请求独立、
// 图片从载荷里拆成第二个 content part、工具错误是 200 + ok:false。

type fakeCall struct {
	Name string
	Args map[string]any
}

// fakeHandler 预置返回值；返回 error 就模拟工具失败（200 + ok:false）。
type fakeHandler func(args map[string]any, calls []fakeCall) (map[string]any, error)

type fakeServerOptions struct {
	// Token 默认 test-token。
	Token string
	// Handlers 覆盖默认返回值。
	Handlers map[string]fakeHandler
}

type fakeServer struct {
	server   *httptest.Server
	token    string
	handlers map[string]fakeHandler

	mu     sync.Mutex
	calls  []fakeCall
	events []map[string]any
}

func startFakeServer(t *testing.T, options fakeServerOptions) *fakeServer {
	t.Helper()
	if options.Token == "" {
		options.Token = "test-token"
	}
	fake := &fakeServer{
		token:    options.Token,
		handlers: defaultHandlers(),
	}
	for name, handler := range options.Handlers {
		fake.handlers[name] = handler
	}
	fake.server = httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeServer) serve(writer http.ResponseWriter, request *http.Request) {
	if request.Header.Get("Authorization") != "Bearer "+f.token {
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(writer, "unauthorized")
		return
	}

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/api/tools":
		writeJSON(writer, map[string]any{
			"version": "0.19.0",
			"tools":   []map[string]any{{"name": "page_click", "description": "click", "inputSchema": map[string]any{}}},
		})
		return

	case request.Method == http.MethodPost && request.URL.Path == "/api/call":
		body, err := io.ReadAll(request.Body)
		if err != nil {
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		var call struct {
			Tool string         `json:"tool"`
			Args map[string]any `json:"args"`
		}
		if err := json.Unmarshal(body, &call); err != nil || call.Tool == "" {
			writeJSON(writer, map[string]any{"ok": false, "code": "bad_request", "error": "tool is required"})
			return
		}
		f.mu.Lock()
		f.calls = append(f.calls, fakeCall{Name: call.Tool, Args: call.Args})
		calls := append([]fakeCall(nil), f.calls...)
		handler := f.handlers[call.Tool]
		f.mu.Unlock()

		data := map[string]any{"ok": true}
		if handler != nil {
			if result, err := handler(call.Args, calls); err != nil {
				data = map[string]any{"ok": false, "control": "shared", "error": err.Error()}
			} else {
				data = result
			}
		}
		writeJSON(writer, data)
		return

	case request.Method == http.MethodPost && request.URL.Path == "/api/events":
		body, _ := io.ReadAll(request.Body)
		var query struct {
			Since *int64 `json:"since"`
			Wait  int64  `json:"wait"`
			Limit int    `json:"limit"`
		}
		_ = json.Unmarshal(body, &query)
		wait := time.Duration(query.Wait) * time.Millisecond
		if wait > 3*time.Second {
			wait = 3 * time.Second
		}
		deadline := time.Now().Add(wait)
		for {
			// 客户端取消（订阅 off / 超时）后别再傻等到 3 秒，否则 httptest 的 Close 会陪着等
			if request.Context().Err() != nil {
				return
			}
			f.mu.Lock()
			ready := make([]map[string]any, 0, len(f.events))
			for _, event := range f.events {
				if query.Since == nil || event["seq"].(int64) > *query.Since {
					ready = append(ready, event)
				}
			}
			f.mu.Unlock()
			if len(ready) > 0 {
				limit := query.Limit
				if limit <= 0 || limit > len(ready) {
					limit = len(ready)
				}
				last, _ := ready[limit-1]["seq"].(int64)
				writeJSON(writer, map[string]any{"epoch": "test", "seq": last, "events": ready[:limit]})
				return
			}
			if time.Now().After(deadline) {
				var seq int64
				if query.Since != nil {
					seq = *query.Since
				}
				writeJSON(writer, map[string]any{"epoch": "test", "seq": seq, "events": []any{}, "timeout": true})
				return
			}
			time.Sleep(10 * time.Millisecond)
		}

	default:
		writer.WriteHeader(http.StatusNotFound)
	}
}

// pushEvent 往事件队列里塞一条，供 WaitEvents 取。
func (f *fakeServer) pushEvent(kind string, payload map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var seq int64 = 101
	if len(f.events) > 0 {
		seq = f.events[len(f.events)-1]["seq"].(int64) + 1
	}
	f.events = append(f.events, map[string]any{
		"seq":     seq,
		"type":    kind,
		"at":      0,
		"env":     "env-default",
		"payload": payload,
	})
}

func (f *fakeServer) endpoint() Endpoint {
	return Endpoint{URL: f.server.URL + "/mcp", API: f.server.URL + "/api", Token: f.token}
}

// recorded 返回到目前为止的调用记录副本。
func (f *fakeServer) recorded() []fakeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeCall(nil), f.calls...)
}

func (f *fakeServer) reset() {
	f.mu.Lock()
	f.calls = nil
	f.mu.Unlock()
}

func writeJSON(writer http.ResponseWriter, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(payload)
}

func mustJSON(payload any) string {
	data, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(data)
}

// writeFile 在测试里造一个小文件。
func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

// defaultHandlers 是预置的一批合理返回值，让测试只关心「发了什么」。
func defaultHandlers() map[string]fakeHandler {
	return map[string]fakeHandler{
		"tab_open": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabId": "tab-test", "env": "env-default"}, nil
		},
		"tab_list": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabs": []map[string]any{{
				"id": "tab-test", "envId": "env-default", "url": "https://example.com", "title": "Example",
			}}}, nil
		},
		"env_list": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "envs": []map[string]any{{
				"id": "env-default", "name": "默认", "remark": "", "windowOpen": true, "headless": false,
			}}}, nil
		},
		"env_open": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true}, nil
		},
		"env_close": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true}, nil
		},
		"page_navigate": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabId": args["tabId"], "url": args["url"]}, nil
		},
		"page_click": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabId": args["tabId"], "control": "agent"}, nil
		},
		"page_type": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabId": args["tabId"]}, nil
		},
		"page_key": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "tabId": args["tabId"]}, nil
		},
		"page_wait": func(args map[string]any, _ []fakeCall) (map[string]any, error) {
			state, _ := args["state"].(string)
			if state == "" {
				state = "appear"
			}
			return map[string]any{"ok": true, "tabId": args["tabId"], "state": state}, nil
		},
		"page_query": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "total": 2, "matches": []map[string]any{
				{"index": 0, "hittable": true},
				{"index": 1, "hittable": false},
			}}, nil
		},
		"page_inspect": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "text": "按钮文字"}, nil
		},
		"page_source": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "html": "<html></html>"}, nil
		},
		"page_script": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "value": 42}, nil
		},
		"page_snapshot": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "snapshot": "button 登录"}, nil
		},
		"page_console": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{"ok": true, "messages": []map[string]any{{"level": "error", "message": "boom"}}}, nil
		},
		"page_screenshot": func(map[string]any, []fakeCall) (map[string]any, error) {
			return map[string]any{
				"ok":     true,
				"width":  800,
				"height": 600,
				"path":   "/tmp/a.jpg",
				"image": map[string]any{
					"mimeType": "image/png",
					"data":     base64.StdEncoding.EncodeToString([]byte("png-bytes")),
				},
			}, nil
		},
	}
}

// newTestPage 直接造一个页面，不经过 Launch。
func newTestPage(fake *fakeServer) *Page {
	return NewPage(NewTransport(fake.endpoint()), "tab-test", "env-default")
}
