# 贡献指南

感谢你为 Codex Manager 提交改进。项目是本地 Electron 应用，改动需要同时考虑文件边界、凭据安全和 Windows 客户端兼容性。

## 提交前检查

在项目根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:ci
pnpm run build
```

涉及界面时，请补充对应的 Electron 交互检查；涉及主题连接、账号切换或配置写入时，请使用临时目录和合成数据。不要让测试读取日常 `CODEX_HOME`、真实 `auth.json`、`config.toml` 或真实保险库。

## 提交内容

- 一个提交只解决一个清晰的问题。
- 代码、变量和函数使用英文命名；注释、错误提示和文档使用简体中文。
- 新测试放在 `tests/`；工具脚本放在 `scripts/`；技术文档放在 `docs/`。
- 不提交 `accounts.vault`、`auth.json`、`config.toml`、真实会话、构建产物、安装包或本地报告。
- 使用第三方主题、提示词或素材时，必须同时补充来源、固定版本和许可证信息。

## Pull Request

描述问题、行为变化、验证命令和已知限制。UI 改动请附截图或说明验证尺寸；发布相关改动请列出 Windows 安装器、真实客户端和其他平台中哪些已验证、哪些仍未验证。
