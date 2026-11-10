import { createServer } from 'node:http';
import { readFile, writeFile, stat, chmod, unlink } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './Room.mjs';
import { simulationVersion } from './version.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
export function createGameServer({ origin, station = false, base = '/', root = fileURLToPath(new URL('../dist', import.meta.url)), autoTick = true, diagnostics } = {}) {
  const version = simulationVersion();
  const newRoom = () => {
    const r = new Room();
    // shortcut: keep the latest desync bundle; retain multiple files if real sessions need historical investigation.
    if (diagnostics) r.onMismatch = evidence => writeFile(diagnostics, JSON.stringify({ version, ...evidence })).catch(error => console.error('Desync log:', error.message));
    return r;
  };
  let room = newRoom();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    if (path === base + 'health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ version, tick: room.world?.tick ?? 0, players: room.members.filter(m => m.send).length, running: !!room.world, resyncs: room.resyncs })); return; }
    if (station || !['GET', 'HEAD'].includes(req.method) || !path.startsWith(base)) { res.writeHead(404); res.end(); return; }
    let file;
    try { file = resolve(root, decodeURIComponent(path.slice(base.length)) || 'index.html'); } catch { res.writeHead(400); res.end(); return; }
    if (!file.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const info = await stat(file); if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true } });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://local').pathname !== base + 'socket' || origin && req.headers.origin !== origin || station && !req.headers['x-cs-player-id']) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws, req));
  });
  sockets.on('connection', (ws, req) => {
    let member, joinedRoom, alive = true;
    const send = data => { if (ws.readyState === ws.OPEN) { if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, '连接积压'); else ws.send(JSON.stringify(data)); } };
    const helloTimeout = setTimeout(() => { if (!member) ws.close(1008, '连接超时'); }, 10000);
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 15000);
    ws.on('message', data => {
      let value;
      try { value = JSON.parse(data.toString()); } catch { ws.close(1008, '消息格式错误'); return; }
      if (!value || typeof value !== 'object') { ws.close(1008, '消息格式错误'); return; }
      if (!member) {
        if (value.type !== 'hello' || value.version !== version) { send({ type: 'error', message: '游戏版本已更新，请刷新页面', fatal: true }); ws.close(1008); return; }
        try { joinedRoom = room; member = room.join(station ? req.headers['x-cs-player-id'] : null, typeof value.token === 'string' ? value.token : null, send, () => ws.close(4001, '已在另一页面连接')); }
        catch (error) { send({ type: 'error', message: error.message, fatal: true }); ws.close(1008); }
        clearTimeout(helloTimeout); return;
      }
      if (member.send !== send) return;
      let error;
      switch (value.type) {
        case 'configure': error = joinedRoom.configure(member, value.settings, value.ai); break;
        case 'start': error = joinedRoom.start(member); break;
        case 'command': error = joinedRoom.request(member, value.seq, value.command); break;
        case 'hash': joinedRoom.check(member, value.tick, value.hash); break;
        case 'resync': joinedRoom.resync(member); break;
        case 'leave': ws.close(1000); break;
        default: error = '未知消息';
      }
      if (error) send({ type: 'error', message: error });
    });
    ws.on('close', () => { clearTimeout(heartbeat); clearTimeout(helloTimeout); if (member) { joinedRoom.disconnect(member, send); if (joinedRoom === room && room.world?.winner !== null && !room.members.some(m => m.send)) room = newRoom(); } });
    ws.on('error', () => {});
  });
  let previous = performance.now(), accumulated = 0;
  const timer = autoTick ? setInterval(() => {
    const now = performance.now(); accumulated += now - previous; previous = now;
    if (room.emptySince && Date.now() - room.emptySince > 60000) { room = newRoom(); accumulated = 0; }
    if (!room.world || room.world.winner !== null) { accumulated = 0; return; }
    for (let i = 0; accumulated >= 1000 / 30 && i < 8; i++) { room.tick(); accumulated -= 1000 / 30; }
  }, 10) : null;
  return { server, sockets, get room() { return room; }, close: () => new Promise(resolve => { if (timer) clearInterval(timer); for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.close(resolve); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const socket = process.env.GAME_SOCKET;
  const game = createGameServer({ origin: process.env.GAME_ORIGIN, station: !!socket, base: process.env.GAME_BASE ?? '/', diagnostics: process.env.GAME_DIAGNOSTICS });
  if (socket) { try { await unlink(socket); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  game.server.listen(socket ?? Number(process.env.PORT ?? 5182), socket ? undefined : '127.0.0.1', async () => {
    if (socket) await chmod(socket, 0o660);
    console.log(`ForgeFront ${simulationVersion()} listening on ${socket ?? '127.0.0.1:' + (process.env.PORT ?? 5182)}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await game.close(); process.exit(0); });
}
