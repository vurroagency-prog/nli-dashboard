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

const SENSITIVE_KEYS = ['iban', 'IBAN', 'piva', 'partitaIva', 'codiceFiscale', 'cf', 'email'];
const removed = {};

// maschera dati sensibili dentro testo libero (note/descrizioni)
const IBAN_RX = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;          // IBAN qualsiasi paese
const CF_RX = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;   // codice fiscale persona
const EMAIL_RX = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;             // email in testo libero
const PIVA_RX = /\b\d{11}\b/g;                                   // P.IVA italiana in testo libero
function maskText(s) {
  return s.replace(IBAN_RX, '[IBAN rimosso]').replace(CF_RX, '[CF rimosso]')
          .replace(EMAIL_RX, '[email rimossa]').replace(PIVA_RX, '[P.IVA rimossa]');
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
['dettaglioPaghe', 'rimborsi', 'debitiVersoSoci'].forEach(s => { if (pub[s] !== undefined) { delete pub[s]; removed['§' + s] = 1; } });

// CATALOGO ADEMPIMENTI: guida informativa, ok pubblica ma senza nomi di persone
if (pub.catalogoAdempimenti && Array.isArray(pub.catalogoAdempimenti.voci)) {
  const RX = /Marco Vurro|Sajay Fernandez Espinosa|\bMarco\b|\bSajay\b|\bClaudia\b/g;
  pub.catalogoAdempimenti.voci.forEach(v => {
    ['nome', 'chi', 'cosa', 'comeSiCalcola', 'quando', 'notaApplicabile'].forEach(k => {
      if (typeof v[k] === 'string' && RX.test(v[k])) {
        v[k] = v[k].replace(RX, m => /sajay/i.test(m) ? 'la socia' : /claudia/i.test(m) ? "l'ex dipendente" : 'il socio');
        removed['§catalogo(nomi)'] = (removed['§catalogo(nomi)'] || 0) + 1;
      }
      RX.lastIndex = 0;
    });
  });
}

// LEDGER VERSAMENTI (F24 personali dei soci) → mai pubblico
if (pub.previsioneFiscale) {
  delete pub.previsioneFiscale.versamenti;
  delete pub.previsioneFiscale.versamentiNota;
  removed['§previsioneFiscale.versamenti'] = 1;
}

// SCADENZE: anonimizza i nomi dei soci nei testi (chi/descrizione/note)
const SOCI_RX = /Marco Vurro|VurroMarco|Sajay Fernandez Espinosa|\bMarco\b|\bSajay\b/g;
(pub.scadenze || []).forEach(s => {
  ['chi', 'descrizione', 'nota', 'note', 'notaPagamento', 'fileArchiviato', 'fonte'].forEach(k => {
    if (typeof s[k] === 'string' && SOCI_RX.test(s[k])) {
      s[k] = s[k].replace(SOCI_RX, 'socio');
      removed['§scadenze(nomi soci)'] = (removed['§scadenze(nomi soci)'] || 0) + 1;
    }
    SOCI_RX.lastIndex = 0;
  });
});

// ORDINI: margini di contribuzione, costi per voce, P.IVA clienti → dati commerciali
// sensibili, MAI pubblici. Via tutta la sezione.
if (pub.ordini !== undefined) { delete pub.ordini; removed['§ordini'] = 1; }

// PORTAFOGLIO ORDINI: tieni solo gli aggregati che servono al forecast pubblico
// (perMese/totale/numeroRate/nota); togli il dettaglio per-cliente delle rate e gli ID batch.
if (pub.portafoglioOrdini) {
  delete pub.portafoglioOrdini.rate;
  delete pub.portafoglioOrdini.batchSddDaSpacchettare;
  removed['§portafoglioOrdini.rate+batch'] = 1;
}
// nota esplicativa sugli ordini ora orfana (ordini rimosso) → via
if (pub.meta && pub.meta.notaOrdini) { delete pub.meta.notaOrdini; removed['§meta.notaOrdini'] = 1; }

// previsione fiscale: togli il dettaglio per-socio (redditi/netti), tieni gli aggregati societari
if (pub.previsioneFiscale) {
  delete pub.previsioneFiscale.soci;
  if (pub.previsioneFiscale.stima) {
    delete pub.previsioneFiscale.stima.marco;
    delete pub.previsioneFiscale.stima.sajay;
    removed['§previsioneFiscale.soci+stima(marco/sajay)'] = 1;
  }
  // BLOCCO 2: compagine per anno → anonimizza (via nomi + redditi personali), tieni
  // quote/tipo/imposte che servono al calcolo fiscale aggregato societario.
  if (pub.previsioneFiscale.sociPerAnno) {
    Object.keys(pub.previsioneFiscale.sociPerAnno).forEach(y => {
      if (!/^\d{4}$/.test(y)) return;
      pub.previsioneFiscale.sociPerAnno[y] = pub.previsioneFiscale.sociPerAnno[y].map((s, i) => ({
        nome: 'Socio ' + (i + 1), quota: s.quota, tipo: s.tipo,
        redditoDipendente: 0, altriRedditi: 0,
        imposteApplicabili: s.imposteApplicabili, uscita: s.uscita
      }));
    });
    removed['§sociPerAnno(anonimizzato)'] = 1;
  }
}

// BLOCCO 3: utili maturati/prelevati/liquidazione PER SOCIO → via del tutto (PII + importi sensibili).
// Il motore nasconde la card "Utili per socio" quando manca questo blocco.
if (pub.riserveUtili !== undefined) { delete pub.riserveUtili; removed['§riserveUtili'] = 1; }

// BLOCCO 4: costo personale → tieni l'importo aggregato (serve all'EBITDA pubblico),
// togli i riferimenti nominativi nel testo.
if (pub.costiStruttura && pub.costiStruttura.personaleAnnuo) {
  pub.costiStruttura.personaleAnnuo.descrizione = 'Personale (costo aziendale annuo)';
  delete pub.costiStruttura.personaleAnnuo.fonte;
  delete pub.costiStruttura.personaleAnnuo.daConfermare;
  if (pub.costiStruttura._nota) delete pub.costiStruttura._nota;
  removed['§costiStruttura(nomi)'] = 1;
}

// BLOCCO 5 (recinto): il reddito di partecipazione per socio è un reddito PERSONALE → via.
// Senza, calcRecinto azzera la componente IRPEF e lo segnala (no degrado silenzioso).
if (pub.previsioneFiscale && pub.previsioneFiscale.impostePerAnno) {
  Object.keys(pub.previsioneFiscale.impostePerAnno).forEach(y => {
    const irs = pub.previsioneFiscale.impostePerAnno[y] && pub.previsioneFiscale.impostePerAnno[y].irpefSoci;
    if (irs) {
      if (irs.redditoPartecipazionePerSocio !== undefined) { delete irs.redditoPartecipazionePerSocio; removed['§redditoPartecipazione'] = 1; }
      if (irs.fonteReddito !== undefined) delete irs.fonteReddito;
    }
  });
}

// marcatore
pub.meta = pub.meta || {};
pub.meta.versionePubblica = 'sanitizzata per pubblicazione (no IBAN/CF/P.IVA/redditi soci/paghe)';

writeFileSync('./registro.public.json', JSON.stringify(pub, null, 1));

// verifica anti-leak: nessuna chiave sensibile residua nel file scritto
const raw = readFileSync('./registro.public.json', 'utf8');
const leaks = [];
// NB: i nomi soci sono già nei movimenti pubblicati (scelta pre-esistente); il gate copre i
// vettori NUOVI: il blocco riserveUtili dev'essere rimosso e i redditi personali azzerati.
[/"iban"/i, /"partitaIva"/, /"piva"/, /"codiceFiscale"/, /"email"/, /"margineContribuzione"/, /"margine"/, /\bIT\d{2}[A-Z0-9]{10,}/,
 /"riserveUtili"/, /"redditoDipendente":\s*[1-9]/, /"redditoPartecipazionePerSocio"/,
 /"versamenti"/, /"debitiVersoSoci"/, /\b[\w.+-]+@[\w-]+\.(com|it|net|org)\b/].forEach(rx => {
  if (rx.test(raw)) leaks.push(rx.toString());
});

console.log('registro.public.json generato.');
console.log('Rimosso:', JSON.stringify(removed));
if (leaks.length) { console.log('❌ POSSIBILE LEAK residuo:', leaks.join(', ')); process.exit(1); }
console.log('✓ Nessun IBAN/P.IVA/CF residuo nel file pubblico.');
