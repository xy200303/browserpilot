package browserpilot

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// LookupEnv 抽象环境变量读取，测试换掉它就不用动进程环境。
// 生产代码一直用 OSEnv()。
type LookupEnv func(string) string

// OSEnv 返回读真实进程环境的 LookupEnv。
func OSEnv() LookupEnv { return os.Getenv }

// CurrentPlatform 把 Go 的 GOOS/GOARCH 换成发布产物的命名：win32 / darwin / linux、x64 / arm64。
func CurrentPlatform() (platform, arch string) {
	switch runtime.GOOS {
	case "windows":
		platform = "win32"
	default:
		platform = runtime.GOOS
	}
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	default:
		arch = runtime.GOARCH
	}
	return platform, arch
}

func isDarwin() bool { return runtime.GOOS == "darwin" }

func homeDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	if home := os.Getenv("USERPROFILE"); home != "" {
		return home
	}
	return os.Getenv("HOME")
}

// AppDataRoot 是 Electron 的 userData 父目录。
// App 把 userData 固定成 <appData>/BrowserPilot，所以端点文件的位置只跟系统有关，
// 和 App 装在哪儿无关。
func AppDataRoot(platform string, env LookupEnv) string {
	switch platform {
	case "win32":
		if value := env("APPDATA"); value != "" {
			return value
		}
		return filepath.Join(homeDir(), "AppData", "Roaming")
	case "darwin":
		return filepath.Join(homeDir(), "Library", "Application Support")
	default:
		if value := env("XDG_CONFIG_HOME"); value != "" {
			return value
		}
		return filepath.Join(homeDir(), ".config")
	}
}

// MCPFile 返回端点文件路径：
// %APPDATA%\BrowserPilot\mcp.json / ~/Library/Application Support/... / $XDG_CONFIG_HOME/...
func MCPFile(platform string, env LookupEnv) string {
	return filepath.Join(AppDataRoot(platform, env), "BrowserPilot", "mcp.json")
}

// MCPFilePath 是当前这台机器上的端点文件路径。
func MCPFilePath() string {
	platform, _ := CurrentPlatform()
	return MCPFile(platform, OSEnv())
}

// DataHome 是 SDK 自己的目录：下载缓存和便携副本都放这儿。
// 用 BROWSERPILOT_HOME 可以改位置。
func DataHome(env LookupEnv) string {
	if value := env("BROWSERPILOT_HOME"); value != "" {
		return value
	}
	return filepath.Join(homeDir(), ".browserpilot")
}

// SDKDir 是某个版本解压后的安装目录。
func SDKDir(version string) string {
	return filepath.Join(DataHome(OSEnv()), "sdk", version)
}

// DownloadsDir 存下载中的压缩包，`.part` 临时文件也在这里。
func DownloadsDir() string {
	return filepath.Join(DataHome(OSEnv()), "downloads")
}

// LooksLikeApp 确认路径真是应用本体，而不是同目录下的 cli/browserpilot。
// 打包后的 App 一定有 resources/app.asar；macOS 的 .app 内层可执行文件和
// AppImage 靠路径特征和体积判断。
func LooksLikeApp(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if strings.Contains(filepath.ToSlash(path), ".app/Contents/MacOS/") {
		return true
	}
	if info.Size() > 20*1024*1024 {
		return true
	}
	return fileExists(filepath.Join(filepath.Dir(path), "resources", "app.asar"))
}

// InstallCandidates 是桌面版的默认安装位置。SDK 优先用这些，因为登录态都在用户日常那份里。
// platform 用发布产物的命名（win32 / darwin / linux）。
func InstallCandidates(platform string, env LookupEnv) []string {
	switch platform {
	case "win32":
		local := env("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(homeDir(), "AppData", "Local")
		}
		programFiles := env("ProgramFiles")
		if programFiles == "" {
			programFiles = `C:\Program Files`
		}
		programFiles86 := env("ProgramFiles(x86)")
		if programFiles86 == "" {
			programFiles86 = `C:\Program Files (x86)`
		}
		candidates := []string{
			filepath.Join(local, "Programs", "BrowserPilot", "BrowserPilot.exe"),
			filepath.Join(programFiles, "BrowserPilot", "BrowserPilot.exe"),
			filepath.Join(programFiles86, "BrowserPilot", "BrowserPilot.exe"),
		}
		return append(candidates, fromPath("BrowserPilot.exe", platform, env)...)
	case "darwin":
		// 这里是 macOS 路径，故意不经过 filepath.Join，免得在非 darwin 的机器上被转成反斜杠。
		return []string{
			"/Applications/BrowserPilot.app/Contents/MacOS/BrowserPilot",
			filepath.ToSlash(filepath.Join(homeDir(), "Applications")) + "/BrowserPilot.app/Contents/MacOS/BrowserPilot",
		}
	default:
		return append([]string{
			"/opt/BrowserPilot/BrowserPilot",
			"/usr/lib/browserpilot/BrowserPilot",
		}, fromPath("BrowserPilot", platform, env)...)
	}
}

// fromPath 沿着 PATH 找一遍：安装包会把 CLI 放进去，同一个目录里通常就是应用本体。
func fromPath(exe, platform string, env LookupEnv) []string {
	path := env("PATH")
	if path == "" {
		path = env("Path")
	}
	separator := ":"
	if platform == "win32" {
		separator = ";"
	}
	dirs := strings.Split(path, separator)
	candidates := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		if platform == "win32" {
			candidates = append(candidates, filepath.Join(dir, exe))
		} else {
			candidates = append(candidates, filepath.ToSlash(filepath.Join(dir, exe)))
		}
	}
	return candidates
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
