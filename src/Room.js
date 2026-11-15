'use strict';

const defaultConfig = require('./config');
const defaultWords = require('./words');
const { GameError, shuffle, randomId, sameName } = require('./utils');

const PHASE = Object.freeze({ LOBBY: 'lobby', PLAYING: 'playing', RESULTS: 'results' });
const COLOR_COUNT = 20; // must match PALETTE length in public/js/ui.js

/**
 * One game room. Holds all game state and rules and knows nothing about
 * sockets, so it can be unit-tested directly. Every mutating method either
 * succeeds or throws a GameError with a player-facing message.
 *
 * Player:  { id, token, name, color, socketId, score, turnOrder, disconnectedAt }
 *   - id        public, stable identifier (safe to share with other players)
 *   - token     secret, used to resume the session after a reload/disconnect
 *   - socketId  current socket, or null while disconnected
 *   - turnOrder 1..N while taking part in the current round, otherwise null
 */
class Room {
  constructor(code, { config = defaultConfig, words = defaultWords } = {}) {
    this.code = code;
    this.config = config;
    this.words = words;

    this.players = [];
    this.hostId = null;
    this.impostorCount = config.MIN_IMPOSTORS;
    this.phase = PHASE.LOBBY;
    this.round = null;
    this.results = null;
    this.roundCounter = 0;

    this.deck = [];
    this.lastPairIndex = -1;

    this.createdAt = Date.now();
    this.lastActivityAt = this.createdAt;
    this.emptySince = null;
    this.hostGraceTimer = null;
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  // ─── Players ──────────────────────────────────────────────────────────────

  get host() {
    return this.getPlayer(this.hostId);
  }

  get connectedPlayers() {
    return this.players.filter((p) => p.socketId);
  }

  /** Players dealt into the current round, in speaking order. */
  get participants() {
    return this.players.filter((p) => p.turnOrder != null).sort((a, b) => a.turnOrder - b.turnOrder);
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  findByToken(token) {
    if (typeof token !== 'string' || !token) return null;
    return this.players.find((p) => p.token === token) || null;
  }

  findByName(name) {
    return this.players.find((p) => sameName(p.name, name)) || null;
  }

  isHost(player) {
    return Boolean(player) && player.id === this.hostId;
  }

  addPlayer(name, { asHost = false } = {}) {
    if (this.findByName(name)) throw new GameError('That name is already taken in this room.', 'NAME_TAKEN');
    if (this.phase !== PHASE.LOBBY) throw new GameError('Game has already started.', 'GAME_STARTED');
    if (this.players.length >= this.config.MAX_PLAYERS_PER_ROOM) {
      throw new GameError(`This room is full (${this.config.MAX_PLAYERS_PER_ROOM} players max).`, 'ROOM_FULL');
    }

    const player = {
      id: randomId(),
      token: randomId(24),
      name,
      color: this.nextColor(),
      socketId: null,
      score: 0,
      turnOrder: null,
      disconnectedAt: null,
    };
    this.players.push(player);
    if (asHost || !this.hostId) this.hostId = player.id;
    this.touch();
    return player;
  }

  nextColor() {
    const used = new Set(this.players.map((p) => p.color));
    for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i;
    return this.players.length % COLOR_COUNT;
  }

  /** Issues a new secret token (used when a seat is reclaimed by name). */
  rotateToken(player) {
    player.token = randomId(24);
    return player.token;
  }

  attach(player, socketId) {
    player.socketId = socketId;
    player.disconnectedAt = null;
    this.emptySince = null;
    this.touch();
  }

  detach(player) {
    player.socketId = null;
    player.disconnectedAt = Date.now();
    if (this.connectedPlayers.length === 0) this.emptySince = Date.now();
  }

  /** Removes a player. Returns { removed, roundEnded }. */
  removePlayer(playerId) {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index === -1) return { removed: null, roundEnded: false };
    const [removed] = this.players.splice(index, 1);
    this.touch();

    let roundEnded = false;
    const round = this.round;
    if (this.phase === PHASE.PLAYING && round && removed.turnOrder != null) {
      round.votes.delete(removed.id);
      round.impostorIds.delete(removed.id);

      const remaining = this.participants;
      if (round.currentSpeaker === removed.turnOrder && remaining.length) {
        const next = remaining.find((p) => p.turnOrder > removed.turnOrder) || remaining[0];
        round.currentSpeaker = next.turnOrder;
      }
      // If everyone still in the round has already voted, finish it.
      if (!round.votingLocked && remaining.length && round.votes.size >= remaining.length) {
        this.endRound();
        roundEnded = true;
      }
    }
    if (this.players.length && !this.connectedPlayers.length) this.emptySince = this.emptySince || Date.now();
    return { removed, roundEnded };
  }

  // ─── Guards ───────────────────────────────────────────────────────────────

  assertHost(player) {
    if (!this.isHost(player)) throw new GameError('Only the host can do that.', 'NOT_HOST');
  }

  assertPlaying(message = 'No round is in progress.') {
    if (this.phase !== PHASE.PLAYING || !this.round) throw new GameError(message, 'WRONG_PHASE');
  }

  // ─── Lobby ────────────────────────────────────────────────────────────────

  setImpostorCount(player, count) {
    this.assertHost(player);
    const { MIN_IMPOSTORS, MAX_IMPOSTORS } = this.config;
    const n = Number.parseInt(count, 10) || MIN_IMPOSTORS;
    this.impostorCount = Math.max(MIN_IMPOSTORS, Math.min(MAX_IMPOSTORS, n));
    this.touch();
    return this.impostorCount;
  }

  // ─── Rounds ───────────────────────────────────────────────────────────────

  /**
   * Deals a new round to every connected player: random speaking order,
   * random impostors, a fresh word pair. Used for the first round, "New word"
   * and "New round" alike.
   */
  startRound(player) {
    this.assertHost(player);
    const crew = this.connectedPlayers;
    if (crew.length < this.config.MIN_PLAYERS) {
      throw new GameError(
        `Need at least ${this.config.MIN_PLAYERS} players to start. Currently ${crew.length} player(s) connected.`,
        'NOT_ENOUGH_PLAYERS'
      );
    }
    if (this.impostorCount >= crew.length) {
      throw new GameError('Too many impostors for this many players.', 'TOO_MANY_IMPOSTORS');
    }

    const orders = shuffle(crew.map((_, i) => i + 1));
    for (const p of this.players) p.turnOrder = null;
    crew.forEach((p, i) => {
      p.turnOrder = orders[i];
    });

    const impostorIds = new Set(shuffle(crew.map((p) => p.id)).slice(0, this.impostorCount));

    this.round = {
      id: ++this.roundCounter,
      pair: this.drawPair(),
      impostorIds,
      roster: crew.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      currentSpeaker: 1,
      votingLocked: true,
      votes: new Map(), // voterId -> targetId
    };
    this.phase = PHASE.PLAYING;
    this.results = null;
    this.touch();
    return this.round;
  }

  /** Draws a random pair without repeats until the whole list has been used. */
  drawPair() {
    if (this.deck.length === 0) {
      this.deck = shuffle(this.words.map((_, i) => i));
      const last = this.deck.length - 1;
      if (last > 0 && this.deck[last] === this.lastPairIndex) {
        [this.deck[0], this.deck[last]] = [this.deck[last], this.deck[0]];
      }
    }
    this.lastPairIndex = this.deck.pop();
    return this.words[this.lastPairIndex];
  }

  /**
   * Passes the turn to the next speaker (wrapping around). Allowed for the
   * current speaker and the host. `expected` ({ roundId, turn }) makes the
   * call idempotent: a duplicate or late tap is ignored instead of skipping
   * the next player. Returns true when the speaker changed.
   */
  advanceSpeaker(player, expected = {}) {
    this.assertPlaying();
    const round = this.round;
    const isSpeaker = player.turnOrder != null && player.turnOrder === round.currentSpeaker;
    if (!isSpeaker && !this.isHost(player)) throw new GameError("It's not your turn.", 'NOT_YOUR_TURN');

    if (expected.roundId != null && Number(expected.roundId) !== round.id) return false;
    if (expected.turn != null && Number(expected.turn) !== round.currentSpeaker) return false;

    const speakers = this.participants;
    if (!speakers.length) return false;
    const index = speakers.findIndex((p) => p.turnOrder === round.currentSpeaker);
    round.currentSpeaker = speakers[(index + 1) % speakers.length].turnOrder;
    this.touch();
    return true;
  }

  // ─── Voting ───────────────────────────────────────────────────────────────

  toggleVoting(player) {
    this.assertHost(player);
    this.assertPlaying();
    this.round.votingLocked = !this.round.votingLocked;
    this.touch();
    return this.round.votingLocked;
  }

  resetVoting(player) {
    this.assertHost(player);
    this.assertPlaying();
    this.round.votes.clear();
    this.round.votingLocked = true;
    this.touch();
  }

  /** Records a vote. Returns { roundEnded } — the round ends once everyone voted. */
  castVote(player, targetId) {
    this.assertPlaying('Voting is currently locked.');
    const round = this.round;
    if (round.votingLocked) throw new GameError('Voting is currently locked.', 'VOTING_LOCKED');
    if (player.turnOrder == null) throw new GameError("You're not playing this round.", 'NOT_IN_ROUND');
    if (round.votes.has(player.id)) throw new GameError('You have already voted.', 'ALREADY_VOTED');

    const target = this.getPlayer(targetId);
    if (!target || target.turnOrder == null) throw new GameError('That player is not in this round.', 'BAD_TARGET');
    if (target.id === player.id) throw new GameError("You can't vote for yourself.", 'BAD_TARGET');

    round.votes.set(player.id, target.id);
    this.touch();

    if (round.votes.size >= this.participants.length) {
      this.endRound();
      return { roundEnded: true };
    }
    return { roundEnded: false };
  }

  /**
   * Ends the round and scores it. The impostors are caught if any of them is
   * among the most-voted players. Caught: every crewmate +1. Not caught:
   * every impostor +1.
   */
  endRound() {
    this.assertPlaying();
    const round = this.round;

    const counts = new Map();
    for (const targetId of round.votes.values()) counts.set(targetId, (counts.get(targetId) || 0) + 1);
    const maxVotes = Math.max(0, ...counts.values());
    const mostVotedIds = [...counts].filter(([, n]) => n === maxVotes).map(([id]) => id);
    const impostorFound = mostVotedIds.some((id) => round.impostorIds.has(id));

    const scoreDeltas = {};
    for (const p of this.participants) {
      const isImpostor = round.impostorIds.has(p.id);
      const delta = impostorFound ? (isImpostor ? 0 : 1) : isImpostor ? 1 : 0;
      p.score += delta;
      scoreDeltas[p.id] = delta;
    }

    this.results = {
      roundId: round.id,
      impostorFound,
      impostorIds: [...round.impostorIds],
      mostVotedIds,
      voteCounts: Object.fromEntries(counts),
      votes: [...round.votes].map(([voterId, targetId]) => ({ voterId, targetId })),
      words: { crew: round.pair.crew, impostor: round.pair.impostor },
      scoreDeltas,
      roster: round.roster,
    };
    this.phase = PHASE.RESULTS;
    this.touch();
    return this.results;
  }

  /** Final ranking for the game-over screen. */
  standings() {
    return [...this.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score }));
  }

  // ─── Client view ──────────────────────────────────────────────────────────

  /** The state one player is allowed to see. Never leaks other players' roles or words. */
  snapshotFor(viewerId) {
    const viewer = this.getPlayer(viewerId);
    const round = this.phase === PHASE.LOBBY ? null : this.round;
    const voting = this.phase === PHASE.PLAYING && round;
    const inRound = Boolean(round && viewer && viewer.turnOrder != null);
    const isImpostor = inRound && round.impostorIds.has(viewer.id);
    const host = this.host;

    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      hostConnected: Boolean(host && host.socketId),
      settings: {
        impostorCount: this.impostorCount,
        minImpostors: this.config.MIN_IMPOSTORS,
        maxImpostors: this.config.MAX_IMPOSTORS,
        minPlayers: this.config.MIN_PLAYERS,
        maxPlayers: this.config.MAX_PLAYERS_PER_ROOM,
      },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isHost: p.id === this.hostId,
        isConnected: Boolean(p.socketId),
        score: p.score,
        turnOrder: p.turnOrder,
        hasVoted: Boolean(voting && round.votes.has(p.id)),
      })),
      you: viewer
        ? {
            id: viewer.id,
            name: viewer.name,
            isHost: this.isHost(viewer),
            inRound,
            turnOrder: viewer.turnOrder,
            word: inRound ? (isImpostor ? round.pair.impostor : round.pair.crew) : null,
            isImpostor,
            votedFor: (voting && round.votes.get(viewer.id)) || null,
          }
        : null,
      round: round
        ? {
            id: round.id,
            currentSpeaker: round.currentSpeaker,
            votingLocked: round.votingLocked,
            totalVotes: round.votes.size,
            totalVoters: this.participants.length,
          }
        : null,
      results: this.phase === PHASE.RESULTS ? this.results : null,
    };
  }
}

module.exports = { Room, PHASE, COLOR_COUNT };
