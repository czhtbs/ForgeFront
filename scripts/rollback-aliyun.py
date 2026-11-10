"""Restore only files that still match this deployment's manifest."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

archive = Path(sys.argv[1]).resolve()
assert str(archive).startswith('/opt/cs-station-upgrade/forgefront-')
manifest = json.loads((archive / 'manifest.json').read_text())
for name, info in manifest['files'].items():
    path = Path(name)
    assert path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == info['sha256'], f'{name} has later edits; stop and review'
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'disable', '--now', 'cs-forgefront.service'], check=True)
for name, info in manifest['files'].items():
    path = Path(name)
    if info['existed']: shutil.copy2(archive / 'before' / path.name, path)
    else: path.unlink()
current = Path('/usr/local/lib/cs-forgefront/current')
assert current.is_symlink() and current.resolve() == Path(manifest['release'])
current.unlink()
if manifest['previous']: current.symlink_to(manifest['previous'])
subprocess.run(['nginx', '-t'], check=True)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['/opt/file_analyzer/restart.sh', 'reload'], check=True)
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('Rolled back ForgeFront only; release and backup retained.')
