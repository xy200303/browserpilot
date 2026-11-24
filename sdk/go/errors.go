package browserpilot

import "errors"

// 错误码和 Node / Python SDK 保持一致。判错请用 IsToolError 这类辅助函数或比对 Code，
// 不要去匹配错误文案。
const (
	// CodeBrowserPilotError 是兜底错误码：定位器写法不对、截图存不下来之类。
	CodeBrowserPilotError = "browserpilot_error"
	// CodeToolError 表示工具跑了但失败（载荷里 ok:false）。
	CodeToolError = "tool_error"
	// CodeTransportError 表示连不上、超时、鉴权失败或 JSON-RPC 出错。
	CodeTransportError = "transport_error"
	// CodeInstallError 表示找不到也装不上 BrowserPilot。
	CodeInstallError = "install_error"
	// CodeNotFound 表示定位器没命中，或这个工具不支持这种定位方式。
	CodeNotFound = "not_found"
)

// Error 是 SDK 唯一的错误类型，跨语言语义一致：
//
//   - Code == CodeToolError：工具真的跑了，但返回 ok:false。Payload 是原始载荷，
//     Tool 是工具名；这时候 HTTP 状态是 200，别拿状态码判错。
//   - Code == CodeTransportError：端点不通、token 不对、响应不是 JSON-RPC。
//   - Code == CodeInstallError：本机没有 BrowserPilot，也下载不下来。
//   - Code == CodeNotFound：定位器没命中，或这种定位方式这个工具不支持。
type Error struct {
	// Code 是上面列出的错误码之一。
	Code string
	// Tool 只在工具错误时有值，是失败的工具名。
	Tool string
	// Payload 只在工具错误时有值，是工具返回的原始载荷。
	Payload map[string]any
	// Message 给人看的说明，可能包含工具自己的错误文案。
	Message string
	// Err 是被包装的底层错误，可以用 errors.Is / errors.As 继续往下查。
	Err error
}

// Error 实现 error 接口。
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Tool != "" {
		return e.Tool + " 失败"
	}
	return e.Code
}

// Unwrap 让 errors.Is / errors.As 能穿透到底层错误。
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// ScreenshotPath 返回工具失败时 App 顺手拍的现场截图路径，没有就是空串。
func (e *Error) ScreenshotPath() string {
	if e == nil || e.Payload == nil {
		return ""
	}
	path, _ := e.Payload["errorShot"].(string)
	return path
}

func newError(code, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Err: cause}
}

func newToolError(tool string, payload map[string]any) *Error {
	message := ""
	if payload != nil {
		if text, ok := payload["error"].(string); ok {
			message = text
		}
	}
	if message == "" {
		message = tool + " 失败"
	}
	return &Error{Code: CodeToolError, Tool: tool, Payload: payload, Message: message}
}

func newTransportError(message string, cause ...error) *Error {
	return &Error{Code: CodeTransportError, Message: message, Err: firstError(cause)}
}

func newInstallError(message string, cause ...error) *Error {
	return &Error{Code: CodeInstallError, Message: message, Err: firstError(cause)}
}

// firstError 让构造函数可以不带 cause 调用，省掉一堆 nil。
func firstError(causes []error) error {
	if len(causes) == 0 {
		return nil
	}
	return causes[0]
}

func newNotFoundError(message string) *Error {
	return &Error{Code: CodeNotFound, Message: message}
}

// IsToolError 判断是不是「工具跑了但失败」。载荷里 ok:false 的 200 响应走这个分支。
func IsToolError(err error) bool { return hasCode(err, CodeToolError) }

// IsTransportError 判断是不是传输层问题：连不上、超时、token 不对、响应格式不对。
func IsTransportError(err error) bool { return hasCode(err, CodeTransportError) }

// IsInstallError 判断是不是安装层问题：找不到也下载不了 BrowserPilot。
func IsInstallError(err error) bool { return hasCode(err, CodeInstallError) }

// IsNotFoundError 判断是不是定位器没命中，或工具不支持这种定位方式。
func IsNotFoundError(err error) bool { return hasCode(err, CodeNotFound) }

func hasCode(err error, code string) bool {
	var target *Error
	return errors.As(err, &target) && target.Code == code
}
