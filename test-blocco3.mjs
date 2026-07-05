// test-blocco3.mjs — TDD per il BLOCCO 3 (riserve utili per anno + utili per socio D5 + chiusura sbilancio SP)
// Stile gate.mjs: throw + process.exit(1) al primo fallimento.
//
// CONTRATTO: data.utiliSoci = {
//   anniChiusi:String[], utileCumulatoPostIRAP:Number, prelieviTotali:Number,
//   liquidazioneUscitiTotale:Number,
//   soci:[{ nome, quotaUltimoAnno, attribuito, prelevato, residuo, uscito:Bool, parziale:Bool, residuoFonte:String }],
//   datiMancanti:String[]
// }
// + SP: passivo include "Debiti verso soci uscenti (liquidazione)"; PN "Utili pregressi" non più 0;
//   la verifica SP deve risultare "quadrato".

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('./compute.js');
const reg = require('./registro.json');
const st = require('./data.static.json');

let pass = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); process.exit(1); } console.log('  ✓ ' + m); pass++; }
function near(a, b, t, m) { ok(Math.abs(a - b) <= (t || 0.01), m + ' (' + a + ' ~ ' + b + ')'); }

const data = C.buildDashboardData(reg, st);
const u = data.utiliSoci;

console.log('\n[1] Riserve utili maturate per anno (post-IRAP, da storico − decurtazioni)');
ok(u && Array.isArray(u.anniChiusi), 'utiliSoci.anniChiusi presente');
ok(u.anniChiusi.join(',') === '2023,2024,2025', 'anni chiusi = 2023,2024,2025');
// 16539 + 60756.5 + 69813.09 − 2200 (Timeflow) = 144908.59
near(u.utileCumulatoPostIRAP, 144908.59, 0.01, 'utile cumulato post-IRAP netto decurtazioni');

console.log('\n[2] Attribuzione pro-quota per socio (4 soci 25% 2023-2025)');
ok(Array.isArray(u.soci) && u.soci.length === 4, '4 soci storici');
const marco = u.soci.find(s => /Marco/.test(s.nome));
const sajay = u.soci.find(s => /Sajay/.test(s.nome));
const ales = u.soci.find(s => /Alessandro/.test(s.nome));
const claudia = u.soci.find(s => /Claudia/.test(s.nome));
// utile cumulato 144908.59 / 4 = 36227.1475
near(marco.attribuito, 36227.15, 0.01, 'Marco attribuito cumulato');
near(sajay.attribuito, 36227.15, 0.01, 'Sajay attribuito cumulato');
// somma attribuito = utile cumulato
near(u.soci.reduce((a, s) => a + s.attribuito, 0), u.utileCumulatoPostIRAP, 0.05, 'Σ attribuito = utile cumulato');

console.log('\n[3] Prelievi acconto utili per socio (bank-verified: 2024 prima nota + 2025 E/C + 2026 LIVE dai movimenti)');
// 2026 dal vivo: somma dei movimenti distribuzione_utili che citano il nome proprio del socio
function prel2026(nomeProprio) {
  return Math.round((reg.movimenti || [])
    .filter(m => m.categoria === 'distribuzione_utili' && m.tipo === 'uscita' && String(m.data || '').startsWith('2026'))
    .filter(m => ((m.controparte || '') + ' ' + (m.descrizione || '')).includes(nomeProprio))
    .reduce((s, m) => s + Math.abs(m.importo || 0), 0) * 100) / 100;
}
near(marco.prelevato, 17341 + 11308.86 + prel2026('Marco'), 0.01, 'Marco prelevato (17341 + 11308,86 + 2026 live)');
near(sajay.prelevato, 4200 + 17822.30 + prel2026('Sajay'), 0.01, 'Sajay prelevato (4200 + 17822,30 + 2026 live)');
near(ales.prelevato, 34310.32, 0.01, 'Alessandro prelevato (10510,25 + 19704,98 + 4095,09)');
near(claudia.prelevato, 33463.18, 0.01, 'Claudia prelevato (5757,76 + 21800,51 + 5904,91)');
near(u.prelieviTotali, Math.round(u.soci.reduce((a, s) => a + s.prelevato, 0) * 100) / 100, 0.01, 'prelievi totali = somma per socio');

console.log('\n[4] Residuo bank-verified; usciti = liquidazione ufficiale');
ok(ales.uscito && claudia.uscito, 'Alessandro e Claudia marcati usciti');
ok(!marco.uscito && !sajay.uscito, 'Marco e Sajay soci attuali');
near(ales.residuo, 1916.83, 0.01, 'Alessandro residuo = liquidazione ufficiale');
near(claudia.residuo, 2763.97, 0.01, 'Claudia residuo = liquidazione ufficiale');
near(u.liquidazioneUscitiTotale, 4680.80, 0.01, 'liquidazione usciti totale');
ok(!marco.parziale && !sajay.parziale, 'residuo soci attuali NON più stima (bank-verified)');
near(marco.residuo, Math.round((marco.attribuito - marco.prelevato) * 100) / 100, 0.01, 'Marco residuo = attribuito − prelevato (verificato)');
near(sajay.residuo, Math.round((sajay.attribuito - sajay.prelevato) * 100) / 100, 0.01, 'Sajay residuo = attribuito − prelevato (verificato)');
// il residuo calcolato dei soci usciti deve coincidere con la liquidazione (cross-check 0 warning)
ok(!u.datiMancanti.some(d => /≠ liquidazione/.test(d)), 'residuo calcolato usciti coincide con liquidazione ufficiale');

console.log('\n[5] Chiusura sbilancio SP');
const sp = data.bilancio.sp;
const liq = sp.passivo.gruppi.find(g => /uscent/i.test(g.label));
ok(liq && Math.abs(liq.importo - 4680.80) < 0.01, 'passivo include Debiti verso soci uscenti €4.680,80');
const pregr = sp.pn.dettaglio.find(g => /pregress|riserv/i.test(g.label));
ok(pregr && pregr.importo !== 0, 'PN Utili pregressi/riserve non più a 0');
ok(sp.verifica.stato === 'quadrato', 'SP quadrato dopo chiusura');
ok(Math.abs(sp.verifica.differenza) < 1, 'differenza SP < 1€');

console.log('\nOK — tutte le asserzioni del BLOCCO 3 passano (' + pass + ' check).');
