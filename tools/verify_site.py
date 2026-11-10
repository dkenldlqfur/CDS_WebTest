"""Verify the prebuilt game files without launching HTML, JS or game code."""
import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'


def verify_achievement_preload(files):
    definitions = [item for item in files if item['path'] == '/cds95/data/achievements.json']
    assert len(definitions) == 1 and definitions[0]['deferred'] is False, 'Missing startup preload for achievement definitions'


def main():
    manifest = json.loads((ROOT / 'site-manifest.json').read_text(encoding='utf-8'))
    expected = set()
    total = 0
    for item in manifest['files']:
        path = PurePosixPath(item['path'])
        assert not path.is_absolute() and '..' not in path.parts and item['path'] not in expected
        expected.add(item['path'])
        data = (SITE / item['path']).read_bytes()
        assert len(data) == item['size'], item['path']
        assert hashlib.sha256(data).hexdigest() == item['sha256'], item['path']
        # index.pck is reconstructed from verified parts after checkout.
        assert len(data) < 100 * 1024 * 1024 or item['path'] == 'index.pck', 'File exceeds GitHub repository limit'
        assert not path.name.upper().startswith(('SAVEDATA', 'ACCDATA', 'UTF8-NAMES')), 'Personal save, name registry or backup file'
        total += len(data)
    actual = {path.relative_to(SITE).as_posix() for path in SITE.rglob('*') if path.is_file()}
    assert expected == actual, 'Published file set differs from verified manifest'
    assert total < 1024 ** 3, 'Site exceeds GitHub Pages size limit'
    for name in ('index.html', 'index.js', 'index.wasm', 'index.side.wasm', 'cds_native.web.wasm',
                 'index.pck', 'assets-manifest.json', 'isolation-sw.js', '.nojekyll'):
        assert name in expected, name
    assert (SITE / 'index.wasm').read_bytes()[:4] == b'\0asm'
    assets = json.loads((SITE / 'assets-manifest.json').read_text(encoding='utf-8'))
    verify_achievement_preload(assets['files'])
    for item in assets['files']:
        data = (SITE / item['url']).read_bytes()
        assert len(data) == item['size'] and hashlib.sha256(data).hexdigest() == item['sha256']
    print(json.dumps({'verified_files': len(actual), 'site_bytes': total, 'gameplay_executed': False}, indent=2))


if __name__ == '__main__':
    main()
