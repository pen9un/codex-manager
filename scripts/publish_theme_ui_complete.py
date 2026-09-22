"""根据完整矩阵验收记录发布二十组主题缩略图和本地看图页面。"""
import argparse
import hashlib
import html
import json
import subprocess
from pathlib import Path
from build_original_skins import encode_webp
from build_theme_ui_samples import ROOT, COMPONENT_THEMES, refresh_hashes, write_json


def publish(report):
    source = report / 'visual-1'
    result = json.loads((source / 'result.json').read_text(encoding='utf-8'))
    expected = {(theme_id, mode, view, width) for theme_id in COMPONENT_THEMES
                for mode in ('light', 'dark') for view in ('home', 'task', 'settings', 'components')
                for width in (920, 1280, 1920)}
    actual = {(item['id'], item['mode'], item['view'], item['width']) for item in result.get('states', [])}
    if result.get('passed') is not True or actual != expected or len(result['states']) != len(expected):
        raise ValueError('二十组完整尺寸验收未通过，不能发布缩略图')
    expected_resources = {f'{theme_id}/{name}' for theme_id in COMPONENT_THEMES
                          for name in ('theme.json', 'original.css', 'hero-light.webp', 'hero-dark.webp')}
    if set(result['runtime_hashes']) != expected_resources:
        raise ValueError('主题资源摘要不完整')
    for name, digest in result['runtime_hashes'].items():
        if hashlib.sha256((ROOT / 'resources/skins' / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'验收后资源已变化，需要重新检查：{name}')
    engine_files = ('dream-skin.css', 'renderer-inject.js')
    if set(result.get('engine_resource_hashes', {})) != set(engine_files):
        raise ValueError('运行引擎资源摘要不完整')
    for name in engine_files:
        if hashlib.sha256((ROOT / 'resources/theme-engine' / name).read_bytes()).hexdigest() != result['engine_resource_hashes'][name]:
            raise ValueError(f'运行引擎资源在验收后发生变化：{name}')
    # 直接执行 Node，不经 shell 插值；复核实际预览入口及其全部打包依赖。
    script = """const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=path.resolve('node_modules/.pnpm');const esbuild=require(path.join(store,fs.readdirSync(store).find(x=>x.startsWith('esbuild@')),'node_modules/esbuild'));
const bundle=esbuild.buildSync({entryPoints:[path.resolve('tests/theme_preview_electron_entry.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
process.stdout.write(crypto.createHash('sha256').update(bundle).digest('hex'));"""
    current_engine = subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True).strip()
    if current_engine != result['engine_bundle_sha256']:
        raise ValueError('预览引擎在验收后发生变化')
    for item in result['states']:
        filename = f"{item['id']}-{item['mode']}-{item['view']}-{item['width']}.jpg"
        if item['screenshot'] != filename or hashlib.sha256((source / filename).read_bytes()).hexdigest() != item['sha256']:
            raise ValueError(f'界面截图与验收记录不一致：{filename}')
    expected_art = {f'{theme_id}-{mode}-without-art.jpg' for theme_id in COMPONENT_THEMES for mode in ('light', 'dark')}
    if {item['screenshot'] for item in result.get('without_art', [])} != expected_art or len(result['without_art']) != 40:
        raise ValueError('无主图对照记录不完整')
    for item in result['without_art']:
        if hashlib.sha256((source / item['screenshot']).read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('无主图对照图片与验收记录不一致')
    cards = []
    for theme_id in COMPONENT_THEMES:
        directory = ROOT / 'resources/skins' / theme_id
        config = json.loads((directory / 'theme.json').read_text(encoding='utf-8'))
        provenance = json.loads((directory / 'provenance.json').read_text(encoding='utf-8'))
        for mode in ('light', 'dark'):
            screenshot = source / f'{theme_id}-{mode}-home-1280.jpg'
            record = next(item for item in result['states'] if item['screenshot'] == screenshot.name)
            digest = hashlib.sha256(screenshot.read_bytes()).hexdigest()
            if digest != record['sha256']:
                raise ValueError(f'截图与验收记录不一致：{screenshot.name}')
            encode_webp(screenshot, directory / f'preview-{mode}.webp', 160 * 1024, 720)
            provenance['assets'][mode]['preview'] = dict(method='同引擎隔离 Electron 实际渲染',
                view='home', viewport=[1280, 800], screenshot=screenshot.as_posix(), screenshot_sha256=digest,
                engine_bundle_sha256=result['engine_bundle_sha256'], note='完整界面第二批；模拟结构，不是真实Codex截图')
        write_json(directory / 'provenance.json', provenance)
        name = html.escape(config['name'])
        cards.append(f'<article><h2>{name}</h2><a target="_blank" rel="noopener"><img data-theme="{theme_id}" alt="{name}隔离预览"></a></article>')
    refresh_hashes()
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>二十组完整界面主题</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#243348;font:15px/1.6 'Segoe UI','Microsoft YaHei UI',sans-serif}main{max-width:1800px;margin:auto;padding:28px}h1{margin:0;font-size:28px}p{color:#53647a}nav{display:flex;gap:14px;flex-wrap:wrap;position:sticky;top:0;background:#edf1f5;padding:16px 0;z-index:1}label{display:flex;align-items:center;gap:8px}select{padding:8px;border:1px solid #71829b;border-radius:6px;font:inherit;background:white;color:inherit}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #a6b3c4;border-radius:14px;overflow:hidden}h2{font-size:17px;margin:14px 18px}img{display:block;width:100%;aspect-ratio:16/10;object-fit:contain}a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #286ca8;outline-offset:3px}@media(max-width:900px){.grid{grid-template-columns:1fr}main{padding:18px}}
</style><main><h1>二十组完整界面主题</h1><p>比较标题栏、会话列表、输入区、设置与弹窗。此处全部为同引擎隔离预览；真实客户端验证范围单独记入验收报告。</p>
<nav><label>外观<select id="mode"><option value="light">浅色</option><option value="dark">深色</option></select></label><label>页面<select id="view"><option value="home">首页</option><option value="task">任务页</option><option value="settings">设置</option><option value="components">菜单与弹窗</option></select></label><label>窗口<select id="width"><option>1280</option><option>920</option><option>1920</option></select></label><label><input type="checkbox" id="hide-art">隐藏首页主图</label></nav>
<div class="grid">__CARDS__</div></main><script>
const mode=document.querySelector('#mode'),view=document.querySelector('#view'),width=document.querySelector('#width'),hide=document.querySelector('#hide-art');function update(){document.querySelectorAll('img').forEach(img=>{img.src='visual-1/'+img.dataset.theme+'-'+mode.value+'-'+(hide.checked?'without-art':view.value+'-'+width.value)+'.jpg';img.parentElement.href=img.src})}for(const item of [mode,view,width,hide])item.onchange=()=>{if(item===view||item===width)hide.checked=false;update()};update();
</script></html>'''.replace('__CARDS__', ''.join(cards))
    (report / 'review.html').write_text(page, encoding='utf-8')
    print('已发布四十张完整界面缩略图及二十组看图页面')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='发布通过验收的完整主题界面')
    parser.add_argument('--report', required=True, type=Path, help='完整视觉验收目录')
    publish(parser.parse_args().report.resolve())
