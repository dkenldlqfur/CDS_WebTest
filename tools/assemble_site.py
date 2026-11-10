"""Store large PCK bytes in Git-sized parts; reconstruct them before Pages upload."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / 'release-parts'
PACK = ROOT / 'site/index.pck'
CHUNK = 64 * 1024 * 1024


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(data)
    return digest.hexdigest()


def split():
    assert PACK.is_file()
    PARTS.mkdir(exist_ok=True)
    records = []
    with PACK.open('rb') as stream:
        while data := stream.read(CHUNK):
            name = 'index.pck.%03d' % len(records)
            (PARTS / name).write_bytes(data)
            records.append({'path': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    manifest = {'size': PACK.stat().st_size, 'sha256': sha(PACK), 'parts': records}
    (PARTS / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Prepared %d pack parts; original package bytes preserved.' % len(records))


def assemble():
    manifest_path = PARTS / 'manifest.json'
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert manifest['parts'] and 0 < manifest['size'] < 1024 ** 3
    temporary = PACK.with_suffix('.pck.assembling')
    with temporary.open('wb') as stream:
        for index, record in enumerate(manifest['parts']):
            assert record['path'] == 'index.pck.%03d' % index
            part = PARTS / record['path']
            assert 0 < record['size'] <= CHUNK
            assert part.stat().st_size == record['size'] and sha(part) == record['sha256']
            stream.write(part.read_bytes())
    assert temporary.stat().st_size == manifest['size'] and sha(temporary) == manifest['sha256']
    temporary.replace(PACK)
    print('Reconstructed index.pck; SHA-256 matches the verified export.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split', action='store_true')
    options = parser.parse_args()
    split() if options.split else assemble()
