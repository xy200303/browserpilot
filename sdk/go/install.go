package browserpilot

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// releaseAPIBase 是 GitHub Release API 的前缀。测试会把它换成 httptest 地址。
var releaseAPIBase = "https://api.github.com/repos/xy200303/browserpilot/releases/tags"

// installCandidatesHook 让测试能屏蔽这台机器上真装了的 App，别让测试结果依赖运行环境。
var installCandidatesHook = func() []string {
	platform, _ := CurrentPlatform()
	return InstallCandidates(platform, OSEnv())
}

// AssetKind 是发布资产的类型。
type AssetKind string

const (
	// AssetZip 是打包成 zip 的桌面版。
	AssetZip AssetKind = "zip"
	// AssetAppImage 是 Linux 的 AppImage，一个文件就是全部。
	AssetAppImage AssetKind = "appimage"
)

// Asset 描述一份发布产物。
type Asset struct {
	// Name 是 Release 里的资产文件名。
	Name string
	// Kind 决定下载完是解压还是直接拷。
	Kind AssetKind
	// Exe 是应用本体相对安装目录的路径。
	Exe string
}

// AssetFor 给出某个平台对应的发布产物。
//
// 这里是实际存在的组合，不是猜的：发布流水线只产出 Windows x64、macOS arm64、
// Linux x64 三个平台。别的组合直接报错，不要下到一半才发现。
// platform 用发布产物的命名（win32 / darwin / linux），arch 是 x64 / arm64。
func AssetFor(version, platform, arch string) (Asset, error) {
	switch {
	case platform == "win32" && arch == "x64":
		return Asset{Name: "BrowserPilot-" + version + "-win.zip", Kind: AssetZip, Exe: "BrowserPilot.exe"}, nil
	case platform == "darwin" && arch == "arm64":
		return Asset{
			Name: "BrowserPilot-" + version + "-arm64-mac.zip",
			Kind: AssetZip,
			Exe:  filepath.Join("BrowserPilot.app", "Contents", "MacOS", "BrowserPilot"),
		}, nil
	case platform == "linux" && arch == "x64":
		return Asset{Name: "BrowserPilot-" + version + ".AppImage", Kind: AssetAppImage, Exe: "BrowserPilot.AppImage"}, nil
	}
	return Asset{}, newInstallError(fmt.Sprintf(
		"没有 %s-%s 的 BrowserPilot 构建。目前只发布 Windows x64、macOS arm64、Linux x64。"+
			"如果你本机已经装了桌面版，把 BROWSERPILOT_EXE 指向它就能用。", platform, arch))
}

// AppSource 说明这份 App 是从哪儿来的。
type AppSource string

const (
	// SourceEnv 来自 BROWSERPILOT_EXE 或显式指定。
	SourceEnv AppSource = "env"
	// SourceInstalled 是用户装的桌面版。
	SourceInstalled AppSource = "installed"
	// SourceCache 是之前下载到 ~/.browserpilot/sdk/ 里的副本。
	SourceCache AppSource = "cache"
	// SourceDownloaded 是这次刚下载的。
	SourceDownloaded AppSource = "downloaded"
)

// AppLocation 是一个可用的 BrowserPilot。
type AppLocation struct {
	// Exe 是可执行文件路径。
	Exe string
	// Source 说明它是怎么找到的。
	Source AppSource
	// Version 只有 SDK 自己下的那份才知道确切版本。
	Version string
}

// Progress 是一次下载进度回调。
type Progress struct {
	// Asset 是正在下载的资产文件名。
	Asset string
	// Received 是已经收到的字节数。
	Received int64
	// Total 是总字节数，服务端没给就是 0。
	Total int64
}

// EnsureOptions 控制「找一份能用的 BrowserPilot」。
type EnsureOptions struct {
	// Exe 显式指定可执行文件，优先于环境变量。
	Exe string
	// Version 指定要装的版本，默认跟 SDK 同号。
	Version string
	// Offline 只找不下载。
	Offline bool
	// OnDownload 收下载进度，可以拿来画进度条。
	OnDownload func(Progress)
	// Log 收过程日志，比如「下载 xxx」。
	Log func(string)

	// platform / arch 覆盖宿主平台，只给测试用。
	platform string
	arch     string
}

// FindInstalled 找一份装好的 App，不做任何网络请求。给 doctor 用。
func FindInstalled(exe string) (*AppLocation, error) {
	return LocateApp(EnsureOptions{Exe: exe, Offline: true})
}

// LocateApp 按「显式指定 → 桌面版安装位置 → SDK 缓存」找一份能用的 App，不下载。
// 找不到返回 (nil, nil)：不是错误，只是该走下载流程了。
func LocateApp(options EnsureOptions) (*AppLocation, error) {
	explicit := options.Exe
	if explicit == "" {
		explicit = OSEnv()("BROWSERPILOT_EXE")
	}
	if explicit != "" {
		if !fileExists(explicit) {
			return nil, newInstallError("BROWSERPILOT_EXE 指向的 " + explicit + " 不存在")
		}
		return &AppLocation{Exe: explicit, Source: SourceEnv}, nil
	}

	for _, candidate := range installCandidatesHook() {
		if LooksLikeApp(candidate) {
			return &AppLocation{Exe: candidate, Source: SourceInstalled}, nil
		}
	}

	version := options.version()
	asset, err := assetFor(options, version)
	if err != nil {
		return nil, err
	}
	cached := filepath.Join(SDKDir(version), asset.Exe)
	if LooksLikeApp(cached) {
		return &AppLocation{Exe: cached, Source: SourceCache, Version: version}, nil
	}
	return nil, nil
}

// EnsureApp 拿到一份能用的 BrowserPilot：先找，找不到再下载。
// 下载会校验 SHA-256，解压到 ~/.browserpilot/sdk/<version>/。
func EnsureApp(ctx context.Context, options EnsureOptions) (*AppLocation, error) {
	found, err := LocateApp(options)
	if err != nil {
		return nil, err
	}
	if found != nil {
		return found, nil
	}

	if options.Offline || OSEnv()("BROWSERPILOT_OFFLINE") == "1" {
		return nil, newInstallError("没找到 BrowserPilot，而且现在是离线模式（BROWSERPILOT_OFFLINE=1）。")
	}

	version := options.version()
	exe, err := downloadApp(ctx, options, version)
	if err != nil {
		return nil, err
	}
	return &AppLocation{Exe: exe, Source: SourceDownloaded, Version: version}, nil
}

func (o EnsureOptions) version() string {
	if o.Version != "" {
		return o.Version
	}
	return APPVersion
}

func (o EnsureOptions) platformArch() (string, string) {
	if o.platform != "" && o.arch != "" {
		return o.platform, o.arch
	}
	return CurrentPlatform()
}

func (o EnsureOptions) log(message string) {
	if o.Log != nil {
		o.Log(message)
	}
}

func assetFor(options EnsureOptions, version string) (Asset, error) {
	platform, arch := options.platformArch()
	return AssetFor(version, platform, arch)
}

type releaseAssetInfo struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	Digest             string `json:"digest"`
}

func releaseAsset(ctx context.Context, version, name string) (*releaseAssetInfo, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, releaseAPIBase+"/v"+version, nil)
	if err != nil {
		return nil, newInstallError("查 v"+version+" 的发行版失败", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "browserpilot-sdk")
	// 没登录的 GitHub API 是 60 次/小时，CI 里塞个 token 更稳。
	if token := OSEnv()("GITHUB_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return nil, newInstallError("查 v"+version+" 的发行版失败", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, newInstallError("GitHub 上没有 v" + version + " 这个版本")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, newInstallError(fmt.Sprintf("GitHub 返回 %d，可能触发了限流", response.StatusCode))
	}

	var payload struct {
		Assets []releaseAssetInfo `json:"assets"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, newInstallError("v"+version+" 的发行版信息不是合法 JSON", err)
	}
	for index := range payload.Assets {
		if payload.Assets[index].Name == name {
			return &payload.Assets[index], nil
		}
	}
	return nil, newInstallError("v" + version + " 里没有 " + name)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func downloadApp(ctx context.Context, options EnsureOptions, version string) (string, error) {
	asset, err := assetFor(options, version)
	if err != nil {
		return "", err
	}
	info, err := releaseAsset(ctx, version, asset.Name)
	if err != nil {
		return "", err
	}

	downloads := DownloadsDir()
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		return "", newInstallError("建不了下载目录 "+downloads, err)
	}
	archive := filepath.Join(downloads, asset.Name)
	partial := archive + ".part"
	expected := strings.TrimPrefix(info.Digest, "sha256:")

	// 上次下好且校验通过就不再下。
	reusable := false
	if fileExists(archive) {
		if expected == "" {
			reusable = true
		} else if actual, err := sha256File(archive); err == nil && actual == expected {
			reusable = true
		}
	}

	if !reusable {
		options.log(fmt.Sprintf("下载 %s（%d MB）", asset.Name, info.Size/1024/1024))
		if err := downloadTo(ctx, info, asset.Name, partial, expected, options); err != nil {
			return "", err
		}
		if err := os.Rename(partial, archive); err != nil {
			return "", newInstallError("下载完挪不动 "+archive, err)
		}
	}

	target := SDKDir(version)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", newInstallError("建不了安装目录 "+target, err)
	}

	if asset.Kind == AssetAppImage {
		exe := filepath.Join(target, asset.Exe)
		if err := copyFile(archive, exe); err != nil {
			return "", newInstallError("装不了 "+exe, err)
		}
		if err := chmodExec(exe); err != nil {
			return "", err
		}
		return exe, nil
	}

	if err := extractZip(archive, target); err != nil {
		return "", err
	}
	exe := filepath.Join(target, asset.Exe)
	if !fileExists(exe) {
		return "", newInstallError("解压后没找到 " + asset.Exe)
	}
	if err := chmodExec(exe); err != nil {
		return "", err
	}
	return exe, nil
}

func downloadTo(ctx context.Context, info *releaseAssetInfo, assetName, partial, expected string, options EnsureOptions) error {
	// 网慢的时候 30 分钟够下完；比 Node 那边的 AbortSignal.timeout 一样长。
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, info.BrowserDownloadURL, nil)
	if err != nil {
		return newInstallError("下载失败", err)
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return newInstallError("下载失败", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return newInstallError(fmt.Sprintf("下载失败：HTTP %d", response.StatusCode))
	}

	file, err := os.Create(partial)
	if err != nil {
		return newInstallError("写不了 "+partial, err)
	}

	total := info.Size
	if response.ContentLength > 0 {
		total = response.ContentLength
	}
	hash := sha256.New()
	received := int64(0)
	buffer := make([]byte, 64*1024)
	for {
		read, readErr := response.Body.Read(buffer)
		if read > 0 {
			if _, err := file.Write(buffer[:read]); err != nil {
				file.Close()
				os.Remove(partial)
				return newInstallError("下载中断", err)
			}
			hash.Write(buffer[:read])
			received += int64(read)
			if options.OnDownload != nil {
				options.OnDownload(Progress{Asset: assetName, Received: received, Total: total})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			os.Remove(partial)
			return newInstallError("下载中断", readErr)
		}
	}
	if err := file.Close(); err != nil {
		os.Remove(partial)
		return newInstallError("下载中断", err)
	}

	actual := hex.EncodeToString(hash.Sum(nil))
	if expected != "" && expected != actual {
		// 半成品不能留着，否则下次会被当成可复用的包。
		os.Remove(partial)
		return newInstallError(fmt.Sprintf("SHA-256 不匹配：期望 %s，实际 %s", expected, actual))
	}
	return nil
}

// extractZip 用标准库解压。路径越界的条目直接拒绝，别让压缩包写到目录外面去。
func extractZip(archive, target string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return newInstallError("解压失败：读不了 "+archive, err)
	}
	defer reader.Close()

	root := filepath.Clean(target)
	for _, entry := range reader.File {
		name := filepath.FromSlash(entry.Name)
		if name == "" {
			continue
		}
		destination := filepath.Join(root, name)
		if destination != root && !strings.HasPrefix(destination, root+string(os.PathSeparator)) {
			return newInstallError("压缩包里有越界路径 " + entry.Name)
		}
		if strings.HasSuffix(entry.Name, "/") || entry.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0o755); err != nil {
				return newInstallError("解压失败：建不了 "+destination, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return newInstallError("解压失败：建不了 "+filepath.Dir(destination), err)
		}
		if err := extractEntry(entry, destination); err != nil {
			return err
		}
	}
	return nil
}

func extractEntry(entry *zip.File, destination string) error {
	source, err := entry.Open()
	if err != nil {
		return newInstallError("解压失败："+entry.Name, err)
	}
	defer source.Close()

	data, err := io.ReadAll(source)
	if err != nil {
		return newInstallError("解压失败："+entry.Name, err)
	}

	// macOS 的 .app 里可能有符号链接，压平了应用会起不来。
	if entry.Mode()&os.ModeSymlink != 0 {
		os.Remove(destination)
		if err := os.Symlink(string(data), destination); err == nil {
			return nil
		}
		// Windows 上没权限建符号链接，退回写普通文件。
	}

	permissions := entry.Mode().Perm()
	if permissions == 0 {
		permissions = 0o644
	}
	if err := os.WriteFile(destination, data, permissions); err != nil {
		return newInstallError("解压失败："+entry.Name, err)
	}
	return nil
}

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = io.Copy(output, input)
	return err
}

func chmodExec(path string) error {
	// Windows 上 chmod 只认只读位，调用是无害的。
	if err := os.Chmod(path, 0o755); err != nil {
		return newInstallError("改不了执行权限："+path, err)
	}
	return nil
}
