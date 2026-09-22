"""将验收展示页及其全部截图整理为可随仓库发布的静态文档。"""
import argparse
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'docs/theme-gallery'


def archive(report):
    page = (report / 'review.html').read_text(encoding='utf-8')
    theme_ids = re.findall(r'data-theme="([a-z0-9-]+)"', page)
    if len(set(theme_ids)) != 20 or len(theme_ids) != 20:
        raise ValueError('展示页必须包含二十组不重复主题')
    result = json.loads((report / 'visual-1/result.json').read_text(encoding='utf-8'))
    if result.get('passed') is not True:
        raise ValueError('截图验收记录未通过')
    hashes = {item['screenshot']: item['sha256'] for item in result['states'] + result['without_art']}
    names = [f'{theme_id}-{mode}-{suffix}' for theme_id in theme_ids for mode in ('light', 'dark')
             for suffix in ([f'{view}-{width}' for view in ('home', 'task', 'settings', 'components')
                             for width in (920, 1280, 1920)] + ['without-art'])]
    if DESTINATION.exists():
        raise ValueError('展示目录已存在，未覆盖已有文件')
    with tempfile.TemporaryDirectory(prefix='theme-gallery-') as temporary:
        staged = Path(temporary)
        images = staged / 'visual-1'
        images.mkdir()
        for name in names:
            source = report / 'visual-1' / f'{name}.jpg'
            if hashlib.sha256(source.read_bytes()).hexdigest() != hashes.get(source.name):
                raise ValueError(f'原截图与验收记录不一致：{source.name}')
            with Image.open(source) as image:
                image.save(images / f'{name}.webp', 'WEBP', quality=85, method=6)
        if page.count("+'.jpg'") != 1:
            raise ValueError('展示页图片引用格式发生变化，未发布')
        (staged / 'review.html').write_text(page.replace("+'.jpg'", "+'.webp'"), encoding='utf-8')
        total_bytes = sum(file.stat().st_size for file in staged.rglob('*') if file.is_file())
        if shutil.disk_usage(ROOT).free < total_bytes + 4 * 1024 * 1024:
            raise ValueError(f'项目磁盘空间不足，展示资源需要 {total_bytes} 字节并预留 4 MiB')
        shutil.copytree(staged, DESTINATION)
        for file in staged.rglob('*'):
            if file.is_file() and file.read_bytes() != (DESTINATION / file.relative_to(staged)).read_bytes():
                raise ValueError(f'迁移后文件校验失败：{file.name}')
        print(f'已归档展示页面与 {len(names)} 张截图，总大小 {total_bytes / 1024 / 1024:.2f} MiB：{DESTINATION}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='归档主题馆静态展示页')
    parser.add_argument('--report', required=True, type=Path, help='已验收的展示产物目录')
    archive(parser.parse_args().report.resolve())
