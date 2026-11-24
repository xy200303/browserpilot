package browserpilot

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Endpoint 是 App 写下的端点文件内容。程序面在 API 字段里。
type Endpoint struct {
	URL   string `json:"url"`
	API   string `json:"api"`
	Token string `json:"token"`
}

// ImagePart 是截图类工具的图片内容。App 把它放在载荷的同级 image 字段里。
type ImagePart struct {
	MimeType string
	Data     []byte
}

// ToolInfo 是工具目录里的一项。
type ToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
}

// CallResult 是一次工具调用的结果：载荷加上可选的图片。
type CallResult struct {
	// Data 是工具载荷本身（已经是 JSON 对象，不再包一层）。
	Data map[string]any
	// Image 只有截图类工具有。
	Image *ImagePart
}

// EventRecord 是一条事件。
type EventRecord struct {
	Seq     int64          `json:"seq"`
	Type    string         `json:"type"`
	At      int64          `json:"at"`
	Env     string         `json:"env"`
	TabID   string         `json:"tabId"`
	Payload map[string]any `json:"payload"`
}

// EventWaitOptions 是长轮询的参数。Since 为 nil 表示只看新事件。
type EventWaitOptions struct {
	Since *int64
	Types []string
	Env   string
	TabID string
	// Wait 最多挂起多久，默认 25 秒，上限 25 秒。
	Wait  time.Duration
	Limit int
}

// EventWaitResult 是一次长轮询的结果。
type EventWaitResult struct {
	Epoch   string        `json:"epoch"`
	Seq     int64         `json:"seq"`
	Events  []EventRecord `json:"events"`
	More    bool          `json:"more"`
	Timeout bool          `json:"timeout"`
	Reset   bool          `json:"reset"`
	Busy    bool          `json:"busy"`
}

const (
	defaultTimeout = 120 * time.Second
	maxEventWait   = 25 * time.Second
)

// httpClient 是所有请求共用的客户端。超时一律由 context 控制，所以这里不设 Timeout。
var httpClient = &http.Client{}

// Transport 负责和程序面 /api 说话：朴素 JSON 进出，不涉及 JSON-RPC。
type Transport struct {
	// Endpoint 是当前连接的端点，可以在运行中改指向。
	Endpoint Endpoint
	// Timeout 是单次工具调用的默认超时。
	Timeout time.Duration

	mu     sync.Mutex
	closed bool
}

// NewTransport 用给定端点建一个传输层。
func NewTransport(endpoint Endpoint) *Transport {
	return &Transport{Endpoint: endpoint, Timeout: defaultTimeout}
}

// ReadEndpoint 读取 App 写下的端点文件。没有 api 字段说明装的是旧版 App，
// 直接报错而不是回退 /mcp——跨版本混用会静默降级，比报错难查。
func ReadEndpoint(file string) (Endpoint, error) {
	if file == "" {
		file = MCPFilePath()
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Endpoint{}, newTransportError(
				fmt.Sprintf("没找到 %s。要么 BrowserPilot 没启动过，要么 MCP 在设置里被关掉了。", file), err)
		}
		return Endpoint{}, newTransportError("读不了 "+file, err)
	}
	var saved Endpoint
	if err := json.Unmarshal(raw, &saved); err != nil {
		return Endpoint{}, newTransportError(file+" 不是合法的 JSON", err)
	}
	if saved.Token == "" {
		return Endpoint{}, newTransportError(file + " 里缺 token")
	}
	if saved.API == "" {
		return Endpoint{}, newInstallError(fmt.Sprintf(
			"本机装的 BrowserPilot 太旧，没有 /api（对应 SDK v%s）。请升级，或用 BROWSERPILOT_EXE 指定新版本。",
			APPVersion))
	}
	saved.API = strings.TrimRight(saved.API, "/")
	return saved, nil
}

// Ping 探活：App 没起来、端口被占、token 过期都返回 false。
func (t *Transport) Ping(ctx context.Context) bool {
	return t.ping(ctx, 2*time.Second)
}

func (t *Transport) ping(ctx context.Context, timeout time.Duration) bool {
	_, err := t.request(ctx, http.MethodGet, "/tools", nil, timeout)
	return err == nil
}

// Tools 拿全量工具目录（不受 toolMode 影响）。
func (t *Transport) Tools(ctx context.Context) []ToolInfo {
	var payload struct {
		Tools []ToolInfo `json:"tools"`
	}
	if _, err := t.request(ctx, http.MethodGet, "/tools", nil, 10*time.Second, &payload); err != nil {
		return nil
	}
	return payload.Tools
}

// Call 调用一个工具。
func (t *Transport) Call(ctx context.Context, name string, args map[string]any) (*CallResult, error) {
	return t.CallWithTimeout(ctx, name, args, t.Timeout)
}

// CallWithTimeout 用指定超时调用一个工具。
func (t *Transport) CallWithTimeout(ctx context.Context, name string, args map[string]any, timeout time.Duration) (*CallResult, error) {
	return t.call(ctx, name, args, timeout)
}

// call 是包内入口，page 之类内部调用走它。
func (t *Transport) call(ctx context.Context, name string, args map[string]any, timeout time.Duration) (*CallResult, error) {
	if args == nil {
		args = map[string]any{}
	}
	payload := map[string]any{}
	if _, err := t.request(ctx, http.MethodPost, "/call", map[string]any{"tool": name, "args": args}, timeout, &payload); err != nil {
		return nil, err
	}
	image := (*ImagePart)(nil)
	if raw, ok := payload["image"].(map[string]any); ok {
		if encoded, ok := raw["data"].(string); ok && encoded != "" {
			data, decodeErr := base64.StdEncoding.DecodeString(encoded)
			if decodeErr != nil {
				return nil, newTransportError(name+" 的图片不是合法 base64", decodeErr)
			}
			mime, _ := raw["mimeType"].(string)
			if mime == "" {
				mime = "image/png"
			}
			image = &ImagePart{MimeType: mime, Data: data}
		}
	}
	delete(payload, "image")
	// 工具失败是 200 + ok:false，这是唯一判据。
	if ok, exists := payload["ok"].(bool); exists && !ok {
		return nil, newToolError(name, payload)
	}
	return &CallResult{Data: payload, Image: image}, nil
}

// WaitEvents 长轮询取一批事件。
func (t *Transport) WaitEvents(ctx context.Context, opts EventWaitOptions) (*EventWaitResult, error) {
	wait := opts.Wait
	if wait <= 0 {
		wait = maxEventWait
	}
	if wait > maxEventWait {
		wait = maxEventWait
	}
	body := map[string]any{"wait": wait.Milliseconds()}
	if opts.Since != nil {
		body["since"] = *opts.Since
	}
	if len(opts.Types) > 0 {
		body["types"] = opts.Types
	}
	if opts.Env != "" {
		body["env"] = opts.Env
	}
	if opts.TabID != "" {
		body["tabId"] = opts.TabID
	}
	if opts.Limit > 0 {
		body["limit"] = opts.Limit
	}
	result := &EventWaitResult{}
	// 客户端要比服务端挂得久一点，否则先超时的会是客户端
	if _, err := t.request(ctx, http.MethodPost, "/events", body, wait+10*time.Second, result); err != nil {
		return nil, err
	}
	return result, nil
}

// Close 关闭传输层。
func (t *Transport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	return nil
}

// request 是所有请求的唯一出口：带 Bearer，非 2xx 一律变成 transport error。
func (t *Transport) request(ctx context.Context, method, path string, body any, timeout time.Duration, out ...any) ([]byte, error) {
	t.mu.Lock()
	closed := t.closed
	t.mu.Unlock()
	if closed {
		return nil, newTransportError("连接已经关了")
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, newTransportError("参数序列化失败", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(reqCtx, method, t.Endpoint.API+path, reader)
	if err != nil {
		return nil, newTransportError("拼不出请求", err)
	}
	request.Header.Set("Authorization", "Bearer "+t.Endpoint.Token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := httpClient.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, newTransportError(fmt.Sprintf("等了 %dms 没回应", timeout.Milliseconds()))
		}
		return nil, newTransportError("连不上 "+t.Endpoint.API+path, err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(response.Body)

	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return nil, newTransportError("token 不对，重新读一遍 mcp.json")
	case response.StatusCode == http.StatusForbidden:
		return nil, newTransportError("被 Origin 校验挡下了")
	case response.StatusCode >= 400:
		return nil, newTransportError(fmt.Sprintf("HTTP %d %s", response.StatusCode, clip(string(raw), 200)))
	}

	if len(out) > 0 && out[0] != nil {
		if err := json.Unmarshal(raw, out[0]); err != nil {
			return nil, newTransportError(path+" 返回的不是 JSON："+clip(string(raw), 200), err)
		}
	}
	return raw, nil
}

func clip(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}
