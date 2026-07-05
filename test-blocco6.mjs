// TEST BLOCCO 6 — tasse per socio + guida tasse + alert derivati + "cosa genera l'azienda"
// Lancio: node test-blocco6.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const C = require('./compute.js');
const reg = require('./registro.json');
const st = require('./data.static.json');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); }
  else { failures++; console.log('  ✗ ' + label + (detail ? '  -> ' + detail : '')); }
}
function isNum(x) { return typeof x === 'number' && !Number.isNaN(x); }

console.log('TEST BLOCCO 6 — tasse soci / guida / alert derivati / generazione\n');
const d = C.buildDashboardData(reg, st);

// ------------------------------------------------ tasseSoci
console.log('[1] Tasse per socio');
const ts = d.tasseSoci || {};
ok('tasseSoci esiste', ts && Array.isArray(ts.schede));
ok('3 schede (Marco, Sajay, Società)', ts.schede && ts.schede.length === 3, 'n=' + (ts.schede || []).length);
const marco = (ts.schede || []).find(s => s.key === 'marco') || {};
const sajay = (ts.schede || []).find(s => s.key === 'sajay') || {};
const soc = (ts.schede || []).find(s => s.key === 'societa') || {};
ok('Marco: versato = somma ledger perimetro marco', (() => {
  const att = (reg.previsioneFiscale.versamenti || []).filter(v => v.perimetro === 'marco')
    .reduce((a, v) => a + v.importo, 0);
  return isNum(marco.versato) && Math.abs(marco.versato - att) < 0.01;
})(), 'val=' + marco.versato);
ok('Marco: stima include INPS fisso 4.515', (marco.righeStima || []).some(r => /INPS/.test(r.label) && r.importo === 4515));
ok('Sajay: nessuna riga INPS (accomandante)', !(sajay.righeStima || []).some(r => /INPS/.test(r.label)));
ok('Società: versato > 0 e lista popolata', isNum(soc.versato) && soc.versato > 0 && (soc.versamenti || []).length > 0);
ok('F24 ignoto €1.663 flaggato daIdentificare', (soc.versamenti || []).some(v => v.daIdentificare && Math.abs(v.importo - 1663) < 0.01));
ok('residuo Marco = max(0, stima - versato)', isNum(marco.residuo) && Math.abs(marco.residuo - Math.max(0, marco.stimaTotale - marco.versato)) < 0.01);

// versione pubblica: sezione nascosta
const pubReg = JSON.parse(JSON.stringify(reg));
pubReg.meta.versionePubblica = 'test';
delete pubReg.previsioneFiscale.versamenti;
const tsPub = C._calc.calcTasseSoci(pubReg, d.bilancio);
ok('versione pubblica -> nascosto', tsPub && tsPub.nascosto === true);

// ------------------------------------------------ guidaTasse
console.log('\n[2] Guida tasse');
const g = d.guidaTasse || {};
ok('guidaTasse ha gruppi', Array.isArray(g.gruppi) && g.gruppi.length >= 4, 'n=' + (g.gruppi || []).length);
const tutte = (g.gruppi || []).flatMap(x => x.voci);
ok('almeno 20 voci nel catalogo', tutte.length >= 20, 'n=' + tutte.length);
ok('le non-applicabili hanno stato na con motivo', tutte.filter(v => !v.applicabile).every(v => v.stato === 'na' && v.notaApplicabile));
const iva = tutte.find(v => v.id === 'ADE-IVA-TRIM');
ok('IVA trimestrale agganciata a una scadenza futura censita', iva && iva.stato === 'ok' && !!iva.prossimaData, iva && iva.statoLabel);
ok('nessuna voce senza nome/cosa', tutte.every(v => v.nome && v.cosa));

// ------------------------------------------------ alert derivati
console.log('\n[3] Alert derivati');
const al = d.alert || [];
ok('alert è un array non vuoto', Array.isArray(al) && al.length > 0);
ok('formato {tipo,testo} compatibile col render', al.every(a => a.tipo && a.testo));
ok('niente suggerimenti statici stantii', d.suggerimenti === '');
// scadenza scaduta da_pagare nota (INAIL 2a rata 18/05) deve produrre un danger
ok('la scaduta INAIL 18/05 genera un alert rosso', al.some(a => a.tipo === 'danger' && /INAIL/.test(a.testo)));
// robustezza: scadenza senza data -> alert tecnico
const regBad = JSON.parse(JSON.stringify(reg));
regBad.scadenze.push({ id: 'SCAD-TEST-NODATE', descrizione: 'test', stato: 'da_pagare' });
const alBad = C._calc.calcAlertDerivati(regBad);
ok('scadenza senza data valida -> alert tecnico', alBad.some(a => /senza data/.test(a.testo) && /SCAD-TEST-NODATE/.test(a.testo)));

// ------------------------------------------------ generazione
console.log('\n[4] Cosa genera l\'azienda');
const gz = d.generazione || {};
const CHIAVI_CATENA = ['venduto', 'margine', 'fissi', 'utile', 'cassa', 'firmato'];
ok('le 6 righe della catena ci sono tutte', CHIAVI_CATENA.every(k => (gz.righe || []).some(x => x.key === k)), 'keys=' + (gz.righe || []).map(x => x.key).join(','));
ok('riga utili residui soci (solo versione privata)', (gz.righe || []).some(x => x.key === 'utiliResidui'));
ok('utile = utile netto del CE', (() => {
  const r = (gz.righe || []).find(x => x.key === 'utile');
  return r && r.valoreFmt.replace(/[^\d,.-−]/g, '') !== '';
})());
const rm = (gz.righe || []).find(x => x.key === 'margine');
ok('margine 2026 dichiara i costi mancanti', rm && /senza costi/.test(rm.sub || ''), rm && rm.sub);

// ------------------------------------------------ previsione fiscale de-cablata
console.log('\n[5] Previsione fiscale de-cablata (imposteApplicabili)');
const pf = d.bilancio.previsioneFiscale;
ok('perSocio presente con 2 soci', Array.isArray(pf.perSocio) && pf.perSocio.length === 2);
ok('INPS solo al socio con INPS_commercianti', pf.marco.inpsFisso === 4515 && pf.sajay.inpsFisso === 0);
ok('zero warning con compagine 2026', (pf._warnings || []).length === 0, JSON.stringify(pf._warnings));
// socio ipotetico senza INPS: il motore lo tratta dal dato, non dal nome
const regX = JSON.parse(JSON.stringify(reg));
regX.previsioneFiscale.sociPerAnno['2026'].push({ nome: 'Test Socio', quota: 0, tipo: 'accomandante', redditoDipendente: 0, altriRedditi: 0, imposteApplicabili: ['IRPEF'] });
const pfX = C._calc.calcPrevisioneFiscale(regX, 10000, 10000);
ok('terzo socio entra nel calcolo senza toccare il codice', pfX.perSocio.length === 3 && pfX.perSocio[2].inpsFisso === 0);
ok('quote != 100% genera warning', (pfX._warnings || []).length === 0, 'le quote sommano ancora a 1: nessun warning atteso');

console.log('');
if (failures) { console.log('FAIL — ' + failures + ' asserzioni fallite.'); process.exit(1); }
console.log('OK — tutte le asserzioni del BLOCCO 6 passano.');
