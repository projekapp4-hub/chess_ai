'use strict';

// ========== STATE ==========
let chess        = new Chess();
let boardFlipped = false;
let selectedSq   = null;
let legalMoves   = [];
let gameStates   = [];
let moveHistory = [];
let histIdx      = 0;
let engineActive = true;
let engineReady  = false;
let sfWorker     = null;
let pendingLines = {};
let promotionRes = null;
let dragState    = null;
let dragGhost    = null;
let analysisCache = new Map(); // key: fen + '_' + depth

// ADDED: Position tracking untuk sinkronisasi engine
let currentPositionFen = '';
let currentTurn = 'w';
let lastAnalysisId = 0;

// Chess.com data
let dbGames      = [];
let dbUsername   = '';
let selectedGame = null; // pgn string

const SQ = 70; // pixel size per square

const FILES  = ['a','b','c','d','e','f','g','h'];
const RANKS  = ['8','7','6','5','4','3','2','1'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Drag and resize variables
let isDragging = false;
let isResizing = false;
let dragOffsetX, dragOffsetY;
let startX, startY, startWidth, startHeight;
let currentResizeDirection = null;

// Minimize state
let isPaletteMinimized = false;

// Piece list untuk palette
const PIECE_LIST = [
  { code: 'wK', color: 'white', type: 'king' },
  { code: 'wQ', color: 'white', type: 'queen' },
  { code: 'wR', color: 'white', type: 'rook' },
  { code: 'wB', color: 'white', type: 'bishop' },
  { code: 'wN', color: 'white', type: 'knight' },
  { code: 'wP', color: 'white', type: 'pawn' },
  { code: 'bK', color: 'black', type: 'king' },
  { code: 'bQ', color: 'black', type: 'queen' },
  { code: 'bR', color: 'black', type: 'rook' },
  { code: 'bB', color: 'black', type: 'bishop' },
  { code: 'bN', color: 'black', type: 'knight' },
  { code: 'bP', color: 'black', type: 'pawn' }
];

// ========== DOM ==========
const boardEl    = document.getElementById('chessboard');
const arrowSvg   = document.getElementById('arrow-svg');
const evalFill   = document.getElementById('eval-fill');
const evalTop    = document.getElementById('eval-top');
const evalBottom = document.getElementById('eval-bottom');
const evalMain   = document.getElementById('eval-main');
const evalDepth  = document.getElementById('eval-depth-display');
const evalNps    = document.getElementById('eval-nps-display');
const bmVal      = document.getElementById('bestmove-val');
const pvVal      = document.getElementById('ponder-val');
const linesEl    = document.getElementById('lines-container');
const movesEl    = document.getElementById('moves-list');
const engineDot  = document.getElementById('engine-dot');
const engineLbl  = document.getElementById('engine-label');
const engineTgl  = document.getElementById('engine-toggle');
const toastEl    = document.getElementById('toast');

// ========== BOOT ==========
document.addEventListener('DOMContentLoaded', () => {
  buildCoords();
  initStates(); // Pastikan initStates() mengeset boardFlipped = false
  
  // ADDED: Initialize position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId = 0;
  
  renderBoard();
  initEngine();
  updateInfo();
  initDbYearMonth();
  resetEval();
  document.addEventListener('keydown', onKey);
});

function initStates() {
  gameStates = [chess.fen()];
  moveHistory = [];
  histIdx = 0;
}


function getCachedAnalysis(fen, depth) {
  return analysisCache.get(fen + '_' + depth);
}

function setCachedAnalysis(fen, depth, data) {
  analysisCache.set(fen + '_' + depth, data);
}

// ========== TABS ==========
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('nav-' + tab).classList.add('active');
}

// ========== COORDINATES ==========
function buildCoords() {
  const fTop = document.getElementById('coord-files-top');
  const fBot = document.getElementById('coord-files-bottom');
  const rLft = document.getElementById('coord-ranks-left');
  const rRgt = document.getElementById('coord-ranks-right');

  fTop.innerHTML = fBot.innerHTML = rLft.innerHTML = rRgt.innerHTML = '';

  // File labels (a-h or h-a)
  const files = boardFlipped ? [...FILES].reverse() : FILES;
  files.forEach(f => {
    [fTop, fBot].forEach(row => {
      const s = document.createElement('span');
      s.className = 'coord-label'; s.textContent = f; row.appendChild(s);
    });
  });

  // Rank labels
  const ranks = boardFlipped ? [...RANKS].reverse() : RANKS;
  ranks.forEach(r => {
    [rLft, rRgt].forEach(col => {
      const s = document.createElement('span');
      s.className = 'coord-label'; s.style.flex = `0 0 ${SQ}px`; s.textContent = r; col.appendChild(s);
    });
  });
}

// ========== BOARD RENDER ==========
function renderBoard() {
  boardEl.innerHTML = '';
  clearArrows();
  clearAnnotationSymbols();   // ← tambahkan ini

  const board    = chess.board();
  const inCheck  = chess.in_check();
  const turnCol  = chess.turn();

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const dRow = boardFlipped ? 7 - row : row;
      const dCol = boardFlipped ? 7 - col : col;
      const sq   = FILES[dCol] + RANKS[dRow];

      const sqEl = document.createElement('div');
      sqEl.className = 'square ' + ((dRow + dCol) % 2 === 0 ? 'light' : 'dark');
      sqEl.dataset.sq = sq;

      const cell = board[dRow][dCol];
      if (cell) {
        const pEl = document.createElement('div');
        pEl.className = `piece ${cell.color==='w' ? 'white-piece' : 'black-piece'}`;
        pEl.dataset.sq = sq;

        // Tambahkan class spesifik untuk jenis piece
        let pieceType;
        switch (cell.type) {
          case 'k': pieceType = 'king'; break;
          case 'q': pieceType = 'queen'; break;
          case 'r': pieceType = 'rook'; break;
          case 'b': pieceType = 'bishop'; break;
          case 'n': pieceType = 'knight'; break;
          case 'p': pieceType = 'pawn'; break;
        }
        pEl.classList.add(`${cell.color === 'w' ? 'white' : 'black'}-${pieceType}`);

        if (inCheck && cell.type === 'k' && cell.color === turnCol)
          sqEl.classList.add('in-check');

        sqEl.appendChild(pEl);
      }

      sqEl.addEventListener('mousedown', onSqDown);
      boardEl.appendChild(sqEl);
    }
  }

  applyLastMoveHighlight();

  // ADD THIS BLOCK: Tambahkan highlight anotasi untuk langkah terakhir
  if (histIdx > 0 && moveHistory.length >= histIdx) {
    const lastMove = moveHistory[histIdx - 1];
    const annotation = reviewAnnotations[histIdx - 1];
    if (annotation && annotation.classification) {
      const fromSq = lastMove.from;
      const toSq = lastMove.to;
      const fromEl = boardEl.querySelector(`[data-sq="${fromSq}"]`);
      const toEl = boardEl.querySelector(`[data-sq="${toSq}"]`);
      const annClass = `ann-${annotation.classification}`;
      if (fromEl) fromEl.classList.add(annClass);
      if (toEl) toEl.classList.add(annClass);
    }
  }

  // Tambahkan simbol anotasi jika ada
  if (histIdx > 0 && moveHistory.length >= histIdx) {
    const annotation = reviewAnnotations[histIdx - 1];
    if (annotation && annotation.classification) {
      const move = moveHistory[histIdx - 1];
      const toSq = move.to;
      const toEl = boardEl.querySelector(`[data-sq="${toSq}"]`);
      if (toEl) {
        const symbol = document.createElement('div');
        symbol.className = `annotation-symbol ann-symbol-${annotation.classification}`;
        symbol.textContent = ANNOTATIONS[annotation.classification].label;  // misal "!!", "?", dll.
        toEl.appendChild(symbol);
      }
    }
  }

  if (engineActive && engineReady) scheduleAnalysis();
}

function applyLastMoveHighlight() {
  const hist = chess.history({ verbose: true });
  if (!hist.length) return;
  const last = hist[hist.length - 1];
  markSq(last.from, 'last-from');
  markSq(last.to,   'last-to');
}

function markSq(sq, cls) {
  const el = boardEl.querySelector(`[data-sq="${sq}"]`);
  if (el) el.classList.add(cls);
}

function clearSqClasses() {
  boardEl.querySelectorAll('.square').forEach(el => {
    el.classList.remove('selected','last-from','last-to','in-check');
    
    // Hapus semua kelas anotasi (yang diawali 'ann-')
    const classesToRemove = [];
    el.classList.forEach(cls => {
      if (cls.startsWith('ann-')) {
        classesToRemove.push(cls);
      }
    });
    classesToRemove.forEach(cls => el.classList.remove(cls));
    
    el.querySelectorAll('.legal-dot').forEach(d => d.remove());
  });
}

// ========== SVG ARROWS ==========
function sqCenter(sq) {
  const file = FILES.indexOf(sq[0]);
  const rank = RANKS.indexOf(sq[1]);
  const col  = boardFlipped ? 7 - file : file;
  const row  = boardFlipped ? 7 - rank : rank;
  return { x: col * SQ + SQ / 2, y: row * SQ + SQ / 2 };
}

function drawArrow(fromSq, toSq, markerId, color, strokeWidth = 9) {
  if (!fromSq || !toSq || fromSq === toSq) return;
  const a = sqCenter(fromSq);
  const b = sqCenter(toSq);

  // Shorten line so arrowhead doesn't overlap square center
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  const ux = dx/len, uy = dy/len;
  const shrink = 18;
  const bx = b.x - ux * shrink, by = b.y - uy * shrink;

  const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
  line.setAttribute('x2', bx);  line.setAttribute('y2', by);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', strokeWidth);
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', `url(#${markerId})`);
  line.setAttribute('opacity', '0.88');
  line.classList.add('engine-arrow');
  arrowSvg.appendChild(line);
}

function clearArrows(cls = 'engine-arrow') {
  arrowSvg.querySelectorAll('.' + cls).forEach(el => el.remove());
}

// ========== SQUARE INTERACTION ==========
function onSqDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (promotionRes) return;

  // Get the square element (might be piece or square itself)
  const sqEl = e.currentTarget.closest('.square');
  if (!sqEl) return;
  
  const sq = sqEl.dataset.sq;
  const piece = chess.get(sq);

  // Clicking a legal destination
  if (selectedSq) {
    const isLegal = legalMoves.some(m => m.to === sq);
    if (isLegal) { 
      doMove(selectedSq, sq); 
      return; 
    }
    // Reselect own piece
    if (piece && piece.color === chess.turn()) {
      clearSqClasses(); 
      applyLastMoveHighlight();
      selectSq(sq); 
      startDrag(e, sq, piece); 
      return;
    }
    // Deselect
    clearSqClasses(); 
    applyLastMoveHighlight();
    selectedSq = null; 
    legalMoves = []; 
    return;
  }

  // Start drag if it's our piece
  if (piece && piece.color === chess.turn()) {
    selectSq(sq);
    startDrag(e, sq, piece);
  }
}

function selectSq(sq) {
  selectedSq  = sq;
  legalMoves  = chess.moves({ square: sq, verbose: true });

  markSq(sq, 'selected');

  legalMoves.forEach(m => {
    const tEl = boardEl.querySelector(`[data-sq="${m.to}"]`);
    if (!tEl) return;
    const dot = document.createElement('div');
    const cap = chess.get(m.to) || m.flags.includes('e');
    dot.className = 'legal-dot' + (cap ? ' capture' : '');
    tEl.appendChild(dot);
    tEl.addEventListener('mousedown', () => doMove(sq, m.to), { once: true });
  });
}

// ========== DRAG ==========
function startDrag(e, sq, piece) {
  const srcEl = boardEl.querySelector(`[data-sq="${sq}"] .piece`);
  if (!srcEl) return;

  // Ambil ukuran piece sebenarnya (sesuai skala board saat ini)
  const rect = srcEl.getBoundingClientRect();

  // Buat ghost dengan ukuran yang sama
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.style.backgroundImage = window.getComputedStyle(srcEl).backgroundImage;
  dragGhost.style.width = rect.width + 'px';
  dragGhost.style.height = rect.height + 'px';

  // Tambahkan kelas piece untuk gaya tambahan (jika diperlukan)
  let pieceType;
  switch (piece.type) {
    case 'k': pieceType = 'king'; break;
    case 'q': pieceType = 'queen'; break;
    case 'r': pieceType = 'rook'; break;
    case 'b': pieceType = 'bishop'; break;
    case 'n': pieceType = 'knight'; break;
    case 'p': pieceType = 'pawn'; break;
  }
  const pieceClass = `${piece.color === 'w' ? 'white' : 'black'}-${pieceType}`;
  dragGhost.classList.add(pieceClass);

  document.body.appendChild(dragGhost);
  moveDragGhost(e.clientX, e.clientY);   // posisikan langsung

  srcEl.classList.add('dragging');       // sembunyikan piece asli

  dragState = { sq, piece, srcEl };

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  e.preventDefault();
}

function moveDragGhost(x, y) {
  if (!dragGhost) return;
  // Cukup set left/top ke koordinat cursor, transform: translate(-50%,-50%) di CSS akan memusatkan ghost
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = y + 'px';
}

function onDragMove(e) { moveDragGhost(e.clientX, e.clientY); }

function onDragEnd(e) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  
  // Remove ghost
  if (dragGhost) { 
    dragGhost.remove(); 
    dragGhost = null; 
  }
  
  // Show original piece again
  if (dragState && dragState.srcEl) {
    dragState.srcEl.classList.remove('dragging');
  }
  
  // Find square under cursor
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  const sqEl = els.find(el => el.dataset && el.dataset.sq && el.classList.contains('square'))
             || els.find(el => el.closest && el.closest('.square'))?.closest('.square');

  // Make move if valid
  if (sqEl && dragState && sqEl.dataset.sq !== dragState.sq) {
    // Check if the drop square is a legal move
    const isLegal = legalMoves.some(m => m.to === sqEl.dataset.sq);
    if (isLegal) {
      doMove(dragState.sq, sqEl.dataset.sq);
    }
  }

  dragState = null;
  
  // Clean up any remaining selection classes if needed
  if (!selectedSq) {
    clearSqClasses();
    applyLastMoveHighlight();
  }
}

// ========== MOVE ==========
async function doMove(from, to) {
  clearSqClasses();
  selectedSq = null; legalMoves = [];

  const piece = chess.get(from);
  if (!piece) return;

  let promo;
  if (piece.type === 'p') {
    const toRank = to[1];
    if ((piece.color==='w'&&toRank==='8')||(piece.color==='b'&&toRank==='1'))
      promo = await askPromotion(piece.color);
    if (promo === null) return;
  }

  const move = chess.move({ from, to, promotion: promo || 'q' });
  if (!move) return;

  // Hapus anotasi review jika ada, karena game berubah
  if (Object.keys(reviewAnnotations).length > 0) {
    reviewAnnotations = {};
    document.getElementById('review-summary').style.display = 'none';
    document.getElementById('review-progress').style.display = 'none';
    isReviewing = false;
    const reviewBtn = document.getElementById('review-btn');
    if (reviewBtn) {
      reviewBtn.disabled = false;
      reviewBtn.textContent = '🔍 Review Game';
    }
  }

  // Potong riwayat jika kita berada di tengah (undo/redo)
  if (histIdx < gameStates.length - 1) {
    gameStates = gameStates.slice(0, histIdx + 1);
    moveHistory = moveHistory.slice(0, histIdx);
  }

  gameStates.push(chess.fen());
  moveHistory.push(move);          // simpan langkah
  histIdx = gameStates.length - 1;

  // HAPUS BLOK DUPLIKAT INI:
  // if (histIdx < gameStates.length - 1)
  //   gameStates = gameStates.slice(0, histIdx + 1);
  // gameStates.push(chess.fen());
  // histIdx = gameStates.length - 1;

  // MODIFIED: Update position tracking dan cancel pending analysis
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++; // Cancel semua analysis yang sedang berjalan

  renderBoard();
  updateMoves();
  updateInfo();
}

async function askPromotion(color) {
  return new Promise(res => {
    promotionRes = res;
    const promoBox = document.getElementById('promotion-box');
    promoBox.innerHTML = '';
    const types = ['q', 'r', 'b', 'n'];
    const pieceNames = ['queen', 'rook', 'bishop', 'knight'];
    types.forEach((type, i) => {
      const btn = document.createElement('div');
      btn.className = 'promo-piece';
      const pieceClass = `${color === 'w' ? 'white' : 'black'}-${pieceNames[i]}`;
      btn.classList.add('promo-piece', 'piece', pieceClass);
      btn.onclick = () => {
        document.getElementById('promotion-overlay').style.display = 'none';
        promotionRes = null;
        res(type);
      };
      promoBox.appendChild(btn);
    });
    document.getElementById('promotion-overlay').style.display = 'flex';
  });
}

// ========== NAVIGATION ==========
function goToStart()   { loadState(0); }
function goToEnd()     { loadState(gameStates.length - 1); }
function goBack()      { if (histIdx > 0) loadState(histIdx - 1); }
function goForward()   { if (histIdx < gameStates.length-1) loadState(histIdx + 1); }

function loadState(idx) {
  histIdx = Math.max(0, Math.min(idx, gameStates.length-1));
  chess.load(gameStates[histIdx]);
  
  // MODIFIED: Update position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++; // Cancel pending analysis
  
  renderBoard();
  updateMoves();  // Akan tetap menampilkan semua langkah karena pakai moveHistory
  updateInfo();
}

function resetBoard() {
  chess.reset();
  gameStates = [chess.fen()];
  moveHistory = [];  
  histIdx = 0;
  selectedSq = null; legalMoves = [];
  reviewAnnotations = {};
  document.getElementById('review-summary').style.display = 'none';
  clearArrows();
  
  // MODIFIED: Update position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++;
  
  renderBoard();
  updateMoves();
  updateInfo();
  resetEval();
  scheduleAnalysis();
}

function flipBoard() {
  boardFlipped = !boardFlipped;
  
  // Dapatkan nilai eval saat ini dan update dengan orientasi baru
  const currentEval = parseFloat(evalMain.textContent.replace('+', '')) || 0;
  const isMate = evalMain.className.includes('mate');
  let mateIn = 0;
  
  if (isMate) {
    const match = evalMain.textContent.match(/M(\d+)/);
    mateIn = match ? parseInt(match[1]) : 0;
    if (evalMain.textContent.startsWith('-')) mateIn = -mateIn;
  }
  
  updateEvalBar(currentEval * 100, isMate, mateIn);
  
  buildCoords();
  renderBoard();
}


// ========== MOVE HISTORY PANEL ==========
function updateMoves() {
  movesEl.innerHTML = '';

  if (histIdx === 0 || moveHistory.length === 0) {
    movesEl.innerHTML = '<span class="moves-empty">Make a move to begin.</span>';
    return;
  }

  // Gunakan moveHistory dan gameStates, bukan chess.history()
  const hist = moveHistory.slice(0, histIdx);
  const fens = gameStates.slice(0, histIdx + 1);

  hist.forEach((m, i) => {
    if (i % 2 === 0) {
      const numEl = document.createElement('span');
      numEl.className = 'move-num';
      numEl.textContent = (Math.floor(i / 2) + 1) + '.';
      movesEl.appendChild(numEl);
    }

    const btn = document.createElement('span');
    btn.className = 'move-token';
    
    // Tandai langkah yang sedang aktif (current position)
    if (i + 1 === histIdx) btn.classList.add('current');

    // Annotation badge
    const ann = reviewAnnotations[i];
    if (ann) {
      const info = ANNOTATIONS[ann.classification];
      // Color the token itself for serious errors/brilliances
      const tokenCls = {
        brilliant: 'ann-brilliant', great: 'ann-great', best: 'ann-best',
        blunder: 'ann-blunder', mistake: 'ann-mistake', inaccuracy: 'ann-inaccuracy',
      };
      if (tokenCls[ann.classification]) btn.classList.add(tokenCls[ann.classification]);

      btn.textContent = m.san;

      // Add badge (skip 'good' — no visual clutter)
      if (ann.classification !== 'good' && ann.classification !== 'excellent') {
        const badge = document.createElement('span');
        badge.className = `ann-badge ${ann.classification}`;
        badge.textContent = info.label;
        badge.title = `${info.desc}${ann.cpLoss > 0 ? ' (−' + (ann.cpLoss / 100).toFixed(2) + ')' : ''}`;
        btn.appendChild(badge);
      }
    } else {
      btn.textContent = m.san;
    }

    btn.onclick = () => {
      chess.load(fens[i + 1]);
      histIdx = i + 1;
      
      // MODIFIED: Update position tracking
      currentPositionFen = chess.fen();
      currentTurn = chess.turn();
      lastAnalysisId++;
      
      renderBoard();
      updateMoves();  // Panggil updateMoves() lagi untuk update class 'current'
      updateInfo();

      // Show engine best move for this position if annotated
      if (reviewAnnotations[i] && reviewAnnotations[i].bestMove) {
        clearArrows();
        const bm = reviewAnnotations[i].bestMove;
        if (bm && bm.length >= 4) {
          drawArrow(bm.slice(0, 2), bm.slice(2, 4), 'arr-best', 'rgba(0,200,90,0.92)', 10);
        }
      }
    };

    movesEl.appendChild(btn);
  });

  movesEl.scrollTop = movesEl.scrollHeight;
}

// ========== INFO PANEL ==========
function updateInfo() {
  const parts = chess.fen().split(' ');
  document.getElementById('info-turn').textContent = chess.turn()==='w' ? '⬜ White' : '⬛ Black';
  document.getElementById('info-castling').textContent = parts[2] || '—';
  document.getElementById('info-ep').textContent = parts[3]!=='-' ? parts[3] : '—';
  document.getElementById('info-halfmove').textContent = parts[4];
  document.getElementById('info-fen').textContent = chess.fen();

  if      (chess.in_checkmate()) showToast('♚ Checkmate!');
  else if (chess.in_stalemate()) showToast('Stalemate — Draw!');
  else if (chess.in_draw())      showToast('Draw!');
  else if (chess.in_check())     showToast('Check!');
}

// ========== EVAL BAR ==========
function updateEvalBar(cp, isMate, mateIn) {
  let display, pctWhite;
  if (isMate) {
    display  = (mateIn > 0 ? '+' : '') + 'M' + Math.abs(mateIn);
    pctWhite = mateIn > 0 ? 96 : 4;
    evalMain.className = 'eval-main mate';
  } else {
    const p = cp / 100;
    pctWhite = 50 + 50 * (2/(1+Math.exp(-0.38*p)) - 1);
    pctWhite = Math.max(4, Math.min(96, pctWhite));
    display  = (cp > 0 ? '+' : '') + (cp/100).toFixed(2);
    evalMain.className = 'eval-main ' + (cp > 0 ? 'positive' : cp < 0 ? 'negative' : '');
  }
  
  evalMain.textContent = display;
  
  // Update class pada container untuk transform
  const container = document.querySelector('.eval-bar-container');
  
  // Handle flipped state
  if (boardFlipped) {
    // FLIPPED MODE: Putih di ATAS papan
    container.classList.remove('normal');
    container.classList.add('flipped');
    
    const whiteAdvantage = cp > 0 || (isMate && mateIn > 0);
    const blackAdvantage = cp < 0 || (isMate && mateIn < 0);
    
    evalTop.textContent = whiteAdvantage ? display : '';
    evalBottom.textContent = blackAdvantage ? display : '';
    
    // Fill dari bottom dengan persentase normal (akan di-scaleY(-1))
    evalFill.style.height = pctWhite + '%';
  } else {
    // NORMAL MODE (DEFAULT): Putih di BAWAH papan
    container.classList.remove('flipped');
    container.classList.add('normal');
    
    const whiteAdvantage = cp > 0 || (isMate && mateIn > 0);
    const blackAdvantage = cp < 0 || (isMate && mateIn < 0);
    
    // Di mode normal (putih di bawah):
    // - Hitam di atas (evalTop) = blackAdvantage
    // - Putih di bawah (evalBottom) = whiteAdvantage
    evalTop.textContent = blackAdvantage ? display : '';
    evalBottom.textContent = whiteAdvantage ? display : '';
    
    // Fill dari BAWAH ke ATAS (putih di bawah = 100 - pctWhite)
    evalFill.style.height = pctWhite + '%';
  }
}

function resetEval() {
  evalMain.textContent = '0.00';
  evalMain.className = 'eval-main';
  
  const container = document.querySelector('.eval-bar-container');
  
  // Reset berdasarkan boardFlipped state
  if (boardFlipped) {
    // Flipped: putih di atas
    container.classList.remove('normal');
    container.classList.add('flipped');
    evalFill.style.height = '50%';
    evalTop.textContent = '+0.0';  // Putih di atas
    evalBottom.textContent = '';    // Hitam di bawah
  } else {
    // NORMAL MODE (DEFAULT): Putih di BAWAH
    container.classList.remove('flipped');
    container.classList.add('normal');
    evalFill.style.height = '50%';
    evalTop.textContent = '';       // Hitam di atas (kosong karena 0.00)
    evalBottom.textContent = '+0.0'; // Putih di bawah
  }
  
  evalDepth.textContent = 'Depth —'; 
  evalNps.textContent = '';
  bmVal.textContent = '—'; 
  pvVal.textContent = '—';
  linesEl.innerHTML = '';
  clearArrows();
}


// ========== STOCKFISH ENGINE ==========
function initEngine() {
  engineDot.className = 'engine-dot loading';
  engineLbl.textContent = 'Loading Stockfish 18…';
  
  try {
    sfWorker = new Worker('stockfish-18.js');
    sfWorker.onmessage = onEngineMsg;
    
    // --- PENGATURAN CPU (THREADS) ---
    // Mengambil jumlah core (Logical Processors)
    const totalCores = navigator.hardwareConcurrency || 4; 
    
    // Menghitung setengah dari total core (minimal 1 thread)
    const halfThreads = Math.max(1, Math.floor(totalCores / 2));
    
    sfWorker.postMessage('uci');
    
    // Kirim perintah ke Stockfish
    sfWorker.postMessage(`setoption name Threads value ${halfThreads}`);
    
    // Tingkatkan Hash agar pencarian lebih efisien (RAM)
    sfWorker.postMessage('setoption name Hash value 256');
    
    sfWorker.postMessage('setoption name UCI_ShowWDL value true');
    sfWorker.postMessage('isready');

    console.log(`Engine running on ${halfThreads} threads (Total CPU Cores: ${totalCores})`);

  } catch(e) {
    engineLbl.textContent = 'Engine Unavailable';
    engineDot.className = 'engine-dot';
    console.error('Error starting engine:', e);
  }
}

function onEngineMsg(e) {
  const line = e.data || '';
  if (!line) return;

  if (line === 'readyok') {
    engineReady = true;
    engineDot.className = 'engine-dot ready';
    engineLbl.textContent = 'Stockfish 18 Ready';
    engineTgl.classList.add('active');
    scheduleAnalysis();
    return;
  }

  if (line.startsWith('bestmove')) {
      // MODIFIED: Only process if position still matches
      if (chess.fen() !== currentPositionFen) return;
      
      const parts = line.split(' ');
      const bm = parts[1], ponder = parts[3];
      engineDot.className = 'engine-dot ready';

      clearArrows();
      if (bm && bm !== '(none)') {
          bmVal.textContent = safeFormatMove(bm);
          
          // MODIFIED: Only draw if turn matches current position
          if (chess.fen() === currentPositionFen) {
              // Draw best move arrow
              drawArrow(bm.slice(0,2), bm.slice(2,4), 'arr-best', 'rgba(0,200,90,0.92)', 10);
              
              if (ponder && ponder.length >= 4) {
                  pvVal.textContent = safeFormatMove(ponder, bm);
                  
                  // FIXED: Ponder arrow should be drawn from best move's destination square
                  // to ponder move's destination square, AFTER applying the best move
                  const bestMoveFrom = bm.slice(0,2);
                  const bestMoveTo = bm.slice(2,4);
                  const ponderTo = ponder.slice(2,4);
                  
                  // Validate that ponder move starts from the correct square
                  // After best move, the opponent's pieces are on the board
                  // The ponder move should start from somewhere on the board, not necessarily from bestMoveTo
                  // But in UCI, ponder is given as a full move from the new position
                  
                  // Create a temporary position to validate the ponder move
                  const tempChess = new Chess(chess.fen());
                  const bestMoveResult = tempChess.move({ 
                      from: bestMoveFrom, 
                      to: bestMoveTo, 
                      promotion: bm[4] || 'q' 
                  });
                  
                  if (bestMoveResult) {
                      // Now in the new position, the ponder move should be legal
                      const ponderFrom = ponder.slice(0,2);
                      const ponderLegal = tempChess.moves({ verbose: true }).some(
                          m => m.from === ponderFrom && m.to === ponderTo
                      );
                      
                      if (ponderLegal) {
                          // Draw the ponder arrow from the piece's original square to destination
                          drawArrow(ponderFrom, ponderTo, 'arr-ponder', 'rgba(80,150,255,0.8)', 7);
                      } else {
                          // Fallback: just draw from best move destination to ponder destination
                          // (this might not be accurate but at least shows something)
                          drawArrow(bestMoveTo, ponderTo, 'arr-ponder', 'rgba(80,150,255,0.3)', 5);
                      }
                  } else {
                      // If best move couldn't be applied, draw a simple connection
                      drawArrow(bestMoveTo, ponderTo, 'arr-ponder', 'rgba(80,150,255,0.5)', 6);
                  }
              } else { 
                  pvVal.textContent = '—'; 
              }
          }
      } else { 
          bmVal.textContent = '—'; 
          pvVal.textContent = '—'; 
      }

      renderLines();
      return;
  }

  if (line.startsWith('info') && line.includes(' pv ')) parseInfo(line);
}

// MODIFIED: Add position validation in parseInfo
function parseInfo(line) {
  // MODIFIED: Validate position - ignore stale analysis
  if (chess.fen() !== currentPositionFen) {
    // Stale analysis - ignore
    return;
  }
  
  if (line.includes('lowerbound') || line.includes('upperbound')) return;
  const tok = line.split(' ');
  const get = k => { const i = tok.indexOf(k); return i !== -1 ? tok[i+1] : null; };
  const getAll = k => { const i = tok.indexOf(k); return i !== -1 ? tok.slice(i+1) : []; };

  const depth   = parseInt(get('depth')||'0');
  const multipv = parseInt(get('multipv')||'1');
  const nodes   = parseInt(get('nodes')||'0');
  const nps     = parseInt(get('nps')||'0');
  const pv      = getAll('pv');

  let scoreCP = null, mateIn = null;
  const si = tok.indexOf('score');
  if (si !== -1) {
    if (tok[si+1]==='cp')   { scoreCP = parseInt(tok[si+2]); }
    if (tok[si+1]==='mate') { mateIn  = parseInt(tok[si+2]); scoreCP = mateIn>0?30000:-30000; }
  }

  // Flip for black's POV
  if (chess.turn() === 'b') {
    if (scoreCP!==null) scoreCP = -scoreCP;
    if (mateIn!==null)  mateIn  = -mateIn;
  }

  if (multipv === 1) {
    // MODIFIED: Double-check turn hasn't changed
    if (chess.turn() !== currentTurn) return;
    
    evalDepth.textContent = `Depth ${depth}`;
    evalNps.textContent   = nps ? formatNps(nps) : '';
    if (mateIn !== null) updateEvalBar(0, true, mateIn);
    else if (scoreCP !== null) updateEvalBar(scoreCP, false, null);
  }

  pendingLines[multipv] = { depth, scoreCP, mateIn, pv };
}

// MODIFIED: Add position validation in renderLines
function renderLines() {
  linesEl.innerHTML = '';
  const count = Object.keys(pendingLines).length;
  
  for (let i = 1; i <= count; i++) {
    const d = pendingLines[i];
    if (!d) continue;
    const item = document.createElement('div');
    item.className = 'line-item';

    const rank = document.createElement('span');
    rank.className = 'line-rank'; rank.textContent = '#' + i;

    const score = document.createElement('span');
    score.className = 'line-score';
    if (d.mateIn !== null) {
      score.textContent = (d.mateIn>0?'+':'') + 'M' + Math.abs(d.mateIn);
      score.classList.add('mate');
    } else {
      const v = (d.scoreCP/100).toFixed(2);
      score.textContent = d.scoreCP>0 ? '+'+v : v;
      score.classList.add(d.scoreCP>=0 ? 'pos' : 'neg');
    }

    const moves = document.createElement('span');
    moves.className = 'line-moves';
    moves.innerHTML = formatPV(d.pv);

    item.appendChild(rank);
    item.appendChild(score);
    item.appendChild(moves);

    // MODIFIED: Click handler with position validation
    item.onclick = () => {
      // Only draw arrows if position still matches
      if (chess.fen() === currentPositionFen && d.pv.length >= 1) {
        clearArrows();
        
        // Draw best move arrow
        const bestMove = d.pv[0];
        drawArrow(bestMove.slice(0,2), bestMove.slice(2,4), 'arr-best', 'rgba(0,200,90,0.92)', 10);
        
        // Draw ponder arrow if available (second move in PV)
        if (d.pv.length >= 2) {
          const ponderMove = d.pv[1];
          
          // Create temporary position to validate ponder move
          const tempChess = new Chess(chess.fen());
          const bestMoveResult = tempChess.move({ 
            from: bestMove.slice(0,2), 
            to: bestMove.slice(2,4), 
            promotion: bestMove[4] || 'q' 
          });
          
          if (bestMoveResult) {
            // Ponder move should start from its original square in the new position
            const ponderFrom = ponderMove.slice(0,2);
            const ponderTo = ponderMove.slice(2,4);
            
            // Check if the ponder move is legal from that square
            const ponderLegal = tempChess.moves({ verbose: true }).some(
              m => m.from === ponderFrom && m.to === ponderTo
            );
            
            if (ponderLegal) {
              drawArrow(ponderFrom, ponderTo, 'arr-ponder', 'rgba(80,150,255,0.8)', 7);
            } else {
              // Fallback
              drawArrow(bestMove.slice(2,4), ponderTo, 'arr-ponder', 'rgba(80,150,255,0.3)', 5);
            }
          }
        }
      }
    };

    linesEl.appendChild(item);
  }
}

function formatPV(pvMoves) {
  if (!pvMoves || !pvMoves.length) return '—';
  const tmp = new Chess(chess.fen());
  const out = [];
  pvMoves.forEach((uci, i) => {
    const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4]||'q' });
    if (!m) return;
    out.push(i === 0 ? `<span class="fm">${m.san}</span>` : m.san);
  });
  return out.join(' ');
}

function safeFormatMove(uci, prevUci) {
  if (!uci || uci.length < 4) return uci;
  let tmp = new Chess(chess.fen());
  if (prevUci) tmp.move({ from: prevUci.slice(0,2), to: prevUci.slice(2,4), promotion: prevUci[4]||'q' });
  const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4]||'q' });
  return m ? m.san : uci;
}

function formatNps(n) {
  if (n>=1e6) return (n/1e6).toFixed(1)+'Mn/s';
  if (n>=1e3) return (n/1e3).toFixed(0)+'Kn/s';
  return n+'n/s';
}

// ========== ANALYSIS ==========
let analysisTmr = null;

// MODIFIED: Add position tracking in scheduleAnalysis
function scheduleAnalysis() {
  if (!engineActive || !engineReady || !sfWorker) return;
  
  // MODIFIED: Store current position and turn
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  
  // MODIFIED: Increment analysis ID to track latest request
  const analysisId = ++lastAnalysisId;
  
  clearTimeout(analysisTmr);
  pendingLines = {};
  
  analysisTmr = setTimeout(() => {
    // MODIFIED: Only proceed if this is still the latest request
    if (analysisId !== lastAnalysisId) return;
    
    const depth = parseInt(document.getElementById('engine-depth').value) || 20;
    const multipv = parseInt(document.getElementById('engine-multipv').value) || 3;
    
    sfWorker.postMessage('stop');
    sfWorker.postMessage('ucinewgame');
    sfWorker.postMessage(`setoption name MultiPV value ${multipv}`);
    sfWorker.postMessage(`position fen ${currentPositionFen}`);
    sfWorker.postMessage(`go depth ${depth}`);
    
    engineDot.className = 'engine-dot searching';
    engineLbl.textContent = 'Analyzing…';
  }, 150);
}

function toggleEngine() {
  engineActive = !engineActive;
  engineTgl.classList.toggle('active', engineActive);
  if (!engineActive) {
    sfWorker && sfWorker.postMessage('stop');
    engineDot.className = 'engine-dot';
    engineLbl.textContent = 'Engine Paused';
    resetEval();
  } else { scheduleAnalysis(); }
}

document.getElementById('engine-depth').addEventListener('change', () => engineActive && scheduleAnalysis());
document.getElementById('engine-multipv').addEventListener('change', () => engineActive && scheduleAnalysis());

// ========== CHESS.COM API ==========
const CORS_PROXY = 'https://api.chess.com/pub';

function initDbYearMonth() {
  const yearSel = document.getElementById('db-year');
  const monSel  = document.getElementById('db-month');
  const now     = new Date();

  for (let y = now.getFullYear(); y >= 2010; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    if (y === now.getFullYear()) opt.selected = true;
    yearSel.appendChild(opt);
  }

  MONTHS.forEach((m, i) => {
    const opt = document.createElement('option');
    const num = String(i+1).padStart(2,'0');
    opt.value = num; opt.textContent = m;
    if (i+1 === now.getMonth()+1) opt.selected = true;
    monSel.appendChild(opt);
  });
}

async function fetchChesscomPlayer() {
  const username = document.getElementById('db-username').value.trim();
  if (!username) return;
  dbUsername = username;

  setDbSearching(true);

  try {
    const [playerRes, statsRes] = await Promise.all([
      fetch(`${CORS_PROXY}/player/${username}`),
      fetch(`${CORS_PROXY}/player/${username}/stats`)
    ]);

    if (!playerRes.ok) throw new Error(`User "${username}" not found`);
    const player = await playerRes.json();
    const stats  = statsRes.ok ? await statsRes.json() : null;

    showDbProfile(player, stats);
    document.getElementById('db-filters').style.display = '';
    document.getElementById('db-load-btn') && (document.getElementById('db-load-btn').style.display = '');
    setDbSearching(false);
  } catch(e) {
    setDbSearching(false);
    showToast('❌ ' + e.message);
    document.getElementById('db-profile').style.display = 'none';
    document.getElementById('db-filters').style.display = 'none';
  }
}

function setDbSearching(on) {
  const searchText    = document.getElementById('db-search-text');
  const searchSpinner = document.getElementById('db-search-spinner');
  const searchBtn     = document.querySelector('.db-search-btn');

  if (searchText)    searchText.style.display    = on ? 'none' : '';
  if (searchSpinner) searchSpinner.style.display = on ? ''     : 'none';
  if (searchBtn)     searchBtn.disabled          = on;
}

function showDbProfile(player, stats) {
  const profile = document.getElementById('db-profile');
  profile.style.display = 'flex';

  document.getElementById('db-avatar').src = player.avatar || 'https://www.chess.com/bundles/web/images/user-image.007dad08.svg';
  document.getElementById('db-profile-name').textContent = player.username;

  const title    = player.title ? `[${player.title}] ` : '';
  const country  = player.country ? player.country.split('/').pop() : '';
  document.getElementById('db-profile-sub').textContent =
    `${title}${player.name || ''} ${country ? '· ' + country : ''} · Member since ${new Date(player.joined*1000).getFullYear()}`;

  const ratingsEl = document.getElementById('db-ratings');
  ratingsEl.innerHTML = '';
  if (stats) {
    const modes = [
      { key: 'chess_bullet', label: '🔴 Bullet' },
      { key: 'chess_blitz',  label: '⚡ Blitz'  },
      { key: 'chess_rapid',  label: '🕐 Rapid'  },
      { key: 'chess_daily',  label: '📅 Daily'  },
    ];
    modes.forEach(({ key, label }) => {
      if (stats[key]?.last?.rating) {
        const pill = document.createElement('span');
        pill.className = 'db-rating-pill';
        pill.textContent = `${label} ${stats[key].last.rating}`;
        ratingsEl.appendChild(pill);
      }
    });
  }
}

async function fetchGames() {
  if (!dbUsername) return;
  const year    = document.getElementById('db-year').value;
  const month   = document.getElementById('db-month').value;
  const color   = document.getElementById('db-color').value;
  const result  = document.getElementById('db-result').value;
  const gametype = document.getElementById('db-gametype').value;

  const listEl = document.getElementById('db-games-list');
  listEl.innerHTML = '<div class="db-loading"><div class="spinner"></div>Loading games…</div>';
  document.getElementById('db-stats-bar').style.display = 'none';
  document.getElementById('db-list-header').style.display = 'none';

  try {
    const res = await fetch(`${CORS_PROXY}/player/${dbUsername}/games/${year}/${month}`);
    if (!res.ok) throw new Error('No games found for that month');
    const data = await res.json();
    dbGames = data.games || [];

    // Filter
    let filtered = dbGames;
    const uname = dbUsername.toLowerCase();

    if (color) {
      filtered = filtered.filter(g => g[color]?.username?.toLowerCase() === uname);
    }
    if (result) {
      filtered = filtered.filter(g => {
        const isWhite = g.white?.username?.toLowerCase() === uname;
        const myResult = isWhite ? g.white?.result : g.black?.result;
        if (result === 'win')  return myResult === 'win';
        if (result === 'loss') return ['resigned','checkmated','timeout','abandoned','threecheck','bughousepartnerlose'].includes(myResult);
        if (result === 'draw') return ['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient','drawaccepted'].includes(myResult);
        return true;
      });
    }
    if (gametype) {
      filtered = filtered.filter(g => g.time_class === gametype);
    }

    renderGamesList(filtered, uname);
  } catch(e) {
    listEl.innerHTML = `<div class="db-empty">❌ ${e.message}</div>`;
  }
}

function renderGamesList(games, uname) {
  const listEl  = document.getElementById('db-games-list');
  const header  = document.getElementById('db-list-header');
  const statsBar = document.getElementById('db-stats-bar');
  listEl.innerHTML = '';

  if (!games.length) {
    listEl.innerHTML = '<div class="db-empty">No games found with these filters.</div>';
    return;
  }

  // Sort newest first
  const sorted = [...games].sort((a,b) => b.end_time - a.end_time);

  // Count results
  let wins=0, losses=0, draws=0;
  sorted.forEach(g => {
    const isWhite = g.white?.username?.toLowerCase() === uname;
    const r = isWhite ? g.white?.result : g.black?.result;
    if (r==='win') wins++;
    else if (['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient','drawaccepted'].includes(r)) draws++;
    else losses++;
  });
  const total = sorted.length;

  // Stats bar
  document.getElementById('stat-wins').textContent = wins;
  document.getElementById('stat-losses').textContent = losses;
  document.getElementById('stat-draws').textContent = draws;
  document.getElementById('bar-win').style.width  = (wins/total*100)+'%';
  document.getElementById('bar-draw').style.width = (draws/total*100)+'%';
  document.getElementById('bar-loss').style.width = (losses/total*100)+'%';
  statsBar.style.display = 'flex';

  header.style.display = '';
  document.getElementById('db-list-count').textContent = `${total} games — ${MONTHS[parseInt(document.getElementById('db-month').value)-1]} ${document.getElementById('db-year').value}`;

  sorted.forEach(g => {
    const isWhite = g.white?.username?.toLowerCase() === uname;
    const mySide  = isWhite ? 'white' : 'black';
    const opp     = isWhite ? g.black : g.white;
    const myRes   = g[mySide]?.result;

    let resultClass, resultChar;
    if (myRes === 'win') { resultClass = 'result-win'; resultChar = 'W'; }
    else if (['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient','drawaccepted'].includes(myRes))
      { resultClass = 'result-draw'; resultChar = 'D'; }
    else { resultClass = 'result-loss'; resultChar = 'L'; }

    const date  = new Date(g.end_time * 1000);
    const dateFmt = date.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const oppRating = opp?.rating ? ` (${opp.rating})` : '';
    const timeControl = g.time_control ? ` · ${formatTimeControl(g.time_control)}` : '';
    const gameType = g.time_class ? ` · ${capitalize(g.time_class)}` : '';

    const row = document.createElement('div');
    row.className = 'game-row';
    row.innerHTML = `
      <div class="game-result-badge ${resultClass}">${resultChar}</div>
      <span class="game-color-icon">${isWhite ? '⬜' : '⬛'}</span>
      <div class="game-info">
        <div class="game-opponent">vs ${opp?.username || 'Unknown'}${oppRating}</div>
        <div class="game-meta">${dateFmt}${gameType}${timeControl}</div>
      </div>
      <button class="game-analyze-btn" onclick="loadDbGame(event, ${sorted.indexOf(g)})">Analyze ▶</button>
    `;
    listEl.appendChild(row);
  });

  // Store sorted for later use
  dbGames = sorted;
}

function formatTimeControl(tc) {
  if (!tc) return '';
  const parts = tc.split('+');
  const base = parseInt(parts[0]);
  const inc  = parts[1] ? '+' + parts[1] : '';
  const mins = Math.floor(base/60);
  return mins + (base%60 ? ':'+String(base%60).padStart(2,'0') : '') + inc + '';
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function loadDbGame(e, idx) {
  e.stopPropagation();
  const game = dbGames[idx];
  if (!game || !game.pgn) { showToast('❌ PGN not available for this game'); return; }

  const tmp = new Chess();
  if (!tmp.load_pgn(game.pgn)) { showToast('❌ Failed to parse game PGN'); return; }

  chess = tmp;

  // Build state snapshots dan moveHistory
  const hist2 = chess.history({ verbose: true });
  const tmpC2 = new Chess();
  gameStates = [tmpC2.fen()];
  moveHistory = [];  // Reset moveHistory
  
  hist2.forEach(m => { 
    tmpC2.move(m); 
    gameStates.push(tmpC2.fen());
    moveHistory.push(m);  // Simpan setiap langkah
  });
  
  histIdx = gameStates.length - 1;

  // Reset review annotations
  reviewAnnotations = {};  // ADD THIS LINE
  document.getElementById('review-summary').style.display = 'none';
  document.getElementById('review-progress').style.display = 'none';
  isReviewing = false;
  const reviewBtn = document.getElementById('review-btn');
  if (reviewBtn) {
    reviewBtn.disabled = false;
    reviewBtn.textContent = '🔍 Review Game';
  }

  // MODIFIED: Update position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++;

  // Switch to analysis tab
  switchTab('analysis');
  renderBoard();
  updateMoves();
  updateInfo();
  scheduleAnalysis();
  showToast(`✓ Loaded game vs ${(game.white?.username?.toLowerCase()===dbUsername.toLowerCase() ? game.black : game.white)?.username || '?'}`);
}

// ========== GAME REVIEW ==========

let isReviewing       = false;
let reviewAnnotations = {}; // index → { classification, cpLoss, bestMove, cpLossVal }

const ANNOTATIONS = {
  brilliant:  { label: '!!', desc: 'Brilliant Move',  weight: 10 },
  great:      { label: '!',  desc: 'Great Move',       weight: 9  },
  best:       { label: '✓',  desc: 'Best Move',        weight: 8  },
  excellent:  { label: '⊙',  desc: 'Excellent Move',   weight: 7  },
  good:       { label: '·',  desc: 'Good Move',        weight: 6  },
  inaccuracy: { label: '?!', desc: 'Inaccuracy',       weight: 3  },
  mistake:    { label: '?',  desc: 'Mistake',          weight: 2  },
  blunder:    { label: '??', desc: 'Blunder',          weight: 1  },
  book:       { label: '📖', desc: 'Book Move',        weight: 7  },
};

// Accuracy score per classification
const ANN_ACCURACY = {
  brilliant: 100, great: 100, best: 100, excellent: 97,
  good: 88, inaccuracy: 65, mistake: 35, blunder: 5, book: 95,
};

// Win Probability using sigmoid with Elo scaling factor 400
function winProbability(cp, forColor = 'w') {
  // cp adalah evaluasi dari perspektif Putih
  const evalForPlayer = (forColor === 'w') ? cp : -cp;
  if (evalForPlayer > 2000) return 1.0;
  if (evalForPlayer < -2000) return 0.0;
  return 1 / (1 + Math.pow(10, -evalForPlayer / 400));
}

async function reviewGame() {
  if (isReviewing) return;
  if (gameStates.length < 2) { showToast('No moves to review!'); return; }

  isReviewing = true;
  reviewAnnotations = {};

  clearTimeout(analysisTmr);
  sfWorker && sfWorker.postMessage('stop');

  const reviewBtn = document.getElementById('review-btn');
  const progressEl = document.getElementById('review-progress');
  const barEl = document.getElementById('review-progress-bar');
  const textEl = document.getElementById('review-progress-text');
  const summaryEl = document.getElementById('review-summary');

  reviewBtn.disabled = true;
  reviewBtn.textContent = '⏳ Analyzing…';
  progressEl.style.display = '';
  summaryEl.style.display = 'none';

  const positions = gameStates;
  const evals = [];
  const bestMovesUCI = [];
  const history = buildHistoryFromStates();

  // --- Pass 1: Analisis semua posisi dengan depth bervariasi ---
  for (let i = 0; i < positions.length; i++) {
    const pct = Math.round((i / positions.length) * 100);
    barEl.style.width = pct + '%';
    textEl.textContent = `Analyzing position ${i + 1} / ${positions.length}…`;

    let depth;
    if (i < 10) depth = 22;
    else if (i < 30) depth = 20;
    else depth = 18;

    const result = await analyzeForReview(positions[i], depth);
    evals.push(result.whiteEval);
    bestMovesUCI.push(result.bestMove);
  }

  // --- Pass 2: Analisis lebih dalam untuk posisi setelah sacrifice ---
  for (let i = 1; i < positions.length; i++) {
    const prevMove = history[i - 1];
    if (prevMove && detectSacrifice(prevMove, positions[i - 1])) {
      textEl.textContent = `Deep analysis for move ${i} (sacrifice)…`;
      const deeperResult = await analyzeForReview(positions[i], 24);
      evals[i] = deeperResult.whiteEval;
      bestMovesUCI[i] = deeperResult.bestMove;
    }
  }

  // --- Klasifikasi ---
  barEl.style.width = '100%';
  textEl.textContent = 'Classifying moves…';

  const whiteCounts = {};
  const blackCounts = {};
  Object.keys(ANNOTATIONS).forEach(k => { whiteCounts[k] = 0; blackCounts[k] = 0; });

  history.forEach((move, i) => {
    const color = move.color;
    const evBefore = evals[i];
    const evAfter = evals[i + 1];

    const wpBefore = winProbability(evBefore, color);
    const wpAfter  = winProbability(evAfter, color);
    const lossWP = Math.max(0, wpBefore - wpAfter);

    const uciBest = bestMovesUCI[i] || '';
    const uciActual = move.from + move.to + (move.promotion || '');
    const isBest = uciBest.startsWith(uciActual) || uciActual.startsWith(uciBest.slice(0, 4));

    const isForced = (new Chess(positions[i])).moves().length === 1;
    const fullMove = Math.ceil((i + 1) / 2);
    const cpLoss = Math.abs(evBefore - evAfter);
    const isBook = fullMove <= 8 && cpLoss < 20 && !isForced;
    const isSacrifice = detectSacrifice(move, positions[i]);

    let classification;

    if (isBook) {
      classification = 'book';
    } else if (isSacrifice && isBest && lossWP <= 0.02 && wpAfter >= 0.6) {
      classification = 'brilliant';
    } else if (isForced && lossWP <= 0.01 && Math.abs(evBefore) > 200) {
      classification = 'great';
    } else if (lossWP >= 0.25) {
      classification = 'blunder';
    } else if (lossWP >= 0.12) {
      classification = 'mistake';
    } else if (lossWP >= 0.06) {
      classification = 'inaccuracy';
    } else if (isBest) {
      if (lossWP <= 0.01 && Math.abs(evBefore) > 200) {
        classification = 'great';
      } else {
        classification = 'best';
      }
    } else if (lossWP <= 0.02) {
      classification = 'excellent';
    } else {
      classification = 'good';
    }

    reviewAnnotations[i] = { classification, cpLoss, bestMove: uciBest };

    if (color === 'w') whiteCounts[classification] = (whiteCounts[classification] || 0) + 1;
    else               blackCounts[classification] = (blackCounts[classification] || 0) + 1;
  });

  isReviewing = false;
  reviewBtn.disabled = false;
  reviewBtn.textContent = '🔍 Review Game';
  progressEl.style.display = 'none';

  updateMoves();
  showReviewSummary(whiteCounts, blackCounts);
  renderBoard();
  scheduleAnalysis();
}

function isForcedMove(fen) {
  const temp = new Chess(fen);
  return temp.moves().length === 1;
}

// Analyze a single position; returns { whiteEval, bestMove }
function analyzeForReview(fen, depth) {
  return new Promise((resolve) => {
    if (!sfWorker) {
      resolve({ whiteEval: 0, bestMove: '' });
      return;
    }

    const cached = getCachedAnalysis(fen, depth);
    if (cached) {
      resolve(cached);
      return;
    }

    const savedHandler = sfWorker.onmessage;
    let latestScore = 0;
    let latestMate = null;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sfWorker.onmessage = savedHandler;
        resolve({ whiteEval: 0, bestMove: '' });
      }
    }, 30000);

    sfWorker.onmessage = function (e) {
      if (resolved) return;
      const line = e.data || '';

      if (line.startsWith('info') && line.includes(' pv ')) {
        const tok = line.split(' ');
        const mpvi = tok.indexOf('multipv');
        if (mpvi !== -1 && tok[mpvi + 1] !== '1') return;

        const si = tok.indexOf('score');
        if (si !== -1) {
          if (tok[si + 1] === 'cp') latestScore = parseInt(tok[si + 2]);
          if (tok[si + 1] === 'mate') {
            latestMate = parseInt(tok[si + 2]);
            latestScore = latestMate > 0 ? 30000 : -30000;
          }
        }
      }

      if (line.startsWith('bestmove')) {
        clearTimeout(timeout);
        resolved = true;
        sfWorker.onmessage = savedHandler;
        const bestMove = line.split(' ')[1] || '';
        const tmp = new Chess(fen);
        const turn = tmp.turn();
        const whiteEval = (turn === 'w') ? latestScore : -latestScore;
        const result = { whiteEval, bestMove };
        setCachedAnalysis(fen, depth, result);
        resolve(result);
      }
    };

    sfWorker.postMessage('stop');
    sfWorker.postMessage('setoption name MultiPV value 1');
    sfWorker.postMessage(`position fen ${fen}`);
    sfWorker.postMessage(`go depth ${depth}`);
  });
}

// ── Rebuild verbose move history from gameStates ──
function buildHistoryFromStates() {
  // Jika moveHistory sudah tersedia dan lengkap, gunakan itu
  if (moveHistory.length === gameStates.length - 1) {
    return moveHistory.map(m => ({ ...m, color: m.color }));
  }
  
  // Fallback ke metode lama jika moveHistory tidak lengkap
  const moves = [];
  for (let i = 0; i < gameStates.length - 1; i++) {
    const before  = new Chess(gameStates[i]);
    const color   = before.turn();
    const legal   = before.moves({ verbose: true });
    const target4 = gameStates[i + 1].split(' ').slice(0, 4).join(' ');

    for (const m of legal) {
      const test = new Chess(gameStates[i]);
      test.move(m);
      if (test.fen().split(' ').slice(0, 4).join(' ') === target4) {
        moves.push({ ...m, color });
        break;
      }
    }
  }
  return moves;
}

function detectSacrifice(move, fen) {
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  try {
    const tmp = new Chess(fen);
    const piece = tmp.get(move.from);
    if (!piece) return false;
    const result = tmp.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    if (!result) return false;

    // Apakah square tujuan diserang lawan?
    const opponentMoves = tmp.moves({ verbose: true });
    const attackers = opponentMoves.filter(m => m.to === move.to);
    if (attackers.length === 0) return false; // tidak diserang → bukan sacrifice

    const pieceValue = VALUES[piece.type] || 0;
    const capturedValue = VALUES[result.captured] || 0;

    // Syarat: nilai piece yang dikorbankan > nilai yang ditangkap + 1
    return pieceValue > capturedValue + 1;
  } catch {
    return false;
  }
}

// ── Show review summary in the panel ──
function showReviewSummary(whiteCounts, blackCounts) {
  const el = document.getElementById('review-summary');
  el.style.display = '';

  const rows = [
    { key: 'brilliant',  emoji: '!!',  label: 'Brilliant' },
    { key: 'great',      emoji: '!',   label: 'Great'     },
    { key: 'best',       emoji: '✓',   label: 'Best'      },
    { key: 'excellent',  emoji: '⊙',   label: 'Excellent' },
    { key: 'good',       emoji: '·',   label: 'Good'      },
    { key: 'inaccuracy', emoji: '?!',  label: 'Inaccuracy'},
    { key: 'mistake',    emoji: '?',   label: 'Mistake'   },
    { key: 'blunder',    emoji: '??',  label: 'Blunder'   },
    { key: 'book',       emoji: '📖', label: 'Book'      },
  ];

  const calcAccuracy = (counts) => {
    let total = 0, weightedSum = 0;
    Object.entries(counts).forEach(([k, v]) => {
      if (!v || k === 'book') return;
      total        += v;
      weightedSum  += v * (ANN_ACCURACY[k] || 50);
    });
    return total > 0 ? Math.round(weightedSum / total) : 100;
  };

  const wAcc = calcAccuracy(whiteCounts);
  const bAcc = calcAccuracy(blackCounts);
  const accClass = acc => acc >= 85 ? 'high' : acc >= 65 ? 'mid' : 'low';

  const colHtml = (counts) => rows
    .filter(r => counts[r.key] > 0)
    .map(r => `
      <div class="review-ann-row">
        <span class="ann-badge ${r.key}">${r.emoji}</span>
        <span class="review-ann-label">${r.label}</span>
        <span class="review-ann-count ${r.key}">${counts[r.key]}</span>
      </div>`)
    .join('');

  el.innerHTML = `
    <div class="review-summary-wrap">
      <div class="review-summary-title">📊 Game Review</div>
      <div class="review-players-row">
        <div class="review-player-col">
          <div class="review-player-label">⬜ White</div>
          ${colHtml(whiteCounts)}
          <div class="review-accuracy" style="margin-top:8px">
            <div class="review-accuracy-val ${accClass(wAcc)}">${wAcc}%</div>
            <div class="review-accuracy-label">Accuracy</div>
          </div>
        </div>
        <div class="review-player-col">
          <div class="review-player-label">⬛ Black</div>
          ${colHtml(blackCounts)}
          <div class="review-accuracy" style="margin-top:8px">
            <div class="review-accuracy-val ${accClass(bAcc)}">${bAcc}%</div>
            <div class="review-accuracy-label">Accuracy</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ========== UTILITIES ==========
function copyFEN() { navigator.clipboard.writeText(chess.fen()).then(() => showToast('FEN copied!')); }
function copyPGN() { navigator.clipboard.writeText(chess.pgn()).then(() => showToast('PGN copied!')); }

function showToast(msg, dur=2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), dur);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(e, id) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById(id).classList.remove('open');
}

function importPGN() {
  const pgn = document.getElementById('pgn-input').value.trim();
  if (!pgn) return;
  const tmp = new Chess();
  if (!tmp.load_pgn(pgn)) { showToast('❌ Invalid PGN'); return; }
  chess = tmp;
  
  // Build history dari PGN
  const hist = chess.history({ verbose: true });
  const tmp2 = new Chess();
  gameStates = [tmp2.fen()];
  moveHistory = [];  // Reset moveHistory
  
  hist.forEach(m => { 
    tmp2.move(m); 
    gameStates.push(tmp2.fen());
    moveHistory.push(m);  // Simpan setiap langkah
  });
  
  histIdx = gameStates.length - 1;
  reviewAnnotations = {};  // ADD THIS LINE
  document.getElementById('review-summary').style.display = 'none';
  
  // MODIFIED: Update position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++;
  
  closeModal(null, 'import-modal');
  renderBoard(); 
  updateMoves(); 
  updateInfo(); 
  scheduleAnalysis();
  showToast('✓ PGN loaded');
}

function loadFEN() {
  const fen = document.getElementById('fen-input').value.trim();
  const tmp = new Chess();
  if (!tmp.load(fen)) { showToast('❌ Invalid FEN'); return; }
  chess = tmp;
  gameStates = [fen]; 
  moveHistory = [];  // Reset moveHistory
  histIdx = 0;

  reviewAnnotations = {};  // ADD THIS LINE
  document.getElementById('review-summary').style.display = 'none';
  document.getElementById('review-progress').style.display = 'none';
  isReviewing = false;
  const reviewBtn = document.getElementById('review-btn');
  if (reviewBtn) {
    reviewBtn.disabled = false;
    reviewBtn.textContent = '🔍 Review Game';
  }
  
  // MODIFIED: Update position tracking
  currentPositionFen = chess.fen();
  currentTurn = chess.turn();
  lastAnalysisId++;
  
  closeModal(null, 'fen-modal');
  renderBoard(); 
  updateMoves(); 
  updateInfo(); 
  scheduleAnalysis();
  showToast('✓ Position loaded');
}

function clearAnnotationSymbols() {
  document.querySelectorAll('.annotation-symbol').forEach(el => el.remove());
}

function setFenExample(fen) { document.getElementById('fen-input').value = fen; }

// ========== KEYBOARD ==========
function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft')  goBack();
  if (e.key === 'ArrowRight') goForward();
  if (e.key === 'ArrowUp')    goToEnd();
  if (e.key === 'ArrowDown')  goToStart();
  if (e.key === 'f' || e.key === 'F') flipBoard();
}

// ========== BOARD EDITOR MODE ==========
let editModeActive = false;
let selectedPieceForPlacement = null;
let originalNavActiveClass = '';

// Simpan fungsi onSqDown asli
const originalOnSqDown = window.onSqDown;

function initPiecePalette() {
  const whiteContainer = document.getElementById('white-pieces');
  const blackContainer = document.getElementById('black-pieces');
  
  if (!whiteContainer || !blackContainer) return;
  
  whiteContainer.innerHTML = '';
  blackContainer.innerHTML = '';
  
  PIECE_LIST.forEach(piece => {
    const pieceEl = document.createElement('div');
    pieceEl.className = 'palette-piece';
    pieceEl.setAttribute('data-piece', piece.code);
    pieceEl.setAttribute('data-color', piece.color);
    pieceEl.setAttribute('data-type', piece.type);
    pieceEl.setAttribute('title', `${piece.color} ${piece.type}`);
    pieceEl.onclick = () => selectPiece(piece.code);
    pieceEl.textContent = getPieceSymbol(piece.code);
    
    if (piece.color === 'white') {
      whiteContainer.appendChild(pieceEl);
    } else {
      blackContainer.appendChild(pieceEl);
    }
  });
}

function toggleEditMode() {
  editModeActive = !editModeActive;
  const palette = document.getElementById('piece-palette');
  const boardWrap = document.getElementById('board-wrap');
  const editBtn = document.getElementById('nav-edit');
  
  if (editModeActive) {
    // Masuk edit mode
    originalNavActiveClass = document.querySelector('.nav-btn.active')?.id || 'nav-analysis';
    
    // Nonaktifkan engine sementara
    if (window.engineActive) {
      toggleEngine(); // Matikan engine
    }
    
    // Inisialisasi palette jika belum
    if (!palette.querySelector('.palette-piece')) {
      initPiecePalette();
    }
    
    // Reset posisi palette ke tengah
    resetPalettePosition();
    
    // Tampilkan palette
    palette.style.display = 'block';
    boardWrap.classList.add('edit-mode');
    editBtn.classList.add('active');
    
    // Update status
    selectedPieceForPlacement = null;
    document.querySelectorAll('.palette-piece').forEach(el => el.classList.remove('selected'));
    updatePaletteStatus('Select a piece from palette');
    
    // Hapus seleksi yang ada
    clearSqClasses();
    window.selectedSq = null;
    window.legalMoves = [];
    
    // Ubah cursor
    document.body.style.cursor = 'crosshair';
    
    showToast('✎ Edit Mode Active - Right click to delete pieces');
  } else {
    // Keluar edit mode
    palette.style.display = 'none';
    boardWrap.classList.remove('edit-mode');
    editBtn.classList.remove('active');
    
    // Kembalikan engine jika sebelumnya aktif
    if (!window.engineActive) {
      toggleEngine(); // Hidupkan engine kembali
    }
    
    // Reset cursor
    document.body.style.cursor = 'default';
    selectedPieceForPlacement = null;
    
    // Validasi papan sebelum keluar
    if (!validateBoardHasTwoKings()) {
      showToast('⚠️ Board must have both kings!');
      // Tetap di edit mode
      editModeActive = true;
      palette.style.display = 'block';
      boardWrap.classList.add('edit-mode');
      editBtn.classList.add('active');
      return;
    }
    
    showToast('✓ Edit Mode Ended');
  }
}

function resetPalettePosition() {
  const palette = document.getElementById('piece-palette');
  if (!palette) return;
  
  // Reset ke tengah layar
  palette.style.left = '50%';
  palette.style.top = '50%';
  palette.style.transform = 'translate(-50%, -50%)';
  palette.style.width = '380px';
  palette.style.height = 'auto';
}

function toggleMinimizePalette() {
  const palette = document.getElementById('piece-palette');
  isPaletteMinimized = !isPaletteMinimized;
  
  if (isPaletteMinimized) {
    palette.classList.add('minimized');
  } else {
    palette.classList.remove('minimized');
  }
}

// Drag functionality
function makePaletteDraggable() {
  const palette = document.getElementById('piece-palette');
  const header = document.getElementById('palette-header');
  
  if (!palette || !header) return;
  
  header.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  
  // Resize functionality
  palette.addEventListener('mousedown', function(e) {
    const rect = palette.getBoundingClientRect();
    const isAtBottomRight = e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;
    
    if (isAtBottomRight) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseInt(window.getComputedStyle(palette).width, 10);
      startHeight = parseInt(window.getComputedStyle(palette).height, 10);
      
      palette.classList.add('resizing');
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

function startDrag(e) {
  if (e.target.closest('.palette-header-controls')) return;
  if (isResizing) return;
  
  const palette = document.getElementById('piece-palette');
  if (!palette) return;
  
  isDragging = true;
  
  // Hitung offset dari kiri atas palette ke posisi mouse
  const rect = palette.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  
  palette.classList.add('dragging');
  palette.style.transform = 'none'; // Hapus transform translate
  
  e.preventDefault();
}

function onDrag(e) {
  if (isResizing) {
    // Handle resize
    const palette = document.getElementById('piece-palette');
    if (!palette) return;
    
    const newWidth = Math.max(320, startWidth + (e.clientX - startX));
    const newHeight = Math.max(400, startHeight + (e.clientY - startY));
    
    palette.style.width = newWidth + 'px';
    palette.style.height = newHeight + 'px';
    
    e.preventDefault();
  } else if (isDragging) {
    // Handle drag
    const palette = document.getElementById('piece-palette');
    if (!palette) return;
    
    const newLeft = e.clientX - dragOffsetX;
    const newTop = e.clientY - dragOffsetY;
    
    // Batasi agar tidak keluar layar
    const maxLeft = window.innerWidth - palette.offsetWidth;
    const maxTop = window.innerHeight - palette.offsetHeight;
    
    palette.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
    palette.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
    palette.style.transform = 'none';
    
    e.preventDefault();
  }
}

function stopDrag() {
  const palette = document.getElementById('piece-palette');
  if (!palette) return;
  
  if (isDragging) {
    isDragging = false;
    palette.classList.remove('dragging');
  }
  
  if (isResizing) {
    isResizing = false;
    palette.classList.remove('resizing');
  }
}

function selectPiece(pieceCode) {
  selectedPieceForPlacement = pieceCode;
  
  // Highlight piece yang dipilih di palette
  document.querySelectorAll('.palette-piece').forEach(el => {
    el.classList.remove('selected');
  });
  
  const selectedEl = document.querySelector(`.palette-piece[data-piece="${pieceCode}"]`);
  if (selectedEl) {
    selectedEl.classList.add('selected');
  }
  
  const pieceNames = {
    'wK': 'White King', 'wQ': 'White Queen', 'wR': 'White Rook', 'wB': 'White Bishop', 'wN': 'White Knight', 'wP': 'White Pawn',
    'bK': 'Black King', 'bQ': 'Black Queen', 'bR': 'Black Rook', 'bB': 'Black Bishop', 'bN': 'Black Knight', 'bP': 'Black Pawn'
  };
  
  updatePaletteStatus(`Selected: ${pieceNames[pieceCode] || pieceCode} - Click on empty square`);
}

function getPieceSymbol(pieceCode) {
  const symbols = {
    'wK': '♔', 'wQ': '♕', 'wR': '♖', 'wB': '♗', 'wN': '♘', 'wP': '♙',
    'bK': '♚', 'bQ': '♛', 'bR': '♜', 'bB': '♝', 'bN': '♞', 'bP': '♟'
  };
  return symbols[pieceCode] || pieceCode;
}

function updatePaletteStatus(msg) {
  const statusEl = document.getElementById('palette-status');
  if (statusEl) {
    statusEl.textContent = msg;
  }
}

// Handler untuk square clicks dalam edit mode
window.onSqDown = function(e) {
  if (editModeActive) {
    e.preventDefault();
    e.stopPropagation();
    
    const sqEl = e.currentTarget.closest('.square');
    if (!sqEl) return;
    
    const sq = sqEl.dataset.sq;
    
    // Klik kanan - hapus piece
    if (e.button === 2) {
      e.preventDefault();
      deletePieceAt(sq);
      return;
    }
    
    // Klik kiri - tempatkan piece jika ada yang dipilih
    if (selectedPieceForPlacement) {
      placePiece(sq, selectedPieceForPlacement);
    } else {
      // Jika tidak ada piece dipilih, pilih piece yang ada (jika ada)
      const piece = chess.get(sq);
      if (piece) {
        // Preview piece info
        const pieceColor = piece.color === 'w' ? 'White' : 'Black';
        const pieceType = piece.type === 'k' ? 'King' : 
                         piece.type === 'q' ? 'Queen' :
                         piece.type === 'r' ? 'Rook' :
                         piece.type === 'b' ? 'Bishop' :
                         piece.type === 'n' ? 'Knight' : 'Pawn';
        updatePaletteStatus(`Selected: ${pieceColor} ${pieceType} - Click palette or right click to delete`);
      } else {
        updatePaletteStatus('Select a piece from palette first');
      }
    }
  } else {
    // Mode normal - panggil fungsi asli
    if (originalOnSqDown) {
      originalOnSqDown.call(this, e);
    }
  }
};

function deletePieceAt(sq) {
  const piece = chess.get(sq);
  if (!piece) {
    showToast('No piece to delete');
    return;
  }
  
  // Hapus piece dengan membuat FEN baru
  const fenParts = chess.fen().split(' ');
  let boardFen = fenParts[0];
  
  // Konversi FEN board ke array
  const rows = boardFen.split('/');
  const rankIndex = 8 - parseInt(sq[1]); // 0 = rank 8, 7 = rank 1
  const fileIndex = sq.charCodeAt(0) - 'a'.charCodeAt(0); // 0 = a, 7 = h
  
  if (rankIndex >= 0 && rankIndex < 8 && fileIndex >= 0 && fileIndex < 8) {
    let row = rows[rankIndex];
    let newRow = '';
    let emptyCount = 0;
    
    // Parse row
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (isNaN(parseInt(c))) {
        // Ini piece
        if (emptyCount > 0) {
          newRow += emptyCount;
          emptyCount = 0;
        }
        // Skip piece yang akan dihapus
        if (i === fileIndex) {
          emptyCount++; // Ganti piece dengan 1 empty square
        } else {
          newRow += c;
        }
      } else {
        // Ini angka (empty squares)
        emptyCount += parseInt(c);
      }
    }
    
    if (emptyCount > 0) {
      newRow += emptyCount;
    }
    
    rows[rankIndex] = newRow;
    const newBoardFen = rows.join('/');
    
    // Buat FEN baru
    const newFen = [newBoardFen, ...fenParts.slice(1)].join(' ');
    
    // Update chess instance
    try {
      chess.load(newFen);
      updateBoardAfterEdit();
      showToast(`Piece deleted at ${sq}`);
    } catch (err) {
      showToast('❌ Invalid position after deletion');
    }
  }
}

function placePiece(sq, pieceCode) {
  if (!sq || !pieceCode) return;
  
  // Parse pieceCode (format: wK, bQ, dll)
  const color = pieceCode[0] === 'w' ? 'w' : 'b';
  const type = pieceCode[1].toLowerCase();
  
  // Validasi piece type
  if (!['k','q','r','b','n','p'].includes(type)) {
    showToast('❌ Invalid piece type');
    return;
  }
  
  // Buat FEN baru
  const fenParts = chess.fen().split(' ');
  let boardFen = fenParts[0];
  
  // Konversi FEN board ke array
  const rows = boardFen.split('/');
  const rankIndex = 8 - parseInt(sq[1]);
  const fileIndex = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  
  if (rankIndex >= 0 && rankIndex < 8 && fileIndex >= 0 && fileIndex < 8) {
    // Buat representasi baris baru
    let rowPieces = [];
    let currentCol = 0;
    
    // Parse row yang ada
    for (let i = 0; i < rows[rankIndex].length; i++) {
      const c = rows[rankIndex][i];
      if (isNaN(parseInt(c))) {
        // Piece
        rowPieces.push(c);
        currentCol++;
      } else {
        // Empty squares
        const emptyCount = parseInt(c);
        for (let j = 0; j < emptyCount; j++) {
          rowPieces.push(null);
          currentCol++;
        }
      }
    }
    
    // Tempatkan piece baru
    if (fileIndex >= 0 && fileIndex < 8) {
      const pieceChar = color === 'w' ? type.toUpperCase() : type;
      rowPieces[fileIndex] = pieceChar;
    }
    
    // Konversi kembali ke format FEN
    let newRow = '';
    let emptyCount = 0;
    
    for (let i = 0; i < rowPieces.length; i++) {
      if (rowPieces[i] === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          newRow += emptyCount;
          emptyCount = 0;
        }
        newRow += rowPieces[i];
      }
    }
    if (emptyCount > 0) {
      newRow += emptyCount;
    }
    
    rows[rankIndex] = newRow;
    const newBoardFen = rows.join('/');
    
    // Buat FEN baru, pertahankan turn, castling, dll
    const newFen = [newBoardFen, fenParts[1], fenParts[2], fenParts[3], fenParts[4], fenParts[5]].join(' ');
    
    try {
      chess.load(newFen);
      updateBoardAfterEdit();
      showToast(`Placed ${pieceCode} at ${sq}`);
    } catch (err) {
      showToast('❌ Invalid position after placement');
      console.error(err);
    }
  }
}

function clearBoard() {
  // Buat board kosong (8 baris, masing-masing 8 empty squares)
  const fenParts = chess.fen().split(' ');
  const emptyBoard = '8/8/8/8/8/8/8/8';
  const newFen = [emptyBoard, fenParts[1], fenParts[2], fenParts[3], fenParts[4], fenParts[5]].join(' ');
  
  try {
    chess.load(newFen);
    updateBoardAfterEdit();
    showToast('Board cleared');
  } catch (err) {
    showToast('❌ Failed to clear board');
  }
}

function resetToStart() {
  // Reset ke posisi awal
  chess.reset();
  updateBoardAfterEdit();
  showToast('Reset to starting position');
}

function validateBoardHasTwoKings() {
  const board = chess.board();
  let whiteKing = false;
  let blackKing = false;
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece) {
        if (piece.type === 'k') {
          if (piece.color === 'w') whiteKing = true;
          else blackKing = true;
        }
      }
    }
  }
  
  return whiteKing && blackKing;
}

function updateBoardAfterEdit() {
  // Update semua state
  window.gameStates = [chess.fen()];
  window.moveHistory = [];
  window.histIdx = 0;
  window.reviewAnnotations = {};
  
  // Update position tracking
  window.currentPositionFen = chess.fen();
  window.currentTurn = chess.turn();
  window.lastAnalysisId++;
  
  // Sembunyikan review summary
  const reviewSummary = document.getElementById('review-summary');
  const reviewProgress = document.getElementById('review-progress');
  if (reviewSummary) reviewSummary.style.display = 'none';
  if (reviewProgress) reviewProgress.style.display = 'none';
  window.isReviewing = false;
  
  // Re-render board dan update info
  renderBoard();
  if (typeof updateMoves === 'function') updateMoves();
  if (typeof updateInfo === 'function') updateInfo();
  
  // Reset engine eval
  if (typeof resetEval === 'function') resetEval();
  
  // Jadwalkan analisis ulang jika engine aktif
  if (window.engineActive && window.engineReady) {
    scheduleAnalysis();
  }
}

function doneEditing() {
  if (!validateBoardHasTwoKings()) {
    showToast('❌ Board must have both kings!');
    return;
  }
  
  // Keluar dari edit mode
  if (editModeActive) {
    toggleEditMode();
  }
}

// Override fungsi renderBoard untuk menambahkan class edit-mode
const originalRenderBoard = window.renderBoard;
window.renderBoard = function() {
  if (originalRenderBoard) {
    originalRenderBoard.call(this);
  }
  
  // Tambahkan class edit-mode jika aktif
  const boardWrap = document.getElementById('board-wrap');
  if (boardWrap) {
    if (editModeActive) {
      boardWrap.classList.add('edit-mode');
    } else {
      boardWrap.classList.remove('edit-mode');
    }
  }
};

// Inisialisasi saat DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  // Inisialisasi piece palette
  initPiecePalette();
  
  // Buat palette draggable
  makePaletteDraggable();
  
  // Tambahkan pencegahan context menu saat edit mode
  document.addEventListener('contextmenu', function(e) {
    if (editModeActive) {
      e.preventDefault();
    }
  });
});

// Click outside board → deselect
document.addEventListener('mousedown', e => {
  if (!boardEl.contains(e.target)) {
    clearSqClasses && clearSqClasses();
    selectedSq = null; legalMoves = [];
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }
});