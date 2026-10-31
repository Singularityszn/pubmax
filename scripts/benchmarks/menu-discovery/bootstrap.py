"""Download the unchanged, checksum-pinned PageSift executable for this experiment."""
import hashlib
import io
import json
import os
import pathlib
import platform
import tarfile
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
lock = json.loads((HERE / 'dependency-lock.json').read_text())
system = {'Darwin': 'apple-darwin', 'Linux': 'unknown-linux-gnu'}.get(platform.system())
machine = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x86_64', 'AMD64': 'x86_64'}.get(platform.machine())
target = f'{machine}-{system}'
if target not in lock['assets']:
    raise SystemExit(f'Unsupported release platform: {target}')
asset = lock['assets'][target]
data = urllib.request.urlopen(asset['url'], timeout=60).read()
if hashlib.sha256(data).hexdigest() != asset['sha256']:
    raise SystemExit('Release archive checksum mismatch')
destination = HERE / 'tools'
destination.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    members = [m for m in archive.getmembers() if pathlib.PurePosixPath(m.name).name == 'pagesift' and m.isfile()]
    if len(members) != 1:
        raise SystemExit('Expected one release executable')
    executable = archive.extractfile(members[0]).read()
    (destination / 'pagesift').write_bytes(executable)
    os.chmod(destination / 'pagesift', 0o755)
    for name in ('LICENSE', 'README.md'):
        matches = [m for m in archive.getmembers() if pathlib.PurePosixPath(m.name).name == name and m.isfile()]
        if matches:
            (destination / name).write_bytes(archive.extractfile(matches[0]).read())
licence_url = f'https://raw.githubusercontent.com/YOLOW92/pagesift/{lock["sourceCommit"]}/LICENSE'
licence = urllib.request.urlopen(licence_url, timeout=30).read()
if hashlib.sha256(licence).hexdigest() != lock['licenceSha256']:
    raise SystemExit('Licence checksum mismatch')
(destination / 'LICENSE').write_bytes(licence)
(destination / 'provenance.json').write_text(json.dumps({
    'version': lock['version'], 'sourceCommit': lock['sourceCommit'],
    'target': target, 'archiveSha256': asset['sha256'],
    'executableSha256': hashlib.sha256(executable).hexdigest(),
    'licence': lock['licence'], 'licenceUrl': licence_url,
}, indent=2) + '\n')
print(destination / 'pagesift')
