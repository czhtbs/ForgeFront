"""Run from the extracted release on aliyun; touches only ForgeFront and its station entry."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys

release = Path(__file__).resolve().parents[1]
archive = Path(sys.argv[1]).resolve()
assert str(release).startswith('/usr/local/lib/cs-forgefront/releases/')
assert str(archive).startswith('/opt/cs-station-upgrade/forgefront-')
before = archive / 'before'
before.mkdir(parents=True, exist_ok=False)
station = Path('/opt/file_analyzer/station.py')
nginx = Path('/etc/nginx/conf.d/sub2api.conf')
agents = Path('/opt/file_analyzer/AGENTS.md')
current = Path('/usr/local/lib/cs-forgefront/current')
files = [station, nginx, agents, Path('/opt/file_analyzer/forgefront_site.py'), Path('/etc/nginx/snippets/cs-forgefront.inc'), Path('/etc/systemd/system/cs-forgefront.service')]
manifest = {'release': str(release), 'previous': os.readlink(current) if current.is_symlink() else None, 'files': {}}
for path in files:
    if path.exists():
        shutil.copy2(path, before / path.name)
    manifest['files'][str(path)] = {'existed': path.exists()}
(archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new, 1)

text = station.read_text()
assert "'/forgefront'" not in text, 'ForgeFront already registered; review existing deployment before updating navigation'
text = replace_once(text, "('openfront','/openfront','OpenFront')", "('openfront','/openfront','OpenFront'),('forgefront','/forgefront','铸造前线')")
text = replace_once(text, "else 'openfront' if title=='OpenFront' else ''", "else 'openfront' if title=='OpenFront' else 'forgefront' if title=='铸造前线' else ''")
text = replace_once(text, "'/openfront':'/openfront/guest'", "'/openfront':'/openfront/guest','/forgefront':'/forgefront/guest'")
text = replace_once(text, "('/generals','/draw-guess','/qisheng','/antimatter','/openfront')", "('/generals','/draw-guess','/qisheng','/antimatter','/openfront','/forgefront')")
text = replace_once(text, '    register_openfront(app, page)', '    register_openfront(app, page)\n    from forgefront_site import register as register_forgefront\n    register_forgefront(app, page)')
compile(text, str(station), 'exec')
nginx_text = replace_once(nginx.read_text(), '    include /etc/nginx/snippets/cs-openfront.inc;', '    include /etc/nginx/snippets/cs-openfront.inc;\n    include /etc/nginx/snippets/cs-forgefront.inc;')
for source, target in [('forgefront_site.py', files[3]), ('cs-forgefront.inc', files[4]), ('cs-forgefront.service', files[5])]:
    shutil.copyfile(release / 'deploy' / source, target); target.chmod(0o644)
station.write_text(text); nginx.write_text(nginx_text)
try:
    pwd.getpwnam('cs-forgefront')
except KeyError:
    subprocess.run(['useradd', '--system', '--no-create-home', '--shell', '/sbin/nologin', 'cs-forgefront'], check=True)
for path in (release / 'dist').rglob('*'):
    if path.is_file() and path.suffix in ('.html', '.js', '.css', '.svg', '.json'):
        with gzip.open(str(path) + '.gz', 'wb', compresslevel=9) as output:
            output.write(path.read_bytes())
link = current.with_name('current.new'); link.symlink_to(release); link.replace(current)
for path in files:
    manifest['files'][str(path)]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
(archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
try:
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'cs-forgefront.service'], check=True)
    subprocess.run(['/opt/file_analyzer/restart.sh', 'reload'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except subprocess.CalledProcessError:
    subprocess.run([sys.executable, str(release / 'scripts/rollback-aliyun.py'), str(archive)], check=True)
    raise
with agents.open('a') as output:
    output.write('\n\n2026-11-10 ForgeFront：新增 /forgefront（铸造前线），导航“其他”中紧跟 OpenFront；iframe /forgefront/play/，单人和试验场保留，单房间多人指令同步、最多六阵营。复用已有登录/签名临时玩家和 /_station_openfront_auth，WebSocket 只经 Nginx 注入身份并连接 /run/cs-forgefront/game.sock，校验同源。cs-forgefront.service 以独立用户运行，512MiB/CPU100%，无新公网端口、数据库、Redis或外部模型调用。当前源码与静态文件指向 ' + str(release) + '；后台对局只在内存，所有人断线60秒后回收，服务重启不恢复。变更原件与发布清单：' + str(archive) + '。只平滑 reload 网站与 Nginx，保留其他服务、账号和私人数据。\n')
for path in files:
    manifest['files'][str(path)]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
(archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({'release': str(release), 'archive': str(archive), 'url': 'https://czhtbs.ykcryobs.cn/forgefront'}, ensure_ascii=False))
