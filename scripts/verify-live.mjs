import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { Replica } from '../src/net/Replica.ts';
import { hashState } from '../src/sim/snapshot.ts';
import { simulationVersion } from '../server/version.mjs';

const origin = process.argv[2] ?? 'https://czhtbs.ykcryobs.cn', clients = [], checks = [];
const endpoint = origin.replace('https:', 'wss:') + '/forgefront/play/socket';
try {
  for (let i = 0; i < 2; i++) {
    const guest = await fetch(origin + '/forgefront/guest', { redirect: 'manual' }); assert.equal(guest.status, 303);
    const cookie = guest.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const outer = await fetch(origin + '/forgefront', { headers: { Cookie: cookie } }); assert.equal(outer.status, 200);
    const markup = await outer.text(); assert.match(markup, /href="\/openfront"[^>]*>OpenFront<\/a><a[^>]*href="\/forgefront"/); assert.match(markup, /src="\/forgefront\/play\/"/);
    const index = await fetch(origin + '/forgefront/play/', { headers: { Cookie: cookie } }); assert.equal(index.status, 200);
    assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    const html = await index.text(), script = html.match(/src="([^"]+\.js)"/)[1];
    const js = await fetch(new URL(script, origin + '/forgefront/play/'), { headers: { Cookie: cookie } }); assert.equal(js.status, 200); assert.ok((await js.text()).includes(simulationVersion()));
    for (const file of ['assets/buildings/barracks.webp', 'assets/buildings/researchLab.webp', 'assets/b-style/researchLab.png', 'assets/cards/rifle.svg', 'assets/cards/sword.svg', 'assets/b-style/soldiers.png', 'assets/fx/flame.png']) {
      const asset = await fetch(origin + '/forgefront/play/' + file, { headers: { Cookie: cookie } }); assert.equal(asset.status, 200); assert.ok((await asset.arrayBuffer()).byteLength > 100);
    }
    const replica = new Replica(), messages = [], socket = new WebSocket(endpoint, { origin, headers: { Cookie: cookie } });
    socket.on('message', data => {
      const message = JSON.parse(data.toString()); messages.push(message);
      if (message.type === 'start') replica.restore(message.recovery, message.map);
      if (message.type === 'frame') {
        replica.receive(message.frame); replica.advance(180, 0);
        if (message.frame.hash) { assert.equal(hashState(replica.world), message.frame.hash); socket.send(JSON.stringify({ type: 'hash', tick: replica.world.tick, hash: message.frame.hash })); }
      }
    });
    clients.push({ socket, messages, replica }); await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', version: simulationVersion() }));
    await wait(() => messages.some(m => m.type === 'lobby' || m.type === 'error'));
    assert.ok(!messages.some(m => m.type === 'error'));
    if (i === 0) assert.equal(messages.find(m => m.type === 'lobby').lobby.players.length, 1, 'Room occupied; stop without starting a test match');
    checks.push('guest identity, station navigation, protected HTML, current JS, generated building cards, equipment icons, sprites and WSS');
  }
  const [a, b] = clients;
  a.socket.send(JSON.stringify({ type: 'configure', ai: 0, settings: { seed: 4521, count: 40, difficulty: 'normal' } }));
  await wait(() => a.messages.some(m => m.type === 'lobby' && m.lobby.ai === 0 && m.lobby.players.length === 2));
  a.socket.send(JSON.stringify({ type: 'start' })); await wait(() => clients.every(c => c.replica.world));
  a.socket.send(JSON.stringify({ type: 'command', seq: 1, command: { type: 'upgrade', province: a.replica.world.factions[0].hq } }));
  await wait(() => clients.every(c => c.replica.world.tick >= 150));
  assert.ok(clients.every(c => c.replica.world.provinces[c.replica.world.factions[0].hq].level === 2));
  a.socket.send(JSON.stringify({ type: 'command', seq: 2, command: { type: 'surrender' } }));
  await wait(() => clients.every(c => c.replica.world.winner === 1));
  assert.equal(hashState(a.replica.world), hashState(b.replica.world));
  const report = { origin, version: simulationVersion(), checks, match: { players: 2, tick: a.replica.world.tick, winner: 1, hash: hashState(a.replica.world) }, usedRegisteredAccounts: false };
  mkdirSync('docs/verification', { recursive: true }); writeFileSync('docs/verification/aliyun-live.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { for (const { socket } of clients) socket.close(); }
async function wait(predicate) { const until = Date.now() + 15000; while (!predicate()) { if (Date.now() > until) throw new Error('Live check timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } }
