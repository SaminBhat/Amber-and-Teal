/* ============================================================
   AMBER & TEAL — THE ANCIENT DUEL
   script.js  |  Pure Vanilla JS — no frameworks, no build step.

   BOARD LAYOUT (node indices):
     0 — 1 — 2     (top row)
     |   |   |
     3 — 4 — 5     (middle row)
     |   |   |
     6 — 7 — 8     (bottom row)

   Adjacency: horizontal + vertical + diagonal-through-centre only.
   The centre node (4) connects to ALL 8 neighbours.
   Corner/edge nodes connect only to their orthogonal and
   diagonal-through-centre neighbours.
   ============================================================ */

'use strict';

/* ─────────────────────────────────────────────
   1. GRAPH DEFINITION
───────────────────────────────────────────── */

/** Adjacency list — every entry is bidirectional */
const ADJACENCY = {
  0: [1, 3, 4],
  1: [0, 2, 4],
  2: [1, 5, 4],
  3: [0, 4, 6],
  4: [0, 1, 2, 3, 5, 6, 7, 8], // centre — all 8
  5: [2, 4, 8],
  6: [3, 4, 7],
  7: [4, 6, 8],
  8: [4, 5, 7],
};

/** All possible winning lines (3-in-a-row) */
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],             // diagonals
];

/**
 * In "Frontline Standoff", a player's own physical home row must
 * NOT count as an instant win.  Keys are player numbers (1 or 2);
 * values are the three node indices of that player's home row.
 *
 * NOTE: these are determined dynamically at game-start based on
 * which colour occupies which row, so we store them in game state.
 */

/* ─────────────────────────────────────────────
   2. BOARD GEOMETRY  (420 × 420 SVG viewport)
───────────────────────────────────────────── */

const SVG_SIZE = 420;
const PAD      = 60;                          // padding from SVG edge
const STEP     = (SVG_SIZE - 2 * PAD) / 2;   // 150px between nodes

/** Return {x, y} for a node index in SVG coordinates */
function nodePos(idx) {
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  return { x: PAD + col * STEP, y: PAD + row * STEP };
}

/* ─────────────────────────────────────────────
   3. GAME STATE
───────────────────────────────────────────── */

/**
 * Single source of truth for all mutable game state.
 * Reset completely on each new game via initGameState().
 */
const state = {
  /* Config (set at game start) */
  mode:        'pvp',      // 'pvp' | 'pvc'
  variant:     'blank',    // 'blank' | 'standoff'
  humanPlayer: 1,          // 1 = human plays Amber; 2 = human plays Teal (PvC only)
  aiPlayer:    2,          // opposite of humanPlayer in PvC

  /**
   * homeRows[p] = Set of node indices that form player p's starting
   * home row in Standoff mode.  Used to block the trivial win.
   */
  homeRows: { 1: new Set(), 2: new Set() },

  /* Board — null | 1 | 2 for each of the 9 nodes */
  board: Array(9).fill(null),

  /* Phase: 'place' (Empty Grid only) | 'move' */
  phase: 'place',

  /* How many pieces each player has placed (place phase only) */
  placed: { 1: 0, 2: 0 },

  /* Whose turn it is — AMBER (player 1) always goes first */
  currentPlayer: 1,

  /* Movement phase: which node is currently selected */
  selectedNode: null,

  /* Movement phase: which empty nodes can the selected piece move to */
  validTargets: [],

  /* Result: null | { winner: 1|2, line: [a,b,c] } | 'draw' */
  result: null,

  /* Transient UI message (errors, hints) */
  message: '',

  /* Guard flag — prevents queuing multiple AI timeouts */
  aiPending: false,
};

/* ─────────────────────────────────────────────
   4. GAME LOGIC HELPERS
───────────────────────────────────────────── */

/**
 * Returns the valid (empty) neighbouring nodes a piece on `nodeIdx`
 * can move to.
 */
function getValidMoves(board, nodeIdx) {
  return ADJACENCY[nodeIdx].filter(n => board[n] === null);
}

/**
 * Returns all possible {from, to} moves for `player` on `board`.
 */
function getAllMoves(board, player) {
  const moves = [];
  board.forEach((val, i) => {
    if (val !== player) return;
    getValidMoves(board, i).forEach(to => moves.push({ from: i, to }));
  });
  return moves;
}

/**
 * Check for a winner on `board`.
 * `homeRows` — map of player → Set<nodeIdx> representing starting rows
 * that are forbidden from counting as wins in Standoff mode.
 * `variant`  — 'blank' | 'standoff'
 *
 * Returns { winner: 1|2, line: [a,b,c] } or null.
 */
function checkWinner(board, variant, homeRows) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const owner = board[a];
    if (!owner || owner !== board[b] || owner !== board[c]) continue;

    /* Standoff guard: skip if ALL three nodes are in this player's own home row */
    if (variant === 'standoff') {
      const home = homeRows[owner];
      if (home.has(a) && home.has(b) && home.has(c)) continue;
    }

    return { winner: owner, line };
  }
  return null;
}

/* ─────────────────────────────────────────────
   5. MINIMAX AI  (alpha-beta, depth 6)
───────────────────────────────────────────── */

/**
 * Recursive minimax with alpha-beta pruning.
 *
 * @param {Array}  board
 * @param {boolean} isMax   — true when it's the AI's (maximising) turn
 * @param {number}  aiP     — AI's player number (1 or 2)
 * @param {number}  humanP  — Human's player number
 * @param {number}  depth
 * @param {number}  alpha
 * @param {number}  beta
 * @param {string}  variant
 * @param {object}  homeRows
 */
function minimax(board, isMax, aiP, humanP, depth, alpha, beta, variant, homeRows) {
  const result = checkWinner(board, variant, homeRows);
  if (result) return result.winner === aiP ? 100 + depth : -(100 + depth);
  if (depth === 0) return 0;

  const curPlayer = isMax ? aiP : humanP;
  const moves = getAllMoves(board, curPlayer);
  if (!moves.length) return isMax ? -(50 + depth) : (50 + depth);

  let best = isMax ? -Infinity : Infinity;
  for (const { from, to } of moves) {
    const nb = [...board];
    nb[to] = curPlayer;
    nb[from] = null;
    const score = minimax(nb, !isMax, aiP, humanP, depth - 1, alpha, beta, variant, homeRows);
    if (isMax) { best = Math.max(best, score); alpha = Math.max(alpha, score); }
    else        { best = Math.min(best, score); beta  = Math.min(beta,  score); }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * Returns the best {from, to} move for the AI, or null if none.
 */
function getBestMove(board, aiP, humanP, variant, homeRows) {
  const moves = getAllMoves(board, aiP);
  if (!moves.length) return null;

  let bestScore = -Infinity;
  let bestMove  = moves[0];
  for (const m of moves) {
    const nb = [...board];
    nb[m.to] = aiP;
    nb[m.from] = null;
    const score = minimax(nb, false, aiP, humanP, 5, -Infinity, Infinity, variant, homeRows);
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

/**
 * AI placement heuristic: prefer centre → corners → edges.
 */
function getAIPlacementNode(board) {
  const empty = board.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
  return (
    empty.find(i => i === 4) ??               // centre
    empty.find(i => [0, 2, 6, 8].includes(i)) ?? // corners
    empty[0]
  );
}

/* ─────────────────────────────────────────────
   6. DOM REFERENCES
───────────────────────────────────────────── */

const $menuScreen  = document.getElementById('screen-menu');
const $gameScreen  = document.getElementById('screen-game');

/* Menu */
const $btnPvP      = document.getElementById('btn-pvp');
const $btnPvC      = document.getElementById('btn-pvc');
const $btnBlank    = document.getElementById('btn-blank');
const $btnStandoff = document.getElementById('btn-standoff');
const $btnStart    = document.getElementById('btn-start');

/* Game */
const $roleBadge   = document.getElementById('role-badge');
const $indP1       = document.getElementById('ind-p1');
const $indP2       = document.getElementById('ind-p2');
const $dotP1       = document.getElementById('dot-p1');
const $dotP2       = document.getElementById('dot-p2');
const $labelP1     = document.getElementById('label-p1');
const $labelP2     = document.getElementById('label-p2');
const $phasePill   = document.getElementById('phase-pill');
const $tray        = document.getElementById('tray');
const $trayP1      = document.getElementById('tray-p1');
const $trayP2      = document.getElementById('tray-p2');
const $boardSvg    = document.getElementById('board-svg');
const $svgLines    = document.getElementById('svg-lines');
const $boardNodes  = document.getElementById('board-nodes');
const $infoBar     = document.getElementById('info-bar');
const $btnRestart  = document.getElementById('btn-restart');
const $btnNewGame  = document.getElementById('btn-newgame');

/* ─────────────────────────────────────────────
   7. MENU STATE  (which buttons are selected)
───────────────────────────────────────────── */

let menuMode    = 'pvp';
let menuVariant = 'blank';

function setMenuMode(m) {
  menuMode = m;
  $btnPvP.classList.toggle('selected', m === 'pvp');
  $btnPvC.classList.toggle('selected', m === 'pvc');
}

function setMenuVariant(v) {
  menuVariant = v;
  $btnBlank.classList.toggle('selected',    v === 'blank');
  $btnStandoff.classList.toggle('selected', v === 'standoff');
}

$btnPvP.addEventListener('click',      () => setMenuMode('pvp'));
$btnPvC.addEventListener('click',      () => setMenuMode('pvc'));
$btnBlank.addEventListener('click',    () => setMenuVariant('blank'));
$btnStandoff.addEventListener('click', () => setMenuVariant('standoff'));
$btnStart.addEventListener('click',    () => startGame(menuMode, menuVariant));
$btnRestart.addEventListener('click',  () => startGame(state.mode, state.variant));
$btnNewGame.addEventListener('click',  showMenu);

/* ─────────────────────────────────────────────
   8. SCREEN TRANSITIONS
───────────────────────────────────────────── */

function showMenu() {
  $menuScreen.classList.remove('hidden');
  $gameScreen.classList.add('hidden');
}

function showGame() {
  $menuScreen.classList.add('hidden');
  $gameScreen.classList.remove('hidden');
}

/* ─────────────────────────────────────────────
   9. GAME INITIALISATION
───────────────────────────────────────────── */

function startGame(mode, variant) {
  /* ── Assign human/AI roles ──
     Rule: Amber (player 1) ALWAYS moves first.
     In PvC, randomly assign human to Amber or Teal. */
  const humanPlayer = (mode === 'pvc') ? (Math.random() < 0.5 ? 1 : 2) : 1;
  const aiPlayer    = (mode === 'pvc') ? (humanPlayer === 1 ? 2 : 1)    : null;

  /* ── Build initial board ── */
  let board = Array(9).fill(null);
  let phase = 'place';
  let placed = { 1: 0, 2: 0 };

  /* homeRows tracks which row is each player's starting row (Standoff only).
     Human is ALWAYS on the bottom; AI (or P2 in PvP) is ALWAYS on top. */
  const homeRows = { 1: new Set(), 2: new Set() };

  if (variant === 'standoff') {
    phase = 'move';
    placed = { 1: 3, 2: 3 };

    /* Determine which player occupies which physical row:
       - Bottom row (nodes 6,7,8) → HUMAN player's pieces
       - Top    row (nodes 0,1,2) → COMPUTER / P2's pieces      */
    const bottomPlayer = (mode === 'pvc') ? humanPlayer : 1; // P1 on bottom in PvP
    const topPlayer    = (mode === 'pvc') ? aiPlayer    : 2;

    board[6] = bottomPlayer; board[7] = bottomPlayer; board[8] = bottomPlayer;
    board[0] = topPlayer;    board[1] = topPlayer;    board[2] = topPlayer;

    /* Record home rows for win-guard */
    homeRows[bottomPlayer] = new Set([6, 7, 8]);
    homeRows[topPlayer]    = new Set([0, 1, 2]);
  }

  /* ── Populate state ── */
  state.mode          = mode;
  state.variant       = variant;
  state.humanPlayer   = humanPlayer;
  state.aiPlayer      = aiPlayer;
  state.homeRows      = homeRows;
  state.board         = board;
  state.phase         = phase;
  state.placed        = placed;
  state.currentPlayer = 1;      // Amber always goes first
  state.selectedNode  = null;
  state.validTargets  = [];
  state.result        = null;
  state.message       = '';
  state.aiPending     = false;

  showGame();
  buildBoard();
  renderAll();

  /* If AI is Amber (player 1), it moves first */
  if (mode === 'pvc' && aiPlayer === 1) {
    scheduleAIMove();
  }
}

/* ─────────────────────────────────────────────
   10. BOARD DOM CONSTRUCTION
   (called once per game — creates SVG lines
    and node buttons; pieces are rendered by
    renderAll() on every state change)
───────────────────────────────────────────── */

function buildBoard() {
  /* Clear previous DOM */
  $svgLines.innerHTML  = '';
  $boardNodes.innerHTML = '';

  /* ── Draw SVG connecting lines ── */
  const drawnEdges = new Set();
  for (const [aStr, neighbours] of Object.entries(ADJACENCY)) {
    const a = Number(aStr);
    for (const b of neighbours) {
      const edgeKey = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (drawnEdges.has(edgeKey)) continue;
      drawnEdges.add(edgeKey);

      const pa = nodePos(a);
      const pb = nodePos(b);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pa.x);
      line.setAttribute('y1', pa.y);
      line.setAttribute('x2', pb.x);
      line.setAttribute('y2', pb.y);
      line.classList.add('board-line');
      line.dataset.edge = edgeKey;
      $svgLines.appendChild(line);
    }
  }

  /* ── Create node buttons (9 total) ── */
  for (let i = 0; i < 9; i++) {
    const { x, y } = nodePos(i);
    const btn = document.createElement('button');
    btn.className     = 'node-btn';
    btn.dataset.node  = i;
    btn.style.left    = `${x}px`;
    btn.style.top     = `${y}px`;
    btn.setAttribute('aria-label', `Node ${i}`);
    btn.addEventListener('click', () => handleNodeClick(i));
    $boardNodes.appendChild(btn);
  }
}

/* ─────────────────────────────────────────────
   11. RENDER — update DOM to match state
───────────────────────────────────────────── */

/** Piece class name based on which player owns it */
function pieceClass(player) {
  return player === 1 ? 'piece-amber' : 'piece-teal';
}

/** Human-readable name for player number */
function playerName(player) {
  /* In PvC mode, we label by colour; in PvP we use Terra/Timber */
  if (state.mode === 'pvc') {
    return player === state.humanPlayer ? 'You' : 'Computer';
  }
  return player === 1 ? 'Terra' : 'Timber';
}

/** Colour label (Amber / Teal) for a player number */
function colourName(player) {
  return player === 1 ? 'Amber' : 'Teal';
}

function renderAll() {
  renderStatusBar();
  renderRoleBadge();
  renderTray();
  renderBoard();
  renderInfoBar();
  renderWinLines();
}

/* ── Status bar (player indicators + phase pill) ── */
function renderStatusBar() {
  const cur     = state.currentPlayer;
  const hasResult = !!state.result;

  /* Left indicator = player 1 (Amber) */
  $indP1.className = `flex items-center gap-2 text-[0.62rem] tracking-[0.16em] uppercase transition-all duration-300 ${(!hasResult && cur === 1) ? 'active' : 'inactive'}`;
  $dotP1.className = `player-dot dot-amber ${(!hasResult && cur === 1) ? '' : 'dot-off'}`;

  /* Right indicator = player 2 (Teal) */
  $indP2.className = `flex items-center gap-2 text-[0.62rem] tracking-[0.16em] uppercase transition-all duration-300 ${(!hasResult && cur === 2) ? 'active' : 'inactive'}`;
  $dotP2.className = `player-dot dot-teal ${(!hasResult && cur === 2) ? '' : 'dot-off'}`;

  /* Labels — show role names */
  const p1Label = (state.mode === 'pvc' && state.humanPlayer === 2) ? 'Computer' : 'Terra';
  const p2Label = (state.mode === 'pvc' && state.humanPlayer === 1) ? 'Computer' : 'Timber';
  $labelP1.textContent = p1Label;
  $labelP2.textContent = p2Label;

  /* Phase pill */
  $phasePill.textContent = state.phase === 'place' ? 'Placement' : 'Movement';
}

/* ── Role badge (PvC only) ── */
function renderRoleBadge() {
  if (state.mode !== 'pvc' || !!state.result) {
    $roleBadge.classList.add('hidden');
    return;
  }
  $roleBadge.classList.remove('hidden');
  const colour = colourName(state.humanPlayer);
  const order  = state.humanPlayer === 1 ? 'first' : 'second';
  $roleBadge.innerHTML =
    `You play <span style="color:${state.humanPlayer === 1 ? 'var(--amber-light)' : 'var(--teal-light)'}">${colour} (${order})</span>`;
}

/* ── Placement tray ── */
function renderTray() {
  if (state.phase !== 'place' || !!state.result) {
    $tray.classList.add('hidden');
    return;
  }
  $tray.classList.remove('hidden');

  /* Mark stones/tiles as placed */
  $trayP1.querySelectorAll('.tray-stone').forEach((el, i) => {
    el.classList.toggle('placed', i < state.placed[1]);
  });
  $trayP2.querySelectorAll('.tray-tile').forEach((el, i) => {
    el.classList.toggle('placed', i < state.placed[2]);
  });
}

/* ── Board nodes (pieces + empty dots + valid-target highlights) ── */
function renderBoard() {
  const winLine   = (state.result && state.result !== 'draw') ? state.result.line : null;

  document.querySelectorAll('.node-btn').forEach(btn => {
    const idx        = Number(btn.dataset.node);
    const owner      = state.board[idx];
    const isSelected = state.selectedNode === idx;
    const isTarget   = state.validTargets.includes(idx) && !owner;
    const isWinNode  = winLine && winLine.includes(idx);

    btn.className = `node-btn${isTarget ? ' valid-target' : ''}`;
    btn.innerHTML = '';

    if (owner) {
      const piece       = document.createElement('div');
      piece.className   = pieceClass(owner);
      if (isSelected)  piece.classList.add('selected');
      if (isWinNode)   piece.classList.add('win-piece');
      btn.appendChild(piece);
    } else {
      const dot       = document.createElement('div');
      dot.className   = 'empty-dot';
      btn.appendChild(dot);
    }
  });
}

/* ── Info / message bar ── */
function renderInfoBar() {
  $infoBar.className = 'info-bar w-full';
  let text = '';

  if (state.result === 'draw') {
    $infoBar.classList.add('draw-msg');
    text = 'Stalemate — the duel ends in a draw';
  } else if (state.result) {
    $infoBar.classList.add('win-msg');
    const winner  = state.result.winner;
    const who     = (state.mode === 'pvc')
      ? (winner === state.humanPlayer ? 'You claim' : 'Computer claims')
      : `${colourName(winner)} claims`;
    text = `${who} victory`;
  } else if (state.mode === 'pvc' && state.currentPlayer === state.aiPlayer) {
    text = 'The opponent deliberates…';
  } else if (state.message) {
    text = state.message;
  } else if (state.phase === 'place') {
    text = `Place stone ${state.placed[state.currentPlayer] + 1} of 3`;
  } else if (state.selectedNode !== null) {
    text = 'Choose a destination node';
  } else {
    text = 'Select a piece to move';
  }

  $infoBar.textContent = text;
}

/* ── Highlight winning SVG lines ── */
function renderWinLines() {
  const winLine = (state.result && state.result !== 'draw') ? state.result.line : null;

  document.querySelectorAll('.board-line').forEach(line => {
    if (!winLine) { line.classList.remove('win-line'); return; }

    const [ea, eb] = line.dataset.edge.split('-').map(Number);
    const isWin    = winLine.includes(ea) && winLine.includes(eb);
    line.classList.toggle('win-line', isWin);
  });
}

/* ─────────────────────────────────────────────
   12. PLAYER INPUT HANDLER
───────────────────────────────────────────── */

function handleNodeClick(idx) {
  /* Ignore clicks when game is over or it's the AI's turn */
  if (state.result) return;
  if (state.mode === 'pvc' && state.currentPlayer === state.aiPlayer) return;

  /* ── PLACEMENT PHASE ── */
  if (state.phase === 'place') {
    if (state.board[idx] !== null)              return; // occupied
    if (state.placed[state.currentPlayer] >= 3) return; // all placed

    applyPlacement(idx, state.currentPlayer);
    return;
  }

  /* ── MOVEMENT PHASE ── */
  if (state.selectedNode === null) {
    /* No piece selected yet — try to select one */
    if (state.board[idx] !== state.currentPlayer) {
      state.message = 'Select your own piece';
      renderAll();
      return;
    }
    const targets = getValidMoves(state.board, idx);
    if (!targets.length) {
      state.message = 'Piece is blocked — try another';
      renderAll();
      return;
    }
    state.selectedNode  = idx;
    state.validTargets  = targets;
    state.message       = '';
    renderAll();
    return;
  }

  /* A piece is already selected */
  if (idx === state.selectedNode) {
    /* Clicked same piece — deselect */
    state.selectedNode = null;
    state.validTargets = [];
    renderAll();
    return;
  }

  if (state.board[idx] === state.currentPlayer) {
    /* Clicked own different piece — switch selection */
    const targets = getValidMoves(state.board, idx);
    state.selectedNode = idx;
    state.validTargets = targets;
    state.message      = '';
    renderAll();
    return;
  }

  if (!state.validTargets.includes(idx)) {
    state.message = 'Not a valid move';
    renderAll();
    return;
  }

  /* ── Valid move — apply it ── */
  applyMove(state.selectedNode, idx, state.currentPlayer);
}

/* ─────────────────────────────────────────────
   13. STATE MUTATION HELPERS
───────────────────────────────────────────── */

/** Place a piece during the placement phase */
function applyPlacement(nodeIdx, player) {
  state.board[nodeIdx] = player;
  state.placed[player]++;
  state.selectedNode  = null;
  state.validTargets  = [];
  state.message       = '';

  /* Check for early win (unlikely in place phase but valid) */
  const win = checkWinner(state.board, state.variant, state.homeRows);
  if (win) {
    state.result = win;
    renderAll();
    return;
  }

  /* Transition to movement phase when all 6 pieces are placed */
  const allPlaced = state.placed[1] === 3 && state.placed[2] === 3;
  if (allPlaced) state.phase = 'move';

  /* Hand off to the other player */
  advanceTurn();
}

/** Move a piece during the movement phase */
function applyMove(from, to, player) {
  state.board[to]   = player;
  state.board[from] = null;
  state.selectedNode = null;
  state.validTargets = [];
  state.message      = '';

  /* Check for win */
  const win = checkWinner(state.board, state.variant, state.homeRows);
  if (win) {
    state.result = win;
    renderAll();
    return;
  }

  /* Check for stalemate (opponent has no moves) */
  const next = player === 1 ? 2 : 1;
  if (!getAllMoves(state.board, next).length) {
    state.result = 'draw';
    renderAll();
    return;
  }

  advanceTurn();
}

/** Switch currentPlayer and trigger AI if needed */
function advanceTurn() {
  state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
  renderAll();

  if (state.mode === 'pvc' && state.currentPlayer === state.aiPlayer) {
    scheduleAIMove();
  }
}

/* ─────────────────────────────────────────────
   14. AI MOVE SCHEDULING
───────────────────────────────────────────── */

/**
 * Schedule an AI move after a human-feeling delay (500–800 ms).
 * The guard flag prevents queuing multiple timeouts simultaneously.
 */
function scheduleAIMove() {
  if (state.aiPending) return;
  state.aiPending = true;

  const delay = 520 + Math.random() * 280;
  setTimeout(() => {
    state.aiPending = false;
    if (state.result) return;           // game ended while we were waiting
    if (state.currentPlayer !== state.aiPlayer) return; // turn changed

    if (state.phase === 'place') {
      executeAIPlacement();
    } else {
      executeAIMove();
    }
  }, delay);
}

function executeAIPlacement() {
  const chosen = getAIPlacementNode(state.board);
  if (chosen === undefined) return;
  applyPlacement(chosen, state.aiPlayer);
}

function executeAIMove() {
  const move = getBestMove(
    state.board,
    state.aiPlayer,
    state.humanPlayer,
    state.variant,
    state.homeRows,
  );
  if (!move) {
    state.result = 'draw';
    renderAll();
    return;
  }
  applyMove(move.from, move.to, state.aiPlayer);
}

/* ─────────────────────────────────────────────
   15. BOOT
───────────────────────────────────────────── */

/* Start on the menu screen */
showMenu();
