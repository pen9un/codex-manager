// 检查主题资源与布局；仅显式传入 --apply 时应用主题，不读取任务正文或编辑器内容。
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const store = path.join(root, 'node_modules/.pnpm')
const esbuild = require(path.join(store, fs.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
const compiled = new Module(__filename, module)
compiled.filename = __filename; compiled.paths = module.paths
compiled._compile(esbuild.buildSync({ entryPoints: [path.join(root, 'tests/theme_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename)
const { ThemeRuntime, launch_codex_theme, connect_codex_theme, close_owned_inspectors, discover_theme_processes, open_runtime_connection } = compiled.exports
async function main() {
  let connections = []
  try {
    await launch_codex_theme()
    const apply_id = process.argv.find(value => value.startsWith('--apply='))?.slice(8)
    if (apply_id) {
      const runtime = new ThemeRuntime(path.join(process.env.APPDATA, 'Codex-Manager/theme-backups'), connect_codex_theme, path.join(root, 'resources'))
      await runtime.resume()
      await runtime.apply(apply_id)
    }
    connections = await connect_codex_theme()
    for (const connection of connections) {
      const result = await connection.evaluate(`(async()=>{
        const describe=n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {tag:n.tagName,class:n.className,width_var:s.getPropertyValue('--thread-content-max-width'),attributes:[...n.attributes].map(a=>a.name),part:n.getAttribute('data-cm-theme-part'),background:s.backgroundImage,color:s.backgroundColor,position:s.position,z:s.zIndex,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}};
        const art=getComputedStyle(document.documentElement).getPropertyValue('--original-art').trim();
        const url=art.match(/^url\\(["']?(.*?)["']?\\)$/)?.[1];
        let image;
        if(url){const img=new Image();img.src=url;image=await img.decode().then(()=>({loaded:true,width:img.naturalWidth,height:img.naturalHeight})).catch(e=>({loaded:false,error:String(e)}))}
        const mains=[...document.querySelectorAll('main')];
        const message=document.querySelector('.thread-scroll-container article,.thread-scroll-container [class*="markdown"], [data-message-author-role="assistant"]');
        const ancestors=[];for(let n=message;n&&ancestors.length<12;n=n.parentElement)ancestors.push(describe(n));
        return {theme:window.__CODEX_DREAM_SKIN_STATE__?.themeId,mode:document.documentElement.dataset.originalMode,image,home:!!document.querySelector('main.dream-skin-home-shell'),main:mains.map(describe),ancestors,threads:[...document.querySelectorAll('.thread-scroll-container')].map(n=>({self:describe(n),parent:describe(n.parentElement)}))};
      })()`)
      const output = path.join(root, 'reports/theme-background-fix-20260921')
      fs.mkdirSync(output, { recursive: true })
      fs.writeFileSync(path.join(output, 'current.json'), JSON.stringify(result, null, 2))
      if (process.argv.includes('--capture')) {
        const [, pid, window_id] = connection.id.split(':').map(Number)
        const candidate = (await discover_theme_processes()).find(item => item.pid === pid)
        if (!candidate) throw Error('截图前目标进程已变化')
        for (const port of candidate.ports) {
          const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => [])
          const target = targets.find(item => item.type === 'node' && new URL(item.webSocketDebuggerUrl).hostname === '127.0.0.1' && Number(new URL(item.webSocketDebuggerUrl).port) === port)
          if (!target) continue
          const main_connection = await open_runtime_connection('theme-screenshot', target.webSocketDebuggerUrl)
          try {
            if (await main_connection.evaluate('process.pid') !== pid) throw Error('截图进程身份不一致')
            const clip = await connection.evaluate(`(()=>{const r=document.querySelector('.thread-scroll-container').getBoundingClientRect();return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
            const image = await main_connection.evaluate(`(async()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return (await e.BrowserWindow.fromId(${window_id}).webContents.capturePage(${JSON.stringify(clip)})).toPNG().toString('base64')})()`)
            fs.writeFileSync(path.join(output, 'real-task.png'), Buffer.from(image, 'base64'))
          } finally { main_connection.close() }
          break
        }
      }
      console.log('主题布局诊断：' + JSON.stringify({ theme: result.theme, mode: result.mode, image: result.image, backgrounds: result.threads.map(item => item.self.background), output }))
    }
  } finally { connections.forEach(connection => connection.close()); await close_owned_inspectors() }
}
main().catch(error => { console.error('诊断失败：', error); process.exitCode = 1 })
