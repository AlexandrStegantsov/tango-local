// Tango (LinkedIn-style) — Seeded Generator + Validator + Bootstrap UI

/*
Rules we implement (Takuzu/Binairo-like with extra constraints):
1) No more than two identical symbols adjacent horizontally or vertically
2) Each row and column must contain an equal number of suns and moons
3) Constraint edges: '=' means the two adjacent cells must match, 'x' (×) means they must differ

Grid sizes supported: even sizes 4,6,8
*/

(function () {
const SUN = 1;
const MOON = 0;
const EMPTY = -1;


// Переменные для эмодзи (теперь их можно менять через UI)
let sunChar = '☀️';
let moonChar = '🌙';


// DOM elements
const gridEl = document.getElementById('grid');
const timerEl = document.getElementById('timer');
const statusTextEl = document.getElementById('statusText');
const sizeSelectEl = document.getElementById('sizeSelect');
const seedInputEl = document.getElementById('seedInput');
const randomSeedBtn = document.getElementById('randomSeedBtn');
const newGameBtn = document.getElementById('newGameBtn');
const restartBtn = document.getElementById('restartBtn');
const checkBtn = document.getElementById('checkBtn');
const shareBtn = document.getElementById('shareBtn');
const captchaModalEl = document.getElementById('captchaModal');
const holdBtn = document.getElementById('holdBtn');
const captchaHintEl = document.getElementById('captchaHint');


// === Новые элементы для выбора эмодзи ===
const sunEmojiInput = document.getElementById('sunEmoji');
const moonEmojiInput = document.getElementById('moonEmoji');
const applyEmojisBtn = document.getElementById('applyEmojis');


if (applyEmojisBtn) {
applyEmojisBtn.addEventListener('click', () => {
sunChar = sunEmojiInput.value || '☀️';
moonChar = moonEmojiInput.value || '🌙';
updateCells();
});
}


  // Timer state
  let timerInterval = null;
  let startTimestampMs = 0;
  let elapsedMsBeforePause = 0;

  // Game state
  let gridSize = 6;
  let prng = mulberry32(hashStringToSeed('default'));
  let puzzle = null; // { size, givens: number[][], constraintsH: int[][], constraintsV: int[][] }
  let playerGrid = null; // number[][]
  let errorSince = null; // number | null timestamps per cell
  let clicks = []; // recent click telemetry
  let gridLocked = false; // locked during captcha
  let captcha = null; // { requiredHoldMs, startTs, timer, bsModal }
  let lastHumanClickMs = 0;
  let pointerState = { isDown: false, downTs: 0, moves: 0, lastEventTrusted: false };

  // Constraints encoding: 0 = none, 1 = equals, 2 = differ
  const CONSTRAINT_NONE = 0;
  const CONSTRAINT_EQUAL = 1;
  const CONSTRAINT_DIFF = 2;

  // ---------- Utility: PRNG ----------
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStringToSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function choose(arr) {
    return arr[Math.floor(prng() * arr.length)];
  }

  // ---------- Grid helpers ----------
  function createMatrix(n, fill = EMPTY) {
    const m = new Array(n);
    for (let i = 0; i < n; i++) {
      m[i] = new Array(n).fill(fill);
    }
    return m;
  }

  function cloneMatrix(m) {
    return m.map((row) => row.slice());
  }

  // ---------- Rule checks ----------
  function violatesNoThreeRule(board, r, c) {
    const n = board.length;
    const v = board[r][c];
    if (v === EMPTY) return false;
    // Horizontal
    let run = 1;
    for (let cc = c - 1; cc >= 0 && board[r][cc] === v; cc--) run++;
    for (let cc = c + 1; cc < n && board[r][cc] === v; cc++) run++;
    if (run >= 3) return true;
    // Vertical
    run = 1;
    for (let rr = r - 1; rr >= 0 && board[rr][c] === v; rr--) run++;
    for (let rr = r + 1; rr < n && board[rr][c] === v; rr++) run++;
    return run >= 3;
  }

  function violatesBalanceRule(board, r, c) {
    const n = board.length;
    const half = n / 2;
    // Check row counts
    const row = board[r];
    let suns = 0,
      moons = 0;
    for (let i = 0; i < n; i++) {
      if (row[i] === SUN) suns++;
      if (row[i] === MOON) moons++;
    }
    if (suns > half || moons > half) return true;
    // Check column counts
    suns = 0;
    moons = 0;
    for (let i = 0; i < n; i++) {
      if (board[i][c] === SUN) suns++;
      if (board[i][c] === MOON) moons++;
    }
    return suns > half || moons > half;
  }

  function violatesConstraint(board, r, c, constraintsH, constraintsV) {
    const n = board.length;
    const v = board[r][c];
    if (v === EMPTY) return false;
    // Right neighbor constraint
    if (c < n - 1) {
      const cons = constraintsH[r][c];
      if (cons !== CONSTRAINT_NONE) {
        const neighbor = board[r][c + 1];
        if (neighbor !== EMPTY) {
          if (cons === CONSTRAINT_EQUAL && neighbor !== v) return true;
          if (cons === CONSTRAINT_DIFF && neighbor === v) return true;
        }
      }
    }
    // Left neighbor (mirror of right)
    if (c > 0) {
      const cons = constraintsH[r][c - 1];
      if (cons !== CONSTRAINT_NONE) {
        const neighbor = board[r][c - 1];
        if (neighbor !== EMPTY) {
          if (cons === CONSTRAINT_EQUAL && neighbor !== v) return true;
          if (cons === CONSTRAINT_DIFF && neighbor === v) return true;
        }
      }
    }
    // Down neighbor
    if (r < n - 1) {
      const cons = constraintsV[r][c];
      if (cons !== CONSTRAINT_NONE) {
        const neighbor = board[r + 1][c];
        if (neighbor !== EMPTY) {
          if (cons === CONSTRAINT_EQUAL && neighbor !== v) return true;
          if (cons === CONSTRAINT_DIFF && neighbor === v) return true;
        }
      }
    }
    // Up neighbor
    if (r > 0) {
      const cons = constraintsV[r - 1][c];
      if (cons !== CONSTRAINT_NONE) {
        const neighbor = board[r - 1][c];
        if (neighbor !== EMPTY) {
          if (cons === CONSTRAINT_EQUAL && neighbor !== v) return true;
          if (cons === CONSTRAINT_DIFF && neighbor === v) return true;
        }
      }
    }
    return false;
  }

  function isRowCompleteAndValid(board, r) {
    const n = board.length;
    const half = n / 2;
    let suns = 0,
      moons = 0;
    for (let c = 0; c < n; c++) {
      const v = board[r][c];
      if (v === EMPTY) return false;
      if (v === SUN) suns++;
      else moons++;
      // local check for no-three already enforced during filling
    }
    return suns === half && moons === half;
  }

  function isColCompleteAndValid(board, c) {
    const n = board.length;
    const half = n / 2;
    let suns = 0,
      moons = 0;
    for (let r = 0; r < n; r++) {
      const v = board[r][c];
      if (v === EMPTY) return false;
      if (v === SUN) suns++;
      else moons++;
    }
    return suns === half && moons === half;
  }

  function isSolved(board, constraintsH, constraintsV) {
    const n = board.length;
    for (let r = 0; r < n; r++) {
      if (!isRowCompleteAndValid(board, r)) return false;
    }
    for (let c = 0; c < n; c++) {
      if (!isColCompleteAndValid(board, c)) return false;
    }
    // Constraints check completeness
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n - 1; c++) {
        const cons = constraintsH[r][c];
        if (cons === CONSTRAINT_EQUAL && board[r][c] !== board[r][c + 1]) return false;
        if (cons === CONSTRAINT_DIFF && board[r][c] === board[r][c + 1]) return false;
      }
    }
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n; c++) {
        const cons = constraintsV[r][c];
        if (cons === CONSTRAINT_EQUAL && board[r][c] !== board[r + 1][c]) return false;
        if (cons === CONSTRAINT_DIFF && board[r][c] === board[r + 1][c]) return false;
      }
    }
    return true;
  }

  // ---------- Solver (backtracking with pruning) ----------
  function solve(board, constraintsH, constraintsV) {
    const n = board.length;
    const half = n / 2;

    const rowCounts = new Array(n).fill(0).map(() => ({ sun: 0, moon: 0 }));
    const colCounts = new Array(n).fill(0).map(() => ({ sun: 0, moon: 0 }));

    // initialize counts
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (v === SUN) {
          rowCounts[r].sun++;
          colCounts[c].sun++;
        } else if (v === MOON) {
          rowCounts[r].moon++;
          colCounts[c].moon++;
        }
      }
    }

    function tryPlace(r, c, val) {
      board[r][c] = val;
      if (val === SUN) {
        rowCounts[r].sun++;
        colCounts[c].sun++;
      } else if (val === MOON) {
        rowCounts[r].moon++;
        colCounts[c].moon++;
      }
    }

    function undoPlace(r, c, val) {
      board[r][c] = EMPTY;
      if (val === SUN) {
        rowCounts[r].sun--;
        colCounts[c].sun--;
      } else if (val === MOON) {
        rowCounts[r].moon--;
        colCounts[c].moon--;
      }
    }

    function canPlace(r, c, val) {
      // Balance bounds
      const rc = rowCounts[r];
      const cc = colCounts[c];
      const half = n / 2;
      if (val === SUN && rc.sun + 1 > half) return false;
      if (val === MOON && rc.moon + 1 > half) return false;
      if (val === SUN && cc.sun + 1 > half) return false;
      if (val === MOON && cc.moon + 1 > half) return false;
      // Tentatively place
      const prev = board[r][c];
      board[r][c] = val;
      const violates =
        violatesNoThreeRule(board, r, c) ||
        violatesConstraint(board, r, c, constraintsH, constraintsV);
      // neighbor no-three check minimal for speed
      if (!violates) {
        if (c > 0 && board[r][c - 1] !== EMPTY && violatesNoThreeRule(board, r, c - 1)) {
          board[r][c] = prev;
          return false;
        }
        if (r > 0 && board[r - 1][c] !== EMPTY && violatesNoThreeRule(board, r - 1, c)) {
          board[r][c] = prev;
          return false;
        }
      }
      board[r][c] = prev;
      return !violates;
    }

    function findNextCell() {
      // Most constrained empty cell heuristic
      let best = null;
      let bestOptions = 3;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (board[r][c] === EMPTY) {
            let options = 0;
            if (canPlace(r, c, SUN)) options++;
            if (canPlace(r, c, MOON)) options++;
            if (options === 0) return { r, c, options: 0 };
            if (options < bestOptions) {
              best = { r, c, options };
              bestOptions = options;
              if (options === 1) return best;
            }
          }
        }
      }
      return best;
    }

    let solution = null;
    let solutionCount = 0;

    function backtrack() {
      const next = findNextCell();
      if (!next) {
        // full board
        if (isSolved(board, constraintsH, constraintsV)) {
          solution = cloneMatrix(board);
          solutionCount++;
        }
        return;
      }
      const { r, c } = next;
      for (const val of [SUN, MOON]) {
        if (canPlace(r, c, val)) {
          tryPlace(r, c, val);
          backtrack();
          undoPlace(r, c, val);
          if (solutionCount > 1) return; // stop early if not unique
        }
      }
    }

    backtrack();
    return { solution, solutionCount };
  }

  // ---------- Puzzle generator ----------
  function generateFullSolution(n) {
    // use solver to build a random valid full board by shuffling choices
    const board = createMatrix(n, EMPTY);
    const constraintsH = Array.from({ length: n }, () => new Array(n - 1).fill(CONSTRAINT_NONE));
    const constraintsV = Array.from({ length: n - 1 }, () => new Array(n).fill(CONSTRAINT_NONE));

    // random order of cells
    const cells = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) cells.push({ r, c });
    }
    // simple shuffle
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    // backtracking fill with random preference
    function fill(idx) {
      if (idx >= cells.length) return true;
      const { r, c } = cells[idx];
      const options = prng() < 0.5 ? [SUN, MOON] : [MOON, SUN];
      for (const val of options) {
        board[r][c] = val;
        if (
          !violatesNoThreeRule(board, r, c) &&
          !violatesBalanceRule(board, r, c) &&
          !violatesConstraint(board, r, c, constraintsH, constraintsV)
        ) {
          if (fill(idx + 1)) return true;
        }
        board[r][c] = EMPTY;
      }
      return false;
    }

    const ok = fill(0);
    if (!ok) return null;
    return board;
  }

  function sprinkleConstraints(solution, density = 0.25) {
    const n = solution.length;
    const constraintsH = Array.from({ length: n }, () => new Array(n - 1).fill(CONSTRAINT_NONE));
    const constraintsV = Array.from({ length: n - 1 }, () => new Array(n).fill(CONSTRAINT_NONE));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n - 1; c++) {
        if (prng() < density) {
          constraintsH[r][c] = solution[r][c] === solution[r][c + 1] ? CONSTRAINT_EQUAL : CONSTRAINT_DIFF;
        }
      }
    }
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n; c++) {
        if (prng() < density) {
          constraintsV[r][c] = solution[r][c] === solution[r + 1][c] ? CONSTRAINT_EQUAL : CONSTRAINT_DIFF;
        }
      }
    }
    return { constraintsH, constraintsV };
  }

  function generatePuzzle(n) {
    // 1) Generate a full solution
    let solution = generateFullSolution(n);
    if (!solution) {
      // fallback: retry with new shuffle
      solution = generateFullSolution(n);
    }
    const { constraintsH, constraintsV } = sprinkleConstraints(solution, n === 4 ? 0.15 : n === 6 ? 0.2 : 0.25);

    // 2) Remove some givens to create a puzzle, keep uniqueness via solver
    let givens = cloneMatrix(solution);
    const totalCells = n * n;
    let targetGivens = Math.floor(totalCells * (n === 4 ? 0.55 : n === 6 ? 0.45 : 0.4));

    // Order to remove
    const positions = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) positions.push({ r, c });
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    for (const { r, c } of positions) {
      if (targetGivens <= 0) break;
      const saved = givens[r][c];
      givens[r][c] = EMPTY;
      const { solutionCount } = solve(cloneMatrix(givens), constraintsH, constraintsV);
      if (solutionCount !== 1) {
        // not unique; restore
        givens[r][c] = saved;
      } else {
        targetGivens--;
      }
    }

    return { size: n, givens, constraintsH, constraintsV };
  }

  // ---------- Rendering ----------
  function renderGrid(puz) {
    const n = puz.size;
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${n}, 1fr)`;

    // Cells
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const div = document.createElement('div');
        div.className = 'tango-cell';
        div.dataset.r = String(r);
        div.dataset.c = String(c);
        div.addEventListener('click', onCellClick);
        gridEl.appendChild(div);
      }
    }

    // Constraints
    // We position constraints by using the grid wrapper's client size later
    requestAnimationFrame(() => renderConstraints(puz));
  }

  function renderConstraints(puz) {
    // Remove old constraints
    const old = document.querySelectorAll('.constraint');
    old.forEach((e) => e.remove());

    const wrapper = document.getElementById('gridWrapper');
    const gridRect = gridEl.getBoundingClientRect();
    const n = puz.size;
    const cells = gridEl.children;

    // Horizontal between (r,c)-(r,c+1)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n - 1; c++) {
        const t = puz.constraintsH[r][c];
        if (t === CONSTRAINT_NONE) continue;
        const idxA = r * n + c;
        const idxB = r * n + (c + 1);
        const a = cells[idxA].getBoundingClientRect();
        const b = cells[idxB].getBoundingClientRect();
        const midX = (a.right + b.left) / 2 - gridRect.left;
        const midY = a.top + a.height / 2 - gridRect.top;
        const span = document.createElement('div');
        span.className = 'constraint h ' + (t === CONSTRAINT_EQUAL ? 'equal' : 'diff');
        span.style.left = `${midX}px`;
        span.style.top = `${midY}px`;
        gridEl.appendChild(span);
      }
    }

    // Vertical between (r,c)-(r+1,c)
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n; c++) {
        const t = puz.constraintsV[r][c];
        if (t === CONSTRAINT_NONE) continue;
        const idxA = r * n + c;
        const idxB = (r + 1) * n + c;
        const a = cells[idxA].getBoundingClientRect();
        const b = cells[idxB].getBoundingClientRect();
        const midX = a.left + a.width / 2 - gridRect.left;
        const midY = (a.bottom + b.top) / 2 - gridRect.top;
        const span = document.createElement('div');
        span.className = 'constraint v ' + (t === CONSTRAINT_EQUAL ? 'equal' : 'diff');
        span.style.left = `${midX}px`;
        span.style.top = `${midY}px`;
        gridEl.appendChild(span);
      }
    }
  }

function updateCells() {
const n = puzzle.size;
const cells = gridEl.children;
for (let r = 0; r < n; r++) {
for (let c = 0; c < n; c++) {
const idx = r * n + c;
const el = cells[idx];
const v = playerGrid[r][c];
el.textContent = v === SUN ? sunChar : v === MOON ? moonChar : '';
el.classList.remove('error', 'ok');
if (puzzle.givens[r][c] !== EMPTY) {
el.style.fontWeight = '700';
} else {
el.style.fontWeight = '400';
}
}
}
validateBoardVisual();
}

  // ---------- Interaction ----------
  function onCellClick(e) {
    if (gridLocked) return;
    // Ignore synthesized clicks
    if (!e.isTrusted) return;
    const el = e.currentTarget;
    const r = parseInt(el.dataset.r, 10);
    const c = parseInt(el.dataset.c, 10);
    const given = puzzle.givens[r][c] !== EMPTY;
    // Allow overriding givens? Usually no. We'll lock givens.
    if (given) return;

    const now = performance.now();
    lastHumanClickMs = now;

    const current = playerGrid[r][c];
    const next = current === EMPTY ? SUN : current === SUN ? MOON : EMPTY;
    playerGrid[r][c] = next;
    recordClick(r, c, e);
    maybeRequireCaptcha();
    updateCells();

    if (isSolved(playerGrid, puzzle.constraintsH, puzzle.constraintsV)) {
      stopTimer();
      statusTextEl.textContent = 'Solved! Great job.';
      shareBtn.classList.add('btn-warning');
    }
  }

  // Pointer telemetry to detect synthetic input
  gridEl.addEventListener('pointerdown', (e) => {
    pointerState.isDown = true;
    pointerState.downTs = performance.now();
    pointerState.moves = 0;
    pointerState.lastEventTrusted = !!e.isTrusted;
  }, true);
  gridEl.addEventListener('pointermove', (e) => {
    if (!pointerState.isDown) return;
    pointerState.moves += 1;
    pointerState.lastEventTrusted = pointerState.lastEventTrusted && !!e.isTrusted;
  }, true);
  gridEl.addEventListener('pointerup', (e) => {
    pointerState.isDown = false;
    pointerState.lastEventTrusted = pointerState.lastEventTrusted && !!e.isTrusted;
  }, true);

  // ---------- Anti-bot telemetry ----------
  function recordClick(r, c, evt) {
    const now = performance.now();
    const rect = gridEl.getBoundingClientRect();
    const n = puzzle.size;
    const cellW = rect.width / n;
    const cellH = rect.height / n;
    const cellLeft = rect.left + c * cellW;
    const cellTop = rect.top + r * cellH;
    const clickX = evt.clientX;
    const clickY = evt.clientY;
    const dx = Math.abs(clickX - (cellLeft + cellW / 2));
    const dy = Math.abs(clickY - (cellTop + cellH / 2));
    const hold = Math.max(0, now - pointerState.downTs);
    const moves = pointerState.moves;
    const trusted = !!evt.isTrusted;
    clicks.push({ t: now, r, c, dx, dy, hold, moves, trusted });
    // keep last 40
    if (clicks.length > 40) clicks.shift();
  }

  function maybeRequireCaptcha() {
    if (!clicks.length) return;
    const now = performance.now();
    // Analyze last 12 clicks in 8s
    const windowMs = 8000 + Math.random() * 1500;
    const recent = clicks.filter((k) => now - k.t <= windowMs);
    if (recent.length < 12) return; // need enough signal to avoid false positives
    // Speed: median inter-click interval too low indicates automation
    const sorted = recent.map((k) => k.t).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    const speedThreshold = 90 + Math.random() * 90; // 90-180ms

    // Precision: median dx/dy too low means too-perfect clicking
    const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const dxMedian = median(recent.map((k) => k.dx));
    const dyMedian = median(recent.map((k) => k.dy));
    const precisionThreshold = (3 + Math.random() * 6) * (window.devicePixelRatio || 1); // scale with DPR

    // Hold duration: extremely short press patterns are bot-like
    const holdMedian = median(recent.map((k) => k.hold));
    const holdThreshold = 35 + Math.random() * 40; // 35-75ms

    // Repetition: repeating same cells quickly
    const repScore = recent.reduce((acc, k, i) => acc + (i > 0 && k.r === recent[i - 1].r && k.c === recent[i - 1].c ? 1 : 0), 0);

    // Untrusted share (should be 100% trusted from genuine clicks)
    const trustedRatio = recent.filter((k) => k.trusted).length / recent.length;

    const suspicious =
      (
        medianInterval < speedThreshold &&
        dxMedian < precisionThreshold &&
        dyMedian < precisionThreshold &&
        holdMedian < holdThreshold
      ) ||
      repScore > Math.max(3, Math.floor(recent.length * 0.3)) ||
      trustedRatio < 0.85;

    if (suspicious) triggerCaptcha();
  }

  function triggerCaptcha() {
    if (gridLocked) return;
    gridLocked = true;
    statusTextEl.textContent = 'Verification required...';
    const requiredHoldMs = 1200 + Math.floor(Math.random() * 800); // 1.2s - 2s
    captcha = { requiredHoldMs, startTs: 0, timer: null, bsModal: null };
    captchaHintEl.textContent = '';
    if (window.bootstrap && bootstrap.Modal) {
      const bsModal = new bootstrap.Modal(captchaModalEl, { backdrop: 'static', keyboard: false });
      captcha.bsModal = bsModal;
      bsModal.show();
    } else {
      // Fallback show modal without Bootstrap JS
      captchaModalEl.classList.add('show');
      captchaModalEl.style.display = 'block';
      captchaModalEl.removeAttribute('aria-hidden');
      captchaModalEl.setAttribute('aria-modal', 'true');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop fade show';
      document.body.appendChild(backdrop);
      captcha.bsModal = {
        hide() {
          captchaModalEl.classList.remove('show');
          captchaModalEl.style.display = 'none';
          captchaModalEl.setAttribute('aria-hidden', 'true');
          captchaModalEl.removeAttribute('aria-modal');
          backdrop.remove();
        },
      };
    }
  }

  holdBtn.addEventListener('pointerdown', () => {
    if (!captcha) return;
    const progressEl = holdBtn.querySelector('.hold-progress');
    captcha.startTs = performance.now();
    progressEl.style.transform = 'scale(0.05)';
    captcha.timer = setInterval(() => {
      const elapsed = performance.now() - captcha.startTs;
      const p = Math.min(1, elapsed / captcha.requiredHoldMs);
      progressEl.style.transform = `scale(${p})`;
      if (p >= 1) {
        clearInterval(captcha.timer);
        captcha.timer = null;
        captcha.bsModal.hide();
        gridLocked = false;
        clicks = [];
        captcha = null;
        statusTextEl.textContent = 'Thanks! Verification complete.';
      }
    }, 50);
  });

  holdBtn.addEventListener('pointerup', () => {
    if (!captcha) return;
    if (captcha.timer) clearInterval(captcha.timer);
    const elapsed = performance.now() - captcha.startTs;
    const progressEl = holdBtn.querySelector('.hold-progress');
    progressEl.style.transform = 'scale(0)';
    captcha.timer = null;
    captcha.startTs = 0;
    captchaHintEl.textContent = elapsed > 0 ? 'Too short, please hold a bit longer.' : '';
  });

  // ---------- Timer ----------
  function resetTimer() {
    stopTimer();
    elapsedMsBeforePause = 0;
    startTimestampMs = performance.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((performance.now() - startTimestampMs + elapsedMsBeforePause) / 1000);
      timerEl.textContent = formatSeconds(elapsed);
      if (puzzle) validateBoardVisual();
    }, 200);
  }

  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function formatSeconds(s) {
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // ---------- Validation visuals ----------
  function validateBoardVisual() {
    const n = puzzle.size;
    const cells = gridEl.children;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const idx = r * n + c;
        const el = cells[idx];
        const v = playerGrid[r][c];
        if (!errorSince) errorSince = createMatrix(n, null);
        if (v === EMPTY) {
          el.classList.remove('error');
          errorSince[r][c] = null;
          continue;
        }
        const bad =
          violatesNoThreeRule(playerGrid, r, c) ||
          violatesBalanceRule(playerGrid, r, c) ||
          violatesConstraint(playerGrid, r, c, puzzle.constraintsH, puzzle.constraintsV);
        if (bad) {
          if (errorSince[r][c] == null) errorSince[r][c] = performance.now();
          const elapsed = performance.now() - errorSince[r][c];
          if (elapsed >= 750) {
            el.classList.add('error');
          } else {
            el.classList.remove('error');
          }
        } else {
          el.classList.remove('error');
          errorSince[r][c] = null;
        }
      }
    }
  }

  // ---------- Controls ----------
  randomSeedBtn.addEventListener('click', () => {
    const rnd = Math.floor(Math.random() * 1e9);
    seedInputEl.value = `seed-${rnd}`;
  });

  newGameBtn.addEventListener('click', () => {
    startNewGame();
  });

  restartBtn.addEventListener('click', () => {
    if (!puzzle) return;
    playerGrid = cloneMatrix(puzzle.givens);
    errorSince = createMatrix(puzzle.size, null);
    updateCells();
    resetTimer();
    statusTextEl.textContent = '';
  });

  checkBtn.addEventListener('click', () => {
    const solved = isSolved(playerGrid, puzzle.constraintsH, puzzle.constraintsV);
    if (solved) {
      stopTimer();
      statusTextEl.textContent = 'Solved! Great job.';
    } else {
      statusTextEl.textContent = 'Not solved yet. Keep going!';
    }
  });


  shareBtn.addEventListener('click', async () => {
    const size = puzzle.size;
    const seed = seedInputEl.value || 'default';
    const text = `Tango (${size}x${size}) — seed: ${seed} — time: ${timerEl.textContent}`;
    try {
      if (gridLocked) throw new Error('locked');
      await navigator.clipboard.writeText(text);
      statusTextEl.textContent = 'Copied share text to clipboard!';
    } catch {
      statusTextEl.textContent = text;
    }
  });

  window.addEventListener('resize', () => {
    if (puzzle) renderConstraints(puzzle);
  });

  window.addEventListener('load', () => {
    if (puzzle) renderConstraints(puzzle);
  });

  // ---------- Game bootstrap ----------
  function startNewGame() {
    gridSize = parseInt(sizeSelectEl.value, 10);
    const seed = seedInputEl.value && seedInputEl.value.trim().length > 0 ? seedInputEl.value.trim() : `auto-${Date.now()}`;	
    seedInputEl.value = seed;
    prng = mulberry32(hashStringToSeed(seed));

    statusTextEl.textContent = 'Generating...';
    setTimeout(() => {
      puzzle = generatePuzzle(gridSize);
      playerGrid = cloneMatrix(puzzle.givens);
      errorSince = createMatrix(puzzle.size, null);
      renderGrid(puzzle);
      updateCells();
      resetTimer();
      statusTextEl.textContent = '';
    }, 30);
  }

  // initial
  seedInputEl.value = `daily-${new Date().toISOString().slice(0, 10)}`;
  startNewGame();
})();


