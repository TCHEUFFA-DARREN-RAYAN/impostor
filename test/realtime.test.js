'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server');
const baseConfig = require('../src/config');

const config = { ...baseConfig, HOST_RECONNECT_GRACE_MS: 300, RATE_LIMIT_BURST: 1000, RATE_LIMIT_PER_SEC: 1000 };

let instance;
let url;
const clients = [];

test.before(async () => {
  instance = createApp({ config });
  await new Promise((resolve) => instance.server.listen(0, resolve));
  url = `http://localhost:${instance.server.address().port}`;
});

test.after(async () => {
  for (const c of clients) c.socket.close();
  await instance.close();
});

/** A test player: a socket plus its latest state snapshot. */
function client() {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, state: null, events: [], waiters: [] };
  socket.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => !w(s));
  });
  for (const e of ['room:closed', 'room:kicked', 'game:over', 'session:replaced']) socket.on(e, (d) => c.events.push([e, d]));
  c.req = (event, payload = {}) => new Promise((resolve) => socket.timeout(2000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
  c.until = (pred, ms = 2000) =>
    new Promise((resolve, reject) => {
      if (c.state && pred(c.state)) return resolve(c.state);
      const timer = setTimeout(() => reject(new Error('timed out waiting for state')), ms);
      c.waiters.push((s) => (pred(s) ? (clearTimeout(timer), resolve(s), true) : false));
    });
  c.connected = new Promise((resolve) => socket.on('connect', resolve));
  clients.push(c);
  return c;
}

async function room(n) {
  const host = client();
  await host.connected;
  const created = await host.req('room:create', { name: 'Host' });
  assert.ok(created.ok, created.error);
  const code = created.session.roomCode;
  const guests = [];
  for (let i = 1; i < n; i++) {
    const g = client();
    await g.connected;
    const res = await g.req('room:join', { roomCode: code, name: `Guest${i}` });
    assert.ok(res.ok, res.error);
    g.session = res.session;
    guests.push(g);
  }
  host.session = created.session;
  const all = [host, ...guests];
  await Promise.all(all.map((c) => c.until((s) => s.players.length === n)));
  return { code, host, guests, all };
}

test('room codes are 4 digits and unique', async () => {
  const codes = new Set();
  for (let i = 0; i < 20; i++) {
    const c = client();
    await c.connected;
    const res = await c.req('room:create', { name: 'H' });
    assert.match(res.session.roomCode, /^\d{4}$/);
    codes.add(res.session.roomCode);
    c.socket.close();
  }
  assert.equal(codes.size, 20);
});

test('full game with 8 players', async () => {
  const { host, all } = await room(8);
  assert.ok((await host.req('lobby:setImpostors', { count: 2 })).ok);
  await Promise.all(all.map((c) => c.until((s) => s.settings.impostorCount === 2)));

  assert.ok((await host.req('game:start')).ok);
  const states = await Promise.all(all.map((c) => c.until((s) => s.phase === 'playing')));
  assert.equal(states.filter((s) => s.you.isImpostor).length, 2);
  assert.equal(new Set(states.map((s) => s.you.turnOrder)).size, 8);

  // Everyone speaks once, in order. A duplicate tap must not skip anybody.
  for (let turn = 1; turn <= 8; turn++) {
    const speaker = all.find((c) => c.state.you.turnOrder === turn);
    const roundId = speaker.state.round.id;
    const [first, dupe] = await Promise.all([speaker.req('turn:next', { roundId, turn }), speaker.req('turn:next', { roundId, turn })]);
    assert.ok(first.ok && first.changed, `turn ${turn}`);
    assert.ok(!dupe.ok || dupe.changed === false, 'duplicate tap ignored');
    await host.until((s) => s.round.currentSpeaker === (turn % 8) + 1);
  }

  assert.equal((await all[1].req('vote:cast', { targetId: host.state.you.id })).ok, false); // locked
  assert.ok((await host.req('vote:toggle')).ok);
  await Promise.all(all.map((c) => c.until((s) => s.round.votingLocked === false)));

  const impostorIds = states.filter((s) => s.you.isImpostor).map((s) => s.you.id);
  for (const c of all) {
    const target = impostorIds.find((id) => id !== c.state.you.id) || all.find((o) => o !== c).state.you.id;
    const res = await c.req('vote:cast', { targetId: target });
    assert.ok(res.ok, res.error);
  }
  const results = await Promise.all(all.map((c) => c.until((s) => s.phase === 'results')));
  assert.equal(results[0].results.impostorFound, true);
  assert.deepEqual(new Set(results[0].results.impostorIds), new Set(impostorIds));

  assert.ok((await host.req('round:new')).ok);
  await Promise.all(all.map((c) => c.until((s) => s.phase === 'playing' && s.round.id === 2)));

  assert.ok((await host.req('game:end')).ok);
  await new Promise((r) => setTimeout(r, 100));
  for (const c of all) assert.equal(c.events.at(-1)[0], 'game:over');
  assert.equal(all[0].events.at(-1)[1].standings.length, 8);
});

test('a reloaded player resumes their seat, word and vote', async () => {
  const { host, guests } = await room(3);
  await host.req('game:start');
  await host.req('vote:toggle');
  const g = guests[0];
  const before = await g.until((s) => s.phase === 'playing' && !s.round.votingLocked);
  await g.req('vote:cast', { targetId: host.state.you.id });
  g.socket.close();
  await host.until((s) => s.players.find((p) => p.id === before.you.id).isConnected === false);

  const back = client();
  await back.connected;
  const res = await back.req('room:resume', { roomCode: g.session.roomCode, token: g.session.token });
  assert.ok(res.ok, res.error);
  const after = await back.until((s) => s.phase === 'playing');
  assert.equal(after.you.word, before.you.word);
  assert.equal(after.you.turnOrder, before.you.turnOrder);
  assert.equal(after.you.votedFor, host.state.you.id);
  await host.until((s) => s.players.every((p) => p.isConnected));
});

test('an active player cannot be impersonated by name', async () => {
  const { code } = await room(2);
  const impostor = client();
  await impostor.connected;
  const res = await impostor.req('room:join', { roomCode: code, name: 'guest1' });
  assert.equal(res.ok, false);
  assert.match(res.error, /taken/);
});

test('bad tokens and malformed payloads are rejected without crashing', async () => {
  const c = client();
  await c.connected;
  assert.equal((await c.req('room:resume', { roomCode: '0000', token: 'nope' })).code, 'SESSION_INVALID');
  for (const payload of [null, 42, 'x', [], { roomCode: { $gt: '' } }]) {
    c.socket.emit('room:join', payload, () => {});
    c.socket.emit('vote:cast', payload, () => {});
  }
  c.socket.emit('game:start'); // no ack at all
  assert.equal((await c.req('vote:cast', { targetId: 'x' })).code, 'NOT_IN_ROOM');
  assert.equal((await c.req('room:join', { roomCode: '9', name: '   ' })).ok, false);
  const health = await (await fetch(`${url}/healthz`)).json();
  assert.equal(health.ok, true);
});

test('kicked players are told and removed', async () => {
  const { host, guests, all } = await room(3);
  const target = guests[1];
  assert.equal((await guests[0].req('lobby:kick', { playerId: target.state.you.id })).ok, false); // not host
  const res = await host.req('lobby:kick', { playerId: target.state.you.id });
  assert.ok(res.ok);
  await host.until((s) => s.players.length === 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(target.events.at(-1)[0], 'room:kicked');
  assert.equal((await target.req('game:start')).code, 'NOT_IN_ROOM');
  assert.equal(all.length, 3);
});

test('room closes for everyone when the host leaves or does not come back', async () => {
  const a = await room(2);
  await a.host.req('room:leave');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.guests[0].events.at(-1)[0], 'room:closed');

  const b = await room(2);
  b.host.socket.close();
  await b.guests[0].until((s) => s.hostConnected === false);
  await new Promise((r) => setTimeout(r, config.HOST_RECONNECT_GRACE_MS + 150));
  assert.equal(b.guests[0].events.at(-1)[0], 'room:closed');
  assert.equal(instance.manager.get(b.code), null);
});

test('host coming back within the grace period keeps the room', async () => {
  const { code, host, guests } = await room(2);
  host.socket.close();
  await guests[0].until((s) => s.hostConnected === false);
  const back = client();
  await back.connected;
  assert.ok((await back.req('room:resume', { roomCode: code, token: host.session.token })).ok);
  await new Promise((r) => setTimeout(r, config.HOST_RECONNECT_GRACE_MS + 150));
  assert.ok(instance.manager.get(code));
  assert.ok((await back.req('game:start')).ok);
});
