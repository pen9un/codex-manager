"""整理第二版主题素材，默认只制作已确认样板之后的七组扩展。"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from build_original_skins import encode_webp, write_json
from theme_v2_designs import DESIGNS, EXPANSION, RETAINED, RETIRED, CATEGORIES, palette, theme_css
from build_theme_ui_samples import COMPONENT_THEMES as UI_SAMPLES, apply_component_style

ROOT = Path(__file__).resolve().parents[1]
SKINS = ROOT/'resources/skins'
ASSETS = ROOT/'assets/theme-v2'

def refresh_catalog():
    entries = []
    for theme_id in [item['id'] for item in DESIGNS] + RETAINED:
        directory = SKINS/theme_id
        if not (directory/'theme.json').is_file():
            raise ValueError(f'完整目录缺少主题：{theme_id}')
        config = json.loads((directory/'theme.json').read_text(encoding='utf-8'))
        kind = config['codexManager'].get('content_kind','original')
        entries.append(dict(id=theme_id,original=kind=='original',content_kind=kind,version=config['version'],
                            hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir()) if p.is_file()}))
    write_json(SKINS/'catalog.json', entries)
    print(f'已登记{len(entries)}组主题，包含40个明暗外观')

def migrate():
    archive = ASSETS/'retired-20260920'
    for theme_id in RETIRED:
        source = (SKINS/theme_id).resolve()
        target = (archive/theme_id).resolve()
        if source.parent != SKINS.resolve() or target.parent != archive.resolve():
            raise ValueError('归档路径超出本项目主题目录')
        if source.exists():
            if target.exists():
                raise ValueError(f'已有归档，拒绝覆盖：{target}')
            archive.mkdir(parents=True,exist_ok=True)
            shutil.move(str(source),str(target))
    for theme_id in RETAINED:
        file = SKINS/theme_id/'theme.json'
        config = json.loads(file.read_text(encoding='utf-8'))
        config['codexManager'].update(category=CATEGORIES[theme_id],content_kind='original',original=True)
        write_json(file,config)

def build(styles_only=False, selected=None):
    sources = json.loads((ASSETS/'sources.json').read_text(encoding='utf-8'))
    expansion_sources = ASSETS/'final-sources.json'
    if expansion_sources.exists():
        sources.update(json.loads(expansion_sources.read_text(encoding='utf-8')))
    chosen = selected if selected is not None else [item['id'] for item in EXPANSION]
    if not chosen or any(theme_id not in [item['id'] for item in DESIGNS] for theme_id in chosen):
        raise ValueError('制作列表必须使用已登记的第二版主题ID')
    for item in DESIGNS:
        if item['id'] not in chosen:
            continue
        theme_id = item['id']; destination=SKINS/theme_id
        destination.mkdir(parents=True,exist_ok=True)
        if styles_only:
            (destination/'original.css').write_text(theme_css(item),encoding='utf-8')
            if theme_id in UI_SAMPLES:
                apply_component_style(theme_id)
            continue
        master_root = ASSETS/theme_id
        master_root.mkdir(parents=True,exist_ok=True)
        prior_file=destination/'provenance.json'
        prior=json.loads(prior_file.read_text(encoding='utf-8')) if prior_file.exists() else {}
        records={}
        for mode in ('light','dark'):
            source = sources[f'{theme_id}-{mode}']; master=master_root/f'{mode}.png'
            shutil.copy2(source['path'],master)
            dimensions=encode_webp(master,destination/f'hero-{mode}.webp',2*1024*1024)
            thumbnail=destination/f'preview-{mode}.webp'
            if not thumbnail.exists():
                # 临时自举缩略图，正式交付由同引擎界面截图覆盖。
                encode_webp(master,thumbnail,160*1024,640)
            records[mode]=dict(method='内置 image_gen AI 绘画',prompt=source['prompt'],native_dimensions=dimensions,
                               source_sha256=hashlib.sha256(master.read_bytes()).hexdigest(),references=source['references'],
                               operation='参考同组浅色图重绘夜间光照' if mode=='dark' else '按角色参考与独立构图生成')
            old=prior.get('assets',{}).get(mode,{})
            if old.get('source_sha256')==records[mode]['source_sha256'] and 'preview' in old:
                records[mode]['preview']=old['preview']
        kind=item['content_kind']; original=kind=='original'
        config=dict(schemaVersion=2,uuid=f'codex-manager-{theme_id}',id=theme_id,version='1.0.0',minEngineVersion='2.0.0',
                    name=item['name'],description=item['description'],tagline=item['tagline'],tags=item['tags'],hero='hero-light.webp',preview='preview-light.webp',
                    light=palette(item['light']),dark=palette(item['dark']),layout=item['layout'],heroFit='contain',heroFocusX=.75,heroFocusY=.5,heroZoom=1,heroHeight=440,
                    heroTextAlign='left',heroScrim=0,wallpaperEnabled=False,wallpaperFocusX=.5,wallpaperFocusY=.5,wallpaperOpacity=0,wallpaperBlur=0,
                    radius=item['radius'],density=item['density'],fontPreset='system',glass=False,shadow='sm',decoration=0,
                    effects=dict(particles=0,aurora=0,glow=0,noise=0,grid=0,float=0),brandSubtitle=item['name'],projectPrefix='项目 · ',projectLabel='选择项目',statusText='专注此刻',quote=item['tagline'],
                    codexManager=dict(category=item['category'],art={m:f'hero-{m}.webp' for m in ('light','dark')},thumbnails={m:f'preview-{m}.webp' for m in ('light','dark')},style='original.css',motion=item['motion'],original=original,content_kind=kind))
        write_json(destination/'theme.json',config)
        write_json(destination/'provenance.json',dict(original=original,content_kind=kind,ai_generated=True,theme=item['name'],assets=records,
                   preview='同一引擎隔离固定示例；不是实际用户会话截图',references=item['references']))
        (destination/'original.css').write_text(theme_css(item),encoding='utf-8')
        subject={'original':'角色与场景为本项目原创设计。','ip-recreation':'角色属于其原IP；本主题为AI绘制的场景再创作，非官方联名。','user-characters':'角色由用户提供；本主题将其统一为3D材质并重新设计场景。'}[kind]
        (destination/'LICENSE.txt').write_text(f'主题配置与样式按项目MIT许可证分发。{subject}\n角色权利不因AI绘制而改变，本文件不授予第三方角色权利。\n',encoding='utf-8')
        (destination/'NOTICE.txt').write_text(f'{item["name"]}\n{subject}\n运行图像由内置AI绘画生成，不使用下载壁纸作为运行主图。\n底层codex-themes引擎及声明保留。其他工具可能忽略codexManager扩展，不能保证完整还原。\n',encoding='utf-8')
        print(f'已整理主题：{item["name"]}')
        if theme_id in UI_SAMPLES:
            apply_component_style(theme_id)
    refresh_catalog()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='制作主题馆第二版完整目录；默认只更新七组扩展')
    parser.add_argument('--styles-only',action='store_true')
    parser.add_argument('--migrate',action='store_true')
    parser.add_argument('--ids',help='可选，使用逗号分隔的主题ID')
    args=parser.parse_args()
    if args.migrate:migrate()
    build(args.styles_only,args.ids.split(',') if args.ids else None)
