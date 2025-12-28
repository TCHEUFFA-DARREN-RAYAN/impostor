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

// Professional Fisher-Yates shuffle algorithm for true randomness
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Get player list for a room
function getPlayerList(roomCode) {
  const room = rooms[roomCode];
  if (!room) return [];
  const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
  const connectedIds = socketsInRoom ? new Set(socketsInRoom) : new Set();
  return room.players.map(player => {
    const socket = io.sockets.sockets.get(player.id);
    const isConnected = Boolean(socket && socket.connected && connectedIds.has(player.id));
    return {
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      turnOrder: player.turnOrder,
      score: player.score || 0,
      isConnected
    };
  });
}

function removePlayerFromRoom(roomCode, playerId, options = {}) {
  const room = rooms[roomCode];
  if (!room) return null;
  const playerIndex = room.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return null;

  const [removedPlayer] = room.players.splice(playerIndex, 1);
  if (room.playerWords) {
    delete room.playerWords[removedPlayer.name];
  }
  if (room.votes) {
    delete room.votes[removedPlayer.name];
  }
  if (room.impostorNames) {
    room.impostorNames = room.impostorNames.filter(name => name !== removedPlayer.name);
  }

  if (room.gameStarted && room.currentSpeaker === removedPlayer.turnOrder) {
    const nextSpeaker = room.players
      .filter(p => p.turnOrder !== null && p.turnOrder !== undefined)
      .sort((a, b) => a.turnOrder - b.turnOrder)[0];

    if (nextSpeaker) {
      room.currentSpeaker = nextSpeaker.turnOrder;
      io.to(roomCode).emit('speakerUpdate', {
        currentSpeaker: room.currentSpeaker,
        speakerName: nextSpeaker.name
      });
    }
  }

  if (options.notifySocket) {
    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) {
      targetSocket.leave(roomCode);
      targetSocket.emit('kickedFromRoom', {
        message: options.reason || 'You were removed from the room by the host.'
      });
    }
  }

  if (room.players.length === 0) {
    delete rooms[roomCode];
  } else {
    io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
  }

  return removedPlayer;
}

// Get connected players for a room (more reliable check)
function getConnectedPlayers(roomCode) {
  if (!rooms[roomCode]) return [];
  const room = rooms[roomCode];
  const socketsInRoom = io.sockets.adapter.rooms.get(roomCode);
  
  if (!socketsInRoom) return [];
  
  // Return all players whose socket IDs are in the room and socket is connected
  return room.players.filter(player => {
    const socket = io.sockets.sockets.get(player.id);
    return socket && socket.connected && socketsInRoom.has(player.id);
  });
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
        isHost: true,
        score: 0,
        turnOrder: null // Only assigned when game starts
      }],
      host: socket.id,
      impostorCount: 1,
      gameStarted: false,
      currentWordPair: null,
      currentTurn: 1, // Current turn order (1, 2, 3...)
      currentSpeaker: 1, // Start with turn 1
      votes: {},
      votingLocked: true, // Voting is locked by default
      roundEnded: false
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
          isImpostor: wordData.isImpostor,
          turnOrder: player.turnOrder,
          players: getPlayerList(roomCode)
        });
      } else if (room.gameStarted && room.currentWordPair) {
        // Fallback to old method
        const player = room.players[existingPlayerIndex];
        const isImpostor = room.impostorNames?.includes(player.name) ?? false;
        io.to(socket.id).emit('gameStarted', {
          word: isImpostor ? room.currentWordPair.impostorWord : room.currentWordPair.mainWord,
          isImpostor: isImpostor,
          turnOrder: player.turnOrder,
          players: getPlayerList(roomCode)
        });
      }
      
      if (!room.gameStarted) {
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
          isImpostor: wordData.isImpostor,
          turnOrder: player.turnOrder,
          players: getPlayerList(roomCode)
        });
      } else if (room.gameStarted && room.currentWordPair) {
        // Fallback to old method
        const isImpostor = room.impostorNames?.includes(name) ?? false;
        io.to(socket.id).emit('gameStarted', {
          word: isImpostor ? room.currentWordPair.impostorWord : room.currentWordPair.mainWord,
          isImpostor: isImpostor,
          turnOrder: player.turnOrder,
          players: getPlayerList(roomCode)
        });
      }
      
      if (!room.gameStarted) {
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
      isHost: false,
      score: 0,
      turnOrder: null // Only assigned when game starts
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

  socket.on('kickPlayer', (data) => {
    const { roomCode, playerId } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    const targetPlayer = room.players.find(p => p.id === playerId);
    if (!targetPlayer || targetPlayer.isHost) {
      return;
    }

    removePlayerFromRoom(roomCode, playerId, {
      notifySocket: true,
      reason: `${targetPlayer.name} was removed from the lobby by the host.`
    });
    socket.emit('playerKicked', { playerName: targetPlayer.name });
  });

  // Start game
  socket.on('startGame', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    const connectedPlayers = getConnectedPlayers(roomCode);
    if (connectedPlayers.length < 2) {
      socket.emit('gameError', { message: `Need at least 2 players to start. Currently ${connectedPlayers.length} player(s) connected.` });
      return;
    }

    if (room.impostorCount >= connectedPlayers.length) {
      socket.emit('gameError', { message: 'Too many impostors for this many players' });
      return;
    }

    // 1. Assign unique random turn orders to EVERY connected player
    const numbers = Array.from({ length: connectedPlayers.length }, (_, i) => i + 1);
    const shuffledNumbers = shuffleArray(numbers);
    
    connectedPlayers.forEach((player, index) => {
      const roomPlayer = room.players.find(rp => rp.name === player.name);
      if (roomPlayer) {
        roomPlayer.turnOrder = shuffledNumbers[index];
        roomPlayer.id = player.id; // Ensure socket ID is current
        if (roomPlayer.score === undefined) roomPlayer.score = 0;
      }
    });

    // 2. Select random impostors using true shuffle
    const playerIds = connectedPlayers.map(p => p.id);
    const shuffledPlayerIds = shuffleArray(playerIds);
    const impostorIds = shuffledPlayerIds.slice(0, room.impostorCount);

    room.impostorNames = connectedPlayers
      .filter(p => impostorIds.includes(p.id))
      .map(p => p.name);

    const wordPair = getRandomWordPair();
    room.currentWordPair = wordPair;
    room.gameStarted = true;
    room.roundEnded = false;
    room.votes = {};
    room.votingLocked = true; // Always lock voting when starting a new game
    room.currentSpeaker = 1; // Reset speaker to 1 when game starts

    room.playerWords = {};
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      room.playerWords[player.name] = {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      };
    });

    // 3. Send to each player
    const playerList = getPlayerList(roomCode);
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      const roomPlayer = room.players.find(rp => rp.name === player.name);
      
      io.to(player.id).emit('gameStarted', {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor,
        turnOrder: roomPlayer ? roomPlayer.turnOrder : null,
        players: playerList
      });
    });

    io.to(roomCode).emit('playerListUpdate', { players: playerList });
    
    // Initial speaker update - delay slightly to ensure client sets myTurnOrder
    setTimeout(() => {
      if (rooms[roomCode]) {
        io.to(roomCode).emit('speakerUpdate', { 
          currentSpeaker: rooms[roomCode].currentSpeaker,
          speakerName: playerList.find(p => p.turnOrder === rooms[roomCode].currentSpeaker)?.name || 'Someone'
        });
      }
    }, 500);

    console.log(`Game started in room ${roomCode}. Turn orders:`, playerList.map(p => `${p.name}: ${p.turnOrder}`).join(', '));
  });

  // New round
  socket.on('newRound', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    const connectedPlayers = getConnectedPlayers(roomCode);
    if (connectedPlayers.length < 2) {
      socket.emit('gameError', { message: `Need at least 2 players. Currently ${connectedPlayers.length} player(s) connected.` });
      return;
    }

    if (room.impostorCount >= connectedPlayers.length) {
      socket.emit('gameError', { message: 'Too many impostors for this many players' });
      return;
    }

    // 1. Reassign unique random turn orders
    const numbers = Array.from({ length: connectedPlayers.length }, (_, i) => i + 1);
    const shuffledNumbers = shuffleArray(numbers);
    
    connectedPlayers.forEach((player, index) => {
      const roomPlayer = room.players.find(rp => rp.name === player.name);
      if (roomPlayer) {
        roomPlayer.turnOrder = shuffledNumbers[index];
        roomPlayer.id = player.id;
      }
    });

    // 2. Select random impostors using true shuffle
    const playerIds = connectedPlayers.map(p => p.id);
    const shuffledPlayerIds = shuffleArray(playerIds);
    const impostorIds = shuffledPlayerIds.slice(0, room.impostorCount);

    room.impostorNames = connectedPlayers
      .filter(p => impostorIds.includes(p.id))
      .map(p => p.name);

    const wordPair = getRandomWordPair();
    room.currentWordPair = wordPair;
    room.roundEnded = false;
    room.votes = {};
    room.votingLocked = true; // Always lock voting when starting a new round
    room.currentSpeaker = 1; // Reset speaker to 1 when new round starts

    room.playerWords = {};
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      room.playerWords[player.name] = {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor
      };
    });

    // 3. Send to each player
    const playerList = getPlayerList(roomCode);
    connectedPlayers.forEach(player => {
      const isImpostor = impostorIds.includes(player.id);
      const roomPlayer = room.players.find(rp => rp.name === player.name);
      
      io.to(player.id).emit('newRoundStarted', {
        word: isImpostor ? wordPair.impostorWord : wordPair.mainWord,
        isImpostor: isImpostor,
        turnOrder: roomPlayer ? roomPlayer.turnOrder : null,
        players: playerList
      });
    });

    io.to(roomCode).emit('playerListUpdate', { players: playerList });
    
    // Initial speaker update for new round - delay slightly
    setTimeout(() => {
      if (rooms[roomCode]) {
        io.to(roomCode).emit('speakerUpdate', { 
          currentSpeaker: rooms[roomCode].currentSpeaker,
          speakerName: playerList.find(p => p.turnOrder === rooms[roomCode].currentSpeaker)?.name || 'Someone'
        });
      }
    }, 500);

    console.log(`New round started in room ${roomCode}. Turn orders:`, playerList.map(p => `${p.name}: ${p.turnOrder}`).join(', '));
  });

  // Handle next speaker turn
  socket.on('nextSpeaker', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !room.gameStarted || room.roundEnded) {
      return;
    }

    const playerList = getPlayerList(roomCode);
    // Only cycle through players that actually have a turn order
    const speakers = playerList
      .filter(p => p.turnOrder !== null && p.turnOrder !== undefined)
      .sort((a, b) => a.turnOrder - b.turnOrder);
    
    if (speakers.length === 0) return;

    // Find index of current speaker in the sorted list
    const currentIndex = speakers.findIndex(p => p.turnOrder === room.currentSpeaker);
    const nextIndex = (currentIndex + 1) % speakers.length;
    
    room.currentSpeaker = speakers[nextIndex].turnOrder;
    const nextSpeaker = speakers[nextIndex];

    io.to(roomCode).emit('speakerUpdate', { 
      currentSpeaker: room.currentSpeaker,
      speakerName: nextSpeaker.name
    });
    
    console.log(`Turn moved to speaker ${room.currentSpeaker} (${nextSpeaker.name}) in room ${roomCode}`);
  });

  // Toggle voting locker (host only)
  socket.on('toggleVoting', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room) || !room.gameStarted || room.roundEnded) {
      return;
    }

    room.votingLocked = !room.votingLocked;
    io.to(roomCode).emit('votingStatusUpdate', { 
      locked: room.votingLocked,
      totalPlayers: getConnectedPlayers(roomCode).length,
      totalVotes: Object.keys(room.votes).length
    });
    console.log(`Voting ${room.votingLocked ? 'locked' : 'unlocked'} in room ${roomCode}`);
  });

  // Vote for impostor
  socket.on('voteImpostor', (data) => {
    const { roomCode, votedPlayerName } = data;
    const room = rooms[roomCode];

    if (!room || !room.gameStarted || room.roundEnded || room.votingLocked) {
      socket.emit('voteError', { message: 'Voting is currently locked' });
      return;
    }

    // Find the voting player
    const votingPlayer = room.players.find(p => p.id === socket.id);
    if (!votingPlayer) {
      return;
    }

    // Check if player already voted
    if (room.votes[votingPlayer.name]) {
      socket.emit('voteError', { message: 'You have already voted' });
      return;
    }

    // Record the vote
    room.votes[votingPlayer.name] = votedPlayerName;

    // Broadcast vote update
    io.to(roomCode).emit('voteUpdate', {
      votes: room.votes,
      totalVotes: Object.keys(room.votes).length,
      totalPlayers: getConnectedPlayers(roomCode).length
    });

    // Check if all players have voted
    const connectedPlayers = getConnectedPlayers(roomCode);
    if (Object.keys(room.votes).length >= connectedPlayers.length) {
      // All players voted, end the round
      endRound(roomCode);
    }
  });

  // End round (host can manually end round)
  socket.on('endRound', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room) || !room.gameStarted || room.roundEnded) {
      return;
    }

    endRound(roomCode);
  });

  socket.on('leaveRoom', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (player.isHost) {
      io.to(roomCode).emit('hostLeft');
      delete rooms[roomCode];
      return;
    }

    removePlayerFromRoom(roomCode, socket.id);
    socket.leave(roomCode);
  });

  // Function to end round and calculate scores
  function endRound(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.roundEnded) {
      return;
    }

    room.roundEnded = true;

    // Count votes for each player
    const voteCounts = {};
    Object.values(room.votes).forEach(votedName => {
      voteCounts[votedName] = (voteCounts[votedName] || 0) + 1;
    });

    // Find the player(s) with the most votes
    const maxVotes = Math.max(...Object.values(voteCounts), 0);
    const mostVotedPlayers = Object.keys(voteCounts).filter(name => voteCounts[name] === maxVotes);

    // Check if any impostor was found
    const impostorFound = mostVotedPlayers.some(name => room.impostorNames.includes(name));

    // Calculate scores
    const connectedPlayers = getConnectedPlayers(roomCode);
    connectedPlayers.forEach(player => {
      const roomPlayer = room.players.find(rp => rp.name === player.name);
      if (roomPlayer) {
        const isImpostor = room.impostorNames.includes(player.name);
        
        if (impostorFound) {
          // Impostor was found
          if (isImpostor) {
            // Impostor gets 0 points
            roomPlayer.score += 0;
          } else {
            // Non-impostors get 1 point
            roomPlayer.score += 1;
          }
        } else {
          // Impostor was not found
          if (isImpostor) {
            // Impostor gets 1 point
            roomPlayer.score += 1;
          } else {
            // Non-impostors get 0 points
            roomPlayer.score += 0;
          }
        }
      }
    });

    // Broadcast round results
    io.to(roomCode).emit('roundEnded', {
      votes: room.votes,
      voteCounts: voteCounts,
      mostVotedPlayers: mostVotedPlayers,
      impostorNames: room.impostorNames,
      impostorFound: impostorFound,
      players: getPlayerList(roomCode)
    });

    console.log(`Round ended in room ${roomCode}. Impostor found: ${impostorFound}`);
  }

  // End game
  socket.on('endGame', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || !isHost(socket, room)) {
      return;
    }

    // Notify all players with final scores
    io.to(roomCode).emit('gameEnded', {
      players: getPlayerList(roomCode)
    });
    
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
        if (rooms[roomCode]) {
          io.to(roomCode).emit('playerListUpdate', { players: getPlayerList(roomCode) });
        }
        } else {
          // Game hasn't started, remove player immediately
        removePlayerFromRoom(roomCode, socket.id);
          // Update player list for remaining players
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

