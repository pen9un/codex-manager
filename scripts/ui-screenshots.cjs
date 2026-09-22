// 保留现有命令入口，实际界面测试统一放在 tests 目录。
const { app } = require('electron')
require('../tests/ui_redesign.cjs').run_suite('full').catch(error => { console.error('界面验证失败：', error); app.exit(2) })
