"""Verify the prebuilt game files without launching HTML, JS or game code."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'


def verify_achievement_preload(files):
    definitions = [item for item in files if item['path'] == '/cds95/data/achievements.json']
    assert len(definitions) == 1 and definitions[0]['deferred'] is False, 'Missing startup preload for achievement definitions'


def main():
    manifest = json.loads((ROOT / 'site-manifest.json').read_text(encoding='utf-8'))
    chunks = json.loads((ROOT / 'release-parts/manifest.json').read_text(encoding='utf-8'))
    reassembled = chunks.get('packs', {'index.pck': chunks})
    expected = set()
    total = 0
    for item in manifest['files']:
        path = PurePosixPath(item['path'])
        assert not path.is_absolute() and '..' not in path.parts and item['path'] not in expected
        expected.add(item['path'])
        data = (SITE / item['path']).read_bytes()
        assert len(data) == item['size'], item['path']
        assert hashlib.sha256(data).hexdigest() == item['sha256'], item['path']
        assert len(data) < 100 * 1024 * 1024 or item['path'] in reassembled, 'File exceeds GitHub repository limit'
        assert not path.name.upper().startswith(('SAVEDATA', 'ACCDATA', 'UTF8-NAMES')), 'Personal save, name registry or backup file'
        total += len(data)
    actual = {path.relative_to(SITE).as_posix() for path in SITE.rglob('*') if path.is_file()}
    assert expected == actual, 'Published file set differs from verified manifest'
    retired = {'strings.ko.json', 'disev.json', 'disev.cds', 'story_events.json', 'story0.cds', 'story1.cds'}
    assert not any(PurePosixPath(name).name.lower() in retired for name in actual), 'Standalone catalog or retired archive in site'
    assert total < 1024 ** 3, 'Site exceeds GitHub Pages size limit'
    for name in ('index.html', 'index.js', 'index.wasm', 'index.side.wasm', 'cds_native.web.wasm',
                 'index.pck', 'assets-manifest.json', 'isolation-sw.js', 'discovery-video-worker.js', '.nojekyll'):
        assert name in expected, name
    assert (SITE / 'index.wasm').read_bytes()[:4] == b'\0asm'
    assets = json.loads((SITE / 'assets-manifest.json').read_text(encoding='utf-8'))
    html = (SITE / 'index.html').read_text(encoding='utf-8')
    shell_manifest = re.search(r'<script type="application/json" id="cds95-assets-manifest">([^<]*)</script>', html)
    assert shell_manifest and json.loads(shell_manifest[1]) == assets, 'Web shell manifest differs from the package'
    assert all(PurePosixPath(path).name.lower() not in retired
               for item in assets['files'] for path in [item['path'], *item['aliases']]), 'Standalone catalog or retired archive in manifest'
    verify_achievement_preload(assets['files'])
    packs = assets['packs']
    shared = ['index.pck', 'gameplay.pck', 'game-data.pck']
    startup = [item for item in packs if not item.get('deferred')]
    deferred = [item for item in packs if item.get('deferred')]
    deferred_names = [item['url'] for item in deferred]
    assert deferred_names in ([], ['puzzles.pck']), 'Unexpected deferred resource pack'
    assets_by_folder = startup[len(shared):]
    names = [item['url'] for item in assets_by_folder]
    assert names and names == sorted(names)
    assert [item['url'] for item in packs] == [*shared, *names, *deferred_names]
    folders = {}
    for name in names:
        part = re.fullmatch(r'(assets-[a-z0-9][a-z0-9_-]*)(?:\.(\d{3}))?\.pck', name)
        assert part, name
        folder, index = part.groups()
        folders.setdefault(folder, []).append(index)
    for folder, indices in folders.items():
        assert indices == ([None] if len(indices) == 1 else
                           [f'{index:03d}' for index in range(1, len(indices) + 1)]), (folder, indices)
    assert all(0 < item['size'] <= 32 * 1024 * 1024 for item in assets_by_folder + deferred)
    mobile_packs = []
    for pack in packs:
        mobile = pack.get('mobile')
        assert mobile or not re.fullmatch(r'assets-(?:cities(?:\.\d{3})?|cityfrm)\.pck', pack['url']), pack['url']
        if mobile:
            assert re.fullmatch(r'assets-[a-z0-9][a-z0-9_-]*(?:\.\d{3})?\.pck', pack['url']), pack['url']
            assert mobile['url'] == 'mobile/' + pack['url']
            assert 0 < mobile['size'] < pack['size']
            mobile_packs.append(mobile)
    assert {path for path in actual if path.endswith('.pck')} == {item['url'] for item in packs + mobile_packs}
    for item in assets['files'] + packs + mobile_packs:
        data = (SITE / item['url']).read_bytes()
        assert len(data) == item['size'] and hashlib.sha256(data).hexdigest() == item['sha256']
    print(json.dumps({'verified_files': len(actual), 'site_bytes': total, 'gameplay_executed': False}, indent=2))


if __name__ == '__main__':
    main()
