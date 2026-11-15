'use strict';

const crypto = require('node:crypto');
const defaultConfig = require('./config');
const { Room } = require('./Room');
const { GameError } = require('./utils');

/** Owns every live room: creation with collision-free codes, lookup and expiry. */
class RoomManager {
  constructor({ config = defaultConfig, words } = {}) {
    this.config = config;
    this.words = words;
    this.rooms = new Map();
  }

  generateCode() {
    let length = this.config.ROOM_CODE_LENGTH;
    for (let attempt = 1; attempt <= 200; attempt++) {
      const code = String(crypto.randomInt(10 ** length)).padStart(length, '0');
      if (!this.rooms.has(code)) return code;
      if (attempt % 40 === 0) length++; // code space is crowded, use a longer code
    }
    throw new GameError('Could not create a room right now. Please try again.', 'NO_CODE');
  }

  create() {
    if (this.rooms.size >= this.config.MAX_ROOMS) {
      throw new GameError('The server is full right now. Please try again in a few minutes.', 'SERVER_FULL');
    }
    const options = { config: this.config };
    if (this.words) options.words = this.words;
    const room = new Room(this.generateCode(), options);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(code) || null;
  }

  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
    this.rooms.delete(code);
  }

  /** Rooms that nobody is connected to, or that have been idle for too long. */
  expired(now = Date.now()) {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.emptySince && now - room.emptySince > this.config.EMPTY_ROOM_TTL_MS) out.push(room);
      else if (now - room.lastActivityAt > this.config.IDLE_ROOM_TTL_MS) out.push(room);
    }
    return out;
  }

  stats() {
    let players = 0;
    let connected = 0;
    for (const room of this.rooms.values()) {
      players += room.players.length;
      connected += room.connectedPlayers.length;
    }
    return { rooms: this.rooms.size, players, connected };
  }
}

module.exports = { RoomManager };
