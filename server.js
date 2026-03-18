require('dotenv').config();

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const state = require('./game/state');
const { SCENES, ROOT_CAUSES, getSceneById, assignScenes } = require('./game/scenes');
const { AIManager } = require('./game/ai');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Validate API key exists at startup (never log it)
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Add it to .env or environment variables.');
  process.exit(1);
}

// Block any attempt to access server files, .env, game/, etc
app.use((req, res, next) => {
  const blocked = ['.env', '/game/', '/server', '/node_modules', '/.git'];
  if (blocked.some(b => req.path.toLowerCase().includes(b))) {
    return res.status(404).send('Not found');
  }
  next();
});

// Serve static frontend files (only /public)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Initialize AI manager
const ai = new AIManager(
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_MODEL
);

// ===== Socket.IO Event Handling =====

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ----- HOST EVENTS -----

  socket.on('host:create-room', (callback) => {
    const room = state.createRoom(socket.id);
    socket.join(`room:${room.code}`);
    console.log(`Room created: ${room.code}`);
    callback({ code: room.code });
  });

  socket.on('host:start', ({ code }) => {
    const room = state.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.phase !== 'lobby') return;

    const playerCount = room.players.size;
    if (playerCount === 0) return;

    // Assign scenes to players
    const scenes = assignScenes(playerCount);
    let i = 0;
    for (const player of room.players.values()) {
      player.sceneId = scenes[i].id;
      player.status = 'investigating';
      i++;
    }

    // Start timer
    room.phase = 'investigation';
    room.timerStartedAt = Date.now();

    // Send scene assignments to each player
    for (const player of room.players.values()) {
      const scene = getSceneById(player.sceneId);
      io.to(player.socketId).emit('game:start', {
        scene: {
          id: scene.id,
          title: scene.title,
          setup: scene.setup,
          characterName: scene.characterName,
        },
      });

      // Initialize AI chat session for this player
      (async () => {
        try {
          const result = await ai.createSession(player.id, scene);
          io.to(player.socketId).emit('chat:response', {
            messages: result.messages,
            chips: result.chips,
            showTips: result.showTips,
          });
        } catch (err) {
          console.error(`Failed to init AI for ${player.name}:`, err.message);
          const fallbackChips = ai.extractChips(scene.chips?.[0]?.questions);
          io.to(player.socketId).emit('chat:response', {
            messages: [{ text: scene.setup + ' Take a moment to look around and ask your first question.', type: 'dialogue' }],
            chips: fallbackChips,
            showTips: true,
          });
        }
      })();
    }

    // Send dashboard update
    const assignments = [];
    for (const player of room.players.values()) {
      const scene = getSceneById(player.sceneId);
      assignments.push({
        id: player.id,
        name: player.name,
        sceneId: scene.id,
        sceneTitle: scene.title,
        rootCause: scene.rootCause,
        status: player.status,
        messageCount: 0,
      });
    }

    io.to(`room:${room.code}`).emit('game:phase', { phase: 'investigation' });
    socket.emit('dashboard:assignments', { assignments, rootCauses: ROOT_CAUSES });

    // Start timer ticks
    room.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now(), room.timerStartedAt) / 1000);
      const remaining = Math.max(0, room.timerDuration, elapsed);
      io.to(`room:${room.code}`).emit('timer:tick', { remaining });

      if (remaining <= 0) {
        clearInterval(room.timerInterval);
        // Don't auto-end, let host decide
      }
    }, 1000);
  });

  socket.on('host:end', ({ code }) => {
    const room = state.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;

    endInvestigation(room);
  });

  socket.on('host:set-timer', ({ code, duration }) => {
    const room = state.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    room.timerDuration = duration;
  });

  // ----- PLAYER EVENTS -----

  socket.on('player:join', ({ code, name }, callback) => {
    const room = state.getRoom(code);
    if (!room) {
      return callback({ error: 'Room not found. Check the code and try again.' });
    }
    if (room.phase !== 'lobby') {
      return callback({ error: 'Game already in progress.' });
    }

    const player = state.addPlayer(room, name, socket.id);
    socket.join(`room:${room.code}`);

    callback({ playerId: player.id, roomCode: room.code });

    // Notify dashboard
    io.to(room.hostSocketId).emit('lobby:update', {
      players: state.getPlayersArray(room),
    });
  });

  socket.on('player:reconnect', ({ playerId, code }, callback) => {
    const room = state.getRoom(code);
    if (!room) return callback({ error: 'Room not found.' });

    const player = room.players.get(playerId);
    if (!player) return callback({ error: 'Player not found.' });

    // Update socket ID
    player.socketId = socket.id;
    socket.join(`room:${room.code}`);

    callback({
      playerId: player.id,
      roomCode: room.code,
      phase: room.phase,
      scene: player.sceneId ? {
        id: player.sceneId,
        title: getSceneById(player.sceneId).title,
        setup: getSceneById(player.sceneId).setup,
        characterName: getSceneById(player.sceneId).characterName,
      } : null,
      chatHistory: player.chatHistory,
      status: player.status,
    });
  });

  socket.on('chat:message', async ({ text, chipType }) => {
    const room = state.getRoomBySocketId(socket.id);
    if (!room || room.phase !== 'investigation') return;

    const player = state.getPlayerBySocketId(room, socket.id);
    if (!player || player.status === 'complete') return;

    // Rate limit: ignore if last message was < 1.5s ago
    const now = Date.now();
    if (now, player.lastActivity < 1500) return;
    player.lastActivity = now;

    // Store player message in history
    player.chatHistory.push({ role: 'user', text, timestamp: now });
    player.messageCount++;

    // Update dashboard
    io.to(room.hostSocketId).emit('player:status', {
      id: player.id,
      status: player.status,
      messageCount: player.messageCount,
      lastActivity: now,
    });

    // Send activity feed update
    io.to(room.hostSocketId).emit('activity:feed', {
      name: player.name,
      sceneTitle: getSceneById(player.sceneId).title,
      messageCount: player.messageCount,
    });

    // Handle examine chips, scripted response, no AI
    if (chipType === 'examine') {
      const examineResponse = ai.handleNarrationChip(player.id, text);
      if (examineResponse) {
        player.chatHistory.push({ role: 'evidence', text: examineResponse, timestamp: Date.now() });
        const { chips, narration } = ai.advanceMilestone(player.id, examineResponse);
        socket.emit('chat:response', {
          text: examineResponse,
          isEvidence: true,
          chips,
          narration,
        });
        return;
      }
    }

    // Send typing indicator for AI responses
    socket.emit('chat:typing', {});

    // Get AI response
    try {
      const result = await ai.sendMessage(player.id, text);
      player.chatHistory.push({ role: 'assistant', text: result.text, timestamp: Date.now() });
      socket.emit('chat:response', {
        text: result.text,
        chips: result.chips,
        narration: result.narration,
      });
    } catch (err) {
      console.error(`Chat error for ${player.name}:`, err.message);
      socket.emit('chat:response', {
        messages: [{ text: "Give me a moment... Could you try asking that again?", type: 'dialogue' }],
      });
    }
  });

  socket.on('finding:submit', async ({ whatWentWrong, proposedFix, usedExtraQuestion }) => {
    const room = state.getRoomBySocketId(socket.id);
    if (!room || room.phase !== 'investigation') return;

    const player = state.getPlayerBySocketId(room, socket.id);
    if (!player || player.status === 'complete') return;

    player.submission = { whatWentWrong, proposedFix };
    player.usedExtraQuestion = usedExtraQuestion || false;

    // Score with AI (1-3 scale, always accepts)
    try {
      const evaluation = await ai.evaluateSubmission(player.id, player.submission);
      player.evaluation = evaluation;
      player.score = evaluation.score || 1;
    } catch (err) {
      console.error(`Scoring error for ${player.name}:`, err.message);
      player.evaluation = { score: 1, leverage: 'low', feedback: '' };
      player.score = 1;
    }

    player.status = 'complete';
    socket.emit('finding:result', { complete: true });

    // Update dashboard
    io.to(room.hostSocketId).emit('player:status', {
      id: player.id,
      status: player.status,
      messageCount: player.messageCount,
      lastActivity: player.lastActivity,
      score: player.score,
    });

    // Check if all players are complete
    const allComplete = Array.from(room.players.values()).every(p => p.status === 'complete');
    if (allComplete) {
      endInvestigation(room);
    }
  });

  // ----- DISCONNECT -----

  socket.on('disconnect', () => {
    const room = state.getRoomBySocketId(socket.id);
    if (!room) return;

    if (room.hostSocketId === socket.id) {
      // Host disconnected, keep room alive, they might reconnect
      console.log(`Host disconnected from room ${room.code}`);
      return;
    }

    const player = state.getPlayerBySocketId(room, socket.id);
    if (!player) return;

    if (room.phase === 'lobby') {
      // In lobby, remove the player
      state.removePlayer(room, player.id);
      io.to(room.hostSocketId).emit('lobby:update', {
        players: state.getPlayersArray(room),
      });
    } else {
      // During game, mark as disconnected but keep their data
      player.status = player.status === 'complete' ? 'complete' : 'waiting';
      io.to(room.hostSocketId).emit('player:status', {
        id: player.id,
        status: player.status,
        messageCount: player.messageCount,
        lastActivity: player.lastActivity,
        disconnected: true,
      });
    }
  });
});

function endInvestigation(room) {
  if (room.phase === 'assembly') return;

  room.phase = 'assembly';
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }

  // Build assembly data
  const findings = [];
  for (const player of room.players.values()) {
    const scene = getSceneById(player.sceneId);
    findings.push({
      id: player.id,
      name: player.name,
      sceneId: scene.id,
      sceneTitle: scene.title,
      rootCause: scene.rootCause,
      rootCauseLabel: scene.rootCauseLabel,
      status: player.status,
      submission: player.submission,
      evaluation: player.evaluation,
      score: player.score || 0,
    });
  }

  io.to(`room:${room.code}`).emit('game:phase', { phase: 'assembly' });
  io.to(`room:${room.code}`).emit('assembly:data', {
    findings,
    rootCauses: ROOT_CAUSES,
  });

  // Clean up AI sessions
  for (const player of room.players.values()) {
    ai.destroySession(player.id);
  }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Incident Investigator running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
  console.log(`Open http://localhost:${PORT}/dashboard.html to host`);
});
