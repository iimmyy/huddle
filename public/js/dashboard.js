const socket = io({ transports: ['websocket'] });

// State
let roomCode = null;
let phase = 'lobby';
let assignments = [];
let rootCauses = {};
let timerMinutes = 8;

// DOM
const headerRoomCode = document.getElementById('header-room-code');
const lobbyCodeHuge = document.getElementById('lobby-code-huge');
const joinUrl = document.getElementById('join-url');
const playerCount = document.getElementById('player-count');
const playerRoster = document.getElementById('player-roster');
const startBtn = document.getElementById('start-btn');
const endBtn = document.getElementById('end-btn');
const timerDisplay = document.getElementById('timer-display');
const timerValue = document.getElementById('timer-value');
const timerMinus = document.getElementById('timer-minus');
const timerPlus = document.getElementById('timer-plus');

const dashLobby = document.getElementById('dash-lobby');
const dashInvestigation = document.getElementById('dash-investigation');
const dashAssembly = document.getElementById('dash-assembly');

// The old dashboard-header is removed; investigation phase has its own header now

const investigationTree = document.getElementById('investigation-tree');
const activityFeed = document.getElementById('activity-feed');
const progressLabel = document.getElementById('progress-label');
const progressFill = document.getElementById('progress-fill');
const assemblyTree = document.getElementById('assembly-tree');

// ===== INIT: Create Room =====

socket.emit('host:create-room', (response) => {
  roomCode = response.code;
  headerRoomCode.textContent = roomCode;
  lobbyCodeHuge.textContent = roomCode;
  joinUrl.textContent = window.location.origin;
  startBtn.style.display = 'inline-flex';
});

// ===== TIMER SETTINGS =====

timerMinus.addEventListener('click', () => {
  timerMinutes = Math.max(1, timerMinutes - 1);
  timerValue.textContent = timerMinutes;
  socket.emit('host:set-timer', { code: roomCode, duration: timerMinutes * 60 });
});

timerPlus.addEventListener('click', () => {
  timerMinutes = Math.min(20, timerMinutes + 1);
  timerValue.textContent = timerMinutes;
  socket.emit('host:set-timer', { code: roomCode, duration: timerMinutes * 60 });
});

// ===== LOBBY =====

socket.on('lobby:update', ({ players }) => {
  playerRoster.innerHTML = '';
  players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'roster-player';
    el.textContent = p.name;
    playerRoster.appendChild(el);
  });
  const count = players.length;
  playerCount.textContent = `${count} investigator${count !== 1 ? 's' : ''} connected`;
  startBtn.disabled = count === 0;
});

// ===== START GAME =====

startBtn.addEventListener('click', () => {
  socket.emit('host:start', { code: roomCode });
});

socket.on('game:phase', ({ phase: newPhase }) => {
  phase = newPhase;
  if (phase === 'investigation') {
    showInvestigation();
  } else if (phase === 'assembly') {
    showAssembly();
  }
});

socket.on('dashboard:assignments', (data) => {
  assignments = data.assignments;
  rootCauses = data.rootCauses;
  buildTree();
});

// ===== INVESTIGATION =====

function showInvestigation() {
  dashLobby.style.display = 'none';
  dashInvestigation.style.display = 'flex';
  dashAssembly.style.display = 'none';
}

function buildTree() {
  investigationTree.innerHTML = '';

  // Root node
  const root = document.createElement('div');
  root.className = 'tree-root';
  root.innerHTML = `
    <h3>Patient: Severe Hypoglycemia</h3>
    <p>BG 2.5 mmol/L, Insulin Dispensing Error</p>
  `;
  investigationTree.appendChild(root);

  // Connector
  const conn = document.createElement('div');
  conn.className = 'tree-connector';
  investigationTree.appendChild(conn);

  // Branches by root cause
  const branches = document.createElement('div');
  branches.className = 'tree-branches';

  const rcGroups = {};
  assignments.forEach(a => {
    if (!rcGroups[a.rootCause]) rcGroups[a.rootCause] = [];
    rcGroups[a.rootCause].push(a);
  });

  // Show all 5 root cause groups, even if no players assigned
  for (let rc = 1; rc <= 5; rc++) {
    const rcInfo = rootCauses[rc];
    if (!rcInfo) continue;

    const group = document.createElement('div');
    group.className = 'root-cause-group';

    const label = document.createElement('div');
    label.className = 'rc-label';
    label.textContent = rcInfo.label;
    group.appendChild(label);

    const nodes = document.createElement('div');
    nodes.className = 'player-nodes';

    const players = rcGroups[rc] || [];
    if (players.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'player-node';
      empty.dataset.status = 'waiting';
      empty.innerHTML = '<div class="node-name" style="color:var(--text-dim)">, </div>';
      nodes.appendChild(empty);
    } else {
      players.forEach(p => {
        const node = document.createElement('div');
        node.className = 'player-node';
        node.id = `node-${p.id}`;
        node.dataset.status = p.status;
        node.innerHTML = `
          <div class="node-name">${p.name}</div>
          <div class="node-scene">${p.sceneTitle}</div>
          <div class="node-msgs">0 messages</div>
        `;
        nodes.appendChild(node);
      });
    }

    group.appendChild(nodes);
    branches.appendChild(group);
  }

  investigationTree.appendChild(branches);
  updateProgress();
}

// ===== PLAYER STATUS UPDATES =====

socket.on('player:status', ({ id, status, messageCount, lastActivity, disconnected }) => {
  const node = document.getElementById(`node-${id}`);
  if (!node) return;

  node.dataset.status = disconnected ? 'waiting' : status;

  const msgsEl = node.querySelector('.node-msgs');
  if (msgsEl) {
    msgsEl.textContent = `${messageCount} message${messageCount !== 1 ? 's' : ''}`;
  }

  // Update assignment in memory
  const a = assignments.find(a => a.id === id);
  if (a) {
    a.status = status;
    a.messageCount = messageCount;
  }

  updateProgress();
});

function updateProgress() {
  const total = assignments.length;
  const complete = assignments.filter(a => a.status === 'complete').length;
  progressLabel.textContent = `${complete} / ${total} complete`;
  progressFill.style.width = total > 0 ? `${(complete / total) * 100}%` : '0%';
}

// ===== ACTIVITY FEED =====

socket.on('activity:feed', ({ name, sceneTitle, messageCount }) => {
  const verbs = [
    'is investigating',
    'asked a question about',
    'is looking into',
    'is examining',
    'is questioning',
  ];
  const verb = verbs[Math.floor(Math.random() * verbs.length)];

  addFeedItem(`<span class="feed-name">${name}</span> ${verb} ${sceneTitle}`, `Message #${messageCount}`);
});

function addFeedItem(html, detail) {
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `${html}<div class="feed-time">${detail}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
  activityFeed.prepend(item);

  // Keep max 30 items
  while (activityFeed.children.length > 30) {
    activityFeed.lastChild.remove();
  }
}

// ===== TIMER =====

socket.on('timer:tick', ({ remaining }) => {
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  timerDisplay.textContent = `${min}:${sec.toString().padStart(2, '0')}`;

  timerDisplay.classList.remove('warning', 'critical');
  if (remaining <= 60) {
    timerDisplay.classList.add('critical');
  } else if (remaining <= 120) {
    timerDisplay.classList.add('warning');
  }
});

// ===== END INVESTIGATION =====

endBtn.addEventListener('click', () => {
  if (confirm('End the investigation and reveal the full incident tree?')) {
    socket.emit('host:end', { code: roomCode });
  }
});

// ===== ASSEMBLY =====

socket.on('assembly:data', ({ findings, rootCauses: rc }) => {
  rootCauses = rc;
  showAssembly();
  buildAssemblyTree(findings);
});

function showAssembly() {
  dashLobby.style.display = 'none';
  dashInvestigation.style.display = 'none';
  dashAssembly.style.display = 'flex';
}

function buildAssemblyTree(findings) {
  assemblyTree.innerHTML = '';

  // Patient incident card
  const patient = document.createElement('div');
  patient.className = 'assembly-patient';
  patient.innerHTML = `
    <div class="assembly-patient-icon">&#9888;&#65039;</div>
    <div class="assembly-patient-info">
      <h3>Patient: Severe Hypoglycemia</h3>
      <p>BG 2.5 mmol/L &mdash; Insulin Dispensing Error</p>
      <p class="assembly-patient-detail">Novolin GE 30/70 / Novo-Rapid Mix-Up</p>
    </div>
  `;
  assemblyTree.appendChild(patient);

  // Vertical connector line
  const conn = document.createElement('div');
  conn.className = 'assembly-connector';
  assemblyTree.appendChild(conn);

  // "Contributing Factors" label
  const factorsLabel = document.createElement('div');
  factorsLabel.className = 'assembly-factors-label';
  factorsLabel.textContent = 'Contributing Factors';
  assemblyTree.appendChild(factorsLabel);

  // Root cause cards grid
  const grid = document.createElement('div');
  grid.className = 'assembly-grid';

  const rcGroups = {};
  findings.forEach(f => {
    if (!rcGroups[f.rootCause]) rcGroups[f.rootCause] = [];
    rcGroups[f.rootCause].push(f);
  });

  // Stats
  const totalPlayers = findings.length;
  const completedPlayers = findings.filter(f => f.status === 'complete').length;
  const avgScore = completedPlayers > 0
    ? (findings.reduce((sum, f) => sum + (f.score || 0), 0) / completedPlayers).toFixed(1)
    : '—';

  let delay = 0;
  for (let rc = 1; rc <= 5; rc++) {
    const rcInfo = rootCauses[rc];
    if (!rcInfo) continue;

    delay += 150;
    const card = document.createElement('div');
    card.className = 'assembly-rc-card';
    card.style.animationDelay = `${delay}ms`;

    const players = rcGroups[rc] || [];
    const investigated = players.length > 0 && players.some(p => p.status === 'complete');

    // Card header
    const header = document.createElement('div');
    header.className = 'assembly-rc-header';
    header.innerHTML = `
      <div class="assembly-rc-status ${investigated ? 'investigated' : 'gap'}">
        ${investigated ? '&#10003;' : '?'}
      </div>
      <div class="assembly-rc-title">${rcInfo.label}</div>
    `;
    card.appendChild(header);

    // Player findings
    const body = document.createElement('div');
    body.className = 'assembly-rc-body';

    if (players.length === 0) {
      body.innerHTML = `<div class="assembly-empty">No one assigned</div>`;
    } else {
      players.forEach(f => {
        delay += 80;
        const finding = document.createElement('div');
        finding.className = `assembly-finding ${f.status === 'complete' ? 'complete' : 'incomplete'}`;
        finding.style.animationDelay = `${delay}ms`;

        let starsHtml = '';
        if (f.score > 0) {
          const filled = '★'.repeat(f.score);
          const empty = '☆'.repeat(3 - f.score);
          const cls = f.score === 3 ? 'score-high' : f.score === 2 ? 'score-mid' : 'score-low';
          starsHtml = `<span class="assembly-stars ${cls}">${filled}${empty}</span>`;
        }

        let quoteHtml = '';
        if (f.submission && f.submission.whatWentWrong) {
          quoteHtml = `<div class="assembly-quote">"${truncate(f.submission.whatWentWrong, 80)}"</div>`;
        }

        let fixHtml = '';
        if (f.submission && f.submission.proposedFix) {
          fixHtml = `<div class="assembly-fix"><strong>Fix:</strong> ${truncate(f.submission.proposedFix, 60)}</div>`;
        }

        finding.innerHTML = `
          <div class="assembly-finding-top">
            <div class="assembly-finding-name">${f.name}</div>
            ${starsHtml}
          </div>
          <div class="assembly-finding-scene">${f.sceneTitle}</div>
          ${quoteHtml}
          ${fixHtml}
        `;
        body.appendChild(finding);
      });
    }

    card.appendChild(body);
    grid.appendChild(card);
  }

  assemblyTree.appendChild(grid);

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'assembly-summary';
  summary.innerHTML = `
    <div class="assembly-stat">
      <div class="assembly-stat-value">${completedPlayers}/${totalPlayers}</div>
      <div class="assembly-stat-label">Investigated</div>
    </div>
    <div class="assembly-stat">
      <div class="assembly-stat-value">${avgScore}</div>
      <div class="assembly-stat-label">Avg Score</div>
    </div>
    <div class="assembly-stat">
      <div class="assembly-stat-value">${Object.keys(rcGroups).length}/5</div>
      <div class="assembly-stat-label">Factors Covered</div>
    </div>
  `;
  assemblyTree.appendChild(summary);
}

// ===== RESTART =====

document.getElementById('restart-btn').addEventListener('click', () => {
  if (confirm('Start a new game? All current data will be lost.')) {
    socket.emit('host:restart', { code: roomCode });
  }
});

socket.on('host:new-room', ({ code }) => {
  roomCode = code;
  headerRoomCode.textContent = roomCode;
  lobbyCodeHuge.textContent = roomCode;
  assignments = [];
  assemblyTree.innerHTML = '';
  investigationTree.innerHTML = '';
  activityFeed.innerHTML = '';
  timerMinutes = 8;
  timerValue.textContent = '8';
  timerDisplay.textContent = '--:--';
  progressLabel.textContent = '0 / 0 complete';
  progressFill.style.width = '0%';
  startBtn.style.display = 'inline-flex';
  startBtn.disabled = false;

  dashLobby.style.display = 'flex';
  dashInvestigation.style.display = 'none';
  dashAssembly.style.display = 'none';
  phase = 'lobby';
});

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}
