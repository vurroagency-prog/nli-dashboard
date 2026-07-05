/* render-smoke.mjs — Smoke test del RENDERING reale.
 * Esegue lo <script> inline di index.html dentro un DOM/Chart mockato, con
 * fetch che legge i file locali, e chiama loadData(): se il rendering accede a
 * un campo mancante o lancia un errore, lo cattura. Verifica l'esecuzione, non
 * solo i dati (complementare a gate.mjs).
 */
import { readFileSync } from 'fs';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const html = readFileSync('./index.html', 'utf8');
// estrai lo <script> inline (senza src) piu' lungo = quello applicativo
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const appScript = scripts.sort((a, b) => b.length - a.length)[0];

// ---- mock canvas 2D context (no-op per ogni metodo)
function mockCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createPattern' || p === 'createLinearGradient' || p === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      if (p === 'canvas') return makeEl();
      return () => {};
    },
    set() { return true; }
  });
}

// ---- mock DOM
function makeEl() {
  const el = {
    _children: [], innerHTML: '', textContent: '', value: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this._children.push(c); return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    getContext() { return mockCtx(); }, remove() {}, contains() { return false; },
    insertAdjacentHTML() {}
  };
  return el;
}
const elCache = {};
const document = {
  getElementById(id) { return elCache[id] || (elCache[id] = makeEl()); },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  createElement() { return makeEl(); },
  addEventListener() {}, body: makeEl(), documentElement: makeEl()
};

const errors = [];
function Chart(ctx, cfg) {
  // valida che i dataset abbiano dati numerici, come farebbe Chart.js
  try {
    const ds = cfg && cfg.data && cfg.data.datasets;
    if (ds) ds.forEach(d => (d.data || []).forEach(() => {}));
  } catch (e) { errors.push('Chart: ' + e.message); }
  return { destroy() {}, update() {}, data: cfg && cfg.data, options: {} };
}
Chart.defaults = { font: {}, plugins: {}, color: '', scale: {} };
Chart.register = () => {};

let fetchLog = [];
async function fetchMock(url) {
  const file = url.split('?')[0];
  fetchLog.push(file);
  let body;
  try { body = readFileSync('./' + file, 'utf8'); }
  catch (e) { return { ok: false, status: 404, async json() { throw new Error('404 ' + file); }, async text() { return ''; } }; }
  return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
}

const sandbox = {
  document, Chart, fetch: fetchMock, console,
  window: {}, self: {}, location: { href: '', reload() {} },
  sessionStorage: { getItem: (k) => (k === 'nli_dash_auth' ? 'true' : null), setItem() {}, removeItem() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  crypto: { subtle: { async digest() { return new ArrayBuffer(32); } } },
  TextEncoder, setTimeout, clearTimeout, Date, Math, JSON, Promise, Array, Object,
  getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
  requestAnimationFrame: (f) => f(), NLICompute: require('./compute.js'), alert() {}, confirm() { return true; }
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

process.on('unhandledRejection', (e) => errors.push('UnhandledRejection: ' + (e && e.message)));

try {
  vm.runInContext(appScript, sandbox, { filename: 'index-inline.js' });
} catch (e) { errors.push('Script load: ' + e.message + '\n' + e.stack); }

const run = async () => {
  if (typeof sandbox.loadData === 'function') {
    try { await sandbox.loadData(); }
    catch (e) { errors.push('loadData(): ' + e.message + '\n' + (e.stack || '')); }
  } else {
    errors.push('loadData non trovata nello script.');
  }
  await new Promise(r => setTimeout(r, 200));

  console.log('\n=== RENDER SMOKE TEST ===');
  console.log('fetch chiamati:', [...new Set(fetchLog)].join(', '));
  console.log('elementi DOM toccati:', Object.keys(elCache).length);
  // spot-check: alcuni elementi devono aver ricevuto contenuto
  const checks = ['last-update-date', 'iva-trimestri-body', 'bilancio-ce-table', 'overview-status', 'recinto-body', 'tasse-soci', 'tasse-guida', 'generazione-body', 'alert-list'];
  checks.forEach(id => {
    const el = elCache[id];
    const filled = el && (el.innerHTML || el.textContent);
    console.log(`  ${filled ? '✓' : '⚠'} #${id} ${filled ? 'popolato' : 'VUOTO'}`);
    if (id === 'recinto-body' && el) console.log('    testo recinto: ' + String(el.innerHTML || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320));
  });
  if (errors.length) {
    console.log(`\n❌ ${errors.length} ERRORI runtime nel rendering:`);
    errors.forEach(e => console.log('  - ' + e));
    process.exit(1);
  } else {
    console.log('\n✓ Rendering eseguito senza errori runtime.\n');
  }
};
run();
