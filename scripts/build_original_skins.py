"""整理 AI 原图、生成主题配方并校验发行资源。"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SKINS = ROOT / 'resources' / 'skins'
SOURCE = ROOT / 'assets' / 'original-themes'

# 各主题分别定义阅读底色与强调色，正文色通过对比度门槛检查。
DESIGNS = [
 ('pine-retreat','苔原松风','nature','在松风与雾气之间，慢慢深入。','松林、山雾和温润石色，安放一段安静的专注。',['自然','松林','舒缓'],'dream-banner','md','spacious','none','#f3f6f0','#32664b','#15221e','#a7d2ad',.72,.48),
 ('tidal-letter','潮汐来信','nature','把思绪交给潮汐，把灵感留在此刻。','海岸漫射光与潮线，带来通透清爽的工作氛围。',['海岸','清爽','通透'],'dream-banner','md','normal','none','#f0f7f9','#186880','#10222e','#8fd9e8',.70,.50),
 ('ink-landscape','纸上山河','nature','胸有丘壑，落笔有声。','原创水墨山势、宣纸留白与一点朱砂。',['国风','水墨','阅读'],'paper-board','sm','spacious','none','#f7f3ea','#9c3d32','#25221f','#e7a18c',.75,.50),
 ('orbital-harbor','星港远航','cyber','下一次探索，从这里启航。','原创轨道空间站与遥远行星，打开辽阔的想象。',['科幻','星空','沉浸'],'full-canvas','md','normal','orbit','#eef6f8','#176879','#0d1b2c','#85ddec',.77,.48),
 ('neon-rain','霓虹雨巷','cyber','城市入夜，灵感亮起。','未来街景与雨夜反射，青紫霓虹只在边缘发光。',['赛博','霓虹','都市'],'dream-banner','sm','normal','rain','#f1f1f9','#6745b4','#18172d','#b9a0f2',.72,.48),
 ('floating-courier','浮岛信使','anime','带着好奇，寄往未曾抵达的地方。','云海浮岛与原创飞行信使，展开绘本式冒险。',['幻想','绘本','冒险'],'dream-banner','lg','spacious','cloud','#f1f6f5','#337084','#1d2940','#edc995',.73,.49),
 ('cloud-cottage','绒云小筑','companions','有个柔软的小世界，等你回来。','原创绒毛伙伴与微缩居所，给工作一点温柔陪伴。',['可爱','陪伴','立体'],'split-studio','lg','spacious','float','#f5f7f0','#3c7267','#292530','#cfb8eb',.73,.52),
 ('skyward-journal','晴空绘旅','anime','沿着光的方向，画出下一段旅程。','原创成年旅行创作者，陪你从晴空走向暮色。',['二次元','原创人物','明亮冒险'],'split-studio','md','normal','breeze','#f1f6fd','#245ea5','#18253c','#f1bd91',.79,.38),
 ('moonlit-serenade','月下弦歌','anime','在城市安静之后，听见自己的节奏。','原创成年音乐创作者与月夜天台，沉静而富有层次。',['二次元','原创人物','月夜都市'],'split-studio','md','normal','moonlight','#f3f2f9','#59529d','#1c1e35','#c7bbef',.77,.38),
]

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def palette(background, accent, dark, high_contrast=False):
    return {'background':background,'panel':background,'panelAlt':'#29323e' if dark else '#e7ecf2',
            'surface':'#202934' if dark else '#ffffff','text':'#ffffff' if dark else '#17202b',
            'muted':('#f0f2f6' if high_contrast else '#c2c9d2') if dark else ('#29313c' if high_contrast else '#4c5766'),
            'border':'#8996a8' if dark else '#7b8798','accent':accent,'accentAlt':accent,
            'secondary':accent,'highlight':accent}

def encode_webp(source_path, target, max_bytes, width=None):
    with Image.open(source_path) as image:
        image = image.convert('RGB')
        if width and image.width > width:
            image.thumbnail((width, round(width * image.height / image.width)), Image.Resampling.LANCZOS)
        for quality in (92, 87, 82, 76, 68):
            image.save(target, 'WEBP', quality=quality, method=6)
            if target.stat().st_size <= max_bytes:
                return list(image.size)
    raise ValueError(f'图片压缩后仍超过限制：{target.name}')

def theme_css(theme_id, layout):
    # 扩展只绑定当前原创主题，不覆盖代码或终端的语义颜色。
    selector = f'html.codex-dream-skin[data-dream-theme="{theme_id}"]'
    focus = '3px' if theme_id == 'clarity' else '2px'
    art_height = '300px' if layout in ('minimal-focus', 'terminal-grid') else '100%'
    art_position = 'right top' if layout in ('minimal-focus', 'terminal-grid') else 'var(--ds-hero-position)'
    density = next(design[8] for design in DESIGNS if design[0] == theme_id)
    spacing = {'compact': 10, 'normal': 14, 'spacious': 18}[density]
    reading_width = {'compact': 820, 'normal': 780, 'spacious': 740}[density]
    return f'''/* 原创主题：{theme_id}，仅调整视觉，不拦截原生交互。 */
{selector} {{ --cm-focus-width: {focus}; --cm-home-spacing:{spacing}px; }}
{selector}[data-original-theme] body {{background:var(--ds-bg)!important;}}
{selector}[data-original-theme] body::before,{selector}[data-original-theme] body::after {{display:none!important;}}
{selector} :is(button,a,input,textarea,[contenteditable]):focus-visible {{outline:{focus} solid var(--ds-accent);outline-offset:3px;}}
{selector}[data-original-theme] :is(main.main-surface,main.dream-skin-main-surface).dream-skin-home-shell {{
 background-color:var(--ds-bg)!important;
 background-image:linear-gradient(90deg,var(--ds-bg) 0%,color-mix(in srgb,var(--ds-bg) 98%,transparent) 30%,color-mix(in srgb,var(--ds-bg) 82%,transparent) 54%,color-mix(in srgb,var(--ds-bg) 8%,transparent) 100%),var(--original-art)!important;
 background-size:100% 100%,auto {art_height}!important;background-position:center,{art_position}!important;background-repeat:no-repeat!important;
 border-radius:0!important;box-shadow:none!important;
}}
{selector}[data-original-theme] :is(.app-shell-left-panel,.dream-skin-sidebar) {{background:var(--ds-panel)!important;border-radius:0!important;box-shadow:none!important;}}
{selector}[data-original-theme] :is(.composer-surface-chrome,.dream-skin-composer) {{background:var(--ds-panel)!important;border:1px solid var(--ds-line)!important;box-shadow:none!important;border-radius:var(--ds-radius,12px)!important;}}
{selector}[data-original-theme] :is(.composer-surface-chrome,.dream-skin-composer)::before,
{selector}[data-original-theme] :is(.composer-surface-chrome,.dream-skin-composer)::after {{display:none!important;}}
{selector}[data-original-theme] #codex-dream-skin-chrome {{display:none!important;}}
{selector} [class~="group/home-suggestions"] button {{box-shadow:none!important;transform:none!important;background:var(--ds-panel)!important;color:var(--ds-text)!important;}}
{selector}[data-original-theme] .dream-skin-home-shell [class~="group/home-suggestions"] {{gap:var(--cm-home-spacing)!important;}}
{selector}[data-original-theme] .dream-skin-home-shell {{ --thread-content-max-width:{reading_width}px; }}
{selector}[data-original-theme] :is(.preview-welcome,[data-feature="game-source"]) {{background:var(--ds-bg);border-radius:var(--ds-radius);box-shadow:0 0 24px 18px var(--ds-bg);}}
{selector}[data-original-theme] :is(.preview-hint,.preview-eyebrow) {{background:var(--ds-bg);width:fit-content;}}
{selector}[data-original-theme] :is(button,a):hover {{border-color:var(--ds-green);}}
{selector}[data-original-theme] ::selection {{background:var(--ds-green);color:var(--ds-bg);}}
{selector}[data-original-theme] :is(main.main-surface,main.dream-skin-main-surface):not(.dream-skin-home-shell) {{background:var(--ds-bg)!important;}}
{selector} :is(pre,code,.xterm,.monaco-editor) {{text-shadow:none!important;}}
{selector} .dream-skin-home .dream-skin-washi, {selector} .dream-skin-home .dream-skin-corner {{display:none!important;}}
'''

def build(source_map, selected=None):
    for design in DESIGNS:
        theme_id,name,category,tagline,description,tags,layout,radius,density,motion,light_bg,light_accent,dark_bg,dark_accent,fx,fy=design
        if selected and theme_id not in selected:
            continue
        entries = {mode:source_map.get(f'{theme_id}-{mode}') for mode in ('light','dark')}
        if not all(entries.values()):
            continue
        destination = SKINS / theme_id
        masters = SOURCE / theme_id
        destination.mkdir(parents=True, exist_ok=True)
        masters.mkdir(parents=True, exist_ok=True)
        records = {}
        for mode, entry in entries.items():
            master = masters / f'{mode}.png'
            shutil.copy2(entry['path'], master)
            dimensions = encode_webp(master, destination / f'hero-{mode}.webp', 2*1024*1024)
            thumbnail = destination / f'preview-{mode}.webp'
            if not thumbnail.exists():
                # 仅供渲染自举，发行前由同引擎截图覆盖。
                encode_webp(master, thumbnail, 160*1024, 640)
            records[mode] = {'method':'内置 image_gen AI 绘画','prompt':entry['prompt'],'native_dimensions':dimensions,
                             'source_sha256':hashlib.sha256(master.read_bytes()).hexdigest()}
        config = {'schemaVersion':2,'uuid':f'codex-manager-{theme_id}','id':theme_id,'version':'1.0.0','minEngineVersion':'2.0.0',
                  'name':name,'description':description,'tagline':tagline,'tags':tags,'hero':'hero-light.webp','preview':'preview-light.webp',
                  'light':palette(light_bg,light_accent,False,theme_id=='clarity'),'dark':palette(dark_bg,dark_accent,True,theme_id=='clarity'),
                  'layout':layout,'heroFit':'cover','heroFocusX':fx,'heroFocusY':fy,'heroZoom':1,'heroHeight':260 if category=='professional' else 360,
                  'heroTextAlign':'left','heroScrim':0,'wallpaperEnabled':False,'wallpaperFocusX':.5,'wallpaperFocusY':.5,'wallpaperOpacity':0,'wallpaperBlur':0,
                  'radius':radius,'density':density,'fontPreset':'system','glass':False,'shadow':'none' if category=='professional' else 'sm','decoration':0,
                  'effects':{'particles':0,'aurora':0,'glow':0,'noise':0,'grid':0,'float':0},
                  'brandSubtitle':name,'projectPrefix':'项目 · ','projectLabel':'选择项目','statusText':'专注此刻','quote':tagline,
                  'codexManager':{'category':category,'art':{m:f'hero-{m}.webp' for m in entries},'thumbnails':{m:f'preview-{m}.webp' for m in entries},'style':'original.css','motion':motion,'original':True,'content_kind':'original'}}
        write_json(destination/'theme.json',config)
        write_json(destination/'provenance.json',{'original':True,'ai_generated':True,'theme':name,'assets':records,'preview':'由同一主题渲染引擎的隔离示例界面生成；不是实际用户会话截图'})
        (destination/'original.css').write_text(theme_css(theme_id,layout),encoding='utf-8')
        (destination/'LICENSE.txt').write_text('原创主题配置与样式按本项目 MIT 许可证分发。图像由内置 AI 绘画为本项目生成，可随本主题使用和分发。保留本说明。\n',encoding='utf-8')
        (destination/'NOTICE.txt').write_text(f'{name} · Codex-Manager 原创主题\n图像为 AI 生成原创素材，不使用第三方主题的图像、角色和文案。\n底层主题引擎沿用 codex-themes，相关声明保留在应用许可证中。\n.codextheme 基础字段兼容 schema v2；其他工具可能不支持 codexManager 明暗素材、样式和动效扩展。\n',encoding='utf-8')
        from build_theme_ui_samples import COMPONENT_THEMES, apply_component_style
        if theme_id in COMPONENT_THEMES:
            apply_component_style(theme_id)
        print(f'已整理原创主题：{name}')

def catalog():
    # 第二版目录统一入口，旧脚本不再恢复退出主题或覆盖来源标记。
    from build_theme_v2 import refresh_catalog
    refresh_catalog()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='整理原创主题资源')
    parser.add_argument('--sources',type=Path)
    parser.add_argument('--ids',nargs='*')
    parser.add_argument('--catalog',action='store_true')
    parser.add_argument('--styles-only',action='store_true')
    args=parser.parse_args()
    if args.sources:
        build(json.loads(args.sources.read_text(encoding='utf-8')),args.ids)
    if args.styles_only:
        for design in DESIGNS:
            destination = SKINS/design[0]
            if destination.exists():
                (destination/'original.css').write_text(theme_css(design[0],design[6]),encoding='utf-8')
                from build_theme_ui_samples import COMPONENT_THEMES, apply_component_style
                if design[0] in COMPONENT_THEMES:
                    apply_component_style(design[0])
    if args.catalog:
        catalog()
