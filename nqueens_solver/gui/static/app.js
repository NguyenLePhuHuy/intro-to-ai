'use strict';
/* N-Queens Lab — giao diện mượt 60fps & tự động hiển thị thành phẩm:
 *  - màu theme được cache (không gọi getComputedStyle trong vòng vẽ)
 *  - nền bàn cờ & quân hậu được vẽ sẵn vào canvas ẩn, mỗi khung hình chỉ drawImage
 *  - phát lại bằng requestAnimationFrame, quân hậu & con trỏ biểu đồ trượt mượt 60fps
 *  - tự động tải và hiển thị bàn cờ thành phẩm (nghiệm cuối) + bảng/biểu đồ thực nghiệm ngay khi mở
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeBack = (t) => { const c1 = 1.35, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const fmt = (v) => Number(v).toLocaleString('vi-VN');
const EASE_CSS = 'cubic-bezier(.22,.8,.25,1)';
const EMPTY_SET = new Set();

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function reveal(el, delay = 0) {
  if (el && el.animate) {
    el.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, delay, easing: EASE_CSS, fill: 'backwards' });
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setStatus(el, html, isErr = false) {
  el.innerHTML = html;
  el.classList.toggle('err', isErr);
}
const SPIN = '<span class="spinner"></span>';

/* =============================================================== THEME */
const THEME_KEYS = ['bg', 'bg-soft', 'card', 'ink', 'muted', 'line', 'accent', 'accent-2', 'blue',
  'red', 'red-soft', 'sq-dark', 'sq-light', 'std', 'heu'];
const T = {};
let themeVersion = 0;

function readTheme() {
  const s = getComputedStyle(document.documentElement);
  THEME_KEYS.forEach((k) => { T[k] = s.getPropertyValue('--' + k).trim(); });
  themeVersion++;
}
readTheme();

function applyTheme(t) {
  const run = () => { document.documentElement.dataset.theme = t; readTheme(); redrawAll(); };
  if (document.startViewTransition) document.startViewTransition(run); else run();
}
$('#theme-btn').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('nq-theme', t);
  applyTheme(t);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('nq-theme')) applyTheme(e.matches ? 'dark' : 'light');
});

/* ========================================================== ANIMATION */
const anims = new Map();
function animate(key, dur, fn, done) {
  cancelAnimationFrame(anims.get(key));
  const t0 = performance.now();
  const step = (now) => {
    const p = clamp((now - t0) / dur, 0, 1);
    fn(p);
    if (p < 1) anims.set(key, requestAnimationFrame(step));
    else { anims.delete(key); if (done) done(); }
  };
  anims.set(key, requestAnimationFrame(step));
}
function stopAnim(key) { cancelAnimationFrame(anims.get(key)); anims.delete(key); }

function countTo(el, target) {
  if (typeof target !== 'number') { stopAnim(el); el._v = undefined; el.textContent = target; return; }
  const from = typeof el._v === 'number' ? el._v : 0;
  el._v = target;
  if (from === target) { el.textContent = fmt(target); return; }
  animate(el, 340, (p) => { el.textContent = fmt(Math.round(from + (target - from) * easeOut(p))); });
}

/* ============================================================== CANVAS */
const ro = new ResizeObserver((entries) => {
  let changed = false;
  for (const e of entries) {
    const c = e.target, r = e.contentRect;
    if (c._w !== r.width || c._h !== r.height) { c._w = r.width; c._h = r.height; changed = true; }
  }
  if (changed) redrawAll();
});
$$('canvas').forEach((c) => ro.observe(c));

function setupCanvas(canvas) {
  let w = canvas._w, h = canvas._h;
  if (!w || !h) {
    const rect = canvas.getBoundingClientRect();
    w = canvas._w = rect.width;
    h = canvas._h = rect.height;
  }
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const g = canvas._g || (canvas._g = canvas.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr };
}

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* ---------------------------------------------------------- bàn cờ */
const boardCache = new Map();
function boardBackground(n, w, dpr, labels) {
  const key = `${n}|${w}|${dpr}|${labels ? 1 : 0}|${themeVersion}`;
  let c = boardCache.get(key);
  if (c) return c;
  if (boardCache.size > 16) boardCache.clear();
  const px = Math.round(w * dpr);
  c = offscreen(px, px);
  const g = c.getContext('2d');
  const E = (i) => Math.round((i * px) / n);
  g.fillStyle = T['sq-light'];
  g.fillRect(0, 0, px, px);
  g.fillStyle = T['sq-dark'];
  for (let r = 0; r < n; r++) {
    for (let col = (r + 1) % 2; col < n; col += 2) g.fillRect(E(col), E(r), E(col + 1) - E(col), E(r + 1) - E(r));
  }
  const s = px / n;
  if (labels && s >= 22 * dpr) {
    g.font = `${Math.max(9 * dpr, s * 0.23)}px "Cascadia Code", ui-monospace, Consolas, monospace`;
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = T.ink; g.globalAlpha = 0.42;
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) g.fillText(String(r * n + col + 1), E(col) + 3 * dpr, E(r) + 2 * dpr);
    g.globalAlpha = 1;
  } else if (!labels && n <= 20 && s >= 18 * dpr) {
    // Đánh số toạ độ hàng/cột nhẹ ở viền trái & trên để dễ dò ô (r, c)
    g.font = `600 ${Math.max(8 * dpr, s * 0.2)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = T.ink; g.globalAlpha = 0.36;
    g.textAlign = 'left'; g.textBaseline = 'top';
    for (let r = 0; r < n; r++) g.fillText(String(r), 3 * dpr, E(r) + 2 * dpr);
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    for (let col = 0; col < n; col++) g.fillText(String(col), E(col + 1) - 3 * dpr, px - 2 * dpr);
    g.globalAlpha = 1;
  }
  boardCache.set(key, c);
  return c;
}

const spriteCache = new Map();
function queenSprite(px, color, haloColor = '') {
  const key = `${px}|${color}|${haloColor}`;
  let c = spriteCache.get(key);
  if (c) return c;
  if (spriteCache.size > 40) spriteCache.clear();
  c = offscreen(px, px);
  const g = c.getContext('2d');
  if (haloColor) {
    g.fillStyle = haloColor;
    g.beginPath();
    g.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2);
    g.fill();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${px * 0.74}px "Segoe UI Symbol", "Apple Symbols", "DejaVu Sans", serif`;
  g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = px * 0.06; g.shadowOffsetY = px * 0.03;
  g.fillStyle = color;
  g.fillText('♛', px / 2, px / 2 + px * 0.035);
  spriteCache.set(key, c);
  return c;
}

function conflictedRows(cols) {
  const n = cols.length, cc = new Int32Array(n), d1 = new Int32Array(2 * n), d2 = new Int32Array(2 * n);
  for (let r = 0; r < n; r++) { const c = cols[r]; cc[c]++; d1[r - c + n - 1]++; d2[r + c]++; }
  const out = new Set();
  for (let r = 0; r < n; r++) { const c = cols[r]; if (cc[c] + d1[r - c + n - 1] + d2[r + c] > 3) out.add(r); }
  return out;
}

/* o: { queens:[[r,c]], lines, lineAlpha, oldLines, oldLineAlpha, labels, bad:Set(rows), move:{row,from,to,t}, queenScale, solved, showAttackLines } */
function drawBoard(canvas, n, o = {}) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const { g, w, dpr } = ctx;
  const s = w / n;
  const px = Math.round(w * dpr);
  const X = (i) => Math.round((i * px) / n) / dpr;

  g.drawImage(boardBackground(n, w, dpr, o.labels && s >= 22), 0, 0, w, w);

  const fillCells = (cells, color, alpha) => {
    if (!cells || alpha <= 0.001) return;
    g.globalAlpha = alpha; g.fillStyle = color;
    for (const [r, c] of cells) g.fillRect(X(c), X(r), X(c + 1) - X(c), X(r + 1) - X(r));
    g.globalAlpha = 1;
  };
  (o.oldLines || []).forEach((l) => fillCells(l, T.blue, o.oldLineAlpha ?? 0));
  (o.lines || []).forEach((l) => fillCells(l, T.blue, o.lineAlpha ?? 1));

  const queens = o.queens || [];
  const bad = o.bad || EMPTY_SET;
  if (bad.size) {
    const cells = [];
    for (const [r, c] of queens) if (bad.has(r) && Number.isInteger(c)) cells.push([r, c]);
    fillCells(cells, T['red-soft'], 1);
  }

  // Vẽ đường nối mảnh giữa các cặp hậu đang tấn công nhau (khi N <= 28) để dễ nhìn xung đột
  if (o.showAttackLines && bad.size && n <= 28) {
    g.save();
    g.strokeStyle = T.red;
    g.globalAlpha = 0.32;
    g.lineWidth = Math.max(1.2, s * 0.045);
    g.setLineDash([s * 0.12, s * 0.1]);
    g.beginPath();
    for (let i = 0; i < queens.length; i++) {
      const [r1, c1] = queens[i];
      if (!bad.has(r1)) continue;
      for (let j = i + 1; j < queens.length; j++) {
        const [r2, c2] = queens[j];
        if (!bad.has(r2)) continue;
        const ic1 = Math.round(c1), ic2 = Math.round(c2);
        if (ic1 === ic2 || Math.abs(r1 - r2) === Math.abs(ic1 - ic2)) {
          g.moveTo(c1 * s + s / 2, r1 * s + s / 2);
          g.lineTo(c2 * s + s / 2, r2 * s + s / 2);
        }
      }
    }
    g.stroke();
    g.restore();
  }

  if (o.move) {
    const { row, from, to, t } = o.move;
    const cy = row * s + s / 2;
    g.save();
    g.strokeStyle = T.accent;
    g.lineWidth = Math.max(1.5, s * 0.07);
    g.setLineDash([s * 0.14, s * 0.1]);
    g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(from * s + s / 2, cy); g.lineTo(to * s + s / 2, cy); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.35 + 0.65 * t;
    g.lineWidth = Math.max(1.5, s * 0.06);
    g.strokeRect(to * s + 1.5, row * s + 1.5, s - 3, s - 3);
    g.globalAlpha = 0.45 * (1 - t) + 0.15;
    g.fillStyle = T.accent;
    g.beginPath(); g.arc(from * s + s / 2, cy, Math.max(1.5, s * 0.13), 0, Math.PI * 2); g.fill();
    g.restore();
  }

  if (!queens.length) return;
  const k = o.queenScale ?? 1;
  const isSolved = Boolean(o.solved && bad.size === 0 && queens.length === n);
  if (s >= 12) {
    const qpx = Math.max(1, Math.round(s * dpr));
    const halo = isSolved ? 'rgba(13, 148, 136, .16)' : '';
    const spOk = queenSprite(qpx, T.ink, halo), spBad = queenSprite(qpx, T.red, '');
    for (let i = 0; i < queens.length; i++) {
      const [r, c] = queens[i];
      // Hiệu ứng xuất hiện lệch nhịp nhẹ cho từng quân hậu khi vừa giải xong
      const delayScale = k < 1 ? clamp((k - (i / queens.length) * 0.25) / 0.75, 0, 1) : 1;
      if (delayScale <= 0.01) continue;
      const d = s * delayScale, off = (s - d) / 2;
      g.drawImage(bad.has(r) ? spBad : spOk, c * s + off, r * s + off, d, d);
    }
  } else {
    const rad = Math.max(0.8, s * 0.38 * k);
    for (const pass of [false, true]) {
      g.fillStyle = pass ? T.red : (isSolved ? T.accent : T.ink);
      g.beginPath();
      for (const [r, c] of queens) {
        if (bad.has(r) !== pass) continue;
        const cx = c * s + s / 2, cy = r * s + s / 2;
        g.moveTo(cx + rad, cy); g.arc(cx, cy, rad, 0, Math.PI * 2);
      }
      g.fill();
    }
  }
}

/* ------------------------------------------------------------ biểu đồ */
const fmtNum = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k'
  : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

function lineChart(canvas, { xs, series, logY = false }, progress = 1) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const { g, w, h } = ctx;
  g.clearRect(0, 0, w, h);
  const L = 56, R = 18, Tp = 32, B = 34, pw = w - L - R, ph = h - Tp - B;
  const all = series.flatMap((s) => s.ys).filter((v) => v > 0);
  if (!all.length || pw <= 0 || ph <= 0) return;
  const minV = Math.min(...all), maxV = Math.max(...all);
  const floor = logY ? Math.min(minV, 1) / 2 : 0;
  const tr = (v) => (logY ? Math.log10(Math.max(v, floor)) : v);
  let lo = logY ? Math.floor(tr(minV)) : 0;
  let hi = tr(Math.max(maxV, 1e-9));
  if (logY) hi = Math.ceil(hi); else hi *= 1.08;
  if (hi === lo) hi = lo + 1;
  const X = (i) => L + (xs.length === 1 ? pw / 2 : (i / (xs.length - 1)) * pw);
  const Y = (v) => Tp + ph - ((tr(v) - lo) / (hi - lo)) * ph;

  g.font = '11px "Segoe UI", system-ui, sans-serif';
  g.fillStyle = T.muted; g.strokeStyle = T.line; g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  const ticks = logY ? Array.from({ length: hi - lo + 1 }, (_, i) => Math.pow(10, lo + i)) : [0, 1, 2, 3, 4].map((i) => (hi / 4) * i);
  ticks.forEach((v) => {
    const y = Math.round(logY ? Y(v) : Tp + ph - (v / hi) * ph) + 0.5;
    g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillText(fmtNum(v), L - 8, y);
  });
  g.textAlign = 'center'; g.textBaseline = 'top';
  xs.forEach((x, i) => g.fillText(String(x), X(i), h - B + 10));

  g.save();
  g.beginPath(); g.rect(0, 0, L + pw * progress + 6, h); g.clip();
  series.forEach((s) => {
    g.strokeStyle = s.color; g.fillStyle = s.color;
    g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    s.ys.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.stroke();
    g.globalAlpha = 0.08;
    g.lineTo(X(s.ys.length - 1), Tp + ph); g.lineTo(X(0), Tp + ph); g.closePath(); g.fill();
    g.globalAlpha = 1;
    s.ys.forEach((v, i) => {
      g.fillStyle = s.color; g.beginPath(); g.arc(X(i), Y(v), 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = T.card; g.beginPath(); g.arc(X(i), Y(v), 1.8, 0, Math.PI * 2); g.fill();
    });
  });
  g.restore();

  let lx = L;
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '12px "Segoe UI", system-ui, sans-serif';
  series.forEach((s) => {
    g.fillStyle = s.color; g.fillRect(lx, 11, 16, 3);
    g.fillStyle = T.ink; g.fillText(s.name, lx + 22, 12);
    lx += 36 + g.measureText(s.name).width;
  });
}

/* Biểu đồ tổng xung đột: đường cong cache sẵn, con trỏ nội suy mượt 60fps. */
function conflictChart(canvas, rp, color, fpos) {
  const ctx = setupCanvas(canvas);
  if (!ctx) return;
  const { g, w, h, dpr } = ctx;
  const n = rp.totals.length, max = Math.max(rp.maxTotal, 1);
  const X = (i) => 4 + (n === 1 ? 0 : (i / (n - 1)) * (w - 8));
  const Y = (v) => 22 + (1 - v / max) * (h - 30);
  const key = `${w}|${h}|${dpr}|${themeVersion}|${color}`;
  if (rp.chartKey !== key) {
    const c = offscreen(w * dpr, h * dpr), cg = c.getContext('2d');
    cg.setTransform(dpr, 0, 0, dpr, 0, 0);
    cg.strokeStyle = T.line; cg.lineWidth = 1;
    cg.beginPath(); cg.moveTo(0, h - 7.5); cg.lineTo(w, h - 7.5); cg.stroke();
    const buckets = Math.max(1, Math.min(n, Math.floor(w * 1.5)));
    const pts = [];
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor((b * n) / buckets), i1 = Math.max(i0 + 1, Math.floor(((b + 1) * n) / buckets));
      let mn = Infinity, mx = -Infinity;
      for (let i = i0; i < i1; i++) { const v = rp.totals[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const x = X((i0 + i1 - 1) / 2);
      pts.push([x, mx], [x, mn]);
    }
    cg.fillStyle = color; cg.globalAlpha = 0.1;
    cg.beginPath(); cg.moveTo(pts[0][0], h - 8);
    pts.forEach(([x, v]) => cg.lineTo(x, Y(v)));
    cg.lineTo(pts[pts.length - 1][0], h - 8); cg.closePath(); cg.fill();
    cg.globalAlpha = 1;
    cg.strokeStyle = color; cg.lineWidth = 2; cg.lineJoin = 'round'; cg.lineCap = 'round';
    cg.beginPath();
    pts.forEach(([x, v], i) => (i ? cg.lineTo(x, Y(v)) : cg.moveTo(x, Y(v))));
    cg.stroke();
    cg.fillStyle = T.muted; cg.font = '11px "Segoe UI", system-ui, sans-serif';
    cg.textAlign = 'left'; cg.textBaseline = 'top';
    cg.fillText('tổng xung đột theo bước (đỉnh = ' + rp.maxTotal + ')', 6, 2);
    rp.chartImg = c; rp.chartKey = key;
  }
  g.clearRect(0, 0, w, h);
  g.drawImage(rp.chartImg, 0, 0, w, h);
  const p = clamp(fpos ?? rp.idx, 0, n - 1);
  const i0 = Math.floor(p), i1 = Math.min(n - 1, i0 + 1), frac = p - i0;
  const val = rp.totals[i0] + (rp.totals[i1] - rp.totals[i0]) * frac;
  const x = X(p), y = Y(val);
  g.strokeStyle = T.ink; g.globalAlpha = 0.28; g.lineWidth = 1; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(x, 16); g.lineTo(x, h); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;
  g.fillStyle = color; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = T.card; g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
}

/* =============================================================== TABS */
const TAB_NAMES = ['sat', 'mc', 'exp'];
function moveInk(instant) {
  const b = $('#tabs button.active'), ink = $('#tab-ink');
  if (!b) return;
  if (instant) ink.style.transition = 'none';
  ink.style.transform = `translateX(${b.offsetLeft}px) scaleX(${b.offsetWidth / 100})`;
  if (instant) requestAnimationFrame(() => { ink.style.transition = ''; });
}

function activateTab(name, instant = false) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  moveInk(instant);
  history.replaceState(null, '', '#' + name);
  if (name !== 'sat') satStop();
  if (name !== 'mc') mcStop();
  requestAnimationFrame(redrawAll);
}
$$('#tabs button').forEach((btn) => { btn.onclick = () => activateTab(btn.dataset.tab); });
window.addEventListener('resize', () => moveInk(true));

/* ============================================================ TAB 1: SAT */
const sat = { data: null, idx: 0, prev: null, anim: 1, playing: false, timer: 0 };

/* mode: 'final' -> nhảy thẳng tới Bước 9 (thành phẩm bàn cờ đã giải), 'walk' -> phát từ Bước 1 -> 9 */
async function runSat(mode = 'final') {
  const btn = $('#sat-run'), status = $('#sat-status');
  btn.disabled = true;
  setStatus(status, SPIN + 'Đang sinh CNF và giải bằng Glucose3…');
  satStop();
  try {
    const data = await api('/api/sat', { n: +$('#sat-n').value });
    sat.data = data;
    sat.prev = null;
    sat.idx = mode === 'walk' ? 0 : data.steps.length - 1;
    setStatus(status, '');
    const body = $('#sat-body');
    const firstShow = body.classList.contains('hidden');
    body.classList.remove('hidden');
    if (firstShow) $$('#sat-body .card').forEach((c, i) => reveal(c, i * 60));
    $('#sat-slider').max = data.steps.length - 1;
    buildSatSteps();
    renderSatBanner();
    renderSummary();
    updateSatPanel(false);
    playSatTransition();
    if (mode === 'walk') satPlay();
  } catch (e) {
    setStatus(status, '⚠ ' + e.message, true);
  }
  btn.disabled = false;
}
$('#sat-run').onclick = () => runSat('final');
$('#sat-show-final').onclick = () => {
  if (!sat.data) return runSat('final');
  satGo(sat.data.steps.length - 1, true);
};
$('#sat-walk').onclick = () => {
  if (!sat.data) return runSat('walk');
  satStop();
  sat.prev = sat.data.steps[sat.idx];
  sat.idx = 0;
  updateSatPanel(true);
  playSatTransition();
  satPlay();
};

function renderSatBanner() {
  const m = sat.data.summary, n = sat.data.n;
  const lastStep = sat.data.steps[sat.data.steps.length - 1];
  const cols = (lastStep.queens || []).map((q) => q[1]);
  const colsPreview = cols.length <= 14 ? `[${cols.join(', ')}]` : `[${cols.slice(0, 12).join(', ')}, …]`;
  $('#sat-banner').innerHTML = `
    <div class="banner-main">
      <strong>✓ Thành phẩm Glucose3 (N = ${n}):</strong>
      <span>Đã tìm thấy nghiệm hợp lệ với <b>${fmt(n)}</b> quân hậu không tấn công nhau · cột = <code>${colsPreview}</code></span>
    </div>
    <div class="banner-pills">
      <span class="pill ok">SATISFIABLE ✓</span>
      <span class="pill">${fmt(m.variables)} biến</span>
      <span class="pill">${fmt(m.clauses)} mệnh đề CNF</span>
      <span class="pill">Solve: ${m.solve_ms.toFixed(3)} ms</span>
    </div>
  `;
}

function buildSatSteps() {
  const ol = $('#sat-steps');
  ol.textContent = '';
  sat.data.steps.forEach((st, i) => {
    const li = document.createElement('li');
    li.textContent = st.title;
    li.onclick = () => satGo(i, true);
    ol.appendChild(li);
  });
}

function updateSatPanel(animateText = true) {
  const s = sat.data.steps[sat.idx];
  $('#sat-title').textContent = s.title;
  $('#sat-text').textContent = s.text;
  $('#sat-logic').textContent = s.logic ? 'Dạng logic:  ' + s.logic : '';
  const box = $('#sat-samples');
  box.textContent = '';
  (s.samples || []).forEach((smp) => {
    const d = document.createElement('div'); d.className = 'sample';
    d.textContent = smp.text;
    const sm = document.createElement('small'); sm.textContent = smp.cells; d.appendChild(sm);
    box.appendChild(d);
  });
  if (animateText) {
    $('#sat-detail').animate([{ opacity: 0, transform: 'translateX(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: EASE_CSS });
  }
  countTo($('#sat-added'), s.added);
  countTo($('#sat-total'), s.total);
  countTo($('#sat-lines'), s.num_lines ?? '—');

  const badge = $('#sat-board-badge'), sub = $('#sat-board-sub');
  if (s.queens && s.queens.length) {
    badge.className = 'badge ok';
    badge.textContent = `✓ Nghiệm hợp lệ (${s.queens.length} hậu · 0 xung đột)`;
    sub.textContent = `Bước ${sat.idx + 1}/${sat.data.steps.length}`;
  } else {
    badge.className = 'badge';
    badge.textContent = s.title.split('·')[0].trim();
    sub.textContent = `Tổng ${fmt(s.total)} mệnh đề CNF`;
  }

  const ol = $('#sat-steps');
  [...ol.children].forEach((li, i) => { li.className = i === sat.idx ? 'current' : i < sat.idx ? 'done' : ''; });
  const cur = ol.children[sat.idx];
  if (cur && ol.scrollHeight > ol.clientHeight) {
    ol.scrollTo({ top: cur.offsetTop - (ol.clientHeight - cur.offsetHeight) / 2, behavior: 'smooth' });
  }
  $('#sat-slider').value = sat.idx;
  $('#sat-pos').textContent = `${sat.idx + 1} / ${sat.data.steps.length}`;
}

function drawSatBoard() {
  if (!sat.data) return;
  const s = sat.data.steps[sat.idx], prev = sat.prev, e = easeOut(sat.anim);
  const popIn = s.queens.length > 0 && !(prev && prev.queens.length);
  drawBoard($('#sat-board'), sat.data.n, {
    labels: s.labels,
    lines: s.lines, lineAlpha: e,
    oldLines: prev ? prev.lines : null, oldLineAlpha: 1 - e,
    queens: s.queens,
    queenScale: popIn ? Math.max(0, easeBack(sat.anim)) : 1,
    solved: s.queens.length > 0 && sat.data.summary.valid,
  });
}

function playSatTransition() {
  sat.anim = 0;
  drawSatBoard();
  animate('sat-board', 400, (p) => { sat.anim = p; drawSatBoard(); });
}

function satGo(i, user) {
  if (!sat.data) return;
  if (user) satStop();
  i = clamp(i, 0, sat.data.steps.length - 1);
  if (i === sat.idx) return;
  sat.prev = sat.data.steps[sat.idx];
  sat.idx = i;
  updateSatPanel(true);
  playSatTransition();
}

function renderSummary() {
  const m = sat.data.summary;
  const items = [
    ['Số biến', fmt(m.variables)],
    ['Số mệnh đề CNF', fmt(m.clauses) + (m.clauses === m.expected_clauses ? '  ✓ khớp công thức' : '  ✗ lệch công thức')],
    ['Sinh CNF', m.build_ms.toFixed(2) + ' ms'],
    ['Nạp vào solver', m.load_ms.toFixed(2) + ' ms'],
    ['Glucose3 solve', m.solve_ms.toFixed(3) + ' ms'],
    ['Kết quả', m.satisfiable ? 'SAT ✓' : 'UNSAT'],
    ['Nghiệm hợp lệ', m.valid ? 'Có ✓' : 'Không'],
  ].concat(m.groups.map((g) => [g.title, fmt(g.count) + ' mệnh đề']));
  const box = $('#sat-summary');
  box.textContent = '';
  items.forEach(([k, v], i) => {
    const d = document.createElement('div');
    const b = document.createElement('b'); b.textContent = v;
    const sp = document.createElement('span'); sp.textContent = k;
    d.append(b, sp);
    box.appendChild(d);
    reveal(d, 90 + i * 30);
  });
}

function satStop() {
  sat.playing = false;
  clearTimeout(sat.timer);
  $('#sat-play').textContent = '▶ Chạy tự động';
}
function satPlay() {
  if (!sat.data) return;
  if (sat.playing) return satStop();
  if (sat.idx >= sat.data.steps.length - 1) {
    sat.prev = sat.data.steps[sat.idx];
    sat.idx = 0;
    updateSatPanel(true);
    playSatTransition();
  }
  sat.playing = true;
  $('#sat-play').textContent = '⏸ Tạm dừng';
  const tick = () => {
    if (!sat.playing) return;
    if (sat.idx >= sat.data.steps.length - 1) { satStop(); toast('✓ Đã đi hết 9 bước SAT'); return; }
    satGo(sat.idx + 1);
    sat.timer = setTimeout(tick, 1250);
  };
  sat.timer = setTimeout(tick, 1250);
}
$('#sat-play').onclick = satPlay;
$('#sat-prev').onclick = () => satGo(sat.idx - 1, true);
$('#sat-next').onclick = () => satGo(sat.idx + 1, true);
$('#sat-slider').oninput = (e) => satGo(+e.target.value, true);

/* ===================================================== TAB 2: Min-Conflicts */
const CHECKPOINT = 256;
class Replay {
  constructor(trace) {
    this.t = trace;
    this.ev = trace.events;
    this.len = this.ev.length;
    this.n = trace.n;
    this.totals = new Array(this.len + 1);
    this.moves = new Array(this.len + 1);
    this.restarts = new Array(this.len + 1);
    this.totals[0] = trace.init_total; this.moves[0] = 0; this.restarts[0] = 0;
    this.checkpoints = [trace.init_cols.slice()];
    let cols = trace.init_cols.slice(), max = trace.init_total;
    for (let i = 0; i < this.len; i++) {
      const e = this.ev[i], isMove = e[0] === 'm';
      if (isMove) cols[e[1]] = e[3]; else cols = e[1].slice();
      const tot = isMove ? e[4] : e[2];
      this.totals[i + 1] = tot;
      if (tot > max) max = tot;
      this.moves[i + 1] = this.moves[i] + (isMove ? 1 : 0);
      this.restarts[i + 1] = this.restarts[i] + (isMove ? 0 : 1);
      if ((i + 1) % CHECKPOINT === 0) this.checkpoints.push(cols.slice());
    }
    this.maxTotal = max;
    this.cols = trace.init_cols.slice();
    this.idx = 0;
    this.shownIdx = -1;
  }
  seek(k) {
    k = clamp(k, 0, this.len);
    if (k < this.idx || k - this.idx > CHECKPOINT) {
      const b = Math.floor(k / CHECKPOINT);
      this.cols = this.checkpoints[b].slice();
      this.idx = b * CHECKPOINT;
    }
    while (this.idx < k) {
      const e = this.ev[this.idx];
      if (e[0] === 'm') this.cols[e[1]] = e[3]; else this.cols = e[1].slice();
      this.idx++;
    }
  }
}

const MC_KEYS = ['standard', 'heuristic'];
const SPS = [2, 4, 7, 12, 20, 35, 65, 130, 300, 750]; // số bước / giây theo thanh tốc độ
const mc = { rp: null, pos: 0, max: 0, t: 1, playing: false, acc: 0, last: 0, raf: 0, sps: SPS[4], pending: false };
$('#mc-speed').oninput = (e) => { mc.sps = SPS[+e.target.value - 1]; };
mc.sps = SPS[+$('#mc-speed').value - 1];

const STAT_LABELS = ['Bước', 'Tổng xung đột', 'Hậu bị tấn công', 'Khởi động lại', 'Trạng thái', 'Thời gian chạy'];
function buildStats(key, rp) {
  const box = $('#mc-stats-' + key);
  box.textContent = '';
  rp.ui = STAT_LABELS.map((label) => {
    const d = document.createElement('div');
    const b = document.createElement('b');
    const s = document.createElement('span'); s.textContent = label;
    d.append(b, s); box.appendChild(d);
    return { d, b, v: null };
  });
  rp.ui[5].b.textContent = rp.t.time_ms.toFixed(2) + ' ms';
  if (rp.t.truncated) {
    const d = document.createElement('div'); d.className = 'warn';
    d.innerHTML = '<span>⚠ Lịch sử hiển thị đã bị cắt bớt</span>';
    box.appendChild(d);
  }
}
function setStat(rp, i, v, cls) {
  const u = rp.ui[i];
  if (u.v !== v) { u.v = v; u.b.textContent = v; }
  if (cls !== undefined && u.d.className !== cls) u.d.className = cls;
}

function renderMcBanner() {
  const std = mc.rp.standard.t, heu = mc.rp.heuristic.t;
  const ratio = heu.steps > 0 ? (std.steps / heu.steps).toFixed(1) : '—';
  $('#mc-banner').innerHTML = `
    <div class="banner-main">
      <strong>✓ Thành phẩm so sánh (N = ${std.n}, Seed = ${+$('#mc-seed').value}):</strong>
      <span>Bản <b>Heuristic</b> giải xong sau <b>${fmt(heu.steps)} bước</b> (${heu.time_ms.toFixed(2)} ms) — ít bước gấp <b>${ratio}×</b> so với bản <b>Chuẩn</b> (${fmt(std.steps)} bước, ${std.time_ms.toFixed(2)} ms)</span>
    </div>
    <div class="banner-pills">
      <span class="pill ok">Heuristic: ${fmt(heu.steps)} bước</span>
      <span class="pill">Chuẩn: ${fmt(std.steps)} bước</span>
      <span class="pill">Xung đột đầu: ${std.init_total} → ${heu.init_total}</span>
    </div>
  `;
}

function renderMc() {
  if (!mc.rp) return;
  const colors = { standard: T.std, heuristic: T.heu };
  for (const key of MC_KEYS) {
    const rp = mc.rp[key];
    rp.seek(mc.pos);
    const bad = conflictedRows(rp.cols);
    const last = rp.idx > 0 ? rp.ev[rp.idx - 1] : null;
    const isMoving = rp.idx === mc.pos && mc.t < 1;
    const t = isMoving ? mc.t : 1;
    const queens = rp.cols.map((c, r) => [r, c]);
    let move = null;
    if (last && last[0] === 'm' && last[2] !== last[3]) {
      const e = easeInOut(t);
      move = { row: last[1], from: last[2], to: last[3], t: e };
      if (e < 1) queens[last[1]] = [last[1], last[2] + (last[3] - last[2]) * e];
    }
    const atEnd = rp.idx === rp.len;
    drawBoard($('#mc-board-' + key), rp.n, {
      queens, bad, move,
      solved: atEnd && rp.t.solved,
      showAttackLines: true,
    });

    if (rp.shownIdx !== rp.idx) {
      rp.shownIdx = rp.idx;
      setStat(rp, 0, `${fmt(rp.moves[rp.idx])} / ${fmt(rp.t.steps)}`);
      setStat(rp, 1, fmt(rp.totals[rp.idx]));
      setStat(rp, 2, String(bad.size));
      setStat(rp, 3, String(rp.restarts[rp.idx]));
      setStat(rp, 4, atEnd ? (rp.t.solved ? '✓ Đã giải' : '✗ Hết bước') : 'Đang chạy…',
        atEnd ? (rp.t.solved ? 'ok' : 'bad') : '');
      $('#mc-panel-' + key).classList.toggle('solved', atEnd && rp.t.solved);
      const badge = $('#mc-badge-' + key);
      if (atEnd && rp.t.solved) {
        badge.className = 'badge ok';
        badge.textContent = `✓ Nghiệm hợp lệ (${fmt(rp.t.steps)} bước)`;
      } else if (atEnd) {
        badge.className = 'badge bad';
        badge.textContent = `✗ Còn ${rp.totals[rp.idx]} xung đột`;
      } else {
        badge.className = 'badge';
        badge.textContent = `Xung đột: ${rp.totals[rp.idx]}`;
      }
    }
    const fpos = isMoving && rp.idx > 0 ? (rp.idx - 1) + t : rp.idx;
    conflictChart($('#mc-chart-' + key), rp, colors[key], fpos);
  }
  const sl = $('#mc-slider');
  if (+sl.value !== mc.pos) sl.value = mc.pos;
  $('#mc-pos').textContent = `${fmt(mc.pos)} / ${fmt(mc.max)}`;
}

/* mode: 'final' -> hiện ngay bàn cờ thành phẩm cuối, 'play' -> phát quá trình từ đầu */
async function runMc(mode = 'final') {
  const btn = $('#mc-run'), status = $('#mc-status');
  btn.disabled = true;
  setStatus(status, SPIN + 'Đang chạy cả hai thuật toán…');
  mcStop();
  try {
    const data = await api('/api/minconflicts', { n: +$('#mc-n').value, seed: +$('#mc-seed').value, max_steps: +$('#mc-max').value });
    mc.rp = {};
    MC_KEYS.forEach((k) => { mc.rp[k] = new Replay(data[k]); buildStats(k, mc.rp[k]); });
    mc.max = Math.max(...MC_KEYS.map((k) => mc.rp[k].len));
    mc.pos = mode === 'play' ? 0 : mc.max;
    mc.t = 1;
    $('#mc-slider').max = mc.max;
    setStatus(status, '');
    const body = $('#mc-body');
    const firstShow = body.classList.contains('hidden');
    body.classList.remove('hidden');
    if (firstShow) $$('#mc-body .card').forEach((c, i) => reveal(c, i * 65));
    renderMcBanner();
    renderMc();
    if (mode === 'play') mcPlay();
  } catch (e) {
    setStatus(status, '⚠ ' + e.message, true);
  }
  btn.disabled = false;
}
$('#mc-run').onclick = () => runMc('final');

function mcStop() {
  mc.playing = false;
  cancelAnimationFrame(mc.raf);
  $('#mc-play').textContent = '▶ Phát quá trình';
}
function mcPlay() {
  if (!mc.rp) return;
  if (mc.playing) return mcStop();
  stopAnim('mc-step');
  if (mc.pos >= mc.max) {
    mc.pos = mc.max > 0 ? 1 : 0;
    mc.t = 0;
  } else if (mc.pos === 0 && mc.max > 0) {
    mc.pos = 1;
    mc.t = 0;
  }
  mc.playing = true; mc.acc = 0; mc.last = performance.now();
  $('#mc-play').textContent = '⏸ Tạm dừng';
  renderMc();
  mc.raf = requestAnimationFrame(mcLoop);
}
function mcLoop(now) {
  if (!mc.playing) return;
  const dt = Math.min(80, now - mc.last);
  mc.last = now;
  mc.acc += (dt * mc.sps) / 1000;
  if (mc.acc >= 1) {
    const k = Math.floor(mc.acc);
    mc.acc -= k;
    mc.pos = Math.min(mc.max, mc.pos + k);
  }
  const tween = mc.sps <= 35 && mc.pos <= mc.max;
  mc.t = tween ? clamp(mc.acc, 0, 1) : 1;
  renderMc();
  if (mc.pos >= mc.max && mc.t >= 0.99) {
    mc.t = 1;
    renderMc();
    mcStop();
    const solved = MC_KEYS.filter((k) => mc.rp[k].t.solved).length;
    toast(solved === 2 ? '✓ Cả hai thuật toán đã tìm được nghiệm' : solved ? 'Một thuật toán đã tìm được nghiệm' : 'Hết số bước cho phép');
    return;
  }
  mc.raf = requestAnimationFrame(mcLoop);
}

function mcGo(p, animated) {
  if (!mc.rp) return;
  mcStop();
  const next = clamp(p, 0, mc.max);
  const forward = next === mc.pos + 1;
  mc.pos = next;
  if (animated && forward) {
    mc.t = 0; renderMc();
    animate('mc-step', 240, (q) => { mc.t = q; renderMc(); });
  } else {
    stopAnim('mc-step');
    mc.t = 1;
    if (!mc.pending) {
      mc.pending = true;
      requestAnimationFrame(() => { mc.pending = false; renderMc(); });
    }
  }
}
$('#mc-play').onclick = mcPlay;
$('#mc-start').onclick = () => mcGo(0);
$('#mc-end').onclick = () => mcGo(mc.max);
$('#mc-prev').onclick = () => mcGo(mc.pos - 1);
$('#mc-next').onclick = () => mcGo(mc.pos + 1, true);
$('#mc-slider').oninput = (e) => mcGo(+e.target.value);

/* ===================================================== TAB 3: Thực nghiệm */
const parseList = (text) => text.split(/[\s,;]+/).filter(Boolean).map(Number);
let satRows = [], mcRows = [];

function showError(msg) {
  const el = $('#exp-error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}
function updateEmpty() {
  $('#exp-empty').classList.toggle('hidden', satRows.length > 0 || mcRows.length > 0);
}

async function runJob(url, body, progId, onDone) {
  showError('');
  const prog = $(progId);
  const bar = prog.firstElementChild, label = prog.lastElementChild;
  bar.style.transform = 'scaleX(0)';
  label.textContent = 'Đang khởi động…';
  prog.classList.remove('hidden');
  let job;
  try { job = await api(url, body); } catch (e) { showError(e.message); prog.classList.add('hidden'); return; }
  await new Promise((resolve) => {
    const poll = async () => {
      try {
        const s = await api('/api/jobs/' + job.job);
        bar.style.transform = `scaleX(${s.total ? s.done / s.total : 0})`;
        label.textContent = `${s.message} (${s.done}/${s.total})`;
        if (s.status === 'done') {
          setTimeout(() => prog.classList.add('hidden'), 350);
          onDone(s); resolve(); return;
        }
        if (s.status === 'error') { prog.classList.add('hidden'); showError(s.error); resolve(); return; }
        setTimeout(poll, 300);
      } catch (e) { prog.classList.add('hidden'); showError(e.message); resolve(); }
    };
    poll();
  });
}

function buildTable(el, headers, rows) {
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  headers.forEach((h) => { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); });
  const body = t.createTBody();
  rows.forEach((r, ri) => {
    const tr = body.insertRow();
    r.forEach((v) => {
      const td = tr.insertCell();
      if (v && typeof v === 'object') { td.textContent = v.v; td.className = v.cls; } else td.textContent = v;
    });
    reveal(tr, ri * 22);
  });
  el.textContent = '';
  el.appendChild(t);
}

function showSatResults(rows, files) {
  satRows = rows;
  const out = $('#exp-sat-out');
  out.classList.remove('hidden');
  buildTable($('#exp-sat-table'), ['N', 'Số biến', 'Số mệnh đề CNF', 'Sinh CNF (ms)', 'Nạp (ms)', 'Solve (ms)', 'Tổng (ms)', 'Hợp lệ'],
    rows.map((r) => [r.n, fmt(r.variables), fmt(r.clauses), r.build_ms.toFixed(2), r.load_ms.toFixed(2),
      r.solve_ms.toFixed(3), r.total_ms.toFixed(2), r.valid ? { v: '✓', cls: 'ok' } : { v: '✗', cls: 'bad' }]));
  $('#exp-sat-files').textContent = files && files.length ? 'Đã lưu: ' + files.join(', ') : '';
  updateEmpty();
  animate('chart-sat', 700, (p) => drawSatCharts(easeOut(p)));
}

function showMcResults(rows, files) {
  mcRows = rows;
  const out = $('#exp-mc-out');
  out.classList.remove('hidden');
  const std = {};
  rows.forEach((r) => { if (r.algorithm === 'standard') std[r.n] = r; });
  buildTable($('#exp-mc-table'), ['N', 'Thuật toán', 'Thành công', 'Bước TB', 'Bước trung vị', 'Thời gian TB (ms)', 'Restart TB', 'Bước so với chuẩn'],
    rows.map((r) => [r.n, r.algorithm === 'standard' ? 'Chuẩn' : 'Heuristic',
      { v: (100 * r.success_rate).toFixed(0) + '%', cls: r.success_rate >= 1 ? 'ok' : r.success_rate < 0.5 ? 'bad' : '' },
      r.avg_steps.toFixed(1), r.median_steps.toFixed(1), r.avg_time_ms.toFixed(2), r.avg_restarts.toFixed(2),
      r.algorithm === 'standard' || !std[r.n] ? '—'
        : (100 * r.median_steps / Math.max(std[r.n].median_steps, 1e-9)).toFixed(0) + '% (trung vị)']));
  $('#exp-mc-files').textContent = files && files.length ? 'Đã lưu: ' + files.join(', ') : '';
  updateEmpty();
  animate('chart-mc', 700, (p) => drawMcCharts(easeOut(p)));
}

$('#exp-sat-run').onclick = async () => {
  const btn = $('#exp-sat-run');
  btn.disabled = true;
  await runJob('/api/experiments/sat', { ns: parseList($('#exp-sat-ns').value), repeats: +$('#exp-sat-rep').value },
    '#exp-sat-prog', (s) => { showSatResults(s.rows, s.files); toast('✓ Thực nghiệm SAT hoàn tất'); });
  btn.disabled = false;
};

$('#exp-mc-run').onclick = async () => {
  const btn = $('#exp-mc-run');
  btn.disabled = true;
  await runJob('/api/experiments/minconflicts',
    { ns: parseList($('#exp-mc-ns').value), runs: +$('#exp-mc-runs').value, max_steps: +$('#exp-mc-max').value },
    '#exp-mc-prog', (s) => { showMcResults(s.rows, s.files); toast('✓ Thực nghiệm Min-Conflicts hoàn tất'); });
  btn.disabled = false;
};

function drawSatCharts(p = 1) {
  if (!satRows.length) return;
  const xs = satRows.map((r) => r.n);
  lineChart($('#chart-sat-clauses'), { xs, logY: true, series: [{ name: 'số mệnh đề CNF', color: T.accent, ys: satRows.map((r) => r.clauses) }] }, p);
  lineChart($('#chart-sat-time'), { xs, logY: true, series: [
    { name: 'solve', color: T.accent, ys: satRows.map((r) => r.solve_ms) },
    { name: 'sinh CNF', color: T.std, ys: satRows.map((r) => r.build_ms) }] }, p);
}

function drawMcCharts(p = 1) {
  if (!mcRows.length) return;
  const xs = [...new Set(mcRows.map((r) => r.n))];
  const pick = (alg, f) => xs.map((n) => { const r = mcRows.find((x) => x.n === n && x.algorithm === alg); return r ? f(r) : 0; });
  lineChart($('#chart-mc-steps'), { xs, logY: true, series: [
    { name: 'chuẩn', color: T.std, ys: pick('standard', (r) => r.avg_steps) },
    { name: 'heuristic', color: T.heu, ys: pick('heuristic', (r) => r.avg_steps) }] }, p);
  lineChart($('#chart-mc-time'), { xs, logY: true, series: [
    { name: 'chuẩn', color: T.std, ys: pick('standard', (r) => r.avg_time_ms) },
    { name: 'heuristic', color: T.heu, ys: pick('heuristic', (r) => r.avg_time_ms) }] }, p);
}

async function loadSavedResults(announce) {
  try {
    const r = await api('/api/results');
    if (r.sat && r.sat.length) showSatResults(r.sat, ['results/sat_results.csv', 'results/sat_results.json']);
    if (r.mc && r.mc.length) showMcResults(r.mc, ['results/min_conflicts_results.csv', 'results/min_conflicts_results.json']);
    if (announce && ((r.sat && r.sat.length) || (r.mc && r.mc.length))) toast('✓ Đã hiển thị kết quả thực nghiệm');
  } catch (e) { /* chưa có kết quả */ }
  updateEmpty();
}

/* ============================================================ redraw */
function redrawAll() {
  if (sat.data) drawSatBoard();
  if (mc.rp) renderMc();
  if (!anims.has('chart-sat')) drawSatCharts();
  if (!anims.has('chart-mc')) drawMcCharts();
}

/* ========================================================== bàn phím */
[['#sat-n', '#sat-run'], ['#mc-n', '#mc-run'], ['#mc-seed', '#mc-run'], ['#mc-max', '#mc-run'],
  ['#exp-sat-ns', '#exp-sat-run'], ['#exp-sat-rep', '#exp-sat-run'],
  ['#exp-mc-ns', '#exp-mc-run'], ['#exp-mc-runs', '#exp-mc-run'], ['#exp-mc-max', '#exp-mc-run']]
  .forEach(([inp, btn]) => $(inp).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(btn).click(); }));

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  const tab = (document.querySelector('.tab.active') || {}).id;
  if (tab !== 'tab-sat' && tab !== 'tab-mc') return;
  const isSat = tab === 'tab-sat';
  if (e.key === 'ArrowRight') { e.preventDefault(); isSat ? satGo(sat.idx + 1, true) : mcGo(mc.pos + 1, true); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); isSat ? satGo(sat.idx - 1, true) : mcGo(mc.pos - 1); }
  else if (e.key === ' ') { e.preventDefault(); isSat ? satPlay() : mcPlay(); }
  else if (e.key === 'Home') { e.preventDefault(); isSat ? satGo(0, true) : mcGo(0); }
  else if (e.key === 'End') { e.preventDefault(); isSat ? satGo(1e9, true) : mcGo(mc.max); }
});

/* Báo cho máy chủ khi cửa sổ bị đóng -> chương trình tự thoát */
window.addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/bye', ''); } catch (e) { /* bỏ qua */ } });

/* ============================================================ khởi động */
(function init() {
  const initial = (location.hash || '#sat').slice(1);
  const tab = TAB_NAMES.includes(initial) ? initial : 'sat';
  activateTab(tab, true);
  // Tự động nạp sẵn thành phẩm ở cả 3 tab để mở ra là thấy ngay, chuyển tab không phải chờ
  loadSavedResults(tab === 'exp');
  runSat('final');
  runMc('final');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveInk(true));
})();
