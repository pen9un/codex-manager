"""校验二十组最终截图，仅更新七组扩展缩略图，并生成完整审阅资料。"""
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont
from build_original_skins import encode_webp, write_json
from build_theme_v2 import ROOT, SKINS, refresh_catalog
from theme_v2_designs import DESIGNS, EXPANSION, RETAINED

SHOTS = ROOT/'reports/theme-v2-final-visual-1'
OUTPUT = ROOT/'reports/theme-v2-final-review'
GUIDANCE = ROOT/'reports/theme-v2-final-guidance.json'
ENGINE_SOURCES = [
    'tests/theme_preview_electron_entry.ts', 'src/main/themes.ts', 'src/main/theme_preview.ts', 'src/main/original_engine.ts',
    *(f'src/main/vendor/codex-themes/engine/{name}.ts' for name in ('payload','normalize','home-detection','constants','compiler')),
    'src/main/vendor/codex-themes/shared/tone.ts',
    'resources/theme-engine/dream-skin.css', 'resources/theme-engine/renderer-inject.js',
]


def run():
    evidence = json.loads((SHOTS/'result.json').read_text(encoding='utf-8'))
    if evidence.get('passed') is not True:
        raise ValueError('本次完整截图验收尚未通过，不得沿用旧截图')
    theme_ids = [item['id'] for item in DESIGNS] + RETAINED
    expansion_ids = {item['id'] for item in EXPANSION}
    expected = {(theme_id,mode,view,width) for theme_id in theme_ids for mode in ('light','dark') for view in ('home','task') for width in (920,1280,1920)}
    actual = {(item['id'],item['mode'],item['view'],item['width']) for item in evidence['states']}
    if (evidence.get('passed') is not True or evidence.get('full_catalog') is not True
            or evidence.get('catalog_count') != 20 or str(evidence.get('scale')) != '1'
            or len(expected) != 240 or len(evidence['states']) != 240 or actual != expected):
        raise ValueError('二十组主题的240个完整界面状态尚未通过检查')
    # 排除即将更新的缩略图和溯源；其余运行文件及实际预览引擎必须仍与验收时一致。
    input_files = [ROOT/name for name in ENGINE_SOURCES]
    for theme_id in theme_ids:
        directory = SKINS/theme_id
        input_files.extend(file for file in directory.iterdir() if file.is_file() and file.name not in ('preview-light.webp','preview-dark.webp','provenance.json'))
        if any(not (directory/name).is_file() for name in ('theme.json','original.css','hero-light.webp','hero-dark.webp')):
            raise ValueError(f'主题运行资源缺失：{theme_id}')
    input_hashes = {file.relative_to(ROOT).as_posix():hashlib.sha256(file.read_bytes()).hexdigest() for file in input_files}
    if evidence.get('input_hashes') != input_hashes:
        raise ValueError('运行资源或预览引擎源码已变更，必须重新完成截图验收')
    # 先检查全部截图与指导资料，避免把不完整或已被替换的验收结果写入运行资源。
    for state in evidence['states']:
        filename = f'{state["id"]}-{state["mode"]}-{state["view"]}-{state["width"]}.jpg'
        if state.get('screenshot') != filename or not (SHOTS/filename).is_file():
            raise ValueError(f'最终验收截图缺失或名称不符：{filename}')
        if state.get('screenshot_sha256') != hashlib.sha256((SHOTS/filename).read_bytes()).hexdigest():
            raise ValueError(f'最终验收截图内容已变更：{filename}')
    guidance_records = json.loads(GUIDANCE.read_text(encoding='utf-8'))
    guidance = {item['id']:item for item in guidance_records}
    if len(guidance_records) != 7 or set(guidance) != expansion_ids or any(not item.get('result') for item in guidance_records):
        raise ValueError('七组扩展的既有UI/UX指导记录不完整')
    provenances = {theme_id:json.loads((SKINS/theme_id/'provenance.json').read_text(encoding='utf-8')) for theme_id in expansion_ids}
    for theme_id,provenance in provenances.items():
        if any(mode not in provenance.get('assets',{}) for mode in ('light','dark')):
            raise ValueError(f'主题原画溯源缺少明暗资产：{theme_id}')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',22)
    cards = ['# 主题馆第二版完整设计卡\n',
             '日期：2026-09-20。阶段：4组已确认样板、7组扩展与9组保留主题，共20组/40外观。完整验收覆盖首页/任务页、明暗模式及920/1280/1920三档宽度，共240个状态。',
             '所有预览来自同一应用引擎的隔离固定示例，不是真实Codex客户端截图。原画由内置AI绘画生成，实际尺寸按provenance.json记录，没有插值冒充4K。',
             '本轮仅更新7组扩展的14张缩略图及其溯源记录；4组样板与9组保留主题的运行文件保持不变。11组新增作品审阅图另存于reports/theme-v2-final-review/，历史样板资料保留。',
             '扩展风格指导沿用reports/theme-v2-final-guidance.json；以下设计卡逐项记录采纳方式，不重新检索或覆盖历史指导。',
             '共同约束：操作区实色，原画不含软件文字或伪控件；任务页退出复杂背景；正文和代码遵循客户端字体偏好。\n']
    for index,item in enumerate(DESIGNS):
        theme_id = item['id']
        directory = SKINS/theme_id
        if index % 4 == 0:
            overview = Image.new('RGB',(1600,540*min(4,len(DESIGNS)-index)),'#e9edf2')
            overview_draw = ImageDraw.Draw(overview)
        sheet = Image.new('RGB',(2560,1700),'#e9edf2')
        draw = ImageDraw.Draw(sheet)
        for column,mode in enumerate(('light','dark')):
            for row,view in enumerate(('home','task')):
                shot = SHOTS/f'{theme_id}-{mode}-{view}-1280.jpg'
                with Image.open(shot) as source:
                    frame = source.convert('RGB')
                    sheet.paste(frame,(column*1280,row*850+50))
                    draw.text((column*1280+20,row*850+12),f'{item["name"]} · {"浅色" if mode=="light" else "深色"} · {"首页" if view=="home" else "任务页"}',font=font,fill='#17202b')
                    if view=='home':
                        if theme_id in expansion_ids:
                            target = directory/f'preview-{mode}.webp'
                            dimensions = encode_webp(shot,target,160*1024,640)
                            provenances[theme_id]['assets'][mode]['preview'] = dict(method='同引擎隔离 Electron 实际渲染',source=shot.relative_to(ROOT).as_posix(),dimensions=dimensions,sha256=hashlib.sha256(target.read_bytes()).hexdigest())
                        frame.thumbnail((784,490),Image.Resampling.LANCZOS)
                        overview.paste(frame,(column*800+8,(index%4)*540+42))
                        overview_draw.text((column*800+14,(index%4)*540+8),f'{item["name"]} · {"浅色" if mode=="light" else "深色"}',font=font,fill='#17202b')
        sheet.save(OUTPUT/f'{theme_id}-review.jpg',quality=94)
        if theme_id in expansion_ids:
            write_json(directory/'provenance.json',provenances[theme_id])
        if index % 4 == 3 or index == len(DESIGNS)-1:
            overview.save(OUTPUT/f'home-overview-{index//4+1}.jpg',quality=94)
        style_query = guidance.get(theme_id,{}).get('query',item['query'])
        cards.extend([f'## {item["name"]}\n',f'- 内容来源：`{item["content_kind"]}`；分类：`{item["category"]}`。',
                      f'- 受众：{"、".join(item["tags"])}。{item["description"]}',
                      f'- 风格指导：`{style_query}`。{item["guidance"]}',
                      f'- 浅色：底色{item["light"][0]}，面板{item["light"][1]}，强调色{item["light"][6]}；深色：底色{item["dark"][0]}，面板{item["dark"][1]}，强调色{item["dark"][6]}。',
                      f'- 界面：{item["layout"]}，{item["density"]}密度，{item["radius"]}圆角；左侧操作面板，右侧完整场景，禁用横向cover裁切。',
                      f'- 动效：{item["motion"]}，仅环境层；总开关、失焦、隐藏、减少动态效果与任务页优先暂停。',
                      '- 状态：实色输入区、可见边界、悬停强调边框、2px焦点外框；选中态使用本组强调色。',
                      '- 原画参考：'+('；'.join(item['references']) or '原创硬件静物与独立场景构图'),
                      f'- 源图：assets/theme-v2/{theme_id}/；完整提示词、尺寸和SHA-256：resources/skins/{theme_id}/provenance.json。',
                      f'- 审阅图：reports/theme-v2-final-review/{theme_id}-review.jpg。{"已确认样板，本轮运行资源保持不变" if theme_id not in expansion_ids else "本轮扩展作品"}；真实客户端检查未完成。\n'])
    cards.extend(['## 九组保留主题\n','运行资源保持不变，完整状态纳入上述240个截图检查。',
                  '、'.join(f'`{theme_id}`' for theme_id in RETAINED)+'。\n',
                  '## 验收与分页总览\n','完整结果：reports/theme-v2-final-visual-1/result.json。',
                  '首页总览：reports/theme-v2-final-review/home-overview-1.jpg、home-overview-2.jpg、home-overview-3.jpg。',
                  '同引擎截图通过仅证明隔离示例下的状态检查完成；不等同于真实Codex客户端、打包安装或人工审美验收通过。'])
    (ROOT/'docs/主题馆第二版完整设计卡-20260920.md').write_text('\n'.join(cards),encoding='utf-8')
    refresh_catalog()
    print('已校验20组240个状态，生成七组扩展的14张真实渲染缩略图、11组审阅图、3页总览及完整设计卡')


if __name__=='__main__':
    run()
