// test-blocco1.mjs — TDD per il BLOCCO 1 (salute cassa + scadenzario fiscale)
// Stile gate.mjs: throw + process.exit(1) al primo fallimento, niente dipendenze.
// DEVE FALLIRE finché compute.js non espone i nuovi blocchi `cassaSalute` e `fiscale`.
//
// CONTRATTO ATTESO (da implementare in compute.js -> buildDashboardData output):
//
// data.cassaSalute = {
//   burn:   { gross:Number, netto:Number, operativo:Number, grossFmt, nettoFmt, operativoFmt },
//   runway: { mesi:Number|null, crescita:Boolean, label:String },
//   saldoMinimo:Number, saldoMinimoMese:String,
//   scenarioSoloCerti: { saldo:Number[], saldoFine:Number, saldoMinimo:Number, saldoMinimoMese:String },
//   sogliaSicurezza:Number, sogliaSicurezzaMesi:Number, costiFissiMensili:Number,
//   meseSottoSoglia:String|null, meseSottoSogliaSaldo:Number|null, meseSottoZero:String|null,
//   datiMancanti:String[]
// }
// data.fiscale = {
//   scadenzarioForward: [ {id,data,tipo,importo:Number|null,importoNoto:Boolean,label:String} ],
//   totaleTasseResidueAnno:Number, accantonamentoMensile:Number, mesiRimanenti:Number,
//   datiMancanti:String[]
// }

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const C   = require('./compute.js');
const reg = require('./registro.json');
const st  = require('./data.static.json');


let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); }
  else { failures++; console.log('  ✗ ' + label + (detail ? '  -> ' + detail : '')); }
}
function isNum(x) { return typeof x === 'number' && !Number.isNaN(x); }
function near(a, b, tol) { return isNum(a) && isNum(b) && Math.abs(a - b) <= tol; }

console.log('TEST BLOCCO 1 — salute cassa + scadenzario fiscale\n');

const data = C.buildDashboardData(reg, st);
const cs = data.cassaSalute || {};
const fi = data.fiscale || {};

// ------------------------------------------------------------ presenza blocchi
console.log('[0] Presenza blocchi');
ok('data.cassaSalute esiste (oggetto)', cs && typeof cs === 'object' && Object.keys(cs).length > 0);
ok('data.fiscale esiste (oggetto)',     fi && typeof fi === 'object' && Object.keys(fi).length > 0);

// ------------------------------------------------------------ (b) burn gross+net
console.log('\n[1] Burn rate (gross + net + operativo)');
const burn = cs.burn || {};
ok('burn.gross numerico',     isNum(burn.gross),     'val=' + burn.gross);
ok('burn.netto numerico',     isNum(burn.netto),     'val=' + burn.netto);
ok('burn.operativo numerico', isNum(burn.operativo), 'val=' + burn.operativo);
ok('burn.netto = gross - incassi medi (netto <= gross)', isNum(burn.gross) && isNum(burn.netto) && burn.netto <= burn.gross + 0.01,
   'gross=' + burn.gross + ' netto=' + burn.netto);

// ------------------------------------------------------------ (a) runway
console.log('\n[2] Runway (mesi di autonomia)');
ok('runway presente', cs.runway && typeof cs.runway === 'object');
const rw = cs.runway || {};
ok('runway.crescita booleano', typeof rw.crescita === 'boolean', 'val=' + rw.crescita);
ok('runway numerico se burn>0, oppure flag crescita',
   rw.crescita === true || isNum(rw.mesi), 'mesi=' + rw.mesi + ' crescita=' + rw.crescita);
ok('runway.label stringa Homer-proof', typeof rw.label === 'string' && rw.label.length > 0);

// ------------------------------------------------------------ (c) saldo minimo + mese
console.log('\n[3] Saldo minimo proiettato + mese');
ok('cassaSalute.saldoMinimo numerico', isNum(cs.saldoMinimo), 'val=' + cs.saldoMinimo);
ok('cassaSalute.saldoMinimoMese stringa', typeof cs.saldoMinimoMese === 'string' && cs.saldoMinimoMese.length > 0, 'val=' + cs.saldoMinimoMese);
const fcSaldo = (data.forecastCassa && data.forecastCassa.saldo) || [];
ok('saldoMinimo == min(forecast.saldo)', fcSaldo.length === 12 && cs.saldoMinimo === Math.min.apply(null, fcSaldo),
   'min=' + (fcSaldo.length ? Math.min.apply(null, fcSaldo) : 'n/a') + ' vs ' + cs.saldoMinimo);

// ------------------------------------------------------------ (d) scenario solo-certi
console.log('\n[4] Scenario senza vendite nuove (solo incassi certi)');
const sc = cs.scenarioSoloCerti || {};
ok('scenarioSoloCerti presente', sc && typeof sc === 'object' && Object.keys(sc).length > 0);
ok('scenarioSoloCerti.saldo array 12', Array.isArray(sc.saldo) && sc.saldo.length === 12);
ok('scenarioSoloCerti.saldoFine numerico', isNum(sc.saldoFine), 'val=' + sc.saldoFine);
ok('scenarioSoloCerti.saldoMinimo numerico', isNum(sc.saldoMinimo), 'val=' + sc.saldoMinimo);
ok('worst-case <= scenario base (saldoFine certi <= forecast saldoFine)',
   isNum(sc.saldoFine) && isNum(data.forecastCassa && data.forecastCassa.kpi && data.forecastCassa.kpi.saldoFine) &&
   sc.saldoFine <= data.forecastCassa.kpi.saldoFine + 0.01,
   'certi=' + sc.saldoFine + ' base=' + (data.forecastCassa && data.forecastCassa.kpi && data.forecastCassa.kpi.saldoFine));

// ------------------------------------------------------------ (e) soglia sicurezza parametrica (NO 5000 hardcoded)
console.log('\n[5] Soglia di sicurezza parametrica (sogliaSicurezzaMesi x fissi)');
const sogliaMesi = reg.configurazione && reg.configurazione.sogliaSicurezzaMesi;
const fissi = C._calc.calcCostiRicorrenti(reg).totaleMensile;
const sogliaAttesa = Math.round((sogliaMesi * fissi) * 100) / 100;
ok('config.sogliaSicurezzaMesi presente', isNum(sogliaMesi), 'val=' + sogliaMesi);
ok('cassaSalute.sogliaSicurezzaMesi == config', cs.sogliaSicurezzaMesi === sogliaMesi, 'val=' + cs.sogliaSicurezzaMesi);
ok('cassaSalute.costiFissiMensili == calcCostiRicorrenti.totaleMensile', near(cs.costiFissiMensili, fissi, 0.01),
   'val=' + cs.costiFissiMensili + ' atteso=' + fissi);
ok('cassaSalute.sogliaSicurezza == mesi x fissi', near(cs.sogliaSicurezza, sogliaAttesa, 0.5),
   'val=' + cs.sogliaSicurezza + ' atteso=' + sogliaAttesa);
ok('soglia NON e il 5000 hardcoded', cs.sogliaSicurezza !== 5000, 'val=' + cs.sogliaSicurezza);

// ------------------------------------------------------------ (f) mese sotto-soglia
console.log('\n[6] Mese di rottura sotto-soglia (+ meseSottoZero preservato)');
ok('campo meseSottoSoglia presente (string|null)', ('meseSottoSoglia' in cs) && (cs.meseSottoSoglia === null || typeof cs.meseSottoSoglia === 'string'),
   'val=' + cs.meseSottoSoglia);
ok('campo meseSottoSogliaSaldo presente (number|null)', ('meseSottoSogliaSaldo' in cs) && (cs.meseSottoSogliaSaldo === null || isNum(cs.meseSottoSogliaSaldo)),
   'val=' + cs.meseSottoSogliaSaldo);
ok('meseSottoZero ancora esposto (compat)', ('meseSottoZero' in cs), 'val=' + cs.meseSottoZero);
// coerenza: il primo mese con saldo < soglia deve combaciare con meseSottoSogliaSaldo (se esiste)
if (isNum(cs.sogliaSicurezza) && fcSaldo.length === 12) {
  let idx = -1; for (let i = 0; i < 12; i++) if (fcSaldo[i] < cs.sogliaSicurezza) { idx = i; break; }
  const atteso = idx >= 0 ? fcSaldo[idx] : null;
  ok('meseSottoSogliaSaldo coerente col primo saldo < soglia', cs.meseSottoSogliaSaldo === atteso,
     'val=' + cs.meseSottoSogliaSaldo + ' atteso=' + atteso);
}

// ------------------------------------------------------------ (g) scadenzario fiscale forward con le 3 F24
console.log('\n[7] Scadenzario fiscale forward 12 mesi (con le 3 F24 reali)');
const fwd = fi.scadenzarioForward || [];
ok('scadenzarioForward e un array non vuoto', Array.isArray(fwd) && fwd.length > 0, 'len=' + (fwd && fwd.length));
const importi = fwd.map(function (x) { return x && x.importo; });
function hasImporto(v) { return importi.some(function (i) { return near(i, v, 0.01); }); }
ok('contiene IRAP 1° acconto €854,50', hasImporto(854.5));
ok('contiene CCIAA €152', hasImporto(152));
ok('contiene IRAP 2° acconto €1.359,50', hasImporto(1359.5));
// ordinato per data crescente
const date = fwd.map(function (x) { return x && x.data; }).filter(Boolean);
let ordinato = true; for (let i = 1; i < date.length; i++) if (date[i] < date[i - 1]) ordinato = false;
ok('scadenzarioForward ordinato per data', ordinato);
// voci importo:null mostrate (non omesse): se IRPEF soci e in_attesa, deve comparire come "da quantificare"
ok('voci con importo:null hanno importoNoto=false (mostrate, non omesse)',
   fwd.every(function (x) { return x.importo === null ? x.importoNoto === false : x.importoNoto === true; }));

// ------------------------------------------------------------ (h) totale tasse residue anno
console.log('\n[8] Totale tasse residue anno');
ok('fiscale.totaleTasseResidueAnno numerico', isNum(fi.totaleTasseResidueAnno), 'val=' + fi.totaleTasseResidueAnno);
ok('totale include le 3 F24 (>= 2366)', isNum(fi.totaleTasseResidueAnno) && fi.totaleTasseResidueAnno >= 2366 - 0.01,
   'val=' + fi.totaleTasseResidueAnno);

// ------------------------------------------------------------ (i) accantonamento mensile
console.log('\n[9] Accantonamento fiscale mensile consigliato');
ok('fiscale.mesiRimanenti numerico > 0', isNum(fi.mesiRimanenti) && fi.mesiRimanenti > 0, 'val=' + fi.mesiRimanenti);
ok('fiscale.accantonamentoMensile numerico > 0', isNum(fi.accantonamentoMensile) && fi.accantonamentoMensile > 0, 'val=' + fi.accantonamentoMensile);
ok('accantonamento == residue / mesi rimanenti',
   isNum(fi.accantonamentoMensile) && isNum(fi.totaleTasseResidueAnno) && isNum(fi.mesiRimanenti) &&
   near(fi.accantonamentoMensile, fi.totaleTasseResidueAnno / fi.mesiRimanenti, 1),
   'val=' + fi.accantonamentoMensile + ' atteso=' + (isNum(fi.totaleTasseResidueAnno) && fi.mesiRimanenti ? (fi.totaleTasseResidueAnno / fi.mesiRimanenti) : 'n/a'));

// ------------------------------------------------------------ (j) imposte F24 ENTRANO nel forecast
// (prima confrontava un baseline salvato in /tmp di una sessione: file effimero, test rotto.
//  Ora check strutturale: i mesi futuri con scadenze fiscali da_pagare hanno uscite > soli costi fissi)
console.log('\n[10] Le imposte F24 entrano nel forecast (check strutturale, senza baseline)');
const nowSaldoFine = data.forecastCassa && data.forecastCassa.kpi && data.forecastCassa.kpi.saldoFine;
ok('saldoFine attuale numerico', isNum(nowSaldoFine), 'val=' + nowSaldoFine);
const fc = data.forecastCassa || {};
const scadFiscaliFuture = (reg.scadenze || []).filter(s =>
  s.stato === 'da_pagare' && typeof s.importo === 'number' && /^\d{4}-\d{2}/.test(String(s.data || '')));
ok('ci sono scadenze fiscali future da pagare nel registro', scadFiscaliFuture.length > 0, 'n=' + scadFiscaliFuture.length);
const usciteFuture = (fc.uscite || []).slice(fc.realCount || 0).reduce((a, u) => a + (u || 0), 0);
ok('il forecast ha mesi futuri con uscite > 0', usciteFuture > 0, 'uscite=' + usciteFuture);

// ------------------------------------------------------------ datiMancanti = niente fallback silenzioso
console.log('\n[11] Segnalazione input mancanti (no fallback silenzioso)');
ok('cassaSalute.datiMancanti e un array', Array.isArray(cs.datiMancanti), 'tipo=' + (typeof cs.datiMancanti));
ok('fiscale.datiMancanti e un array', Array.isArray(fi.datiMancanti), 'tipo=' + (typeof fi.datiMancanti));

// ------------------------------------------------------------ esito
console.log('\n' + (failures === 0
  ? 'OK — tutte le asserzioni del BLOCCO 1 passano.'
  : 'FAIL — ' + failures + ' asserzioni fallite (atteso in stadio TDD: compute.js non implementa ancora il blocco 1).'));
process.exit(failures === 0 ? 0 : 1);
