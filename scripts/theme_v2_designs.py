"""第二版主题设计：四组已确认样板与七组扩展作品。"""

SAMPLES = [
    dict(id='fruit-base', name='小果与大果 · 并肩小基地', category='companions', content_kind='user-characters',
         tagline='一起，把小想法变成大世界。', description='小果认真动手，大果热情搭把手。属于两只企鹅的晨光与星夜基地。',
         tags=['双角色', '圆润3D', '陪伴'], layout='split-studio', radius='lg', density='normal', motion='float',
         light=['#edf5ff','#f7faff','#dce9f8','#142c48','#425a75','#5b7594','#2360ba'],
         dark=['#101e37','#182b46','#213652','#f1f7ff','#c0d0e5','#93aac7','#9ac8ff'],
         query='claymorphism', guidance='圆润材质与柔和层次，采用可见边界；不让角色整体弹跳。',
         references=['用户图2：小果','用户图3：大果']),
    dict(id='lulu-duo', name='噜噜与噜妹 · 慢半拍搭档', category='trending', content_kind='ip-recreation',
         tagline='慢半拍，也能一起完成。', description='一块饼干，两杯热茶。让软乎乎的搭档陪你轻松开工。',
         tags=['噜噜噜妹', '软萌', '松弛感'], layout='split-studio', radius='lg', density='spacious', motion='cloud',
         light=['#f8f1e5','#fffaf2','#f0e4d3','#382719','#68513c','#846c54','#925020'],
         dark=['#241b17','#32251e','#3b2e25','#fff4e4','#deccb5','#b09a7d','#f1be7d'],
         query='claymorphism', guidance='柔软圆角和低层次阴影，角色材质与操作面板分离，保留呆萌表情。',
         references=['https://www.chinalicensingexpo.com/cn/product/1849','https://www.sina.cn/news/detail/5331448510808568.html']),
    dict(id='totoro-stop', name='龙猫 · 森林候车站', category='anime', content_kind='ip-recreation',
         tagline='下一站，去有风的地方。', description='树荫、雨后田野和安静的龙猫，陪你等一束新的灵感。',
         tags=['龙猫', '手绘动画', '森林'], layout='dream-banner', radius='md', density='spacious', motion='breeze',
         light=['#eff3e7','#f8faef','#e2e9d8','#243521','#4e6346','#637a59','#346036'],
         dark=['#132723','#1b332c','#244137','#f0f6e8','#c3d7bf','#8da98b','#c3dea6'],
         query='organic biophilic', guidance='植物色彩与手绘场景；纸感只放装饰边缘，不将纹理铺进正文。',
         references=['https://www.ghibli.jp/works/totoro/']),
    dict(id='zero-day', name='零日终端', category='geek', content_kind='original',
         tagline='保持好奇，深入每一行。', description='真实硬件质感、清楚的边界与克制的绿色光，进入你的专注工作站。',
         tags=['黑客', '终端', '硬件'], layout='terminal-grid', radius='sm', density='compact', motion='none',
         light=['#ecf0ed','#f5f8f5','#dce5de','#142c21','#3b5748','#53705e','#19633f'],
         dark=['#0c1411','#111f18','#1a2c21','#e5fff0','#b4d2bd','#739b80','#87efac'],
         query='dark oled', guidance='深色实底与绿色强调，技术细节放到硬件原画，正文不做扫描和闪烁。',
         references=[]),
]

EXPANSION = [
    dict(id='chiikawa-camp',name='吉伊卡哇 · 小小冒险队',category='trending',content_kind='ip-recreation',
         tagline='小小的我们，也有大大的冒险。',description='吉伊、小八和乌萨奇的草地营地，一起出发，一起收获微小的快乐。',
         tags=['吉伊卡哇','手绘','露营'],layout='paper-board',radius='lg',density='spacious',motion='breeze',
         light=['#f5f8ee','#fffdf5','#e8eedc','#253528','#506344','#6c805b','#35624b'],
         dark=['#202137','#292b45','#33364f','#fff8eb','#d5d4e4','#969cb8','#e9c9a0'],
         query='flat design',guidance='采纳平面设计的清晰轮廓与短时颜色反馈，圆角和糖果色服务手绘角色；不添加假仪表盘。',
         panel_width=40,panel_radius='24px 24px 24px 8px',panel_border='2px',
         references=['https://www.chiikawaofficial.com/characters']),
    dict(id='labubu-forest',name='LABUBU · 怪趣森林',category='trending',content_kind='ip-recreation',
         tagline='给好奇心，留一片森林。',description='卷曲蕨叶、柔软苔藓与顽皮的LABUBU，在微光中遇见一点怪趣。',
         tags=['LABUBU','潮玩','奇趣森林'],layout='split-studio',radius='lg',density='normal',motion='float',
         light=['#f0f5e9','#fafbef','#e0ead9','#283b31','#51654e','#687e62','#35614a'],
         dark=['#241c32','#30263e','#3c314b','#faf2ff','#d6c7e4','#a690b3','#dcb8f4'],
         query='claymorphism',guidance='绒毛与搪胶材质只呈现在角色，控件采用柔和内外层次与大圆角；深色重新校验文本与边界。',
         panel_radius='30px',panel_shadow='inset 0 0 0 5px var(--ds-panel-2),0 14px 36px #15251b22',
         references=['https://www.popmart.com/us/collection/11/the-monsters','https://www.popmart.com/us/products/675/the-monsters---exciting-macaron-vinyl-face-blind-box']),
    dict(id='sea-train',name='千与千寻 · 海上列车',category='anime',content_kind='ip-recreation',
         tagline='让思绪，随列车驶向远方。',description='千寻与无脸男的安静旅途，窗外水天相接，车灯映亮新的章节。',
         tags=['千与千寻','海上列车','安静旅途'],layout='dream-banner',radius='md',density='spacious',motion='moonlight',
         light=['#edf5f6','#f7fbfa','#dae8e9','#243944','#49616a','#637e84','#286172'],
         dark=['#242638','#303044','#3b3b51','#fff5e8','#d3cddd','#a49ab7','#edc095'],
         query='organic biophilic',guidance='采纳自然色彩、流动构图与低成本层次，用车窗般圆角区分阅读面板；保持通透水蓝与暮紫独立光照。',
         panel_radius='12px 36px 12px 12px',panel_width=42,
         references=['https://www.ghibli.jp/works/chihiro/']),
    dict(id='cloud-castle',name='哈尔 · 云上城堡',category='anime',content_kind='ip-recreation',
         tagline='在云与风之间，发现新的可能。',description='哈尔与苏菲并肩眺望移动城堡，晴空、星夜与炉火交织成一段奇遇。',
         tags=['哈尔','苏菲','动画幻想'],layout='dream-banner',radius='md',density='spacious',motion='cloud',
         light=['#f5f2e9','#fffbf1','#e9e3d6','#353828','#646048','#84785e','#5c6231'],
         dark=['#17243a','#203049','#2a3c55','#fff5e6','#d2d5df','#9ba9bc','#f0c18d'],
         query='organic biophilic',guidance='自然天光与温暖纸色，柔和不对称圆角；不用正文纹理，星夜炉火仅作为环境氛围。',
         panel_width=40,panel_radius='28px 10px 28px 10px',
         references=['https://www.ghibli.jp/works/howl/']),
    dict(id='pixel-studio',name='像素开发部',category='geek',content_kind='original',
         tagline='一格一格，把想法变成现实。',description='复古电脑、小机器人与明亮工位，用像素世界的秩序开启一天。',
         tags=['像素','复古电脑','机器人'],layout='terminal-grid',radius='sm',density='compact',motion='none',
         light=['#f4efdf','#fff8e8','#e6dfc9','#28353b','#526163','#6b7b75','#235e6c'],
         dark=['#172430','#20303f','#293d4b','#f9f0d9','#cbd3d4','#99aeb8','#edc07b'],
         query='retro futurism',guidance='保留像素、复古电脑与方形边框；拒绝扫描线、故障闪烁、文字霓虹与覆盖原生等宽字号。',
         panel_radius='0',panel_border='2px',panel_shadow='5px 5px 0 var(--ds-line)',
         references=[]),
    dict(id='crystal-core',name='透明机核',category='geek',content_kind='original',
         tagline='看见结构，也看见创造的力量。',description='透明机箱、冷却回路与精密线路，在干净的结构光里进入专注。',
         tags=['硬件极客','透明机箱','精密结构'],layout='split-studio',radius='md',density='compact',motion='none',
         light=['#edf3f6','#f8fbfd','#dce7ee','#233a48','#4b606c','#677e8d','#265e84'],
         dark=['#111e2c','#192a3b','#21384b','#eff9ff','#bdcfdf','#8daabe','#9ad8ff'],
         query='glassmorphism',guidance='玻璃透射和金属反光放入主图；界面仅使用清楚的细边框与内描边，面板不透出复杂线路。',
         panel_radius='10px',panel_shadow='inset 0 0 0 4px var(--ds-panel-2),0 12px 36px #091d3320',
         references=[]),
    dict(id='neon-rider',name='霓虹疾行',category='cyber',content_kind='original',
         tagline='穿过雨幕，驶向下一个灵感。',description='成年机车骑手与未来街区，青紫霓虹沿机械轮廓流动，操作区始终清楚。',
         tags=['赛博朋克','机车','原创人物'],layout='full-canvas',radius='sm',density='normal',motion='rain',
         light=['#f0eff7','#faf9ff','#e4e1ef','#302a47','#5e5471','#817292','#64408e'],
         dark=['#161a31','#20253e','#2a314c','#f3f5ff','#c7cce3','#939fbf','#aebeff'],
         query='cyberpunk',guidance='霓虹限定环境与面板边缘，使用切角感与双线轮廓；浅色采用独立雨雾配色，拒绝持续闪烁、正文扫描与假监控。',
         panel_radius='4px 24px 4px 4px',panel_border='2px',panel_shadow='5px 5px 0 var(--ds-panel-2)',
         references=[]),
]

NEW_ORDER = ['fruit-base','lulu-duo','chiikawa-camp','labubu-forest','totoro-stop','sea-train','cloud-castle','pixel-studio','crystal-core','zero-day','neon-rider']
DESIGNS = sorted(SAMPLES + EXPANSION,key=lambda item:NEW_ORDER.index(item['id']))
RETAINED = ['pine-retreat','tidal-letter','ink-landscape','orbital-harbor','neon-rain','floating-courier','cloud-cottage','skyward-journal','moonlit-serenade']
RETIRED = ['porcelain-court','graphite-workshop','precision-blueprint','clarity','apricot-journal']
CATEGORIES = {'pine-retreat':'nature','tidal-letter':'nature','ink-landscape':'nature','orbital-harbor':'cyber','neon-rain':'cyber','floating-courier':'anime','cloud-cottage':'companions','skyward-journal':'anime','moonlit-serenade':'anime'}

def palette(values):
    background, panel, panel_alt, text, muted, border, accent = values
    return dict(background=background,panel=panel,panelAlt=panel_alt,surface=panel,text=text,muted=muted,border=border,accent=accent,accentAlt=accent,secondary=accent,highlight=accent)

def theme_css(design):
    """新主题采用场景与操作分区，已确认样板的默认样式保持不变。"""
    selector = f'html.codex-dream-skin[data-dream-theme="{design["id"]}"][data-original-theme]'
    radius = design.get('panel_radius',{'lg':'22px','md':'14px','sm':'4px'}[design['radius']])
    shadow = design.get('panel_shadow','none' if design['id']=='zero-day' else '0 12px 40px #08192c18')
    border = design.get('panel_border','2px' if design['id'] in ('fruit-base','zero-day') else '1px')
    width = design.get('panel_width',44)
    narrow_width = design.get('panel_width',46)
    heading_wrap = f'\n{selector} main.dream-skin-home-shell h1 {{text-wrap:balance;}}' if design in EXPANSION else ''
    return f'''/* {design['name']}：角色展示与真实操作分区，任务页保持阅读底色。 */
{selector} {{ --cm-sample-radius:{radius};--cm-sample-border:{border}; }}
{selector} body {{background:var(--ds-bg)!important;}}
{selector} body::before,{selector} body::after,{selector} #codex-dream-skin-chrome {{display:none!important;}}
{selector} :is(main.main-surface,main.dream-skin-main-surface).dream-skin-home-shell {{
 background-color:var(--ds-bg)!important;background-image:var(--original-art)!important;
 background-size:100% auto!important;background-position:center center!important;background-repeat:no-repeat!important;
 padding:48px 30px!important;border-radius:0!important;box-shadow:none!important;min-height:100vh;
}}
{selector} main.dream-skin-home-shell > .dream-skin-role-main {{
 width:{width}%!important;max-width:580px!important;min-width:0!important;margin:0!important;padding:28px!important;
 background:var(--ds-panel)!important;border:{border} solid var(--ds-line)!important;border-radius:{radius}!important;
 box-shadow:{shadow}!important;position:relative;z-index:1;
}}
{selector} main.dream-skin-home-shell .dream-skin-home {{min-width:0!important;max-width:100%!important;width:100%!important;}}
{selector} main.dream-skin-home-shell .preview-native-home {{padding-top:0!important;}}
{selector} .preview-welcome h1 {{font-size:clamp(23px,2.1vw,34px)!important;line-height:1.4!important;letter-spacing:-.035em!important;}}{heading_wrap}
{selector} :is(.preview-welcome,.preview-hint,.preview-eyebrow) {{background:none!important;box-shadow:none!important;}}
{selector} :is(.app-shell-left-panel,.dream-skin-sidebar) {{background:var(--ds-panel)!important;border-right:1px solid var(--ds-line)!important;border-radius:0!important;box-shadow:none!important;}}
{selector} :is(.composer-surface-chrome,.dream-skin-composer) {{background:var(--ds-bg)!important;border:{border} solid var(--ds-line)!important;box-shadow:none!important;border-radius:{radius}!important;min-width:0!important;}}
{selector} :is(.composer-surface-chrome,.dream-skin-composer)::before,{selector} :is(.composer-surface-chrome,.dream-skin-composer)::after {{display:none!important;}}
{selector} [class~="group/home-suggestions"] {{gap:8px!important;flex-wrap:wrap!important;}}
{selector} [class~="group/home-suggestions"] button {{background:var(--ds-panel)!important;border:1px solid var(--ds-line)!important;box-shadow:none!important;transform:none!important;border-radius:{radius}!important;}}
{selector} :is(button,a,input,textarea,[contenteditable]):focus-visible {{outline:2px solid var(--ds-green)!important;outline-offset:3px;}}
{selector} :is(button,a):hover {{border-color:var(--ds-green)!important;}}
{selector} ::selection {{background:var(--ds-green);color:var(--ds-bg);}}
{selector} main:not(.dream-skin-home-shell) {{background:var(--ds-bg)!important;}}
{selector} :is(pre,code,.xterm,.monaco-editor) {{text-shadow:none!important;}}
{selector} .dream-skin-home .dream-skin-washi,{selector} .dream-skin-home .dream-skin-corner {{display:none!important;}}
@media(max-width:1100px) {{
 {selector} main.dream-skin-home-shell {{padding:30px 18px!important;}}
 {selector} main.dream-skin-home-shell > .dream-skin-role-main {{width:{narrow_width}%!important;padding:18px!important;}}
 {selector} .preview-welcome h1 {{font-size:24px!important;}}
}}
@media(max-width:680px) {{
 {selector} main.dream-skin-home-shell {{padding:230px 12px 20px!important;background-position:center 12px!important;}}
 {selector} main.dream-skin-home-shell > .dream-skin-role-main {{width:100%!important;max-width:none!important;}}
}}
'''
