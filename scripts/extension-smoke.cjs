// 扩展冒烟只使用隔离数据，覆盖真实预加载桥接和主进程文件操作。
const { app } = require('electron')
require('../tests/ui_redesign.cjs').run_suite('extensions').catch(error => { console.error('扩展验证失败：', error); app.exit(2) })
