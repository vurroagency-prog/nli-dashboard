/* gate.mjs — Gate di non-regressione dashboard-a-formule.
 * Esegue compute.js sul registro.json e confronta i numeri CALCOLATI dal vivo
 * con quelli del data.json attuale (incollati a mano). Le differenze sono o un
 * bug del builder o un errore latente nel data.json: vanno spiegate, non nascoste.
 * Uso: node gate.mjs
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const NLICompute = require('./compute.js');

const reg = JSON.parse(readFileSync('./registro.json', 'utf8'));
const statics = JSON.parse(readFileSync('./data.static.json', 'utf8'));
const old = JSON.parse(readFileSync('./data.json', 'utf8'));
const neu = NLICompute.buildDashboardData(reg, statics);

const E = NLICompute.parseEuro;
let warns = 0;
function cmp(label, oldV, newV, tol = 0.01) {
  const a = E(oldV), b = E(newV);
  const d = Math.round((b - a) * 100) / 100;
  const ok = Math.abs(d) <= tol;
  if (!ok) warns++;
  console.log(`${ok ? '  OK ' : ' ⚠️ '} ${label.padEnd(38)} vecchio=${String(oldV).padStart(14)}  nuovo=${String(newV).padStart(14)}  Δ=${d}`);
}

console.log('\n=== BANCA ===');
cmp('saldo attuale', old.banca.saldoAttuale, neu.banca.saldoAttuale);
cmp('saldo iniziale anno', old.banca.saldoInizialeAnno, neu.banca.saldoInizialeAnno);
cmp('totale entrate', old.banca.totali.entrate, neu.banca.totali.entrate);
cmp('totale uscite', old.banca.totali.uscite, neu.banca.totali.uscite);
console.log(`  info movimenti: vecchio totali.movimenti=${old.banca.totali.movimenti} | nuovo=${neu.banca.totali.movimenti}`);
console.log(`  info riconciliazione: vecchio ${old.banca.riconciliazione.riconciliati}/${old.banca.riconciliazione.totaleMovimenti} (${old.banca.riconciliazione.percentuale}%) | nuovo ${neu.banca.riconciliazione.riconciliati}/${neu.banca.riconciliazione.totaleMovimenti} (${neu.banca.riconciliazione.percentuale}%)`);

console.log('\n=== RIEPILOGO MENSILE (saldoFine) ===');
neu.banca.riepilogoMensile.forEach((m, i) => {
  const o = old.banca.riepilogoMensile[i] || {};
  cmp(m.mese + ' saldoFine', o.saldoFine, m.saldoFine);
  cmp(m.mese + ' entrate', o.entrate, m.entrate);
  cmp(m.mese + ' uscite', o.uscite, m.uscite);
});

console.log('\n=== MOVIMENTI MENSILI (totali) ===');
neu.movimentiMensili.forEach((m, i) => {
  const o = old.movimentiMensili.find(x => x.mese === m.mese) || {};
  cmp(m.mese + ' entrate', o.totaleEntrate, m.totaleEntrate);
  cmp(m.mese + ' uscite', o.totaleUscite, m.totaleUscite);
  console.log(`       righe: ${m.entrate.length} entrate, ${m.uscite.length} uscite (vecchio ${(o.entrate||[]).length}/${(o.uscite||[]).length})`);
});

console.log('\n=== IVA ===');
neu.iva.trimestri.forEach((t, i) => {
  const o = old.iva.trimestri[i] || {};
  cmp(t.id + ' ivaDebito (vs vecchio ivaVendite)', o.ivaVendite, t.ivaDebito);
  cmp(t.id + ' ivaCredito (vs vecchio ivaAcquisti)', o.ivaAcquisti, t.ivaCredito);
  cmp(t.id + ' saldo', o.saldo, t.saldo);
});

console.log('\n=== KPI (informativo) ===');
neu.kpi.forEach((k, i) => {
  const o = old.kpi[i] || {};
  console.log(`  [${k.label}] nuovo="${k.value}"  (vecchio: [${o.label}] "${o.value}")`);
});

console.log('\n=== BILANCIO (informativo — il vecchio era fermo a febbraio) ===');
cmp('CE A totale', old.bilancio.ce.A.totale, neu.bilancio.ce.A.totale);
cmp('CE B totale', old.bilancio.ce.B.totale, neu.bilancio.ce.B.totale);
console.log(`  CE diff A-B: vecchio=${old.bilancio.ce.diffAB?.importo} nuovo=${neu.bilancio.ce.diffAB.importo}`);
console.log(`  SP attivo: vecchio=${old.bilancio.sp.attivo.totale} nuovo=${neu.bilancio.sp.attivo.totale}`);
console.log(`  SP verifica: nuovo stato=${neu.bilancio.sp.verifica.stato} Δ=${neu.bilancio.sp.verifica.differenza}`);

console.log('\n=== SCADENZE ===');
console.log(`  vecchio: ${old.scadenze.length} righe | nuovo (da_pagare future): ${neu.scadenze.length}`);
neu.scadenze.slice(0, 6).forEach(s => console.log(`   - ${s.data} ${s.adempimento} [${s.chi}]`));

// ----------------------------------------------------------------- SHAPE CHECK
// Tutti i path che index.html legge devono esistere, o il rendering crasha.
console.log('\n=== SHAPE CHECK (path letti dal rendering) ===');
const paths = [
  'lastUpdate', 'statusMessage', 'statoLavori', 'suggerimenti', 'ebitdaTargetAnnuo',
  'kpi.0.label', 'kpi.0.value', 'kpi.0.class',
  'scadenze.0.data', 'scadenze.0.adempimento', 'scadenze.0.statoLabel',
  'movimentiMensili.0.mese', 'movimentiMensili.0.totaleEntrate', 'movimentiMensili.0.entrate.0.voce', 'movimentiMensili.0.uscite.0.importo',
  'banca.conto', 'banca.saldoAttuale', 'banca.totali.entrate', 'banca.riepilogoMensile.0.saldoFine', 'banca.riconciliazione.movimentiAperti',
  'iva.disclaimer', 'iva.prossimoVersamento.importo', 'iva.trimestri.0.ivaDebito', 'iva.trimestri.0.ivaCredito', 'iva.trimestri.0.breakdown.debito_22', 'iva.trimestri.0.mesi',
  'bilancio.disclaimer', 'bilancio.ce.A.totale', 'bilancio.ce.B.sottoGruppi', 'bilancio.ce.diffAB.importo', 'bilancio.ce.C.totale', 'bilancio.ce.imposte.totale', 'bilancio.ce.utile.importo',
  'bilancio.sp.attivo.totale', 'bilancio.sp.passivo.totale', 'bilancio.sp.pn.totale', 'bilancio.sp.verifica.stato',
  'bilancio.previsioneFiscale.marco.nettoStimato', 'bilancio.previsioneFiscale.irap.aliquota',
  'storico.annuale', 'forecastCassa.labels', 'previsionale', 'alert.0.testo', 'setupChecklist.0.label'
];
let missing = 0;
for (const p of paths) {
  let v = neu, ok = true;
  for (const k of p.split('.')) { if (v == null) { ok = false; break; } v = v[k]; }
  if (v === undefined) { ok = false; }
  if (!ok) { missing++; console.log(`  ❌ MANCA  ${p}`); }
}
console.log(missing === 0 ? '  ✓ Tutti i path richiesti dal rendering esistono.' : `  ❌ ${missing} path mancanti — il rendering crasherebbe.`);

console.log(`\n=== RISULTATO: ${warns} divergenze valori (tol €0,01) · ${missing} path mancanti ===`);
console.log('(divergenze su uscite/bilancio/IVA = correzioni attese: vecchio data.json fermo a feb / bug segno / liquidazione ufficiale Mascolo / registro fatture incompleto)\n');
