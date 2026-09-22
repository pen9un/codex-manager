@echo off
setlocal EnableExtensions
chcp 65001 >nul

rem 无论从哪个目录调用，都以应用根目录运行构建。
cd /d "%~dp0.."
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%I in (`node -p "require('./package.json').version"`) do set "APP_VERSION=%%I"
if not defined APP_VERSION (
  echo [错误] 无法读取 package.json 中的版本号。
  exit /b 1
)
echo 当前打包版本：v%APP_VERSION%

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 pnpm，请先安装：npm install -g pnpm
  exit /b 1
)

echo [1/4] 安装锁定依赖...
call pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

echo [2/4] 执行完整测试...
call pnpm run test:ci
if errorlevel 1 goto :failed

echo [3/4] 构建应用...
call pnpm run build
if errorlevel 1 goto :failed

echo [4/4] 打包 Windows 安装程序...
set "ELECTRON_DIST="
for /f "usebackq delims=" %%I in (`node -p "require('path').join(require('path').dirname(require.resolve('electron')), 'dist')"`) do set "ELECTRON_DIST=%%I"

if exist "%ELECTRON_DIST%\electron.exe" (
  echo 使用本地 Electron 运行时：%ELECTRON_DIST%
  call pnpm exec electron-builder --win nsis --x64 --publish never --config.electronDist="%ELECTRON_DIST%"
) else (
  echo 未找到本地 Electron 运行时，将按环境配置下载...
  call pnpm exec electron-builder --win nsis --x64 --publish never
)
if errorlevel 1 goto :failed

echo.
echo 打包完成。
echo 输出目录：%CD%\releases
exit /b 0

:failed
set "BUILD_EXIT=%errorlevel%"
echo.
echo [错误] 打包失败，退出码：%BUILD_EXIT%
exit /b %BUILD_EXIT%
