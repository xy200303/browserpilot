package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type endpoint struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func main() {
	enableUTF8Console()
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "tools":
		exit(printTools())
	case "search":
		exit(searchTools(os.Args[2:]))
	case "schema":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		exit(printSchema(os.Args[2]))
	case "call":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		exit(callTool(os.Args[2], os.Args[3:]))
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "用法: browserpilot tools | search <关键词> [--page N] [--page-size N] [--json] | schema <工具> | call <工具> [--json '{}'] [--json-file 文件] [--recording 编号]")
}

func exit(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func mcpFile() string {
	root := os.Getenv("APPDATA")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, "AppData", "Roaming")
	}
	return filepath.Join(root, "BrowserPilot", "mcp.json")
}

func loadEndpoint() (endpoint, error) {
	if err := ensureApp(); err != nil {
		return endpoint{}, err
	}
	raw, err := os.ReadFile(mcpFile())
	if err != nil {
		return endpoint{}, fmt.Errorf("还没连上 BrowserPilot: %w", err)
	}
	var ep endpoint
	if err := json.Unmarshal(raw, &ep); err != nil {
		return endpoint{}, err
	}
	return ep, nil
}

func ensureApp() error {
	deadline := time.Now().Add(45 * time.Second)
	for {
		if _, err := os.Stat(mcpFile()); err == nil {
			ep := endpoint{}
			raw, readErr := os.ReadFile(mcpFile())
			if readErr == nil && json.Unmarshal(raw, &ep) == nil && ping(ep) == nil {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("BrowserPilot 没有在 %s 起来", mcpFile())
		}
		if time.Since(started) > 2*time.Second && !launched {
			launched = true
			startApp()
		}
		time.Sleep(400 * time.Millisecond)
	}
}

var launched bool
var started = time.Now()

func ping(ep endpoint) error {
	req, err := http.NewRequest(http.MethodGet, ep.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+ep.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return fmt.Errorf("状态 %d", res.StatusCode)
	}
	return nil
}

func startApp() {
	if exe := os.Getenv("BROWSERPILOT_EXE"); exe != "" {
		_ = exec.Command(exe).Start()
		return
	}
	root := findRepo()
	if root == "" {
		return
	}
	command := exec.Command("npm", "run", "dev")
	if runtime.GOOS == "windows" {
		command = exec.Command("cmd", "/c", "npm", "run", "dev")
	}
	command.Dir = root
	_ = command.Start()
}

func findRepo() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := cwd
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			raw, _ := os.ReadFile(filepath.Join(dir, "package.json"))
			if bytes.Contains(raw, []byte(`"browserpilot"`)) {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func rpc(method string, params any) (map[string]any, error) {
	ep, err := loadEndpoint()
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  params,
	})
	req, err := http.NewRequest(http.MethodPost, ep.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+ep.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	payload, err := parseRPC(raw)
	if err != nil {
		return nil, err
	}
	if errObj, ok := payload["error"].(map[string]any); ok {
		return nil, fmt.Errorf("%v", errObj["message"])
	}
	result, _ := payload["result"].(map[string]any)
	return result, nil
}

func parseRPC(raw []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(raw))
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			text = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			break
		}
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return nil, fmt.Errorf("%s", string(raw))
	}
	return payload, nil
}

func fullTools() ([]any, error) {
	ep, err := loadEndpoint()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, ep.URL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+ep.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var payload struct {
		Tools []any `json:"tools"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if len(payload.Tools) == 0 {
		return nil, fmt.Errorf("没有拿到工具列表")
	}
	return payload.Tools, nil
}

func printTools() error {
	tools, err := fullTools()
	if err != nil {
		result, rpcErr := rpc("tools/list", map[string]any{})
		if rpcErr != nil {
			return rpcErr
		}
		tools, _ = result["tools"].([]any)
	}
	for _, item := range tools {
		tool, _ := item.(map[string]any)
		fmt.Printf("%s\t%s\n", tool["name"], tool["description"])
	}
	return nil
}

func searchTools(args []string) error {
	page := 1
	size := 10
	jsonOut := false
	var words []string
	for i := 0; i < len(args); i += 1 {
		switch args[i] {
		case "--page", "-p":
			if i+1 >= len(args) {
				return fmt.Errorf("--page 需要一个数字")
			}
			i += 1
			page = atoiOr(args[i], 1)
		case "--page-size", "-n", "--size":
			if i+1 >= len(args) {
				return fmt.Errorf("--page-size 需要一个数字")
			}
			i += 1
			size = atoiOr(args[i], 10)
		case "--json":
			jsonOut = true
		default:
			words = append(words, args[i])
		}
	}
	if len(words) == 0 {
		return fmt.Errorf("用法: browserpilot search <关键词> [--page N] [--page-size N] [--json]")
	}
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 10
	}
	if size > 50 {
		size = 50
	}
	query := strings.Join(words, " ")
	result, err := rpc("tools/call", map[string]any{
		"name": "search_tools",
		"arguments": map[string]any{
			"query":     query,
			"page":      page,
			"page_size": size,
		},
	})
	if err != nil {
		return err
	}
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		return fmt.Errorf("没有拿到搜索结果")
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	if jsonOut {
		fmt.Println(text)
		return nil
	}
	var payload struct {
		Total    int `json:"total"`
		Page     int `json:"page"`
		Pages    int `json:"pages"`
		PageSize int `json:"page_size"`
		Tools    []struct {
			Name        string `json:"name"`
			Group       string `json:"group"`
			Description string `json:"description"`
		} `json:"tools"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return err
	}
	if payload.Total == 0 {
		fmt.Printf("没有匹配「%s」的工具\n", query)
		return nil
	}
	from := (payload.Page-1)*payload.PageSize + 1
	to := from + len(payload.Tools) - 1
	fmt.Printf("「%s」第 %d/%d 页，%d-%d / %d 个\n\n", query, payload.Page, payload.Pages, from, to, payload.Total)
	for _, tool := range payload.Tools {
		desc := shorten(strings.ReplaceAll(tool.Description, "\n", " "), 100)
		fmt.Printf("%s\t[%s]\t%s\n", tool.Name, tool.Group, desc)
	}
	if payload.Page < payload.Pages {
		fmt.Printf("\n下一页: browserpilot search %s --page %d --page-size %d\n", query, payload.Page+1, size)
	}
	fmt.Println("\n看参数: browserpilot schema <工具>")
	return nil
}

func shorten(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

func atoiOr(text string, fallback int) int {
	value := 0
	ok := true
	for _, c := range text {
		if c < '0' || c > '9' {
			ok = false
			break
		}
		value = value*10 + int(c-'0')
	}
	if !ok {
		return fallback
	}
	return value
}

func printSchema(name string) error {
	tools, err := fullTools()
	if err != nil {
		result, rpcErr := rpc("tools/list", map[string]any{})
		if rpcErr != nil {
			return rpcErr
		}
		tools, _ = result["tools"].([]any)
	}
	for _, item := range tools {
		tool, _ := item.(map[string]any)
		if tool["name"] == name {
			encoded, _ := json.MarshalIndent(tool, "", "  ")
			fmt.Println(string(encoded))
			return nil
		}
	}
	return fmt.Errorf("没有这个工具 %s", name)
}

func callTool(name string, args []string) error {
	payload := map[string]any{}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--json":
			i++
			if err := json.Unmarshal([]byte(args[i]), &payload); err != nil {
				return err
			}
		case "--json-file":
			i++
			raw, err := os.ReadFile(args[i])
			if err != nil {
				return err
			}
			var parsed any
			if err := json.Unmarshal(raw, &parsed); err != nil {
				return err
			}
			if rows, ok := parsed.([]any); ok {
				payload["rows"] = rows
			} else if object, ok := parsed.(map[string]any); ok {
				for key, value := range object {
					payload[key] = value
				}
			}
		case "--recording", "--env", "--tabId", "--name":
			key := args[i][2:]
			i++
			payload[key] = args[i]
		}
	}
	result, err := rpc("tools/call", map[string]any{"name": name, "arguments": payload})
	if err != nil {
		return err
	}
	content, _ := result["content"].([]any)
	if len(content) > 0 {
		if first, ok := content[0].(map[string]any); ok {
			fmt.Println(first["text"])
			return nil
		}
	}
	encoded, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(encoded))
	return nil
}
