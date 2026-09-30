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
	"syscall"
	"time"
)

type endpoint struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func main() {
	if runtime.GOOS == "windows" {
		syscall.NewLazyDLL("kernel32.dll").NewProc("SetConsoleOutputCP").Call(65001)
	}
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "tools":
		exit(printTools())
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
	fmt.Fprintln(os.Stderr, "用法: browserpilot tools | schema <工具> | call <工具> [--json '{}'] [--json-file 文件] [--recording 编号]")
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

func printTools() error {
	result, err := rpc("tools/list", map[string]any{})
	if err != nil {
		return err
	}
	tools, _ := result["tools"].([]any)
	for _, item := range tools {
		tool, _ := item.(map[string]any)
		fmt.Printf("%s\t%s\n", tool["name"], tool["description"])
	}
	return nil
}

func printSchema(name string) error {
	result, err := rpc("tools/list", map[string]any{})
	if err != nil {
		return err
	}
	tools, _ := result["tools"].([]any)
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
