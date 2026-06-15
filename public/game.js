(function () {
  'use strict';

  // ─── Player Colors (Among Us palette) ─────────────────────────────────────
  const PLAYER_COLORS = [
    { bg: '#c51111', light: '#ff4444' },
    { bg: '#132ed2', light: '#4466ff' },
    { bg: '#127f2d', light: '#2ed573' },
    { bg: '#c2b613', light: '#ffd700' },
    { bg: '#159e8e', light: '#38fedb' },
    { bg: '#6b31bc', light: '#a55eea' },
    { bg: '#ed54ba', light: '#ff79c6' },
    { bg: '#ef7d0e', light: '#ffa502' },
    { bg: '#50b039', light: '#7bed9f' },
    { bg: '#72491e', light: '#cd853f' },
    { bg: '#6b2c3b', light: '#b33939' },
    { bg: '#ec7578', light: '#f8a5c2' },
  ];

  // ─── State ─────────────────────────────────────────────────────────────────
  const S = {
    socket: null,
    roomCode: null,
    playerName: null,
    isHost: false,
    players: [],
    myTurnOrder: null,
    hasVoted: false,
    votingLocked: true,
    currentSpeakerTurn: 1,
    lastSpeakerName: '',
    waitingForSpeakerAck: false,
    isImpostor: false,
    myWord: '',
    impostorCount: 1,
    roundEnded: false,
    colorMap: {},
    isReconnecting: false,
  };

  let currentScreen = 'screen-home';
  const $ = (id) => document.getElementById(id);

  // ─── Screen Management ─────────────────────────────────────────────────────
  function showScreen(id) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach((s) => s.classList.remove('active'));
    const target = $(id);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }
    currentScreen = id;
  }

  // ─── Avatar Helpers ────────────────────────────────────────────────────────
  function getColor(name) {
    if (S.colorMap[name] !== undefined) return PLAYER_COLORS[S.colorMap[name]];
    const used = new Set(Object.values(S.colorMap));
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      if (!used.has(i)) { S.colorMap[name] = i; return PLAYER_COLORS[i]; }
    }
    S.colorMap[name] = 0;
    return PLAYER_COLORS[0];
  }

  function makeAvatar(name, size) {
    const c = getColor(name);
    const el = document.createElement('div');
    el.className = 'avatar';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.lineHeight = size + 'px';
    el.style.fontSize = Math.round(size * 0.4) + 'px';
    el.style.background = c.bg;
    el.style.borderColor = c.light;
    el.textContent = name.charAt(0).toUpperCase();
    return el;
  }

  function avatarMiniHTML(name) {
    const c = getColor(name);
    return `<div class="avatar-mini" style="background:${c.bg};border-color:${c.light}">${name.charAt(0).toUpperCase()}</div>`;
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg, type) {
    type = type || 'error';
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    $('toast-container').appendChild(el);
    setTimeout(() => { el.classList.add('toast-exit'); setTimeout(() => el.remove(), 400); }, 3500);
  }

  // ─── Confirm Modal ─────────────────────────────────────────────────────────
  function confirm(title, msg, onYes, yesText, yesCls) {
    $('modal-title').textContent = title;
    $('modal-message').textContent = msg;
    $('modal-overlay').style.display = 'flex';
    const cb = $('modal-confirm');
    cb.textContent = yesText || 'YES';
    cb.className = 'btn ' + (yesCls || 'btn-blue') + ' btn-chunky';
    cb.onclick = () => { $('modal-overlay').style.display = 'none'; onYes(); };
    $('modal-cancel').onclick = () => { $('modal-overlay').style.display = 'none'; };
  }

  // ─── Vibrate ───────────────────────────────────────────────────────────────
  function vib(p) { if (navigator.vibrate) navigator.vibrate(p); }

  // ─── Confetti ──────────────────────────────────────────────────────────────
  function confetti() {
    const cv = $('confetti-canvas');
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    cv.style.display = 'block';
    const ctx = cv.getContext('2d');
    const colors = ['#ff4757', '#5865f2', '#2ed573', '#ffd700', '#ff9f43', '#a55eea', '#ff6b9d'];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * cv.width,
      y: Math.random() * cv.height - cv.height,
      w: Math.random() * 10 + 4, h: Math.random() * 6 + 3,
      c: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3 + 2,
      r: Math.random() * 360, rs: (Math.random() - 0.5) * 12,
    }));
    let f = 0;
    (function loop() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of pieces) {
        p.x += p.vx; p.y += p.vy; p.r += p.rs; p.vy += 0.06;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r * Math.PI / 180);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (++f < 200) requestAnimationFrame(loop); else cv.style.display = 'none';
    })();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOCKET EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  function initSocket() {
    S.socket = io();
    const sk = S.socket;

    // ── Room lifecycle ───────────────────────────────────────────────────
    sk.on('roomCreated', (d) => {
      S.roomCode = d.roomCode;
      S.isHost = true;
      save();
      $('lobby-room-code').textContent = S.roomCode;
      $('lobby-host-controls').style.display = 'block';
      $('lobby-guest-msg').style.display = 'none';
      showScreen('screen-lobby');
      GameSounds.play('chime');
    });

    sk.on('roomJoined', (d) => {
      S.roomCode = d.roomCode;
      save();
      $('lobby-room-code').textContent = S.roomCode;
      if (S.isHost) {
        $('lobby-host-controls').style.display = 'block';
        $('lobby-guest-msg').style.display = 'none';
      } else {
        $('lobby-host-controls').style.display = 'none';
        $('lobby-guest-msg').style.display = 'block';
      }
      if (currentScreen === 'screen-home') {
        showScreen('screen-lobby');
        GameSounds.play('chime');
      }
    });

    sk.on('playerListUpdate', (d) => {
      S.players = d.players;
      d.players.forEach((p) => getColor(p.name));
      $('lobby-player-count').textContent = d.players.length;
      if (currentScreen === 'screen-lobby') buildLobby();
      if (currentScreen === 'screen-playing') {
        updateTopbar();
        updateSpeaker();
        buildVotingGrid();
      }
    });

    sk.on('impostorCountUpdated', (d) => {
      S.impostorCount = d.count;
      $('impostor-count-display').textContent = d.count;
    });

    sk.on('playerKicked', (d) => toast(d.playerName + ' was removed.', 'info'));

    // ── Game start / new round ───────────────────────────────────────────
    sk.on('gameStarted', (d) => handleStart(d));
    sk.on('newRoundStarted', (d) => handleStart(d));

    // ── Speaker ──────────────────────────────────────────────────────────
    sk.on('speakerUpdate', (d) => {
      S.currentSpeakerTurn = d.currentSpeaker;
      S.lastSpeakerName = d.speakerName;
      S.waitingForSpeakerAck = false;
      if (currentScreen === 'screen-playing') updateSpeaker();
    });

    // ── Voting ───────────────────────────────────────────────────────────
    sk.on('votingStatusUpdate', (d) => {
      const wasLocked = S.votingLocked;
      S.votingLocked = d.locked;
      updateVotingLock();
      updateVoteBar(d.totalVotes, d.totalPlayers);
      if (S.isHost) $('btn-toggle-voting').textContent = S.votingLocked ? 'UNLOCK VOTING' : 'LOCK VOTING';
      if (wasLocked && !S.votingLocked) { GameSounds.play('alert'); vib(100); }
    });

    sk.on('votingReset', () => { S.hasVoted = false; buildVotingGrid(); updateVotingLock(); });
    sk.on('voteUpdate', (d) => updateVoteBar(d.totalVotes, d.totalPlayers));
    sk.on('voteError', (d) => toast(d.message));

    // ── Round end ────────────────────────────────────────────────────────
    sk.on('roundEnded', (d) => {
      S.roundEnded = true;
      S.players = d.players;
      buildResults(d);
      showScreen('screen-results');
      if (d.impostorFound) { GameSounds.play('victory'); confetti(); }
      else GameSounds.play('defeat');
      vib([100, 50, 100]);
    });

    // ── Game end ─────────────────────────────────────────────────────────
    sk.on('gameEnded', (d) => {
      buildGameOver(d ? d.players : S.players);
      showScreen('screen-gameover');
      GameSounds.play('fanfare');
      confetti();
      resetGame();
    });

    // ── Errors / kicks ───────────────────────────────────────────────────
    sk.on('gameError', (d) => toast(d.message));
    sk.on('joinError', (d) => toast(d.message));

    sk.on('kickedFromRoom', (d) => {
      toast(d && d.message ? d.message : 'You were removed from the room.');
      resetAll();
      showScreen('screen-home');
    });

    sk.on('hostLeft', () => {
      toast('Host left the game.');
      resetAll();
      showScreen('screen-home');
    });

    // ── Reconnection ─────────────────────────────────────────────────────
    sk.on('connect', () => {
      if (S.roomCode && S.playerName && currentScreen !== 'screen-home') {
        sk.emit('joinRoom', { roomCode: S.roomCode, name: S.playerName });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════
  function handleStart(d) {
    S.myWord = d.word;
    S.isImpostor = d.isImpostor;
    S.hasVoted = false;
    S.votingLocked = true;
    S.roundEnded = false;
    S.waitingForSpeakerAck = false;
    if (d.players) { S.players = d.players; d.players.forEach((p) => getColor(p.name)); }
    if (d.turnOrder != null) S.myTurnOrder = parseInt(d.turnOrder);
    else {
      const me = (d.players || []).find((p) => p.name === S.playerName);
      if (me && me.turnOrder != null) S.myTurnOrder = parseInt(me.turnOrder);
    }

    if (S.isReconnecting) {
      S.isReconnecting = false;
      setupPlaying();
      showScreen('screen-playing');
      return;
    }

    setupReveal();
    showScreen('screen-reveal');
    GameSounds.play('whoosh');
  }

  // ─── Reveal Screen ─────────────────────────────────────────────────────────
  function setupReveal() {
    const card = $('reveal-card');
    const back = card.querySelector('.reveal-card-back');
    const role = $('reveal-role');
    const word = $('reveal-word');

    card.classList.remove('flipped');
    word.textContent = S.myWord;

    if (S.isImpostor) {
      role.textContent = 'YOU ARE THE IMPOSTOR';
      role.className = 'reveal-role impostor-role';
      word.className = 'reveal-word impostor-text';
      back.className = 'reveal-card-back impostor-back';
    } else {
      role.textContent = 'YOUR WORD IS';
      role.className = 'reveal-role';
      word.className = 'reveal-word';
      back.className = 'reveal-card-back';
    }

    const fresh = card.cloneNode(true);
    card.parentNode.replaceChild(fresh, card);

    fresh.addEventListener('click', function handler() {
      if (fresh.classList.contains('flipped')) return;
      fresh.classList.add('flipped');
      GameSounds.play('reveal');

      if (S.isImpostor) {
        setTimeout(() => {
          document.body.classList.add('shake');
          GameSounds.play('impostor');
          vib([200, 100, 200, 100, 200]);
          setTimeout(() => document.body.classList.remove('shake'), 600);
        }, 600);
      }

      setTimeout(() => { setupPlaying(); showScreen('screen-playing'); }, S.isImpostor ? 3500 : 2500);
    }, { once: true });
  }

  // ─── Playing Screen ────────────────────────────────────────────────────────
  function setupPlaying() {
    updateTopbar();
    $('playing-my-word').textContent = S.myWord;
    if (S.isImpostor) {
      $('playing-impostor-badge').style.display = 'block';
      $('playing-my-word').classList.add('impostor-text');
    } else {
      $('playing-impostor-badge').style.display = 'none';
      $('playing-my-word').classList.remove('impostor-text');
    }
    if (S.isHost) {
      $('playing-host-controls').style.display = 'flex';
      $('btn-toggle-voting').textContent = S.votingLocked ? 'UNLOCK VOTING' : 'LOCK VOTING';
    } else {
      $('playing-host-controls').style.display = 'none';
    }
    buildVotingGrid();
    updateVotingLock();
    updateSpeaker();
  }

  function updateTopbar() {
    const me = S.players.find((p) => p.name === S.playerName);
    $('playing-score').textContent = me ? (me.score || 0) : 0;
    $('playing-turn').textContent = S.myTurnOrder ? S.myTurnOrder + '/' + S.players.length : '-/' + (S.players.length || '-');
  }

  function updateSpeaker() {
    const spot = $('speaker-spotlight');
    const speakBtn = $('btn-speak-done');
    const listen = $('speaker-listening');
    const bar = $('speaker-progress-bar');

    const speaker = S.players.find((p) => p.turnOrder === S.currentSpeakerTurn);
    const isMe = S.myTurnOrder != null && parseInt(S.currentSpeakerTurn) === parseInt(S.myTurnOrder);

    spot.innerHTML = '';
    if (speaker) {
      const av = makeAvatar(speaker.name, 64);
      av.classList.add('spotlight-avatar');
      if (isMe) av.classList.add('my-turn');
      spot.appendChild(av);
      const nm = document.createElement('span');
      nm.className = 'spotlight-name';
      nm.textContent = speaker.name;
      spot.appendChild(nm);
    }

    const active = S.players.filter((p) => p.turnOrder != null).sort((a, b) => a.turnOrder - b.turnOrder);
    if (active.length) {
      const idx = active.findIndex((p) => p.turnOrder === S.currentSpeakerTurn);
      bar.style.width = ((idx + 1) / active.length * 100) + '%';
    }

    if (isMe) {
      speakBtn.style.display = 'flex';
      listen.style.display = 'none';
      speakBtn.disabled = false;
      speakBtn.style.pointerEvents = '';
      S.waitingForSpeakerAck = false;
    } else {
      speakBtn.style.display = 'none';
      speakBtn.disabled = true;
      speakBtn.style.pointerEvents = 'none';
      listen.style.display = 'block';
      $('speaker-listening-name').textContent = S.lastSpeakerName || '...';
    }
  }

  function buildVotingGrid() {
    const grid = $('voting-grid');
    grid.innerHTML = '';
    const others = S.players.filter((p) => p.name !== S.playerName);
    others.forEach((p) => {
      const cell = document.createElement('button');
      cell.className = 'vote-cell';
      cell.disabled = S.votingLocked || S.hasVoted;
      if (S.votingLocked) cell.classList.add('locked');

      cell.appendChild(makeAvatar(p.name, 42));
      const nm = document.createElement('span');
      nm.className = 'vote-cell-name';
      nm.textContent = p.name;
      cell.appendChild(nm);

      cell.addEventListener('click', () => {
        if (S.hasVoted || S.votingLocked) return;
        S.hasVoted = true;
        cell.classList.add('voted');
        grid.querySelectorAll('.vote-cell').forEach((c) => (c.disabled = true));
        S.socket.emit('voteImpostor', { roomCode: S.roomCode, votedPlayerName: p.name });
        GameSounds.play('click');
        vib(50);
      });

      grid.appendChild(cell);
    });
  }

  function updateVotingLock() {
    const msg = $('voting-locked-msg');
    const cells = document.querySelectorAll('.vote-cell');
    if (S.votingLocked) {
      msg.style.display = 'block';
      cells.forEach((c) => { c.disabled = true; c.classList.add('locked'); });
    } else {
      msg.style.display = 'none';
      if (!S.hasVoted) cells.forEach((c) => { c.disabled = false; c.classList.remove('locked'); });
    }
  }

  function updateVoteBar(total, max) {
    $('vote-progress-fill').style.width = (max > 0 ? total / max * 100 : 0) + '%';
    $('vote-progress-text').textContent = total + ' / ' + max + ' votes';
  }

  // ─── Lobby ─────────────────────────────────────────────────────────────────
  function buildLobby() {
    const grid = $('lobby-players-grid');
    grid.innerHTML = '';
    const sorted = [...S.players].sort((a, b) => {
      if (a.turnOrder && b.turnOrder) return a.turnOrder - b.turnOrder;
      return 0;
    });
    sorted.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'lobby-player-item' + (p.isConnected ? '' : ' disconnected');
      row.appendChild(makeAvatar(p.name, 42));

      const info = document.createElement('div');
      info.className = 'lobby-player-info';
      const nm = document.createElement('span');
      nm.className = 'lobby-player-name';
      nm.textContent = p.name;
      info.appendChild(nm);

      const badges = document.createElement('div');
      badges.className = 'lobby-player-badges';
      if (p.isHost) badges.innerHTML += '<span class="badge badge-host">HOST</span>';
      if (p.score > 0) badges.innerHTML += '<span class="badge badge-score">' + p.score + ' pts</span>';
      if (!p.isConnected) badges.innerHTML += '<span class="badge badge-dc">DC</span>';
      info.appendChild(badges);
      row.appendChild(info);

      if (S.isHost && !p.isHost) {
        const k = document.createElement('button');
        k.className = 'btn-kick';
        k.textContent = '✕';
        k.onclick = () => S.socket.emit('kickPlayer', { roomCode: S.roomCode, playerId: p.id });
        row.appendChild(k);
      }
      grid.appendChild(row);
    });
  }

  // ─── Results ───────────────────────────────────────────────────────────────
  function buildResults(d) {
    // Verdict
    const v = $('results-verdict');
    if (d.impostorFound) {
      v.innerHTML = '<span class="verdict-icon">✅</span><span class="verdict-text found">IMPOSTOR FOUND!</span>';
    } else {
      v.innerHTML = '<span class="verdict-icon">❌</span><span class="verdict-text survived">IMPOSTOR WINS!</span>';
    }

    // Votes
    let vh = '<h4>VOTE RESULTS</h4><div class="results-vote-list">';
    [...d.players].sort((a, b) => (d.voteCounts[b.name] || 0) - (d.voteCounts[a.name] || 0)).forEach((p) => {
      const n = d.voteCounts[p.name] || 0;
      const imp = d.impostorNames.includes(p.name);
      vh += '<div class="results-vote-item' + (imp ? ' is-impostor' : '') + '">' +
        avatarMiniHTML(p.name) +
        '<span class="results-vote-name">' + esc(p.name) + '</span>' +
        '<span class="results-vote-count">' + n + ' vote' + (n !== 1 ? 's' : '') + '</span>' +
        (imp ? '<span class="badge badge-impostor">IMPOSTOR</span>' : '') +
        '</div>';
    });
    vh += '</div>';
    $('results-voted-player').innerHTML = vh;

    // Impostor reveal
    let ih = '<h4>THE IMPOSTOR' + (d.impostorNames.length > 1 ? 'S WERE' : ' WAS') + '</h4><div class="impostor-names">';
    d.impostorNames.forEach((n) => {
      ih += '<div class="impostor-name-item">' + avatarMiniHTML(n) + '<span>' + esc(n) + '</span></div>';
    });
    ih += '</div>';
    $('results-impostor-reveal').innerHTML = ih;

    // Scores
    let sh = '<h4>SCORES</h4><div class="results-scores-list">';
    [...d.players].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((p) => {
      const me = p.name === S.playerName;
      sh += '<div class="results-score-item' + (me ? ' is-me' : '') + '">' +
        avatarMiniHTML(p.name) +
        '<span class="results-score-name">' + esc(p.name) + (me ? ' (You)' : '') + '</span>' +
        '<span class="results-score-value">' + (p.score || 0) + '</span></div>';
    });
    sh += '</div>';
    $('results-scores').innerHTML = sh;

    if (S.isHost) { $('results-host-controls').style.display = 'flex'; $('results-guest-msg').style.display = 'none'; }
    else { $('results-host-controls').style.display = 'none'; $('results-guest-msg').style.display = 'block'; }
  }

  // ─── Game Over ─────────────────────────────────────────────────────────────
  function buildGameOver(players) {
    const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top3 = sorted.slice(0, 3);

    const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : [...top3];
    const heights = { 0: 90, 1: 120, 2: 70 };

    let ph = '<div class="podium-row">';
    podiumOrder.forEach((p) => {
      const rank = top3.indexOf(p);
      const c = getColor(p.name);
      ph += '<div class="podium-place"><div class="podium-avatar-wrap">' +
        (rank === 0 ? '<span class="crown">👑</span>' : '') +
        '<div class="avatar" style="width:52px;height:52px;line-height:52px;font-size:20px;background:' + c.bg + ';border-color:' + c.light + '">' + esc(p.name.charAt(0).toUpperCase()) + '</div>' +
        '</div><span class="podium-name">' + esc(p.name) + '</span>' +
        '<div class="podium-bar" style="height:' + heights[rank] + 'px"><span class="podium-rank">#' + (rank + 1) + '</span><span class="podium-pts">' + (p.score || 0) + ' pts</span></div></div>';
    });
    ph += '</div>';
    $('podium').innerHTML = ph;

    let oh = '';
    sorted.slice(3).forEach((p, i) => {
      oh += '<div class="other-score-item"><span class="other-rank">#' + (i + 4) + '</span>' +
        avatarMiniHTML(p.name) +
        '<span class="other-name">' + esc(p.name) + '</span><span class="other-pts">' + (p.score || 0) + ' pts</span></div>';
    });
    $('other-scores').innerHTML = oh;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function save() {
    sessionStorage.setItem('roomCode', S.roomCode || '');
    sessionStorage.setItem('playerName', S.playerName || '');
    sessionStorage.setItem('isHost', S.isHost ? 'true' : 'false');
  }

  function resetGame() {
    S.myTurnOrder = null;
    S.hasVoted = false;
    S.votingLocked = true;
    S.currentSpeakerTurn = 1;
    S.lastSpeakerName = '';
    S.isImpostor = false;
    S.myWord = '';
    S.roundEnded = false;
  }

  function resetAll() {
    S.roomCode = null;
    S.isHost = false;
    S.players = [];
    S.colorMap = {};
    sessionStorage.removeItem('roomCode');
    sessionStorage.removeItem('playerName');
    sessionStorage.removeItem('isHost');
    resetGame();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════
  function bindUI() {
    // ── Home ──
    $('btn-create').onclick = () => { $('create-modal').style.display = 'flex'; $('create-name-input').value = ''; $('create-name-input').focus(); };
    $('create-confirm').onclick = () => {
      const n = $('create-name-input').value.trim() || 'Host';
      S.playerName = n; S.isHost = true; save();
      $('create-modal').style.display = 'none';
      S.socket.emit('createRoom', { name: n });
    };
    $('create-cancel').onclick = () => { $('create-modal').style.display = 'none'; };
    $('create-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create-confirm').click(); });

    $('btn-join').onclick = () => { $('join-modal').style.display = 'flex'; $('join-code-input').value = ''; $('join-name-input').value = ''; $('join-code-input').focus(); };
    $('join-confirm').onclick = () => {
      const code = $('join-code-input').value.trim().toUpperCase();
      const n = $('join-name-input').value.trim();
      if (!code || !n) { toast('Enter both room code and name'); return; }
      S.playerName = n; S.isHost = false; save();
      $('join-modal').style.display = 'none';
      S.socket.emit('joinRoom', { roomCode: code, name: n });
    };
    $('join-cancel').onclick = () => { $('join-modal').style.display = 'none'; };
    $('join-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-name-input').focus(); });
    $('join-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-confirm').click(); });

    // ── Lobby ──
    $('btn-copy-code').onclick = () => {
      navigator.clipboard.writeText(S.roomCode || '').then(() => {
        const b = $('btn-copy-code'); b.textContent = 'COPIED!';
        setTimeout(() => (b.textContent = 'COPY'), 2000);
      }).catch(() => {});
    };
    $('btn-imp-minus').onclick = () => {
      S.impostorCount = Math.max(1, S.impostorCount - 1);
      $('impostor-count-display').textContent = S.impostorCount;
      S.socket.emit('updateImpostorCount', { roomCode: S.roomCode, count: S.impostorCount });
    };
    $('btn-imp-plus').onclick = () => {
      S.impostorCount = Math.min(5, S.impostorCount + 1);
      $('impostor-count-display').textContent = S.impostorCount;
      S.socket.emit('updateImpostorCount', { roomCode: S.roomCode, count: S.impostorCount });
    };
    $('btn-start-game').onclick = () => S.socket.emit('startGame', { roomCode: S.roomCode });
    $('btn-leave-lobby').onclick = () => confirm('Leave Game?', 'Are you sure?', () => {
      S.socket.emit('leaveRoom', { roomCode: S.roomCode }); resetAll(); showScreen('screen-home');
    }, 'LEAVE', 'btn-red');

    // ── Playing ──
    $('btn-speak-done').addEventListener('click', () => {
      if (S.waitingForSpeakerAck) return;
      const isMe = S.myTurnOrder != null && parseInt(S.currentSpeakerTurn) === parseInt(S.myTurnOrder);
      if (!isMe) return;
      S.waitingForSpeakerAck = true;
      $('btn-speak-done').disabled = true;
      $('btn-speak-done').style.pointerEvents = 'none';
      S.socket.emit('nextSpeaker', { roomCode: S.roomCode });
    });
    $('btn-toggle-voting').onclick = () => S.socket.emit('toggleVoting', { roomCode: S.roomCode });
    $('btn-reset-voting').onclick = () => S.socket.emit('resetVoting', { roomCode: S.roomCode });
    $('btn-new-word').onclick = () => S.socket.emit('newRound', { roomCode: S.roomCode });
    $('btn-end-round').onclick = () => confirm('End Round?', 'Show results now?', () => S.socket.emit('endRound', { roomCode: S.roomCode }), 'END ROUND', 'btn-red');
    $('btn-leave-game').onclick = () => confirm('Leave Game?', 'Are you sure?', () => {
      S.socket.emit('leaveRoom', { roomCode: S.roomCode }); resetAll(); showScreen('screen-home');
    }, 'LEAVE', 'btn-red');

    // ── Results ──
    $('btn-new-round').onclick = () => S.socket.emit('newRound', { roomCode: S.roomCode });
    $('btn-end-game').onclick = () => confirm('End Game?', 'Show final scores?', () => S.socket.emit('endGame', { roomCode: S.roomCode }), 'END GAME', 'btn-red');

    // ── Game Over ──
    $('btn-play-again').onclick = () => { resetAll(); showScreen('screen-home'); };

    // ── Mute ──
    $('muteBtn').onclick = () => { const m = GameSounds.toggle(); $('muteBtn').textContent = m ? '🔇' : '🔊'; };
    if (GameSounds.isMuted()) $('muteBtn').textContent = '🔇';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    bindUI();

    // Unlock audio on first touch
    const unlock = () => { GameSounds.init(); document.removeEventListener('click', unlock); document.removeEventListener('touchstart', unlock); };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);

    // Attempt reconnection from session
    const savedRoom = sessionStorage.getItem('roomCode');
    const savedName = sessionStorage.getItem('playerName');
    const savedHost = sessionStorage.getItem('isHost');
    if (savedRoom && savedName) {
      S.playerName = savedName;
      S.isHost = savedHost === 'true';
      S.roomCode = savedRoom;
      S.isReconnecting = true;
      $('lobby-room-code').textContent = savedRoom;
      S.socket.emit('joinRoom', { roomCode: savedRoom, name: savedName });
    }
  });
})();
