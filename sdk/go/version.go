package browserpilot

// SDK 版本号和 App 版本号同号，和 sdk/node/src/version.ts、sdk/python 里的常量一起，
// 由 sdk/scripts/sync-version.mjs 从根 package.json 同步。这里只留一个真源。
const (
	// APPVersion 是当前 SDK 对应的 App 版本，下载资产和严格版本校验都用它。
	APPVersion = "0.21.0"
	// SDKVersion 是本 SDK 自己的版本，正常情况下和 APPVersion 相等。
	SDKVersion = "0.21.0"
)
