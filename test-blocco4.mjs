// test-blocco4.mjs — TDD per il BLOCCO 4 (EBITDA/margini gestionali: costi struttura + break-even + a regime)
// Stile gate.mjs: throw + process.exit(1) al primo fallimento.
//
// CONTRATTO: data.ebitdaGestionale = {
//   costiFissiAnnui:Number, costiFissiMensili:Number, dettaglioStruttura:[{voce,label,importo,fonte}],
//   margineContribuzionePct:Number, breakEvenRicaviAnnui:Number,
//   regime:{anno,ricavi,utileGestionale,marginePct}, datiMancanti:String[]
// }
// + il CE del periodo NON deve essere inquinato dai costi struttura annui (resta da sole fatture).

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('./compute.js');
const reg = require('./registro.json');
const st = require('./data.static.json');

let pass = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); process.exit(1); } console.log('  ✓ ' + m); pass++; }
function near(a, b, t, m) { ok(Math.abs(a - b) <= (t || 0.01), m + ' (' + a + ' ~ ' + b + ')'); }

const data = C.buildDashboardData(reg, st);
const e = data.ebitdaGestionale;

console.log('\n[1] Costi fissi di struttura annui (non fatturati)');
ok(e && typeof e.costiFissiAnnui === 'number', 'costiFissiAnnui presente');
// affitto 350x12 + royalty 200x12 x2 + personale = 4200 + 4800 + 11839,14
near(e.costiFissiAnnui, 20839.14, 0.01, 'costiFissiAnnui = affitto+royalty+personale');
near(e.costiFissiMensili, 1736.6, 0.05, 'costiFissiMensili = annui/12');
ok(e.dettaglioStruttura.length === 4, '4 voci struttura (affitto + 2 royalty + personale)');
const pers = e.dettaglioStruttura.filter(x => x.fonte === 'parametro')[0];
ok(pers && Math.abs(pers.importo - 11839.14) < 0.01, 'personale = parametro reale dalle buste paga');
const aff = e.dettaglioStruttura.filter(x => /affitto/i.test(x.label))[0];
near(aff.importo, 4200, 0.01, 'affitto derivato da ricorrente (350x12)');

console.log('\n[2] Break-even ricavi annui');
ok(e.margineContribuzionePct > 0 && e.margineContribuzionePct <= 1, 'margine contribuzione in (0,1]');
near(e.breakEvenRicaviAnnui, e.costiFissiAnnui / e.margineContribuzionePct, 0.02, 'break-even = costi fissi / margine contribuzione');
ok(e.breakEvenRicaviAnnui > e.costiFissiAnnui, 'break-even ricavi > costi fissi');

console.log('\n[3] Margine gestionale a regime (ultimo anno chiuso)');
ok(e.regime && e.regime.anno === '2025', 'a regime = 2025 (ultimo anno chiuso)');
near(e.regime.marginePct, 73599.38 / 174135.5, 0.0005, 'margine 2025 = utileGestionale/ricavi (~42,3%)');
ok(e.regime.marginePct > 0.35 && e.regime.marginePct < 0.50, 'margine a regime plausibile (35-50%)');

console.log('\n[4] Il CE del periodo NON e inquinato dai costi struttura annui');
const c = data.bilancio.ce.cascata;
// Invariante data-independent: la struttura annua (costiFissiAnnui ~20,8k) NON deve essere
// iniettata nel CE del periodo. Se lo fosse, l'EBITDA crollerebbe di ~20,8k. Così il test non
// si rompe quando si aggiungono fatture reali (cambia il baseline, non l'invariante).
ok(c.ebitda > -data.ebitdaGestionale.costiFissiAnnui * 0.5, 'struttura annua NON iniettata nel CE del periodo (EBITDA non crolla di ~20k)');
ok(Math.abs(c.ebitda - data.bilancio.ce.diffAB.importo) < 0.01, 'EBITDA CE = differenza A−B dalle sole fatture');

console.log('\n[5] Trasparenza assunzione personale');
ok(Array.isArray(e.datiMancanti) && e.datiMancanti.some(x => /personale/i.test(x)), 'datiMancanti segnala l assunzione 13a/14a sul personale');

console.log('\nOK — tutte le asserzioni del BLOCCO 4 passano (' + pass + ' check).');
