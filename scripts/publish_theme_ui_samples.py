"""把已通过的隔离界面截图转为主题缩略图与本地看图验收页面。"""
import hashlib
import html
import json
from pathlib import Path
from build_original_skins import encode_webp
from build_theme_ui_samples import ROOT, SAMPLES, refresh_hashes, write_json

REPORT = ROOT / 'reports/theme-ui-samples-20260921'


def publish():
    source = REPORT / 'visual-1'
    result = json.loads((source / 'result.json').read_text(encoding='utf-8'))
    if result.get('passed') is not True or len(result['states']) != 96:
        raise ValueError('四组完整尺寸验收未通过，不能发布缩略图')
    for name, digest in result['runtime_hashes'].items():
        if hashlib.sha256((ROOT / 'resources/skins' / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'验收后资源已变化，需要重新检查：{name}')
    designs = []
    for theme_id in SAMPLES:
        directory = ROOT / 'resources/skins' / theme_id
        config = json.loads((directory / 'theme.json').read_text(encoding='utf-8'))
        provenance = json.loads((directory / 'provenance.json').read_text(encoding='utf-8'))
        for mode in ('light', 'dark'):
            screenshot = source / f'{theme_id}-{mode}-home-1280.jpg'
            encode_webp(screenshot, directory / f'preview-{mode}.webp', 160 * 1024, 720)
            provenance['assets'][mode]['preview'] = dict(method='同引擎隔离 Electron 实际渲染',
                view='home', viewport=[1280, 800], screenshot=str(screenshot.relative_to(ROOT)).replace('\\', '/'),
                screenshot_sha256=hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                note='完整界面第一批样板；模拟结构，不是真实Codex客户端截图')
        write_json(directory / 'provenance.json', provenance)
        designs.append(dict(id=theme_id, name=config['name'], description={
            'fruit-base':'冰蓝舷窗 · 胶囊控件 · 暖金定位线',
            'lulu-duo':'奶油便签 · 饼干压边 · 可可夜色',
            'totoro-stop':'木质封边 · 叶片轮廓 · 森林站房',
            'zero-day':'哑光直角 · 紧凑分区 · 终端定位线',
        }[theme_id]))
    refresh_hashes()
    cards = ''.join(f'<article><header><h2>{html.escape(item["name"])}</h2><p>{item["description"]}</p></header><a class="image-link" href="visual-1/{item["id"]}-light-home-1280.jpg" target="_blank" rel="noopener"><img data-theme="{item["id"]}" src="visual-1/{item["id"]}-light-home-1280.jpg" alt="{html.escape(item["name"])}浅色首页隔离预览"></a></article>' for item in designs)
    page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>完整界面主题 · 四组样板</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f5;color:#202c3d;font:14px/1.6 'Segoe UI','Microsoft YaHei UI',sans-serif}main{max-width:1680px;margin:auto;padding:28px 32px}h1{font-size:26px;margin:0 0 6px;letter-spacing:-.035em}.intro{color:#526176;margin:0 0 20px}nav{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:24px}nav>div{display:flex;gap:3px;border:1px solid #b4bfcb;border-radius:10px;padding:3px;background:#e5eaf0}button{border:0;background:transparent;border-radius:7px;padding:8px 14px;font:inherit;color:#44556c;cursor:pointer}button[aria-pressed=true]{background:#fff;color:#16253d;box-shadow:0 1px 5px #20334916}button:focus-visible,a:focus-visible{outline:3px solid #2768ac;outline-offset:3px}label{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}article{background:white;border:1px solid #ced6df;border-radius:16px;overflow:hidden}article header{padding:16px 20px 12px}article h2{font-size:17px;margin:0;letter-spacing:-.02em}article p{margin:3px 0 0;font-size:12px;color:#57677b}article img{width:100%;display:block;aspect-ratio:16/10;object-fit:contain;background:#fff}.image-link{display:block}footer{font-size:12px;color:#526176;margin-top:20px}.badge{float:right;color:#526176;font-size:12px;border:1px solid #b4bfcb;padding:4px 10px;border-radius:20px}input{accent-color:#2863a3}@media(max-width:900px){main{padding:20px}.grid{grid-template-columns:1fr}label{margin-left:0}.badge{float:none;display:inline-block;margin-bottom:10px}}
</style></head><body><main><span class="badge">隔离示例 · 真实 Codex 待验证</span><h1>完整界面主题 · 第一批四组样板</h1><p class="intro">比较标题栏、会话列表、输入区与弹窗。点击任意图片查看原尺寸。</p><nav><div aria-label="外观模式"><button data-mode="light" aria-pressed="true">浅色</button><button data-mode="dark" aria-pressed="false">深色</button></div><div aria-label="界面场景"><button data-view="home" aria-pressed="true">首页</button><button data-view="task" aria-pressed="false">任务页</button><button data-view="settings" aria-pressed="false">设置</button><button data-view="components" aria-pressed="false">菜单与弹窗</button></div><label><input id="hide-art" type="checkbox">隐藏主图，比较组件设计</label></nav><div class="grid">__CARDS__</div><footer>主图沿用现有素材；本批升级4组，其余16组等待本批看图确认。窗口系统控件为示例，不代表系统原生边框已换肤。</footer></main><script>
let mode='light',view='home';function update(){const hidden=document.querySelector('#hide-art').checked;document.querySelectorAll('img[data-theme]').forEach(img=>{const suffix=hidden?'without-art':view+'-1280';img.src='visual-1/'+img.dataset.theme+'-'+mode+'-'+suffix+'.jpg';img.parentElement.href=img.src;img.alt=img.dataset.theme+' '+(mode==='light'?'浅色':'深色')+' '+(hidden?'隐藏主图':view)+'隔离预览'});document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));}document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;update()});document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelector('#hide-art').checked=false;update()});document.querySelector('#hide-art').onchange=()=>{view='home';update()};
</script></body></html>'''.replace('__CARDS__', cards)
    (REPORT / 'review.html').write_text(page, encoding='utf-8')
    print('已更新八张首页缩略图与四组样板看图页面')


if __name__ == '__main__':
    publish()
