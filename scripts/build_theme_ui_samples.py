"""制作已批准的二十组完整组件，保留现有主图和来源标记。"""
import argparse
import hashlib
import json
from pathlib import Path
from theme_v2_designs import DESIGNS, RETAINED, theme_css

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ('fruit-base', 'lulu-duo', 'totoro-stop', 'zero-day')
COMPONENT_THEMES = tuple(item['id'] for item in DESIGNS) + tuple(RETAINED)
TEMPLATES = Path(__file__).resolve().parent / 'theme_ui_samples'


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def apply_component_style(theme_id):
    """由独立配方生成可导出的完整样式，重复制作不会叠加CSS。"""
    if theme_id not in COMPONENT_THEMES:
        raise ValueError('主题不在已批准的完整组件目录中')
    directory = ROOT / 'resources/skins' / theme_id
    config = json.loads((directory / 'theme.json').read_text(encoding='utf-8'))
    item = next((item for item in DESIGNS if item['id'] == theme_id), None)
    if item:
        base_css = theme_css(item)
    else:
        from build_original_skins import theme_css as retained_theme_css
        base_css = retained_theme_css(theme_id, config['layout'])
    scope = f'html.codex-dream-skin[data-dream-theme="{theme_id}"][data-original-theme][data-original-mode]'
    css = base_css + '\n' + '\n'.join(
        (TEMPLATES / name).read_text(encoding='utf-8').replace(':scope', scope)
        for name in ('common.css', f'{theme_id}.css')
    )
    (directory / 'original.css').write_text(css, encoding='utf-8')
    config['version'] = '1.1.0'
    config['codexManager']['ui_revision'] = 1
    write_json(directory / 'theme.json', config)
    provenance = json.loads((directory / 'provenance.json').read_text(encoding='utf-8'))
    provenance['component_design'] = dict(revision=1, date='20260921', recipe=f'scripts/theme_ui_samples/{theme_id}.css',
                                         artwork='沿用原有AI主图，未重新生成', acceptance='隔离与实机分别记录，参见二十组完整界面验收报告')
    write_json(directory / 'provenance.json', provenance)


def refresh_hashes():
    """维持原目录顺序，只更新真实文件的版本和哈希。"""
    path = ROOT / 'resources/skins/catalog.json'
    entries = json.loads(path.read_text(encoding='utf-8'))
    for entry in entries:
        if entry['id'] not in COMPONENT_THEMES:
            continue
        directory = path.parent / entry['id']
        entry['version'] = json.loads((directory / 'theme.json').read_text(encoding='utf-8'))['version']
        entry['hashes'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir()) if p.is_file()}
    write_json(path, entries)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='制作二十组完整界面组件')
    parser.add_argument('--hashes-only', action='store_true', help='截图更新后仅刷新资源哈希')
    parser.add_argument('--ids', help='只更新指定主题，英文逗号分隔；默认全部')
    args = parser.parse_args()
    if not args.hashes_only:
        for theme_id in (args.ids.split(',') if args.ids else COMPONENT_THEMES):
            apply_component_style(theme_id)
            print(f'已更新完整组件样式：{theme_id}')
    refresh_hashes()
    print('完整组件主题资源清单已更新')
