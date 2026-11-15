'use strict';

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

module.exports = Object.freeze({
  PORT: int(process.env.PORT, 3000),

  // Rooms
  ROOM_CODE_LENGTH: int(process.env.ROOM_CODE_LENGTH, 4),
  MAX_ROOMS: int(process.env.MAX_ROOMS, 5000),
  MAX_PLAYERS_PER_ROOM: int(process.env.MAX_PLAYERS_PER_ROOM, 20),

  // Game rules (unchanged from the original game)
  MIN_PLAYERS: 2,
  MIN_IMPOSTORS: 1,
  MAX_IMPOSTORS: 5,

  // Players
  NAME_MAX_LENGTH: 20,

  // Lifetimes
  HOST_RECONNECT_GRACE_MS: int(process.env.HOST_RECONNECT_GRACE_MS, 60 * SECOND),
  EMPTY_ROOM_TTL_MS: 10 * MINUTE, // nobody connected
  IDLE_ROOM_TTL_MS: 6 * HOUR, // no activity at all
  SWEEP_INTERVAL_MS: MINUTE,

  // Abuse protection (per socket, token bucket)
  RATE_LIMIT_BURST: 20,
  RATE_LIMIT_PER_SEC: 8,
  MAX_PAYLOAD_BYTES: 4 * 1024,
});
