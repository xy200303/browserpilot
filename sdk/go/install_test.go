package browserpilot

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestAssetMatrix(t *testing.T) {
	cases := []struct {
		platform string
		arch     string
		name     string
		kind     AssetKind
	}{
		{"win32", "x64", "BrowserPilot-0.19.0-win.zip", AssetZip},
		{"darwin", "arm64", "BrowserPilot-0.19.0-arm64-mac.zip", AssetZip},
		{"linux", "x64", "BrowserPilot-0.19.0.AppImage", AssetAppImage},
	}
	for _, item := range cases {
		asset, err := AssetFor("0.19.0", item.platform, item.arch)
		if err != nil {
			t.Fatalf("%s-%s 应该支持：%v", item.platform, item.arch, err)
		}
		if asset.Name != item.name || asset.Kind != item.kind {
			t.Fatalf("%s-%s 资产不对：%#v", item.platform, item.arch, asset)
		}
		if asset.Exe == "" {
			t.Fatalf("%s-%s 没给出应用本体路径", item.platform, item.arch)
		}
	}

	unsupported := []struct {
		platform string
		arch     string
	}{
		{"win32", "arm64"},
		{"darwin", "x64"},
		{"linux", "arm64"},
	}
	for _, item := range unsupported {
		if _, err := AssetFor("0.19.0", item.platform, item.arch); !IsInstallError(err) {
			t.Fatalf("%s-%s 应该报安装错误，实际 %v", item.platform, item.arch, err)
		}
	}
}

func TestMCPFilePerPlatform(t *testing.T) {
	normalize := func(path string) string { return strings.ReplaceAll(path, `\`, "/") }

	windows := normalize(MCPFile("win32", func(key string) string {
		if key == "APPDATA" {
			return "C:/Users/me/AppData/Roaming"
		}
		return ""
	}))
	if windows != "C:/Users/me/AppData/Roaming/BrowserPilot/mcp.json" {
		t.Fatalf("Windows 端点路径不对：%s", windows)
	}

	darwin := normalize(MCPFile("darwin", func(string) string { return "" }))
	if !strings.HasSuffix(darwin, "Library/Application Support/BrowserPilot/mcp.json") {
		t.Fatalf("macOS 端点路径不对：%s", darwin)
	}

	linux := normalize(MCPFile("linux", func(key string) string {
		if key == "XDG_CONFIG_HOME" {
			return "/home/me/.config"
		}
		return ""
	}))
	if linux != "/home/me/.config/BrowserPilot/mcp.json" {
		t.Fatalf("Linux 端点路径不对：%s", linux)
	}
}

func TestInstallCandidatesPerPlatform(t *testing.T) {
	contains := func(paths []string, match func(string) bool) bool {
		for _, path := range paths {
			if match(path) {
				return true
			}
		}
		return false
	}

	windows := InstallCandidates("win32", func(key string) string {
		if key == "LOCALAPPDATA" {
			return `C:\Local`
		}
		return ""
	})
	if !contains(windows, func(path string) bool { return strings.Contains(path, "Programs") }) {
		t.Fatalf("Windows 候选路径缺 Programs：%#v", windows)
	}

	darwin := InstallCandidates("darwin", func(string) string { return "" })
	if !contains(darwin, func(path string) bool { return strings.HasPrefix(path, "/Applications") }) {
		t.Fatalf("macOS 候选路径缺 /Applications：%#v", darwin)
	}

	linux := InstallCandidates("linux", func(string) string { return "" })
	if !contains(linux, func(path string) bool { return strings.HasPrefix(path, "/opt") }) {
		t.Fatalf("Linux 候选路径缺 /opt：%#v", linux)
	}
}

func TestLooksLikeApp(t *testing.T) {
	appDir := filepath.Join(t.TempDir(), "BrowserPilot")
	if err := os.MkdirAll(filepath.Join(appDir, "resources"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(appDir, "resources", "app.asar"), "asar"); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(appDir, "BrowserPilot.exe")
	if err := writeFile(exe, "exe"); err != nil {
		t.Fatal(err)
	}
	if !LooksLikeApp(exe) {
		t.Fatal("有 resources/app.asar 的应该是应用本体")
	}

	// 同目录没有 resources/app.asar 的裸可执行文件，多半是 cli/browserpilot。
	bare := filepath.Join(t.TempDir(), "BrowserPilot.exe")
	if err := writeFile(bare, "exe"); err != nil {
		t.Fatal(err)
	}
	if LooksLikeApp(bare) {
		t.Fatal("裸文件不该被当成应用本体")
	}
	if LooksLikeApp(filepath.Join(t.TempDir(), "nothing-here")) {
		t.Fatal("不存在的路径不该被当成应用本体")
	}
}

func TestLocateAppMissingExeEnv(t *testing.T) {
	t.Setenv("BROWSERPILOT_EXE", filepath.Join(t.TempDir(), "definitely-not-here-12345"))
	_, err := LocateApp(EnsureOptions{})
	if !IsInstallError(err) {
		t.Fatalf("期望安装错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}

func TestEnsureAppOffline(t *testing.T) {
	t.Setenv("BROWSERPILOT_HOME", t.TempDir())
	t.Setenv("BROWSERPILOT_EXE", "")
	t.Setenv("BROWSERPILOT_OFFLINE", "1")
	stubInstallCandidates(t, nil)

	_, err := EnsureApp(context.Background(), EnsureOptions{platform: "win32", arch: "x64"})
	if !IsInstallError(err) {
		t.Fatalf("期望安装错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "离线") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
}

func TestEnsureAppDownloadsZip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BROWSERPILOT_HOME", home)
	t.Setenv("BROWSERPILOT_EXE", "")
	t.Setenv("BROWSERPILOT_OFFLINE", "")
	stubInstallCandidates(t, nil)

	// 真的安装包里一定有 resources/app.asar，缓存是否可用也靠它判断。
	archive := makeZip(t, map[string]string{
		"BrowserPilot.exe":   "fake-exe",
		"resources/app.asar": "fake-asar",
		"locales/zh-CN.pak":  "fake-locale",
	})
	assetName := "BrowserPilot-" + APPVersion + "-win.zip"
	release := newFakeRelease(t, assetName, archive, "sha256:"+sha256Hex(archive))
	stubReleaseAPI(t, release.server.URL+"/releases/tags")

	var progress []Progress
	app, err := EnsureApp(context.Background(), EnsureOptions{
		platform:   "win32",
		arch:       "x64",
		OnDownload: func(item Progress) { progress = append(progress, item) },
	})
	if err != nil {
		t.Fatalf("EnsureApp 失败：%v", err)
	}
	want := filepath.Join(home, "sdk", APPVersion, "BrowserPilot.exe")
	if app.Exe != want {
		t.Fatalf("安装路径不对：%s", app.Exe)
	}
	if app.Source != SourceDownloaded || app.Version != APPVersion {
		t.Fatalf("来源/版本不对：%#v", app)
	}
	content, err := os.ReadFile(app.Exe)
	if err != nil {
		t.Fatalf("可执行文件没解压出来：%v", err)
	}
	if string(content) != "fake-exe" {
		t.Fatalf("解压内容不对：%q", string(content))
	}
	if len(progress) == 0 {
		t.Fatal("没收到下载进度")
	}
	last := progress[len(progress)-1]
	if last.Asset != assetName || last.Received != int64(len(archive)) || last.Total != int64(len(archive)) {
		t.Fatalf("进度不对：%#v", last)
	}
	if release.downloadCount() != 1 {
		t.Fatalf("应该下载 1 次，实际 %d", release.downloadCount())
	}

	// 第二次：缓存里那份校验过，直接复用，不再下载。
	again, err := EnsureApp(context.Background(), EnsureOptions{platform: "win32", arch: "x64"})
	if err != nil {
		t.Fatalf("第二次 EnsureApp 失败：%v", err)
	}
	if again.Source != SourceCache || again.Version != APPVersion {
		t.Fatalf("应该走缓存：%#v", again)
	}
	if release.downloadCount() != 1 {
		t.Fatalf("不该重复下载，实际 %d 次", release.downloadCount())
	}
}

func TestEnsureAppRejectsBadDigest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BROWSERPILOT_HOME", home)
	t.Setenv("BROWSERPILOT_EXE", "")
	t.Setenv("BROWSERPILOT_OFFLINE", "")
	stubInstallCandidates(t, nil)

	archive := makeZip(t, map[string]string{"BrowserPilot.exe": "fake-exe"})
	assetName := "BrowserPilot-" + APPVersion + "-win.zip"
	release := newFakeRelease(t, assetName, archive, "sha256:"+strings.Repeat("0", 64))
	stubReleaseAPI(t, release.server.URL+"/releases/tags")

	_, err := EnsureApp(context.Background(), EnsureOptions{platform: "win32", arch: "x64"})
	if !IsInstallError(err) {
		t.Fatalf("期望安装错误，实际 %v", err)
	}
	if !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("错误文案不对：%s", err.Error())
	}
	if fileExists(filepath.Join(home, "downloads", assetName)) {
		t.Fatal("校验失败的包不该留下")
	}
	if fileExists(filepath.Join(home, "downloads", assetName+".part")) {
		t.Fatal(".part 临时文件不该留下")
	}
	if fileExists(filepath.Join(home, "sdk", APPVersion, "BrowserPilot.exe")) {
		t.Fatal("校验失败不该留下解压出来的可执行文件")
	}
}

func TestEnsureAppInstallsAppImage(t *testing.T) {
	home := t.TempDir()
	t.Setenv("BROWSERPILOT_HOME", home)
	t.Setenv("BROWSERPILOT_EXE", "")
	t.Setenv("BROWSERPILOT_OFFLINE", "")
	stubInstallCandidates(t, nil)

	payload := []byte("appimage-bytes")
	assetName := "BrowserPilot-" + APPVersion + ".AppImage"
	release := newFakeRelease(t, assetName, payload, "sha256:"+sha256Hex(payload))
	stubReleaseAPI(t, release.server.URL+"/releases/tags")

	app, err := EnsureApp(context.Background(), EnsureOptions{platform: "linux", arch: "x64"})
	if err != nil {
		t.Fatalf("EnsureApp 失败：%v", err)
	}
	want := filepath.Join(home, "sdk", APPVersion, "BrowserPilot.AppImage")
	if app.Exe != want {
		t.Fatalf("安装路径不对：%s", app.Exe)
	}
	content, err := os.ReadFile(app.Exe)
	if err != nil {
		t.Fatalf("AppImage 没拷出来：%v", err)
	}
	if string(content) != string(payload) {
		t.Fatalf("AppImage 内容不对：%q", string(content))
	}
}

// fakeRelease 是一个假的 GitHub Release API + 资产下载端点。
type fakeRelease struct {
	server  *httptest.Server
	name    string
	payload []byte
	digest  string

	mu        sync.Mutex
	downloads int
}

func newFakeRelease(t *testing.T, assetName string, payload []byte, digest string) *fakeRelease {
	t.Helper()
	release := &fakeRelease{name: assetName, payload: payload, digest: digest}
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/tags/v"+APPVersion, func(writer http.ResponseWriter, request *http.Request) {
		asset := map[string]any{
			"name":                 release.name,
			"browser_download_url": release.server.URL + "/assets/" + release.name,
			"size":                 len(release.payload),
		}
		if release.digest != "" {
			asset["digest"] = release.digest
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"assets": []map[string]any{asset}})
	})
	mux.HandleFunc("/assets/"+assetName, func(writer http.ResponseWriter, request *http.Request) {
		release.mu.Lock()
		release.downloads++
		release.mu.Unlock()
		_, _ = writer.Write(release.payload)
	})
	release.server = httptest.NewServer(mux)
	t.Cleanup(release.server.Close)
	return release
}

func (r *fakeRelease) downloadCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.downloads
}

func stubInstallCandidates(t *testing.T, candidates []string) {
	t.Helper()
	previous := installCandidatesHook
	installCandidatesHook = func() []string { return candidates }
	t.Cleanup(func() { installCandidatesHook = previous })
}

func stubReleaseAPI(t *testing.T, base string) {
	t.Helper()
	previous := releaseAPIBase
	releaseAPIBase = base
	t.Cleanup(func() { releaseAPIBase = previous })
}

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	buffer := new(bytes.Buffer)
	writer := zip.NewWriter(buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("建 zip 条目失败：%v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("写 zip 条目失败：%v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("收尾 zip 失败：%v", err)
	}
	return buffer.Bytes()
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
