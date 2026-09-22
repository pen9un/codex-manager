// 从矢量主文件生成窗口、托盘与安装器使用的 PNG；不新增应用运行时依赖。
const path = require('node:path')
const sharp = require('sharp')
const root = path.resolve(__dirname, '..')
sharp(path.join(root, 'resources/icon.svg')).resize(512, 512).png().toFile(path.join(root, 'resources/icon.png'))
  .then(() => console.log('已从矢量源生成应用图标'))
  .catch(error => { console.error('图标生成失败：', error.message); process.exitCode = 1 })
