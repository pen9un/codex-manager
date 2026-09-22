// 验证本地看图页的切换与图片完整性，并输出可直接审阅的四组总览。
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const output = path.resolve(__dirname, '../reports/theme-ui-samples-20260921')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
async function run() {
  await app.whenReady()
  const window = new BrowserWindow({ width: 1400, height: 1250, useContentSize: true, show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadFile(path.join(output, 'review.html'))
  const js = expression => window.webContents.executeJavaScript(expression)
  const captures = [
    ['overview-light', ''],
    ['overview-dark', `document.querySelector('[data-mode="dark"]').click()`],
    ['overview-components', `document.querySelector('[data-view="components"]').click()`],
    ['overview-without-art', `document.querySelector('#hide-art').click()`],
  ]
  for (const [name, action] of captures) {
    if (action) await js(action)
    await js(`Promise.all([...document.images].map(image=>image.decode()))`)
    assert.equal(await js(`document.querySelectorAll('article').length`), 4)
    assert.equal(await js(`[...document.images].every(image=>image.complete&&image.naturalWidth===1280)`), true)
    assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`), true)
    assert.equal(await js(`document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight`), true, '四组与说明必须完整出现在总览中')
    await new Promise(resolve => setTimeout(resolve, 150))
    await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
  }
  await fs.writeFile(path.join(output, 'review-page.json'), JSON.stringify({ passed: true, captures: captures.map(item=>item[0]), kind: '隔离预览截图总览，不是真实客户端' }, null, 2))
  console.log('四组样板看图页与总览截图验证通过')
  app.exit(0)
}
run().catch(error=>{console.error('看图页验证失败：',error);app.exit(1)})
