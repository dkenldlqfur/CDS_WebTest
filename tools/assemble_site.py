"""Store each large PCK in Git-sized parts and reconstruct it for Pages."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / 'release-parts'
SITE = ROOT / 'site'
CHUNK = 64 * 1024 * 1024


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def split():
    PARTS.mkdir(exist_ok=True)
    assert (SITE / 'index.pck').is_file()
    packs = {}
    used = set()
    for pack in sorted(SITE.glob('*.pck')):
        size = pack.stat().st_size
        if size <= CHUNK:
            continue
        records = []
        with pack.open('rb') as stream:
            while data := stream.read(CHUNK):
                name = '%s.%03d' % (pack.name, len(records))
                (PARTS / name).write_bytes(data)
                used.add(name)
                records.append({'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        packs[pack.name] = {'size': size, 'sha256': sha(pack), 'parts': records}
    for old in PARTS.glob('*.pck.[0-9][0-9][0-9]'):
        if old.name not in used:
            old.unlink()
    manifest = {'packs': packs}
    (PARTS / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Prepared %d parts for %d packs.' % (len(used), len(packs)))


def assemble():
    manifest_path = PARTS / 'manifest.json'
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for name, record in manifest.get('packs', {'index.pck': manifest}).items():
        assert Path(name).name == name and name.endswith('.pck') and '\\' not in name
        assert record['parts'] and 0 < record['size'] < 1024 ** 3
        pack = SITE / name
        temporary = pack.with_suffix('.pck.assembling')
        try:
            with temporary.open('wb') as stream:
                for index, part_record in enumerate(record['parts']):
                    assert part_record['path'] == '%s.%03d' % (name, index)
                    part = PARTS / part_record['path']
                    assert 0 < part_record['size'] <= CHUNK
                    assert part.stat().st_size == part_record['size'] and sha(part) == part_record['sha256']
                    stream.write(part.read_bytes())
            assert temporary.stat().st_size == record['size'] and sha(temporary) == record['sha256']
            temporary.replace(pack)
        finally:
            temporary.unlink(missing_ok=True)
        print(f'Reconstructed {name}; SHA-256 matches the verified export.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split', action='store_true')
    options = parser.parse_args()
    split() if options.split else assemble()
