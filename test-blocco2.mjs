// test-blocco2.mjs — TDD per il BLOCCO 2 (quote soci datate + parametri fiscali datati + pressione fiscale D3)
// Stile gate.mjs / test-blocco1.mjs: throw + process.exit(1) al primo fallimento, niente dipendenze.
//
// CONTRATTO ATTESO:
//   registro.json > previsioneFiscale.sociPerAnno['2025'|'2026'] (somma quote = 1)
//   registro.json > previsioneFiscale.parametriPerAnno['2026']
//   calcPrevisioneFiscale legge quota da DATO (niente piu utileAnte/2 cablato) + warnings se anno mancante
//   data.fiscale.pressioneFiscale = { disponibile, annoBase, baseUtileAnteImposte, totaleImposte,
//                                     pressioneFiscale, mix:{irap,irpef,addizionali,inps}, ... }

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C   = require('./compute.js');
const reg = require('./registro.json');
const st  = require('./data.static.json');

let pass = 0;
function ok(cond, msg) { if (!cond) { console.error('  ✗ ' + msg); process.exit(1); } console.log('  ✓ ' + msg); pass++; }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= (tol || 0.01), msg + ' (' + a + ' ~ ' + b + ')'); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

console.log('\n[1] Schema dati datato per anno');
const pf = reg.previsioneFiscale;
ok(pf.sociPerAnno && pf.sociPerAnno['2025'] && pf.sociPerAnno['2026'], 'sociPerAnno 2025 e 2026 presenti');
ok(pf.parametriPerAnno && pf.parametriPerAnno['2026'], 'parametriPerAnno 2026 presente');
const sum25 = pf.sociPerAnno['2025'].reduce((a, s) => a + s.quota, 0);
const sum26 = pf.sociPerAnno['2026'].reduce((a, s) => a + s.quota, 0);
near(sum25, 1, 0.0001, 'quote 2025 sommano a 100%');
near(sum26, 1, 0.0001, 'quote 2026 sommano a 100%');
ok(pf.sociPerAnno['2025'].length === 4, '2025 = 4 soci');
ok(pf.sociPerAnno['2026'].length === 2, '2026 = 2 soci');

console.log('\n[2] calcPrevisioneFiscale: quote da DATO, non 50/50 cablato');
// 2026: quote 0.5/0.5 -> mReddito = utile*0.5
const p2026 = C._calc.calcPrevisioneFiscale(reg, 100000, 100000);
ok(p2026.marco.quota === 0.5 && p2026.sajay.quota === 0.5, '2026 legge quota 0.5/0.5 dal dato');
near(p2026.marco.redditoImponibile, 50000, 0.01, '2026 reddito Marco = utile*0.5');
ok((p2026._warnings || []).length === 0, '2026 nessun warning (dati completi)');

// PROVA DEL FUOCO del fix #1: con quote 25% l'imponibile NON deve essere utile/2.
// Costruisco un reg con annoFiscale 2025 (4 soci 25%): Marco deve avere utile*0.25, non utile*0.5.
const reg25 = clone(reg); reg25.meta.annoFiscale = 2025;
const p2025 = C._calc.calcPrevisioneFiscale(reg25, 100000, 100000);
ok(p2025.marco.quota === 0.25, '2025 legge quota 0.25 dal dato');
near(p2025.marco.redditoImponibile, 25000, 0.01, '2025 reddito Marco = utile*0.25 (NON utile/2 cablato)');
ok(p2025.marco.redditoImponibile !== 50000, 'il cablaggio utileAnte/2 e stato rimosso');

console.log('\n[3] Anno mancante -> segnala, niente degrado silenzioso');
const reg99 = clone(reg); reg99.meta.annoFiscale = 2099;
const p99 = C._calc.calcPrevisioneFiscale(reg99, 100000, 100000);
ok((p99._warnings || []).length >= 2, '2099 produce warning su parametri E compagine mancanti');
ok(p99._warnings.some(w => /parametri/i.test(w)) && p99._warnings.some(w => /compagine/i.test(w)), 'warning citano parametri e compagine');

console.log('\n[4] componentiCaricoUtile = carico marginale (somma = famiglia.caricoUtile)');
const comp = p2026.componentiCaricoUtile;
const sommaComp = comp.irap + comp.irpef + comp.addizionali + comp.inps;
near(sommaComp, p2026.famiglia.caricoUtile, 0.02, 'somma componenti = famiglia.caricoUtile');

console.log('\n[5] Pressione fiscale (D3) nel data.fiscale');
const data = C.buildDashboardData(reg, st);
const press = data.fiscale.pressioneFiscale;
ok(press && press.disponibile === true, 'pressioneFiscale disponibile');
ok(press.annoBase === '2025', 'base = ultimo anno chiuso (2025)');
near(press.baseUtileAnteImposte, 73599.38, 0.01, 'base utile ante imposte = utileGestionale 2025');
ok(press.pressioneFiscale != null && press.pressioneFiscale > 0.3 && press.pressioneFiscale < 0.6, 'tax rate in range plausibile (30-60%)');
const mixSum = press.mix.irap + press.mix.irpef + press.mix.addizionali + press.mix.inps;
near(mixSum, 1, 0.01, 'mix imposte somma a 100%');
const impSum = press.imposte.irap + press.imposte.irpef + press.imposte.addizionali + press.imposte.inps;
near(impSum, press.totaleImposte, 0.02, 'somma componenti imposte = totaleImposte (carico attribuibile)');
ok(press.totaleImposte < press.totaleImposteLorde, 'carico marginale < carico lordo (esclude IRPEF stipendio Sajay)');
near(press.nettoFamiglia, press.baseUtileAnteImposte - press.totaleImposte, 0.02, 'nettoFamiglia = base - carico attribuibile');

console.log('\n[6] fiscale espone array datiMancanti (no fallback silenzioso)');
ok(Array.isArray(data.fiscale.datiMancanti), 'fiscale.datiMancanti e un array');

console.log('\nOK — tutte le asserzioni del BLOCCO 2 passano (' + pass + ' check).');
