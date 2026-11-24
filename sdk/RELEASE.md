# 发布 SDK

三个语言的包各有各的地址规则，先把名字和地址记下来：

| | 发布名 | 地址 | 谁维护 |
| --- | --- | --- | --- |
| Python | `browserpilot-sdk` | <https://pypi.org/project/browserpilot-sdk/> | PyPI 账号 `xiaoyun2003` |
| Node | `browserpilot` | <https://www.npmjs.com/package/browserpilot> | npm 账号 `dev_xiaoyun` |
| Go | `github.com/xy200303/browserpilot/sdk/go` | 仓库 tag `sdk/go/vX.Y.Z` | 仓库本身 |

## 为什么 Python 不叫 browserpilot

PyPI 上 `browserpilot` 已经被一个 Selenium 时代的项目占了（最新 0.2.53，作者 handrew）。
装的时候是 `pip install browserpilot-sdk`，装完 `import browserpilot` 不变。

## 一次性准备

1. **npm**：用 `dev_xiaoyun` 登录，在 <https://www.npmjs.com/settings/dev_xiaoyun/tokens> 建一个
   Automation token，存成仓库 secret `NPM_TOKEN`。
2. **PyPI**：用 `xiaoyun2003` 登录，在 <https://pypi.org/manage/account/token/> 建一个
   project-scoped token（scope 选 `browserpilot-sdk`），存成仓库 secret `PYPI_TOKEN`。
3. **Go**：不用做任何事。仓库是公开的，tag 打上去就能被 `go get` 解析。

## 发一个版本

```bash
# 1. 改根 package.json 的 version（三个 SDK 跟它同号）
# 2. 同步三个语言里的版本常量
node sdk/scripts/sync-version.mjs

# 3. 提交
git add -A && git commit -m "发布 <version>"

# 4. 打 tag 并推送，CI 会跑测试、发 npm、发 PyPI、补 Go tag
git tag sdk/v<version>
git push origin main --tags
```

`release-sdk` 工作流会：

1. `sync-version --check` 确认三个语言没漂移
2. 校验 tag 和 `package.json` 的版本一致
3. 跑三套单元测试（Node / Python / Go，含 `go vet` 和 `gofmt`）
4. `npm publish`、`twine upload`
5. 打 `sdk/go/v<version>` 并推上去

只想验证打包而不发布，就在 GitHub 上手动触发这个工作流，`dry_run` 默认是 true。

## 发完怎么确认

```bash
npm view browserpilot version
pip index versions browserpilot-sdk
go list -m github.com/xy200303/browserpilot/sdk/go@v<version>
```

## 注意

- **PyPI 的版本号不能重发**：同一个版本号上传过就不能再传，只能换号。发之前先本地 `python -m build`
  看一眼 `dist/` 里的文件对不对。
- **npm 也允许覆盖**：`npm publish` 之后 72 小时内可以 `npm unpublish`，超过就只能发新版本。
- **Go 的 tag 不能乱动**：`sdk/go/vX.Y.Z` 推上去之后，Go 模块代理会缓存它，改 tag 会让不同人拿到不同内容。
