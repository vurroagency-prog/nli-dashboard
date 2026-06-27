// test-blocco5.mjs — TDD per il BLOCCO 5 (RECINTO / accantonamento tasse — Domanda 2)
// Stile gate.mjs: throw + process.exit(1) al primo fallimento.
//
// CONTRATTO: data.recinto = {
//   totale:Number,
//   componenti:{ tasseCalendario:{totale,voci[]}, iva:{totale,voci[]}, irpefSoci:{totale,stima} },
//   contoAccantonamento:{configurato:Bool,id,saldo}, ammancoRecinto, daVersareOggi, coperto,
//   saldoOperativo, saldoOperativoLibero,
//   percentualeAccantonamento:{disponibile,aliquotaIVAmedia,marginePct,pressioneFiscalePct,
//     imposteRedditoSuImponibilePct,pctSuImponibile,pctSuIncassatoLordo,nota,datiMancanti},
//   perimetro:String, datiMancanti:String[]
// }

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('./compute.js');
const reg = require('./registro.json');
const st = require('./data.static.json');

let pass = 0;
function ok(c, m) { if (!c) { console.error('  ✗ ' + m); process.exit(1); } console.log('  ✓ ' + m); pass++; }
function near(a, b, t, m) { ok(Math.abs(a - b) <= (t || 0.01), m + ' (' + a + ' ~ ' + b + ')'); }

const data = C.buildDashboardData(reg, st);
const r = data.recinto;

console.log('\n[1] Struttura e somma a 3 componenti (senza doppi conteggi)');
ok(r && typeof r.totale === 'number', 'recinto.totale presente');
const A = r.componenti.tasseCalendario, B = r.componenti.iva, Cc = r.componenti.irpefSoci;
near(r.totale, A.totale + B.totale + Cc.totale, 0.01, 'totale = tasseCalendario + iva + irpefSoci');

console.log('\n[2] A) scadenze fiscali a calendario — IVA esclusa, INPS 1a rata pagata esclusa');
ok(A.voci.length >= 1, 'almeno una voce a calendario');
ok(!A.voci.some(v => /iva/i.test(v.label)), 'nessuna voce IVA dentro A (presa derivata in B)');
ok(!A.voci.some(v => v.id === 'SCAD-2026-0027'), 'INPS 1a rata (pagata) NON nel recinto');
// 3 rate INPS residue (2a/3a/4a) + IRAP (854,50+1359,50) + INAIL (3 rate) + CCIAA 152
const inps = A.voci.filter(v => /INPS/i.test(v.label)).reduce((s, v) => s + v.importo, 0);
near(inps, 3411, 0.01, 'INPS = 3 rate residue da 1137 (1a pagata)');
near(A.totale, 5985.71, 0.01, 'A totale = 5.985,71 (IRAP+INPS+INAIL+CCIAA)');

console.log('\n[3] B) IVA dovuta DERIVATA dai trimestri (non statica)');
ok(typeof B.totale === 'number' && B.totale >= 0, 'IVA dovuta >= 0');
// coerenza con calcIVA: somma degli importoVersamento dei trimestri = B.totale
const ivaVersTot = data.iva.trimestri.filter(t => t.importoVersamento > 0).reduce((s, t) => s + t.importoVersamento, 0);
near(B.totale, Math.round(ivaVersTot * 100) / 100, 0.02, 'B = somma versamenti IVA trimestrali dovuti');
ok(!B.voci.some(v => /credito/i.test(v.periodo || '')), 'i trimestri in credito (Q1) non versano → non in B');

console.log('\n[4] C) IRPEF soci = STIMA su quota partecipazione, INPS escluso (già in A)');
ok(Cc.stima && Cc.stima.redditoPartecipazionePerSocio === 17870, 'reddito partecipazione 17.870/socio (da CU)');
ok(Cc.stima.nSoci === 2, '2 soci attuali (Marco+Sajay)');
near(Cc.totale, 9124.42, 1, 'IRPEF+addizionali stimata ~9.124 (Marco + marginale Sajay)');
// invariante: C non deve includere l'INPS (che è in A). Su 17.870 < minimale, INPS eccedenza = 0.
ok(Cc.totale < 11000, 'C non gonfiata dall INPS (escluso)');
ok(r.datiMancanti.some(x => /IRPEF.*STIMA|STIMA.*quota/i.test(x)), 'datiMancanti segnala che IRPEF è una stima (manca PF)');

console.log('\n[5] 2° conto + ammanco + operativo libero (giroconti)');
ok(r.contoAccantonamento.configurato === true, '2° conto configurato (BANCA-ISP-002)');
ok(r.contoAccantonamento.saldo === null, 'saldo 2° conto null finché manca l E/C');
ok(r.datiMancanti.some(x => /E\/C|saldo del 2/i.test(x)), 'datiMancanti chiede l E/C del 2° conto');
// con saldo null, ammanco = intero recinto
near(r.ammancoRecinto, r.totale, 0.01, 'ammanco = totale (recinto vuoto finché saldo null)');
near(r.daVersareOggi, r.ammancoRecinto, 0.01, 'da versare oggi = ammanco');
near(r.saldoOperativoLibero, r.saldoOperativo - r.ammancoRecinto, 0.01, 'operativo libero = operativo − ammanco');
ok(r.saldoOperativoLibero < 0, 'oggi operativo libero negativo → niente utili ritirabili (banca < recinto)');

console.log('\n[6] Perimetro: niente TFR né liquidazione soci usciti');
ok(/TFR/i.test(r.perimetro) && /esclus/i.test(r.perimetro), 'perimetro dichiara TFR/liquidazione esclusi');
ok(!A.voci.some(v => /TFR|liquidazione soci|liquidazione usciti|claudia|alessandro/i.test(v.label)), 'nessuna voce TFR/liquidazione-soci in A (autoliquidazione INAIL è una tassa, ammessa)');

console.log('\n[7] % accantonamento per incasso (modello v1 parametrico)');
const p = r.percentualeAccantonamento;
ok(p.disponibile === true, '% accantonamento disponibile');
near(p.aliquotaIVAmedia, 0.22, 0.001, 'IVA media 22%');
// imposte reddito su imponibile = margine × pressione
near(p.imposteRedditoSuImponibilePct, Math.round(p.marginePct * p.pressioneFiscalePct) / 100, 0.05, 'imposte reddito = margine × pressione');
// % su imponibile = IVA% + imposte reddito%
near(p.pctSuImponibile, 22 + p.imposteRedditoSuImponibilePct, 0.05, '% su imponibile = 22 + imposte reddito');
// % su incassato lordo = % su imponibile / 1,22
near(p.pctSuIncassatoLordo, p.pctSuImponibile / 1.22, 0.05, '% su incassato lordo = imponibile/(1+IVA)');
ok(p.pctSuIncassatoLordo > 25 && p.pctSuIncassatoLordo < 45, '% su incassato lordo plausibile (25-45%)');
ok(p.datiMancanti.some(x => /margine.*business|business.*proprio/i.test(x)), 'segnala che il margine include i clienti del fratello (da affinare)');

console.log('\nOK — tutte le asserzioni del BLOCCO 5 passano (' + pass + ' check).');
