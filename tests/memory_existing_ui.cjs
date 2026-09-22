// 显式启动既有界面回归，检查记忆页面接入后的全局导航与工作台行为。
const { app } = require('electron')
// 仅在显式请求时绕过测试机 GPU 子进程异常，应用生产设置保持不变。
if (process.argv.includes('--software-rendering')) app.disableHardwareAcceleration()
require('./ui_redesign.cjs').run_suite().catch(error => {
  console.error('现有界面回归失败', error)
  app.exit(2)
})
