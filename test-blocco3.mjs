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
// 16539 + 60756.5 + 69813.09 − 550 (Timeflow) = 146558.59
near(u.utileCumulatoPostIRAP, 146558.59, 0.01, 'utile cumulato post-IRAP netto decurtazioni');

console.log('\n[2] Attribuzione pro-quota per socio (4 soci 25% 2023-2025)');
ok(Array.isArray(u.soci) && u.soci.length === 4, '4 soci storici');
const marco = u.soci.find(s => /Marco/.test(s.nome));
const sajay = u.soci.find(s => /Sajay/.test(s.nome));
const ales = u.soci.find(s => /Alessandro/.test(s.nome));
const claudia = u.soci.find(s => /Claudia/.test(s.nome));
// 4134.75 + 15189.125 + (69263.09*0.25=17315.7725) = 36639.6475
near(marco.attribuito, 36639.65, 0.01, 'Marco attribuito cumulato');
near(sajay.attribuito, 36639.65, 0.01, 'Sajay attribuito cumulato');
// somma attribuito = utile cumulato
near(u.soci.reduce((a, s) => a + s.attribuito, 0), u.utileCumulatoPostIRAP, 0.05, 'Σ attribuito = utile cumulato');

console.log('\n[3] Prelievi documentati per socio');
near(marco.prelevato, 500, 0.01, 'Marco prelevato (MOV-0023)');
near(sajay.prelevato, 500, 0.01, 'Sajay prelevato (MOV-0249)');
near(ales.prelevato, 4095, 0.01, 'Alessandro prelevato (quota MOV-0015)');
near(claudia.prelevato, 5905, 0.01, 'Claudia prelevato (quota MOV-0015)');
near(u.prelieviTotali, 11000, 0.01, 'prelievi totali documentati = 10.000 + 500 + 500');

console.log('\n[4] Residuo: usciti = liquidazione ufficiale; attuali = parziale flaggato');
ok(ales.uscito && claudia.uscito, 'Alessandro e Claudia marcati usciti');
ok(!marco.uscito && !sajay.uscito, 'Marco e Sajay soci attuali');
near(ales.residuo, 1916.83, 0.01, 'Alessandro residuo = liquidazione ufficiale');
near(claudia.residuo, 2763.97, 0.01, 'Claudia residuo = liquidazione ufficiale');
ok(ales.residuoFonte === 'liquidazione' && claudia.residuoFonte === 'liquidazione', 'residuo usciti da liquidazione ufficiale');
near(u.liquidazioneUscitiTotale, 4680.80, 0.01, 'liquidazione usciti totale');
ok(marco.parziale && sajay.parziale, 'residuo soci attuali flaggato parziale (prelievi storici non censiti)');
near(marco.residuo, 36139.65, 0.01, 'Marco residuo = attribuito − prelevato (sovrastimato)');
ok(u.datiMancanti.some(d => /prelievi.*storici/i.test(d)), 'datiMancanti segnala prelievi storici da censire');

console.log('\n[5] Chiusura sbilancio SP');
const sp = data.bilancio.sp;
const liq = sp.passivo.gruppi.find(g => /uscent/i.test(g.label));
ok(liq && Math.abs(liq.importo - 4680.80) < 0.01, 'passivo include Debiti verso soci uscenti €4.680,80');
const pregr = sp.pn.dettaglio.find(g => /pregress|riserv/i.test(g.label));
ok(pregr && pregr.importo !== 0, 'PN Utili pregressi/riserve non più a 0');
ok(sp.verifica.stato === 'quadrato', 'SP quadrato dopo chiusura');
ok(Math.abs(sp.verifica.differenza) < 1, 'differenza SP < 1€');

console.log('\nOK — tutte le asserzioni del BLOCCO 3 passano (' + pass + ' check).');
