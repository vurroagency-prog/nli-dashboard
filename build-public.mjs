/* build-public.mjs — Genera registro.public.json (versione SANITIZZATA per Pages).
 * registro.json (completo) NON va mai pubblicato: contiene dati personali e di terzi.
 * Questo script ne deriva una copia pubblicabile, togliendo:
 *  - chiavi sensibili ovunque: iban, piva/partitaIva, codiceFiscale/cf
 *  - sezioni con dati personali: dettaglioPaghe, rimborsi
 *  - dentro previsioneFiscale: il dettaglio redditi/netti per singolo socio
 * Mantiene tutto ciò che serve alla dashboard (banca, mensili, KPI, IVA, scadenze,
 * bilancio CE/SP, carico fiscale societario aggregato).
 * Uso: node build-public.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SENSITIVE_KEYS = ['iban', 'IBAN', 'piva', 'partitaIva', 'codiceFiscale', 'cf'];
const removed = {};

// maschera dati sensibili dentro testo libero (note/descrizioni)
const IBAN_RX = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;          // IBAN qualsiasi paese
const CF_RX = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;   // codice fiscale persona
function maskText(s) {
  return s.replace(IBAN_RX, '[IBAN rimosso]').replace(CF_RX, '[CF rimosso]');
}

function strip(o) {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) {
      if (SENSITIVE_KEYS.includes(k)) { removed[k] = (removed[k] || 0) + 1; continue; }
      out[k] = strip(o[k]);
    }
    return out;
  }
  if (typeof o === 'string') {
    const m = maskText(o);
    if (m !== o) removed['§testo-mascherato'] = (removed['§testo-mascherato'] || 0) + 1;
    return m;
  }
  return o;
}

const reg = JSON.parse(readFileSync('./registro.json', 'utf8'));
const pub = strip(reg);

// sezioni top-level con dati personali → via del tutto
['dettaglioPaghe', 'rimborsi'].forEach(s => { if (pub[s] !== undefined) { delete pub[s]; removed['§' + s] = 1; } });

// previsione fiscale: togli il dettaglio per-socio (redditi/netti), tieni gli aggregati societari
if (pub.previsioneFiscale) {
  delete pub.previsioneFiscale.soci;
  if (pub.previsioneFiscale.stima) {
    delete pub.previsioneFiscale.stima.marco;
    delete pub.previsioneFiscale.stima.sajay;
    removed['§previsioneFiscale.soci+stima(marco/sajay)'] = 1;
  }
}

// marcatore
pub.meta = pub.meta || {};
pub.meta.versionePubblica = 'sanitizzata per pubblicazione (no IBAN/CF/P.IVA/redditi soci/paghe)';

writeFileSync('./registro.public.json', JSON.stringify(pub, null, 1));

// verifica anti-leak: nessuna chiave sensibile residua nel file scritto
const raw = readFileSync('./registro.public.json', 'utf8');
const leaks = [];
[/"iban"/i, /"partitaIva"/, /"piva"/, /"codiceFiscale"/, /\bIT\d{2}[A-Z0-9]{10,}/].forEach(rx => {
  if (rx.test(raw)) leaks.push(rx.toString());
});

console.log('registro.public.json generato.');
console.log('Rimosso:', JSON.stringify(removed));
if (leaks.length) { console.log('❌ POSSIBILE LEAK residuo:', leaks.join(', ')); process.exit(1); }
console.log('✓ Nessun IBAN/P.IVA/CF residuo nel file pubblico.');
