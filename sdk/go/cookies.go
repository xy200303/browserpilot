package browserpilot

import "context"

/*
cookie 的导出与注入。掉登录时不用重扫，把上次导出的 cookie 注回去就行。

BrowserPilot 和 Page 都调这里，只是传进来的 call 不一样：cookie 工具不认 tabId，
所以 Page 不能走 p.Call（那会自动塞 tabId），只能直接走 transport。
*/

// cookieCall 是一次 cookie 工具调用的最小接口，方便 BrowserPilot 和 Page 共用这套逻辑。
type cookieCall func(ctx context.Context, tool string, args map[string]any) (map[string]any, error)

// cookieOptionalFields 是 cookie_set 的可选字段；为空就别发，交给 App 用默认值。
var cookieOptionalFields = []string{"domain", "path", "secure", "httpOnly", "expirationDate", "url"}

func listCookies(ctx context.Context, call cookieCall, env, domain string) ([]map[string]any, error) {
	args := map[string]any{}
	if env != "" {
		args["env"] = env
	}
	if domain != "" {
		args["domain"] = domain
	}
	data, err := call(ctx, "cookie_list", args)
	if err != nil {
		return nil, err
	}
	items := mapList(data["cookies"])
	if items == nil {
		items = []map[string]any{}
	}
	return items, nil
}

func addCookies(ctx context.Context, call cookieCall, cookies []map[string]any, env string) (int, error) {
	written := 0
	for _, item := range cookies {
		payload := make(map[string]any, len(item)+1)
		for key, value := range item {
			// session 是导出时带的「会话 cookie」标记，cookie_set 不认。
			if key == "session" {
				continue
			}
			payload[key] = value
		}
		for _, key := range cookieOptionalFields {
			if value, ok := payload[key]; !ok || value == nil || value == "" {
				delete(payload, key)
			}
		}
		name, _ := payload["name"].(string)
		value, hasValue := payload["value"]
		if name == "" || !hasValue || value == nil {
			return written, newError(CodeBrowserPilotError, "cookie 至少要 name 和 value", nil)
		}
		if env != "" {
			payload["env"] = env
		}
		if _, err := call(ctx, "cookie_set", payload); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

func clearCookies(ctx context.Context, call cookieCall, name, domain, url string, all bool, env string) error {
	if name == "" && domain == "" && url == "" && !all {
		return newError(CodeBrowserPilotError,
			"ClearCookies 至少要给 name / domain / url，或者 all=true", nil)
	}
	args := map[string]any{}
	if name != "" {
		args["name"] = name
	}
	if domain != "" {
		args["domain"] = domain
	}
	if url != "" {
		args["url"] = url
	}
	if all {
		args["all"] = true
	}
	if env != "" {
		args["env"] = env
	}
	// App 要 url+name 或 domain 或 all；只给 name 时先查一下这个 cookie 在哪些域上，
	// 否则工具会直接报「需要 url + name，或 domain，或 all: true」。
	if name != "" && domain == "" && url == "" && !all {
		current, err := listCookies(ctx, call, env, "")
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, item := range current {
			if item["name"] != name {
				continue
			}
			host, _ := item["domain"].(string)
			if host == "" || seen[host] {
				continue
			}
			seen[host] = true
			scoped := map[string]any{"name": name, "domain": host}
			if env != "" {
				scoped["env"] = env
			}
			if _, err := call(ctx, "cookie_remove", scoped); err != nil {
				return err
			}
		}
		return nil
	}
	_, err := call(ctx, "cookie_remove", args)
	return err
}

// Cookies 导出这套环境的 cookie（可以 JSON 序列化存起来，以后 AddCookies 注回去）。
// domain 传空串就是整套环境。
func (bp *BrowserPilot) Cookies(ctx context.Context, env, domain string) ([]map[string]any, error) {
	return listCookies(ctx, bp.cookieCall, env, domain)
}

// AddCookies 把导出的 cookie 注回一套环境，返回写进去的条数。
// 导出载荷里的 session 字段会被丢掉，空的可选字段不会发出去。
func (bp *BrowserPilot) AddCookies(ctx context.Context, cookies []map[string]any, env string) (int, error) {
	return addCookies(ctx, bp.cookieCall, cookies, env)
}

// ClearCookies 删 cookie。name 单删；all=true 清空这套环境；domain / url 收窄范围。
func (bp *BrowserPilot) ClearCookies(ctx context.Context, name, domain, url string, all bool, env string) error {
	return clearCookies(ctx, bp.cookieCall, name, domain, url, all, env)
}

func (bp *BrowserPilot) cookieCall(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	return bp.Call(ctx, tool, args)
}

// Cookies 导出这个标签所属环境的 cookie。cookie 工具不认 tabId，这里不会带。
func (p *Page) Cookies(ctx context.Context, domain string) ([]map[string]any, error) {
	return listCookies(ctx, p.cookieCall, p.env, domain)
}

// AddCookies 把导出的 cookie 注回这个标签所属的环境，返回写入条数。
func (p *Page) AddCookies(ctx context.Context, cookies []map[string]any) (int, error) {
	return addCookies(ctx, p.cookieCall, cookies, p.env)
}

// ClearCookies 删这个标签所属环境的 cookie。
func (p *Page) ClearCookies(ctx context.Context, name, domain, url string, all bool) error {
	return clearCookies(ctx, p.cookieCall, name, domain, url, all, p.env)
}

// cookieCall 直接走 transport：不能经过 p.raw，否则会多带一个 cookie 工具不认的 tabId。
func (p *Page) cookieCall(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	result, err := p.transport.Call(ctx, tool, args)
	if err != nil {
		return nil, err
	}
	return result.Data, nil
}
