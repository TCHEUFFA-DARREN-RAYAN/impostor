'use strict';

const defaultConfig = require('./config');
const { GameError, cleanName, cleanRoomCode, createRateLimiter, log } = require('./utils');

/**
 * Socket.io protocol.
 *
 * Client → server requests are acknowledged with { ok: true, ... } or
 * { ok: false, error, code }. After every change the server pushes a
 * personalised `state` snapshot to each connected player of the room, so
 * clients never have to reconstruct state from individual events.
 *
 * Server → client events:
 *   state            full snapshot for this player (see Room#snapshotFor)
 *   room:closed      { reason }      room no longer exists
 *   room:kicked      { reason }      you were removed by the host
 *   game:over        { standings }   host ended the game (room is deleted)
 *   session:replaced                 this seat was opened on another tab/device
 *   notice           { type, message }
 */
function attachRealtime(io, manager, { config = defaultConfig } = {}) {
  const queued = new Set();

  const socketOf = (player) => (player && player.socketId ? io.sockets.sockets.get(player.socketId) : null);
  const sessionOf = (room, player) => ({ roomCode: room.code, playerId: player.id, token: player.token, name: player.name });

  /** Sends fresh snapshots to everyone in the room (coalesced per tick). */
  function broadcast(room) {
    if (queued.has(room)) return;
    queued.add(room);
    setImmediate(() => {
      queued.delete(room);
      if (manager.get(room.code) !== room) return;
      for (const p of room.players) {
        const socket = socketOf(p);
        if (socket) socket.emit('state', room.snapshotFor(p.id));
      }
    });
  }

  function release(socket, roomCode) {
    socket.leave(roomCode);
    socket.data.member = null;
  }

  /** Tells everyone in the room and deletes it. */
  function closeRoom(room, { event = 'room:closed', payload, except = null } = {}) {
    for (const p of room.players) {
      const socket = socketOf(p);
      if (!socket) continue;
      if (socket !== except) socket.emit(event, payload);
      release(socket, room.code);
    }
    manager.delete(room.code);
  }

  function afterRemoval(room) {
    if (room.players.length === 0) manager.delete(room.code);
    else broadcast(room);
  }

  function startHostGrace(room) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = setTimeout(() => {
      room.hostGraceTimer = null;
      if (manager.get(room.code) !== room) return;
      const host = room.host;
      if (host && host.socketId) return;
      log.info(`Room ${room.code} closed: host did not come back`);
      closeRoom(room, { payload: { reason: 'The host left the game.' } });
    }, config.HOST_RECONNECT_GRACE_MS);
    room.hostGraceTimer.unref?.();
  }

  /** Seats `socket` as `player`, taking the seat over from any older socket. */
  function bind(socket, room, player) {
    unbind(socket);

    const previous = socketOf(player);
    if (previous && previous !== socket) {
      previous.emit('session:replaced');
      release(previous, room.code);
    }

    room.attach(player, socket.id);
    socket.data.member = { roomCode: room.code, playerId: player.id };
    socket.join(room.code);

    if (room.isHost(player) && room.hostGraceTimer) {
      clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }
  }

  /** Marks the socket's player as disconnected (they keep their seat). */
  function unbind(socket) {
    const member = socket.data.member;
    if (!member) return;
    release(socket, member.roomCode);

    const room = manager.get(member.roomCode);
    const player = room && room.getPlayer(member.playerId);
    if (!room || !player || player.socketId !== socket.id) return;

    room.detach(player);
    if (room.isHost(player)) startHostGrace(room);
    broadcast(room);
  }

  io.on('connection', (socket) => {
    socket.data.member = null;
    const allow = createRateLimiter(config.RATE_LIMIT_BURST, config.RATE_LIMIT_PER_SEC);

    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') [payload, ack] = [{}, payload];
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow()) {
          reply({ ok: false, error: 'Too many actions — slow down a little.', code: 'RATE_LIMITED' });
          return;
        }
        try {
          const result = handler(payload && typeof payload === 'object' ? payload : {});
          reply({ ok: true, ...result });
        } catch (err) {
          if (err instanceof GameError) {
            reply({ ok: false, error: err.message, code: err.code });
          } else {
            log.error(`"${event}" failed:`, err);
            reply({ ok: false, error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
          }
        }
      });
    };

    const member = () => {
      const m = socket.data.member;
      const room = m && manager.get(m.roomCode);
      const player = room && room.getPlayer(m.playerId);
      if (!room || !player || player.socketId !== socket.id) {
        socket.data.member = null;
        throw new GameError('You are not in a room.', 'NOT_IN_ROOM');
      }
      return { room, player };
    };

    // ── Room lifecycle ────────────────────────────────────────────────────

    on('room:create', ({ name }) => {
      const cleaned = cleanName(name, config.NAME_MAX_LENGTH) || 'Host';
      const room = manager.create();
      const player = room.addPlayer(cleaned, { asHost: true });
      bind(socket, room, player);
      broadcast(room);
      log.info(`Room ${room.code} created (${manager.rooms.size} rooms)`);
      return { session: sessionOf(room, player) };
    });

    on('room:join', ({ roomCode, name }) => {
      const code = cleanRoomCode(roomCode);
      const cleaned = cleanName(name, config.NAME_MAX_LENGTH);
      if (!code) throw new GameError('Enter a room code.', 'BAD_INPUT');
      if (!cleaned) throw new GameError('Enter your name.', 'BAD_INPUT');

      const room = manager.get(code);
      if (!room) throw new GameError('Room not found. Check the code and try again.', 'ROOM_NOT_FOUND');

      let player = room.findByName(cleaned);
      if (player) {
        // Same name as an existing seat: only allowed to take back a seat whose
        // owner is disconnected (e.g. they lost their tab).
        if (player.socketId && player.socketId !== socket.id) {
          throw new GameError('That name is already taken in this room.', 'NAME_TAKEN');
        }
        room.rotateToken(player);
      } else {
        player = room.addPlayer(cleaned);
      }

      bind(socket, room, player);
      broadcast(room);
      return { session: sessionOf(room, player) };
    });

    on('room:resume', ({ roomCode, token }) => {
      const room = manager.get(cleanRoomCode(roomCode));
      const player = room && room.findByToken(token);
      if (!room || !player) throw new GameError('That game is no longer available.', 'SESSION_INVALID');
      bind(socket, room, player);
      broadcast(room);
      return { session: sessionOf(room, player) };
    });

    on('room:leave', () => {
      if (!socket.data.member) return {};
      const { room, player } = member();
      if (room.isHost(player)) {
        log.info(`Room ${room.code} closed by host`);
        closeRoom(room, { payload: { reason: 'The host left the game.' }, except: socket });
        return {};
      }
      release(socket, room.code);
      room.removePlayer(player.id);
      afterRemoval(room);
      return {};
    });

    // ── Lobby ─────────────────────────────────────────────────────────────

    on('lobby:setImpostors', ({ count }) => {
      const { room, player } = member();
      const value = room.setImpostorCount(player, count);
      broadcast(room);
      return { count: value };
    });

    on('lobby:kick', ({ playerId }) => {
      const { room, player } = member();
      room.assertHost(player);
      const target = room.getPlayer(playerId);
      if (!target) throw new GameError('That player already left.', 'NOT_FOUND');
      if (room.isHost(target)) throw new GameError("You can't remove the host.", 'BAD_TARGET');

      const targetSocket = socketOf(target);
      room.removePlayer(target.id);
      if (targetSocket) {
        release(targetSocket, room.code);
        targetSocket.emit('room:kicked', { reason: 'You were removed from the room by the host.' });
      }
      afterRemoval(room);
      return { name: target.name };
    });

    // ── Rounds ────────────────────────────────────────────────────────────

    const startRound = () => {
      const { room, player } = member();
      const round = room.startRound(player);
      broadcast(room);
      log.info(`Room ${room.code}: round ${round.id} started with ${room.participants.length} players`);
      return {};
    };
    on('game:start', startRound);
    on('round:new', startRound);

    on('turn:next', ({ roundId, turn }) => {
      const { room, player } = member();
      const changed = room.advanceSpeaker(player, { roundId, turn });
      if (changed) broadcast(room);
      return { changed };
    });

    on('round:end', () => {
      const { room, player } = member();
      room.assertHost(player);
      room.assertPlaying();
      room.endRound();
      broadcast(room);
      return {};
    });

    on('game:end', () => {
      const { room, player } = member();
      room.assertHost(player);
      log.info(`Room ${room.code}: game ended`);
      closeRoom(room, { event: 'game:over', payload: { standings: room.standings() } });
      return {};
    });

    // ── Voting ────────────────────────────────────────────────────────────

    on('vote:toggle', () => {
      const { room, player } = member();
      const locked = room.toggleVoting(player);
      broadcast(room);
      return { locked };
    });

    on('vote:reset', () => {
      const { room, player } = member();
      room.resetVoting(player);
      broadcast(room);
      return {};
    });

    on('vote:cast', ({ targetId }) => {
      const { room, player } = member();
      room.castVote(player, targetId);
      broadcast(room);
      return {};
    });

    socket.on('disconnect', () => unbind(socket));
  });

  /** Removes abandoned rooms. Call periodically. */
  function sweep() {
    for (const room of manager.expired()) {
      log.info(`Room ${room.code} expired`);
      closeRoom(room, { payload: { reason: 'This room closed after being inactive.' } });
    }
  }

  return { sweep, broadcast };
}

module.exports = { attachRealtime };
