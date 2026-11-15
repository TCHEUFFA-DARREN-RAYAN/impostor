'use strict';

const crypto = require('node:crypto');

/** User-facing error: its message is safe to show to players. */
class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const randomId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

// Control characters, zero-width characters and bidi overrides.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;

/** Normalises a display name. Returns '' when nothing usable is left. */
function cleanName(value, maxLength) {
  if (typeof value !== 'string') return '';
  const cleaned = value.normalize('NFC').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, maxLength).join('').trim();
}

/** Normalises a room code typed by a player. */
function cleanRoomCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/** Simple token bucket used for per-socket rate limiting. */
function createRateLimiter(burst, perSecond) {
  let tokens = burst;
  let last = Date.now();
  return function take() {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const log = {
  info: (...args) => console.log(new Date().toISOString(), '[info]', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '[warn]', ...args),
  error: (...args) => console.error(new Date().toISOString(), '[error]', ...args),
};

module.exports = { GameError, shuffle, randomId, cleanName, cleanRoomCode, sameName, createRateLimiter, log };
