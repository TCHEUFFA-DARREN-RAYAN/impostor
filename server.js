const express = require('express');
const http = require('node:http');
const socketIo = require('socket.io');
const path = require('node:path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Word pairs dictionary
const wordPairs = {
  "Désinfectant": "Hôpital",
  "Stéthoscope": "Ambulance",
  "Scalpel": "Chirurgien",
  "Vaccin": "Seringue",
  "Radiographie": "Fracture",
  "Casserole": "Restaurant",
  "Couteau": "Planche à découper",
  "Four": "Boulangerie",
  "Réfrigérateur": "Congélateur",
  "Assiette": "Fourchette",
  "Craie": "Tableau noir",
  "Cartable": "Bibliothèque",
  "Diplôme": "Université",
  "Stylo": "Cahier",
  "Cloche": "Récréation",
  "Volant": "Garage",
  "Essence": "Station-service",
  "Pneu": "Crevaison",
  "Clignotant": "Rétroviseur",
  "Coffre": "Bagages",
  "Oreiller": "Lit",
  "Réveil": "Alarme",
  "Armoire": "Cintre",
  "Lampe": "Interrupteur",
  "Miroir": "Salle de bain",
  "Ballon": "Stade",
  "Sifflet": "Arbitre",
  "Maillot": "Vestiaire",
  "Médaille": "Podium",
  "Chronomètre": "Record",
  "Pinceau": "Toile",
  "Palette": "Musée",
  "Sculpture": "Galerie",
  "Chevalet": "Atelier",
  "Vernissage": "Exposition",
  "Clavier": "Souris",
  "Écran": "Projecteur",
  "Serveur": "Réseau",
  "Imprimante": "Scanner",
  "Câble": "Prise",
  "Billets": "Guichet",
  "Quai": "Locomotive",
  "Wagon": "Rails",
  "Horaire": "Retard",
  "Contrôleur": "Ticket",
  "Ancre": "Port",
  "Voile": "Mât",
  "Bouée": "Naufrage",
  "Phare": "Côte",
  "Gouvernail": "Capitaine"
};

// In-memory storage for rooms
const rooms = {};

// Generate random room code (6 characters, alphanumeric)
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get random word pair
function getRandomWordPair() {
  const keys = Object.keys(wordPairs);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return {
    mainWord: randomKey,
    impostorWord: wordPairs[randomKey]
  };
}

// Get player list for a room
function getPlayerList(roomCode) {
  if (!rooms[roomCode]) return [];
  return rooms[roomCode].players.map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost
  }));
}

// Check if socket is the host of a room
function isHost(socket, room) {
  if (!room) return false;
  const player = room.players.find(p => p.id === socket.id);
  return player && player.isHost;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create room
  socket.on('createRoom', (data) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      players: [{
        id: socket.id,
        name: data.name || 'Host',
        isHost: true
      }],
      host: socket.id,
      impostorCount: 1,
      gameStarted: false,
      currentWordPair: null
    };

    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
    socket.emit('playerListUpdate', { players: getPlayerList(roomCode) });
    console.log(`Room created: ${roomCode} by ${socket.id}`);
  });

  // Join room
  socket.on('joinRoom', (data) => {
    const { roomCode, name } = data;

    if (!rooms[roomCode]) {
      socket.emit('joinError', { message: 'Room not found' });
      return;
    }

    const room = rooms[roomCode];
    
    // Check if this socket is already in the room
    const existingPlayerIndex = room.players.findIndex(p => p.id === socket.id);
    if (existingPlayerIndex !== -1) {
      // Already in room, just rejoin socket room
      socket.join(roomCode);
      socket.emit('roomJoined', { roomCode });
      
      // If game has started, resend their word
      if (room.gameStarted && room.playerWords?.[player.name]) {
        const wordData = room.playerWords[player.name];
        io.to(socket.id).emit('gameStarted', {
          word: wordData.word,
          isImpostor: wordData.isImpostor
        });
      } else if (room.gameStarted && room.currentWordPair) {
        // Fallback to old method
        const player = room.players[existingPlayerIndex];
        const isImpostor = room.impostorNames?.includes(player.name) ?? false;
        io.to(socket.id).emit('gameStarted', {
          word: isImpostor ? room.currentWordPair.impostorWord : room.currentWordPair.mainWord,
          isImpostor: isImpostor
        });
      } else {
        io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
      }
      return;
    }

    // Check if a player with this name already exists (reconnection)
    const existingPlayerByNameIndex = room.players.findIndex(p => p.name === name);
    if (existingPlayerByNameIndex !== -1) {
      // Player reconnecting - update their socket ID
      const player = room.players[existingPlayerByNameIndex];
      const wasHost = player.isHost;
      player.id = socket.id;
      
      // Update host socket ID if this was the host
      if (wasHost) {
        room.host = socket.id;
      }
      
      socket.join(roomCode);
      socket.emit('roomJoined', { roomCode });
      
      // If game has started, resend their word
      if (room.gameStarted && room.playerWords?.[name]) {
        const wordData = room.playerWords[name];
        io.to(socket.id).emit('gameStarted', {
          word: wordData.word,
          isImpostor: wordData.isImpostor
        });
      } else if (room.gameStarted && room.currentWordPair) {
        // Fallback to old method
        const isImpostor = room.impostorNames?.includes(name) ?? false;
        io.to(socket.id).emit('gameStarted', {
          word: isImpostor ? room.currentWordPair.impostorWord : room.currentWordPair.mainWord,
          isImpostor: isImpostor
        });
      } else {
        io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
      }
      console.log(`${name} reconnected to room ${roomCode}`);
      return;
    }

    // New player joining - only allow if game hasn't started
    if (room.gameStarted) {
      socket.emit('joinError', { message: 'Game has already started' });
      return;
    }

    // Check if name is already taken
    const nameTaken = room.players.some(p => p.name === name);
    if (nameTaken) {
      socket.emit('joinError', { message: 'Name already taken in this room' });
      return;
    }

    room.players.push({
      id: socket.id,
      name: name,
      isHost: false
    });

    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode });
    
    // Broadcast updated player list to all in room
    io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
    console.log(`${name} joined room ${roomCode}`);
  });

  // Update impostor count (host only)
  socket.on('updateImpostorCount', (data) => {
    const { roomCode, count } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    room.impostorCount = Math.max(1, Math.min(5, Number.parseInt(count) || 1));
    socket.emit('impostorCountUpdated', { count: room.impostorCount });
  });

  // Start game
  socket.on('startGame', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    // Filter to only count players that are actually in the socket room (connected)
    const connectedPlayers = room.players.filter(player => {
      const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
      return socketsInRoom && socketsInRoom.has(player.id);
    });

    if (connectedPlayers.length < 2) {
      socket.emit('gameError', { message: `Need at least 2 players to start. Currently ${connectedPlayers.length} player(s) connected.` });
      return;
    }

    if (room.impostorCount >= connectedPlayers.length) {
      socket.emit('gameError', { message: 'Too many impostors for this many players' });
      return;
    }

    // Select random impostors from connected players
    const impostorIds = [];
    const playerIds = connectedPlayers.map(p => p.id);
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < room.impostorCount; i++) {
      impostorIds.push(shuffled[i]);
    }

    // Store impostor player names for reconnection (since socket IDs change)
    room.impostorNames = connectedPlayers
      .filter(p => impostorIds.includes(p.id))
      .map(p => p.name);

    // Get random word pair
    const wordPair = getRandomWordPair();
    room.currentWordPair = wordPair;
    room.gameStarted = true;

    // Store word assignments by player name for reconnection
    room.playerWords = {};
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      room.playerWords[player.name] = {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      };
    });

    // Send words to each connected player by socket ID
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      io.to(player.id).emit('gameStarted', {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      });
    });

    console.log(`Game started in room ${roomCode}`);
  });

  // New round
  socket.on('newRound', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    // Filter to only count players that are actually in the socket room (connected)
    const connectedPlayers = room.players.filter(player => {
      const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
      return socketsInRoom && socketsInRoom.has(player.id);
    });

    if (connectedPlayers.length < 2) {
      socket.emit('gameError', { message: `Need at least 2 players. Currently ${connectedPlayers.length} player(s) connected.` });
      return;
    }

    if (room.impostorCount >= connectedPlayers.length) {
      socket.emit('gameError', { message: 'Too many impostors for this many players' });
      return;
    }

    // Update player IDs to only use connected players
    // This ensures we're working with current socket connections
    room.players = connectedPlayers;

    // Select new random impostors from connected players
    const impostorIds = [];
    const playerIds = connectedPlayers.map(p => p.id);
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < room.impostorCount; i++) {
      impostorIds.push(shuffled[i]);
    }

    // Store impostor player names for reconnection (since socket IDs change)
    room.impostorNames = connectedPlayers
      .filter(p => impostorIds.includes(p.id))
      .map(p => p.name);

    // Get new random word pair
    const wordPair = getRandomWordPair();
    room.currentWordPair = wordPair;

    // Store word assignments by player name for reconnection
    room.playerWords = {};
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      room.playerWords[player.name] = {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      };
    });

    // Send new words to each connected player
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      io.to(player.id).emit('newRoundStarted', {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      });
    });

    console.log(`New round started in room ${roomCode}`);
  });

  // End game
  socket.on('endGame', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    // Notify all players
    io.to(roomCode).emit('gameEnded');
    
    // Clean up room
    delete rooms[roomCode];
    console.log(`Game ended in room ${roomCode}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Find player in rooms
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        const wasHost = player.isHost;
        const disconnectedSocketId = socket.id;
        const playerName = player.name;
        
        // If game has started, don't remove players immediately - allow reconnection
        // This handles page navigation (lobby.html -> game.html)
        if (room.gameStarted || wasHost) {
          // Keep player in array for reconnection, don't remove immediately
          if (wasHost) {
            // Set a timeout to delete the room if host doesn't reconnect
            setTimeout(() => {
              // Check if room still exists
              if (rooms[roomCode]) {
                // Check if host reconnected (socket ID changed) or still disconnected
                const hostPlayer = rooms[roomCode].players.find(p => p.name === playerName && p.isHost);
                if (!hostPlayer || hostPlayer.id === disconnectedSocketId) {
                  // Host didn't reconnect, delete room
                  io.to(roomCode).emit('hostLeft');
                  delete rooms[roomCode];
                  console.log(`Host left, room ${roomCode} deleted`);
                }
              }
            }, 5000); // 5 second grace period for page navigation
          }
          // For non-host players in started game, just keep them in array
          // They'll reconnect with new socket ID
        } else {
          // Game hasn't started, remove player immediately
          room.players.splice(playerIndex, 1);
          // Update player list for remaining players
          io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

