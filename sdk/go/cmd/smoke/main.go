// 对着真实的 BrowserPilot 跑一遍。
//
//	go run ./cmd/smoke
//	BROWSERPILOT_MCP_FILE=... go run ./cmd/smoke
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	browserpilot "github.com/xy200303/browserpilot-go"
)

type endpointFile struct {
	URL   string `json:"url"`
	API   string `json:"api"`
	Token string `json:"token"`
}

func main() {
	file := os.Getenv("BROWSERPILOT_MCP_FILE")
	if file == "" {
		file = browserpilot.MCPFilePath()
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		fmt.Printf("✗ 读不了 %s：%v\n", file, err)
		os.Exit(1)
	}
	var saved endpointFile
	if err := json.Unmarshal(raw, &saved); err != nil || saved.API == "" {
		fmt.Printf("✗ %s 里没有 api 字段：装的是旧版 App\n", file)
		os.Exit(1)
	}

	started := time.Now()
	ctx := context.Background()
	bp, err := browserpilot.Launch(ctx, browserpilot.WithEndpoint(browserpilot.Endpoint{
		URL:   saved.URL,
		API:   saved.API,
		Token: saved.Token,
	}))
	if err != nil {
		fmt.Printf("✗ 连不上：%v\n", err)
		os.Exit(1)
	}
	defer bp.Close()

	envs, err := bp.Environments(ctx)
	if err != nil {
		fmt.Printf("✗ 列环境失败：%v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ 连上端点，环境 %d 套\n", len(envs))

	page, err := bp.NewPage(ctx, "")
	if err != nil {
		fmt.Printf("✗ 开标签失败：%v\n", err)
		os.Exit(1)
	}
	defer page.Close(ctx)
	fmt.Printf("✓ 新标签 %s\n", page.ID())

	before, err := bp.Call(ctx, "env_list", map[string]any{})
	if err != nil {
		fmt.Printf("✗ env_list 失败：%v\n", err)
		os.Exit(1)
	}

	if err := page.Goto(ctx, "https://example.com"); err != nil {
		fmt.Printf("✗ 导航失败：%v\n", err)
		os.Exit(1)
	}
	title, _ := page.Title(ctx)
	fmt.Printf("✓ 导航到 example.com，标题「%s」\n", title)

	shot, err := page.Screenshot(ctx)
	if err != nil {
		fmt.Printf("✗ 截图失败：%v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ 截图 %d 字节\n", len(shot))

	if err := page.WaitForText(ctx, "Example"); err != nil {
		fmt.Printf("✗ waitForText 失败：%v\n", err)
		os.Exit(1)
	}
	fmt.Println("✓ waitForText 找到 Example")

	count, _ := page.Count(ctx, "p")
	fmt.Printf("✓ count('p') = %d\n", count)

	since, ok := before["seq"].(float64)
	var sincePtr *int64
	if ok {
		value := int64(since)
		sincePtr = &value
	}
	result, err := bp.Transport().WaitEvents(ctx, browserpilot.EventWaitOptions{
		Since: sincePtr,
		Wait:  3 * time.Second,
	})
	if err != nil {
		fmt.Printf("✗ 取事件失败：%v\n", err)
		os.Exit(1)
	}
	seen := map[string]bool{}
	for _, event := range result.Events {
		seen[event.Type] = true
	}
	fmt.Printf("✓ 事件 %d 条，类型数 %d\n", len(result.Events), len(seen))

	fmt.Printf("\n冒烟通过，用时 %dms\n", time.Since(started).Milliseconds())
}
