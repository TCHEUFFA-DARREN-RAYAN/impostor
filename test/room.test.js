'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Room, PHASE } = require('../src/Room');
const { GameError } = require('../src/utils');
const words = require('../src/words');

/** Room with `n` connected players; the first one is host. */
function setup(n, { impostors = 1 } = {}) {
  const room = new Room('1234');
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = room.addPlayer(`P${i}`, { asHost: i === 0 });
    room.attach(p, `socket-${i}`);
    players.push(p);
  }
  room.setImpostorCount(players[0], impostors);
  return { room, host: players[0], players };
}

const speakerOf = (room) => room.participants.find((p) => p.turnOrder === room.round.currentSpeaker);
const impostorsOf = (room) => room.players.filter((p) => room.round.impostorIds.has(p.id));
const crewOf = (room) => room.players.filter((p) => p.turnOrder != null && !room.round.impostorIds.has(p.id));

test('word list has no duplicate keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/words.js'), 'utf8');
  const keys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupes, []);
  assert.equal(keys.length, words.length);
  assert.ok(words.length > 400);
});

test('start requires host, 2+ connected players and fewer impostors than players', () => {
  const { room, host, players } = setup(2);
  assert.throws(() => room.startRound(players[1]), GameError);

  room.setImpostorCount(host, 2);
  assert.throws(() => room.startRound(host), /Too many impostors/);
  room.setImpostorCount(host, 1);

  room.detach(players[1]);
  assert.throws(() => room.startRound(host), /at least 2 players/);
  room.attach(players[1], 'socket-x');

  room.startRound(host);
  assert.equal(room.phase, PHASE.PLAYING);
});

test('impostor count is clamped to 1..5', () => {
  const { room, host } = setup(3);
  assert.equal(room.setImpostorCount(host, 99), 5);
  assert.equal(room.setImpostorCount(host, 0), 1);
  assert.equal(room.setImpostorCount(host, 'abc'), 1);
});

test('round deals unique turn orders, the right number of impostors and words', () => {
  const { room, host } = setup(6, { impostors: 2 });
  room.startRound(host);
  const orders = room.participants.map((p) => p.turnOrder).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6]);
  assert.equal(room.round.impostorIds.size, 2);
  assert.equal(room.round.currentSpeaker, 1);
  assert.equal(room.round.votingLocked, true);

  for (const p of room.players) {
    const view = room.snapshotFor(p.id).you;
    const expected = room.round.impostorIds.has(p.id) ? room.round.pair.impostor : room.round.pair.crew;
    assert.equal(view.word, expected);
    assert.equal(view.isImpostor, room.round.impostorIds.has(p.id));
  }
});

test('disconnected players are not dealt in and see no word', () => {
  const { room, host, players } = setup(4);
  room.detach(players[3]);
  room.startRound(host);
  assert.equal(room.participants.length, 3);
  const view = room.snapshotFor(players[3].id);
  assert.equal(view.you.inRound, false);
  assert.equal(view.you.word, null);
});

test('snapshots never leak other players roles, words or tokens', () => {
  const { room, host } = setup(5);
  room.startRound(host);
  const json = JSON.stringify(room.snapshotFor(crewOf(room)[0].id));
  assert.ok(!json.includes(room.round.pair.impostor));
  assert.ok(!json.includes('impostorIds'));
  for (const p of room.players) assert.ok(!json.includes(p.token));
});

test('turns advance in order and wrap around', () => {
  const { room, host } = setup(3);
  room.startRound(host);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(room.round.currentSpeaker);
    room.advanceSpeaker(speakerOf(room));
  }
  assert.deepEqual(seen, [1, 2, 3, 1]);
});

test('only the current speaker or the host can pass the turn', () => {
  const { room, host } = setup(3);
  room.startRound(host);
  const other = room.participants.find((p) => p.turnOrder !== room.round.currentSpeaker && p !== host);
  if (other) assert.throws(() => room.advanceSpeaker(other), /not your turn/);
  assert.equal(room.advanceSpeaker(host), true);
});

test('duplicate "done speaking" taps do not skip the next player', () => {
  const { room, host } = setup(4);
  room.startRound(host);
  const speaker = speakerOf(room);
  const expected = { roundId: room.round.id, turn: room.round.currentSpeaker };
  assert.equal(room.advanceSpeaker(speaker, expected), true);
  assert.equal(room.advanceSpeaker(host, expected), false); // stale: already moved on
  assert.equal(room.round.currentSpeaker, 2);
  assert.equal(room.advanceSpeaker(host, { roundId: 999, turn: 2 }), false); // wrong round
  assert.equal(room.round.currentSpeaker, 2);
});

test('voting rules: locked, self-vote, double vote, non-participant', () => {
  const { room, host, players } = setup(4);
  room.detach(players[3]);
  room.startRound(host);
  room.attach(players[3], 'socket-back');
  const [a, b] = room.participants;

  assert.throws(() => room.castVote(a, b.id), /locked/);
  room.toggleVoting(host);
  assert.throws(() => room.castVote(a, a.id), /yourself/);
  assert.throws(() => room.castVote(players[3], a.id), /not playing/);
  assert.throws(() => room.castVote(a, players[3].id), /not in this round/);
  room.castVote(a, b.id);
  assert.throws(() => room.castVote(a, b.id), /already voted/);
});

test('reset clears votes and locks voting', () => {
  const { room, host } = setup(3);
  room.startRound(host);
  room.toggleVoting(host);
  const [a, b] = room.participants;
  room.castVote(a, b.id);
  room.resetVoting(host);
  assert.equal(room.round.votes.size, 0);
  assert.equal(room.round.votingLocked, true);
});

test('impostor caught: crew +1 each, impostor 0; round ends when all voted', () => {
  const { room, host } = setup(4);
  room.startRound(host);
  room.toggleVoting(host);
  const [impostor] = impostorsOf(room);
  const crew = crewOf(room);
  for (const p of crew) room.castVote(p, impostor.id);
  assert.equal(room.phase, PHASE.PLAYING);
  const res = room.castVote(impostor, crew[0].id);
  assert.equal(res.roundEnded, true);
  assert.equal(room.phase, PHASE.RESULTS);
  assert.equal(room.results.impostorFound, true);
  for (const p of crew) assert.equal(p.score, 1);
  assert.equal(impostor.score, 0);
});

test('impostor escapes: impostor +1, crew 0', () => {
  const { room, host } = setup(4);
  room.startRound(host);
  room.toggleVoting(host);
  const [impostor] = impostorsOf(room);
  const crew = crewOf(room);
  for (const p of crew) room.castVote(p, crew.find((c) => c !== p).id);
  room.castVote(impostor, crew[0].id);
  assert.equal(room.results.impostorFound, false);
  assert.equal(impostor.score, 1);
  for (const p of crew) assert.equal(p.score, 0);
});

test('a tie that includes the impostor counts as found', () => {
  const { room, host } = setup(4);
  room.startRound(host);
  room.toggleVoting(host);
  const [impostor] = impostorsOf(room);
  const [c1, c2, c3] = crewOf(room);
  room.castVote(c1, impostor.id);
  room.castVote(c2, c3.id);
  room.endRound();
  assert.deepEqual(new Set(room.results.mostVotedIds), new Set([impostor.id, c3.id]));
  assert.equal(room.results.impostorFound, true);
});

test('ending a round with no votes lets the impostor win', () => {
  const { room, host } = setup(3);
  room.startRound(host);
  room.endRound();
  assert.equal(room.results.impostorFound, false);
  assert.equal(impostorsOf(room)[0].score, 1);
});

test('new round re-deals and keeps scores; words do not repeat', () => {
  const { room, host } = setup(3);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    room.startRound(host);
    const key = room.round.pair.crew;
    assert.ok(!seen.has(key), `word ${key} repeated`);
    seen.add(key);
  }
  assert.equal(room.round.id, 50);
});

test('removing the current speaker passes the turn to the next one', () => {
  const { room, host } = setup(4);
  room.startRound(host);
  const order = room.participants;
  room.advanceSpeaker(order[0]); // now speaker #2
  const second = speakerOf(room);
  room.removePlayer(second.id);
  assert.equal(room.round.currentSpeaker, 3);
});

test('removing the last missing voter ends the round', () => {
  const { room, host, players } = setup(3);
  room.startRound(host);
  room.toggleVoting(host);
  const [, b, c] = players;
  room.castVote(host, b.id);
  room.castVote(b, host.id);
  const { roundEnded } = room.removePlayer(c.id);
  assert.equal(roundEnded, true);
  assert.equal(room.phase, PHASE.RESULTS);
});

test('names are unique (case-insensitive) and the room has a size limit', () => {
  const room = new Room('1', { config: { ...require('../src/config'), MAX_PLAYERS_PER_ROOM: 2 } });
  room.addPlayer('Alice', { asHost: true });
  assert.throws(() => room.addPlayer('alice'), /already taken/);
  room.addPlayer('Bob');
  assert.throws(() => room.addPlayer('Carl'), /full/);
});

test('players cannot join once the game has started', () => {
  const { room, host } = setup(2);
  room.startRound(host);
  assert.throws(() => room.addPlayer('Late'), /already started/);
});
