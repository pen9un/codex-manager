// 在测试进程中模拟 Windows DPI，不修改用户显示设置。
const { app } = require('electron')
const ratio = process.argv[2] || '1'
if (!['1', '1.25', '1.5'].includes(ratio)) throw Error('缩放比例必须为 1、1.25 或 1.5')
app.commandLine.appendSwitch('force-device-scale-factor', ratio)
require('./ui_redesign.cjs').run_suite('scaling').catch(error => { console.error(error); app.exit(2) })
