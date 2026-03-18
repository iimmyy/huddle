const socket = io({ transports: ['websocket'] });

// State
let playerId = sessionStorage.getItem('playerId');
let roomCode = sessionStorage.getItem('roomCode');
let characterName = null;
let usedExtraQuestion = false;
let inExtraQuestionMode = false;

// DOM elements
const screens = document.querySelectorAll('.screen');
const joinScreen = document.getElementById('join-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const investigationScreen = document.getElementById('investigation-screen');
const completeScreen = document.getElementById('complete-screen');
const assemblyScreen = document.getElementById('assembly-screen');

const codeBoxes = document.querySelectorAll('.code-box');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const lobbyRoomCode = document.getElementById('lobby-room-code');

const sceneTitle = document.getElementById('scene-title');
const sceneSetup = document.getElementById('scene-setup');
const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');

const submitFindingsBtn = document.getElementById('submit-findings-btn');
const submissionOverlay = document.getElementById('submission-overlay');
const cancelSubmit = document.getElementById('cancel-submit');
const confirmSubmit = document.getElementById('confirm-submit');
const findingWhat = document.getElementById('finding-what');
const findingFix = document.getElementById('finding-fix');

const confirmOverlay = document.getElementById('confirm-overlay');
const gambleBtn = document.getElementById('gamble-btn');
const finalSubmitBtn = document.getElementById('final-submit-btn');

const tipsModal = document.getElementById('tips-modal');
const tipsDismiss = document.getElementById('tips-dismiss');

function showScreen(screen) {
  screens.forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ===== JOIN FLOW =====

function getCode() {
  return Array.from(codeBoxes).map(b => b.value).join('').toUpperCase();
}

function updateJoinButton() {
  const code = getCode();
  const name = nameInput.value.trim();
  joinBtn.disabled = code.length < 4 || name.length < 1;
}

// Code box behavior: auto-advance, backspace, paste
codeBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (box.value && i < 3) codeBoxes[i + 1].focus();
    box.classList.toggle('filled', box.value.length > 0);
    updateJoinButton();
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) {
      codeBoxes[i - 1].focus();
      codeBoxes[i - 1].value = '';
      codeBoxes[i - 1].classList.remove('filled');
      updateJoinButton();
    }
    if (e.key === 'Enter') {
      if (i < 3) { codeBoxes[i + 1].focus(); }
      else { nameInput.focus(); }
    }
  });

  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z]/g, '');
    for (let j = 0; j < 4; j++) {
      codeBoxes[j].value = text[j] || '';
      codeBoxes[j].classList.toggle('filled', codeBoxes[j].value.length > 0);
    }
    if (text.length >= 4) nameInput.focus();
    else if (text.length > 0) codeBoxes[Math.min(text.length, 3)].focus();
    updateJoinButton();
  });
});

nameInput.addEventListener('input', updateJoinButton);

joinBtn.addEventListener('click', joinRoom);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !joinBtn.disabled) joinRoom();
});

function joinRoom() {
  const code = getCode();
  const name = nameInput.value.trim();
  joinError.textContent = '';
  joinBtn.disabled = true;

  socket.emit('player:join', { code, name }, (response) => {
    if (response.error) {
      joinError.textContent = response.error;
      joinBtn.disabled = false;
      return;
    }
    playerId = response.playerId;
    roomCode = response.roomCode;
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('roomCode', roomCode);

    lobbyRoomCode.textContent = roomCode;
    showScreen(lobbyScreen);
  });
}

// ===== RECONNECTION =====

if (playerId && roomCode) {
  socket.emit('player:reconnect', { playerId, code: roomCode }, (response) => {
    if (response.error) {
      sessionStorage.removeItem('playerId');
      sessionStorage.removeItem('roomCode');
      return;
    }

    playerId = response.playerId;
    roomCode = response.roomCode;

    if (response.phase === 'lobby') {
      lobbyRoomCode.textContent = roomCode;
      showScreen(lobbyScreen);
    } else if (response.phase === 'investigation') {
      if (response.scene) {
        sceneTitle.textContent = response.scene.title;
        sceneSetup.textContent = response.scene.setup;
        characterName = response.scene.characterName || response.scene.title;
      }
      if (response.chatHistory) {
        response.chatHistory.forEach(msg => {
          addChatMessage(msg.text, msg.role);
        });
      }
      if (response.status === 'complete') {
        showScreen(completeScreen);
      } else {
        showScreen(investigationScreen);
      }
    } else if (response.phase === 'assembly') {
      showScreen(assemblyScreen);
    }
  });
}

// ===== GAME EVENTS =====

socket.on('game:start', (data) => {
  sceneTitle.textContent = data.scene.title;
  sceneSetup.textContent = data.scene.setup;
  characterName = data.scene.characterName || data.scene.title;
  showScreen(investigationScreen);
  chatInput.focus();
});

socket.on('game:phase', ({ phase }) => {
  if (phase === 'assembly') {
    showScreen(assemblyScreen);
  }
});

socket.on('assembly:data', ({ findings, rootCauses }) => {
  // Show this player's own finding
  const myFinding = findings.find(f => f.id === playerId);
  if (myFinding && myFinding.submission) {
    const findingCard = document.getElementById('assembly-your-finding');
    document.getElementById('assembly-your-scene').textContent = myFinding.sceneTitle;
    document.getElementById('assembly-your-text').textContent = myFinding.submission.whatWentWrong;
    findingCard.style.display = 'block';
  }

  showScreen(assemblyScreen);
});

// ===== RESTART =====

socket.on('game:restart', () => {
  sessionStorage.removeItem('playerId');
  sessionStorage.removeItem('roomCode');
  playerId = null;
  roomCode = null;
  characterName = null;
  usedExtraQuestion = false;
  inExtraQuestionMode = false;

  // Clear chat
  const msgs = chatContainer.querySelectorAll('.chat-message');
  msgs.forEach(m => m.remove());

  // Clear inputs
  chatInput.value = '';
  chatInput.disabled = false;
  chatInput.placeholder = 'Type something...';
  sendBtn.disabled = false;
  findingWhat.value = '';
  findingFix.value = '';

  // Clear code boxes
  codeBoxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
  nameInput.value = '';
  joinBtn.disabled = true;
  joinError.textContent = '';

  // Close any open overlays
  submissionOverlay.classList.remove('active');
  confirmOverlay.classList.remove('active');
  document.getElementById('scoring-overlay').classList.remove('active');
  tipsModal.classList.remove('active');

  showScreen(joinScreen);
});

// ===== CHAT =====

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showTyping() {
  typingIndicator.classList.add('active');
  scrollChat();
}

function hideTyping() {
  typingIndicator.classList.remove('active');
}

// Show messages one by one with typing dots between them
async function showMessagesSequentially(messages, chips, data) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type === 'narration') {
      // Split narration into paragraphs and reveal one by one
      const paragraphs = msg.text.split('\n\n').filter(p => p.trim());
      for (let j = 0; j < paragraphs.length; j++) {
        if (i > 0 || j > 0) {
          showTyping();
          await sleep(600 + Math.random() * 300);
          hideTyping();
        }
        addNarrationMessage(paragraphs[j]);
      }
    } else {
      // Dialogue, show typing dots first
      if (i > 0) {
        showTyping();
        await sleep(800 + Math.random() * 400);
        hideTyping();
      }
      addChatMessage(msg.text, 'assistant');
    }
  }

  // Show chips after all messages
  if (chips && chips.length > 0) {
    await sleep(300);
    renderChips(chips);
  }

  // Show tips modal after opening sequence finishes
  if (data.showTips) {
    await sleep(400);
    tipsModal.classList.add('active');
  }

  chatInput.disabled = false;
  sendBtn.disabled = false;

  if (inExtraQuestionMode) {
    inExtraQuestionMode = false;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    chatInput.placeholder = 'Resubmit your findings...';
    clearChips();
    setTimeout(() => { submissionOverlay.classList.add('active'); }, 1500);
    return;
  }
}

socket.on('chat:response', (data) => {
  hideTyping();

  // Milestone narration
  if (data.narration) {
    addMilestoneNarration(data.narration);
  }

  // Sequential message rendering
  if (data.messages) {
    showMessagesSequentially(data.messages, data.chips, data);
    return;
  }

  // Single message (AI response or evidence)
  if (data.text) {
    if (data.isEvidence) {
      addEvidenceMessage(data.text);
    } else {
      addChatMessage(data.text, 'assistant');
    }
  }

  if (data.chips && data.chips.length > 0) {
    renderChips(data.chips);
  }

  chatInput.disabled = false;
  sendBtn.disabled = false;

  if (inExtraQuestionMode) {
    inExtraQuestionMode = false;
    chatInput.disabled = true;
    sendBtn.disabled = true;
    chatInput.placeholder = 'Resubmit your findings...';
    clearChips();
    setTimeout(() => { submissionOverlay.classList.add('active'); }, 1500);
    return;
  }
});

socket.on('chat:typing', () => {
  typingIndicator.classList.add('active');
  scrollChat();
});

function formatMessage(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function addChatMessage(text, role) {
  const msg = document.createElement('div');
  msg.className = `chat-message ${role}`;
  if (role === 'assistant') {
    if (characterName) msg.innerHTML = `<div class="msg-sender">${characterName}</div>`;
    msg.innerHTML += formatMessage(text);
  } else {
    msg.textContent = text;
  }
  chatContainer.insertBefore(msg, typingIndicator);
  scrollChat();
}

function addNarrationMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-message narration';
  msg.innerHTML = formatMessage(text);
  chatContainer.insertBefore(msg, typingIndicator);
  scrollChat();
}

function addActionMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-message action';
  msg.innerHTML = `🔍 <em>${formatMessage(text)}</em>`;
  chatContainer.insertBefore(msg, typingIndicator);
  scrollChat();
}

function addEvidenceMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-message evidence';
  msg.innerHTML = formatMessage(text);
  chatContainer.insertBefore(msg, typingIndicator);
  scrollChat();
}

function addMilestoneNarration(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-message milestone';
  msg.innerHTML = formatMessage(text);
  chatContainer.insertBefore(msg, typingIndicator);
  scrollChat();
}

function scrollChat() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ===== SUGGESTION CHIPS =====

function renderChips(chips) {
  const container = document.getElementById('suggestion-chips');
  container.innerHTML = '';
  chips.forEach(chip => {
    const text = typeof chip === 'string' ? chip : chip.text;
    const type = typeof chip === 'string' ? 'talk' : (chip.type || 'talk');
    const icon = type === 'examine' ? '🔍' : '💬';

    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.innerHTML = `<span class="choice-icon">${icon}</span><span class="choice-text">${text}</span>`;
    btn.addEventListener('click', () => {
      pendingChipType = type;
      chatInput.value = text;
      sendMessage();
    });
    container.appendChild(btn);
  });
}

let pendingChipType = null;

function clearChips() {
  document.getElementById('suggestion-chips').innerHTML = '';
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  // Show user's action as an "action" bubble if it's an examine chip
  if (pendingChipType === 'examine') {
    addActionMessage(text);
  } else {
    addChatMessage(text, 'user');
  }

  const chipType = pendingChipType;
  pendingChipType = null;
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  clearChips();

  socket.emit('chat:message', { text, chipType });

  // Show typing dots while waiting for response
  showTyping();

  // If this was the extra question, lock the input permanently
  if (inExtraQuestionMode) {
    chatInput.placeholder = 'Waiting for response...';
  }
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !chatInput.disabled) sendMessage();
});

// ===== TIPS MODAL =====

tipsDismiss.addEventListener('click', () => {
  tipsModal.classList.remove('active');
  chatInput.focus();
});

// ===== SUBMISSION FLOW =====

function updateConfirmButton() {
  const hasWhat = findingWhat.value.trim().length > 0;
  const hasFix = findingFix.value.trim().length > 0;
  confirmSubmit.disabled = !(hasWhat && hasFix);
}

findingWhat.addEventListener('input', updateConfirmButton);
findingFix.addEventListener('input', updateConfirmButton);

// Step 1: Open submission form
submitFindingsBtn.addEventListener('click', () => {
  submissionOverlay.classList.add('active');
});

// Step 1b: Go back to chat
cancelSubmit.addEventListener('click', () => {
  submissionOverlay.classList.remove('active');
});

// Step 2: Click "Submit" in form → show "Are You Sure?" (or go straight to final if extra Q used)
confirmSubmit.addEventListener('click', () => {
  submissionOverlay.classList.remove('active');

  if (usedExtraQuestion) {
    // Already used gamble, go straight to final submit
    doFinalSubmit();
  } else {
    // Show "Are You Sure?" confirmation
    confirmOverlay.classList.add('active');
  }
});

// Step 3a: "I'm Sure" → final submit
finalSubmitBtn.addEventListener('click', () => {
  confirmOverlay.classList.remove('active');
  doFinalSubmit();
});

// Step 3b: "One More Question" → gamble
gambleBtn.addEventListener('click', () => {
  confirmOverlay.classList.remove('active');
  usedExtraQuestion = true;
  inExtraQuestionMode = true;

  // Return to chat with input unlocked for exactly 1 message
  chatInput.disabled = false;
  chatInput.placeholder = 'Ask your final question, make it count...';
  chatInput.focus();
});

function doFinalSubmit() {
  // Show scoring overlay
  document.getElementById('scoring-overlay').classList.add('active');

  socket.emit('finding:submit', {
    whatWentWrong: findingWhat.value.trim(),
    proposedFix: findingFix.value.trim(),
    usedExtraQuestion,
  });
}

socket.on('finding:result', () => {
  document.getElementById('scoring-overlay').classList.remove('active');
  showScreen(completeScreen);
});

// ===== TIMER =====

let totalTime = 480; // default 8 min, will be overridden by first tick

socket.on('timer:tick', ({ remaining }) => {
  if (remaining > totalTime) totalTime = remaining;

  const timerEl = document.getElementById('player-timer');
  const fillEl = document.getElementById('timer-fill');
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;

  // Progress bar
  const pct = (remaining / totalTime) * 100;
  fillEl.style.width = pct + '%';

  fillEl.classList.remove('warning', 'critical');
  if (remaining <= 60) {
    fillEl.classList.add('critical');
  } else if (remaining <= 120) {
    fillEl.classList.add('warning');
  }
});
