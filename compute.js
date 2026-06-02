/* ============================================================================
 * compute.js — Motore di calcolo dashboard NLI (dashboard-a-formule)
 * ----------------------------------------------------------------------------
 * Principio: la dashboard NON riceve numeri pre-calcolati. Legge registro.json
 * (unica fonte di verita') e CALCOLA tutto dal vivo sommando le righe.
 * Tutto cio' che e' una somma di righe vive QUI come formula, non come numero
 * incollato a mano in data.json.
 *
 * buildDashboardData(registro, statics) -> oggetto con lo stesso shape che
 * index.html gia' si aspetta da data.json. statics = input non derivabili
 * (storico anni chiusi, forecast, previsionale, testi, config).
 *
 * Modulo isomorfo: usabile nel browser (window.NLICompute) e in Node (require),
 * cosi' il gate di non-regressione lo testa prima del deploy.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NLICompute = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- TASSONOMIA
  // Lista UNICA delle categorie/causali. Usata dal calcolo CE e dal dropdown
  // dell'editor causali. Aggiornare QUI quando nasce una nuova causale.
  // gruppo: a quale macro-voce di bilancio appartiene (A/B6/B7/B8/B9/B10/B14/C
  //         oppure FUORI_CE per movimenti finanziari/patrimoniali).
  var CATEGORIE = [
    { id: 'A1_ricavi',                 label: 'Ricavi — prestazioni servizi', gruppo: 'A'  },
    { id: 'A1_ricavi_vendite',         label: 'Ricavi — vendita merci',       gruppo: 'A'  },
    { id: 'B6_materie_prime',          label: 'Merci e materie prime',        gruppo: 'B6' },
    { id: 'B7_servizi',                label: 'Servizi (generici)',           gruppo: 'B7' },
    { id: 'B7_software_operativi',     label: 'Software operativi',           gruppo: 'B7' },
    { id: 'B7_hosting_tool_digitali',  label: 'Hosting / tool digitali',      gruppo: 'B7' },
    { id: 'B7_spedizioni',             label: 'Spedizioni',                   gruppo: 'B7' },
    { id: 'B7_canone_servizio',        label: 'Canoni servizio',             gruppo: 'B7' },
    { id: 'B7_consulenze_legali',      label: 'Consulenze legali',            gruppo: 'B7' },
    { id: 'B7_consulenza_lavoro',      label: 'Consulenza del lavoro',        gruppo: 'B7' },
    { id: 'B7_energia_elettrica',      label: 'Energia elettrica',            gruppo: 'B7' },
    { id: 'B7_manutenzione_auto',      label: 'Manutenzione auto',            gruppo: 'B7' },
    { id: 'B7_posteggio',              label: 'Posteggio',                    gruppo: 'B7' },
    { id: 'B7_diritti_autore',         label: "Diritti d'autore",             gruppo: 'B7' },
    { id: 'B7_commissioni_welfare',    label: 'Commissioni welfare',          gruppo: 'B7' },
    { id: 'B7_rimborsi_spese_soci',    label: 'Rimborsi spese soci',          gruppo: 'B7' },
    { id: 'B7_pubblicita',             label: 'Pubblicita',                   gruppo: 'B7' },
    { id: 'B8_godimento_beni',         label: 'Godimento beni di terzi (affitto)', gruppo: 'B8' },
    { id: 'B8_godimento',              label: 'Godimento beni di terzi',      gruppo: 'B8' },
    { id: 'B9_personale',              label: 'Personale — stipendi',         gruppo: 'B9' },
    { id: 'B9_personale_dipendenti',   label: 'Personale dipendenti',         gruppo: 'B9' },
    { id: 'B9_inps_commercianti',      label: 'INPS commercianti (Marco)',    gruppo: 'B9' },
    { id: 'B10_macchine_elettroniche', label: 'Ammortamenti (macchine elettroniche)', gruppo: 'B10' },
    { id: 'B14_imposte',               label: 'Imposte e tasse (oneri diversi)', gruppo: 'B14' },
    { id: 'B14_oneri_diversi',         label: 'Oneri diversi di gestione',    gruppo: 'B14' },
    { id: 'B14_royalties',             label: 'Royalties marchio',            gruppo: 'B14' },
    { id: 'C_spese_bancarie',          label: 'Spese bancarie',               gruppo: 'C'  },
    { id: 'C_oneri_finanziari',        label: 'Oneri finanziari',             gruppo: 'C'  },
    { id: 'anticipazione_socio',       label: 'Anticipazione socio (fuori CE)', gruppo: 'FUORI_CE' },
    { id: 'distribuzione_utili',       label: 'Distribuzione utili (fuori CE)', gruppo: 'FUORI_CE' },
    { id: 'TRIB_debiti',               label: 'Pagamento debiti tributari (fuori CE)', gruppo: 'FUORI_CE' },
    { id: 'STR_straordinario',         label: 'Movimento straordinario (fuori CE)', gruppo: 'FUORI_CE' },
    { id: 'DA_VERIFICARE',             label: '⚠ Da verificare',              gruppo: 'FUORI_CE' }
  ];
  var CAT_BY_ID = {};
  CATEGORIE.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  // Label leggibile da un id voce/categoria. Le FATTURE usano una tassonomia
  // voceBilancio piu' granulare dei movimenti (es. B6_merci_prodotti,
  // B9_buoni_pasto): se non e' in CATEGORIE, genera una label pulita dall'id.
  function labelLeggibile(id) {
    if (CAT_BY_ID[id]) return CAT_BY_ID[id].label;
    var s = String(id || '').replace(/^(A1|B6|B7|B8|B9|B10|B14|C)_?/, '').replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(id);
  }

  // Gruppo CE da una categoria: usa la mappa, fallback sul prefisso (B7_x -> B7).
  function gruppoDi(categoria) {
    if (!categoria) return 'FUORI_CE';
    if (CAT_BY_ID[categoria]) return CAT_BY_ID[categoria].gruppo;
    var m = String(categoria).match(/^(A1|B6|B7|B8|B9|B10|B14|C)/);
    if (m) return m[1] === 'A1' ? 'A' : m[1];
    return 'FUORI_CE';
  }

  // ------------------------------------------------------------------ HELPERS
  var MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
              'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  var MESI_ABBR = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  function round2(n) {
    var x = Number(n);
    if (!isFinite(x)) return 0;                       // blinda NaN/undefined/stringhe
    return (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * 100 + Number.EPSILON) / 100; // simmetrico sui negativi
  }

  // "1534.76" -> "1.534,76"
  function nf(n) {
    var x = round2(Math.abs(n || 0));
    var parts = x.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts[0] + ',' + parts[1];
  }
  // importo: negativo -> "−€..", positivo/zero -> "€.."
  function money(n) { return (n < 0 ? '−' : '') + '€' + nf(n); }
  // flusso: segno sempre esplicito "+€.." / "−€.."
  function moneySigned(n) { return (n < 0 ? '−' : '+') + '€' + nf(n); }

  function parseISO(d) { // "2026-01-02" -> {y,m,day}
    var p = String(d || '').split('-');
    return { y: +p[0], m: +p[1], day: +p[2] };
  }
  function ddmm(d) { var p = parseISO(d); return pad2(p.day) + '/' + pad2(p.m); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // "2026-05-16" -> "16 Mag 2026"
  function dataLunga(d) { var p = parseISO(d); return p.day + ' ' + MESI_ABBR[p.m - 1] + ' ' + p.y; }

  // movimenti realmente transitati sul conto NLI (= estratto conto), anno fiscale corrente.
  // WHITELIST: solo conto Intesa o conto non specificato (storici null). Esclude conto
  // personale socio e movimenti marcati cassa:false (riepiloghi non presenti in E/C).
  function movBanca(reg) {
    var anno = (reg.meta && reg.meta.annoFiscale) || 2026;
    return (reg.movimenti || []).filter(function (m) {
      var contoOk = (m.conto === 'BANCA-ISP-001' || m.conto == null);
      return contoOk && m.cassa !== false && parseISO(m.data).y === anno;
    });
  }

  // =========================================================== MOVIMENTI MENSILI
  function calcMensili(reg) {
    var byMonth = {}; // "2026-01" -> {entrate:[], uscite:[]}
    movBanca(reg).forEach(function (m) {   // movBanca filtra già per anno fiscale e conto
      var p = parseISO(m.data);
      var key = p.y + '-' + pad2(p.m);
      if (!byMonth[key]) byMonth[key] = { y: p.y, m: p.m, entrate: [], uscite: [] };
      var voce = (m.controparte || '') + (m.descrizione ? ' — ' + m.descrizione : '');
      var cp = (m.controparte || '').trim();
      var identificato = cp !== '' && cp !== '(da E/C)' && cp !== '-' && cp !== '(senza controparte)';
      var row = {
        data: ddmm(m.data),
        voce: voce.trim().replace(/^—\s*/, ''),
        voceBilancio: m.categoria || 'DA_VERIFICARE',
        importo: m.tipo === 'uscita' ? money(-Math.abs(m.importo)) : money(Math.abs(m.importo)),
        anno: m.competenza ? String(m.competenza) : '',
        competenza: m.competenza ? String(m.competenza) : '',
        daRiconciliare: !identificato,
        riconciliato: !!m.riconciliato,
        _v: Math.abs(m.importo)
      };
      if (m.tipo === 'entrata') byMonth[key].entrate.push(row);
      else byMonth[key].uscite.push(row);
    });

    return Object.keys(byMonth).sort().map(function (key) {
      var b = byMonth[key];
      var totE = b.entrate.reduce(function (s, r) { return s + r._v; }, 0);
      var totU = b.uscite.reduce(function (s, r) { return s + r._v; }, 0);
      b.entrate.forEach(function (r) { delete r._v; });
      b.uscite.forEach(function (r) { delete r._v; });
      var netto = totE - totU;
      return {
        mese: MESI[b.m - 1] + ' ' + b.y,
        label: MESI_ABBR[b.m - 1],
        entrate: b.entrate,
        uscite: b.uscite,
        totaleEntrate: money(totE),
        totaleUscite: money(totU),
        netto: money(netto),
        utileNetto: money(netto),
        ebitda: '—'
      };
    });
  }

  // ================================================================== BANCA
  function calcBanca(reg, statics) {
    var conto = (reg.conti || []).find(function (c) { return c.id === 'BANCA-ISP-001'; }) || {};
    var saldi = (reg.saldi || []).filter(function (s) { return s.contoId === 'BANCA-ISP-001'; })
                                 .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var annoFisc = (reg.meta && reg.meta.annoFiscale) || 2026;
    var saldoInizio = (saldi[0] && /-01-01$/.test(saldi[0].data)) ? saldi[0].importo : (saldi[0] ? saldi[0].importo : 0);
    var saldoFineByMonth = {}; // 'YYYY-MM' -> importo ufficiale fine mese (anno fiscale)
    saldi.forEach(function (s) {
      var p = parseISO(s.data);
      if (p.y !== annoFisc) return;
      // saldi ordinati per data: l'ultimo del mese (data più alta) vince = saldo di fine mese
      saldoFineByMonth[p.y + '-' + pad2(p.m)] = s.importo;
    });
    var saldoAttuale = saldi.length ? saldi[saldi.length - 1].importo : 0;

    // flussi mensili calcolati dai movimenti
    var mens = calcMensili(reg);
    var prevFine = saldoInizio;
    var totE = 0, totU = 0, totMov = 0;
    var riepilogo = mens.map(function (mm) {
      var parts = mm.mese.split(' ');
      var mIdx = MESI.indexOf(parts[0]) + 1;
      var key = parts[1] + '-' + pad2(mIdx);
      var e = parseEuro(mm.totaleEntrate), u = parseEuro(mm.totaleUscite);
      var n = e - u;
      var nMov = mm.entrate.length + mm.uscite.length;
      var inizio = prevFine;
      var fine = (saldoFineByMonth[key] != null) ? saldoFineByMonth[key] : round2(inizio + n);
      prevFine = fine;
      totE += e; totU += u; totMov += nMov;
      return {
        mese: mm.mese,
        saldoInizio: money(inizio),
        entrate: money(e),
        uscite: money(u),
        flusso: moneySigned(n),
        saldoFine: money(fine),
        movimenti: nMov
      };
    });

    // QUADRATURA E/C (i saldi tornano) — info di controllo, mese per mese.
    var meseQuadra = {};
    var prevF = saldoInizio;
    riepilogo.forEach(function (r) {
      var mIdx = MESI.indexOf(r.mese.split(' ')[0]) + 1;
      var diff = parseEuro(r.saldoFine) - (prevF + parseEuro(r.entrate) - parseEuro(r.uscite));
      meseQuadra[mIdx] = Math.abs(round2(diff)) < 1;
      prevF = parseEuro(r.saldoFine);
    });
    var mesiTot = Object.keys(meseQuadra).length;
    var mesiOk = Object.keys(meseQuadra).filter(function (k) { return meseQuadra[k]; }).length;

    // RICONCILIAZIONE = movimenti IDENTIFICATI (con controparte/nome reale).
    // Un movimento è "da riconciliare" se non sappiamo ancora chi è (controparte
    // vuota o generica "(da E/C)"). Questi vanno completati a mano dall'editor.
    var mb = movBanca(reg);
    function identificato(m) {
      var c = (m.controparte || '').trim();
      return c !== '' && c !== '(da E/C)' && c !== '-' && c !== '(senza controparte)';
    }
    var ric = 0;
    var aperti = [];
    mb.forEach(function (m) {
      if (identificato(m)) { ric++; return; }
      aperti.push({
        id: m.id,
        data: m.data,
        controparte: m.descrizioneBanca || m.descrizione || '(da identificare)',
        importo: money(Math.abs(m.importo)),
        tipo: m.tipo,
        motivo: 'Da identificare — apri "Correggi causali" e scrivi chi è'
      });
    });

    return {
      conto: conto.istituto || 'Intesa Sanpaolo',
      iban: conto.iban || '',
      saldoAttuale: money(saldoAttuale),
      saldoInizialeAnno: money(saldoInizio),
      ultimoAggiornamento: (statics && statics.lastUpdate) || '',
      dataAggiornamento: (statics && statics.lastUpdate) || '',
      riepilogoMensile: riepilogo,
      totali: {
        entrate: money(totE),
        uscite: money(totU),
        flusso: moneySigned(totE - totU),
        movimenti: totMov
      },
      riconciliazione: {
        totaleMovimenti: mb.length,
        riconciliati: ric,
        nonRiconciliati: mb.length - ric,
        percentuale: mb.length ? round2(ric / mb.length * 100) : 0,
        mesiQuadrati: mesiOk,
        mesiTotali: mesiTot,
        notaQuadratura: mesiOk + '/' + mesiTot + ' mesi quadrano col saldo E/C ufficiale al centesimo',
        movimentiAperti: aperti
      },
      movimenti: []
    };
  }

  // Robusto sia al formato italiano "1.534,76" sia a "1534.76": l'ULTIMO separatore
  // (virgola o punto) è il decimale; gli altri sono migliaia.
  function parseEuro(s) {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    var str = String(s).trim();
    var neg = str.charAt(0) === '−' || str.charAt(0) === '-';
    var d = str.replace(/[^\d.,]/g, '');
    var lastComma = d.lastIndexOf(','), lastDot = d.lastIndexOf('.');
    var dec = Math.max(lastComma, lastDot);
    var n;
    if (dec === -1) n = parseFloat(d.replace(/[.,]/g, '')) || 0;
    else {
      var intPart = d.slice(0, dec).replace(/[.,]/g, '');
      var fracPart = d.slice(dec + 1).replace(/[.,]/g, '');
      n = parseFloat(intPart + '.' + fracPart) || 0;
    }
    return neg && n > 0 ? -n : n;
  }

  // ================================================================== IVA
  // I totali debito/credito per trimestre sono DATI (somma fatture per aliquota,
  // con la liquidazione ufficiale Mascolo dove presente). Tutto il resto e'
  // FORMULA a catena: credito riportato dal trimestre precedente, saldo,
  // versamento e stato (dedotto dalla data). Niente piu' valori incollati.
  function calcIVA(reg, statics) {
    var iva = reg.iva || {};
    var anno = (reg.meta && reg.meta.annoFiscale) || 2026;
    var oggi = new Date();
    var prevCredito = 0; // credito IVA che si riporta al trimestre successivo
    var trimestri = (iva.trimestri || []).map(function (t) {
      var debito = (t.ivaDebito && t.ivaDebito.totale) || 0;
      var credito = (t.ivaCredito && t.ivaCredito.totale) || 0;
      var creditoRip = round2(prevCredito); // FORMULA: riportato dal trim precedente
      var saldo, creditoIva, importoVers;
      if (t.liquidazioneUfficiale && typeof t.liquidazioneUfficiale.credito === 'number') {
        // liquidazione UFFICIALE Mascolo: prevale (gia' al netto)
        creditoIva = t.liquidazioneUfficiale.credito;
        saldo = round2(-creditoIva);
        importoVers = 0;
        credito = round2(debito + creditoIva); // coerenza display: acquisti = vendite + credito
      } else {
        saldo = round2(debito - credito - creditoRip); // FORMULA
        creditoIva = saldo < 0 ? -saldo : 0;
        importoVers = saldo > 0 ? saldo : 0;
      }
      prevCredito = creditoIva; // a catena verso il trimestre dopo
      // STATO dalla data: chiuso se il trimestre e' finito, in_corso se siamo dentro, altrimenti non_iniziato
      var mesiArr = (t.mesi || []).map(function (m) { return parseISO(m + '-01').m; });
      var stato = 'non_iniziato';
      if (mesiArr.length) {
        var inizio = new Date(anno, mesiArr[0] - 1, 1);
        var fine = new Date(anno, mesiArr[mesiArr.length - 1], 0); // ultimo giorno
        if (oggi > fine) stato = 'chiuso';
        else if (oggi >= inizio) stato = 'in_corso';
      }
      var mesiLabel = (t.mesi || []).map(function (m) { return MESI_ABBR[parseISO(m + '-01').m - 1]; });
      var mesiStr = mesiLabel.length ? mesiLabel[0] + '-' + mesiLabel[mesiLabel.length - 1] : '';
      var d = t.ivaDebito || {}, c = t.ivaCredito || {};
      return {
        id: t.id,
        periodo: t.periodo + ' ' + anno,
        mesi: mesiStr,
        stato: stato,
        scadenza: t.scadenzaVersamento ? ddmmYYYY(t.scadenzaVersamento) : '',
        ivaDebito: round2(debito),
        ivaCredito: round2(credito),
        creditoRiportato: round2(creditoRip),
        saldo: round2(saldo),
        saldoTipo: saldo < 0 ? 'credito' : 'debito',
        creditoIva: round2(creditoIva),
        importoVersamento: round2(importoVers),
        note: t.noteQ1 || t.note || '',
        breakdown: {
          debito_22: round2(d.ordinario_22 || 0),
          credito_22: round2(c.ordinario_22 || 0),
          debito_10: round2(d.ordinario_10 || 0),
          credito_10: round2(c.ordinario_10 || 0),
          debito_4: round2(d.ridotto_4 || 0),
          credito_4: round2(c.ridotto_4 || 0),
          reverseCharge: round2((t.reverseCharge && t.reverseCharge.totaleImponibile) || 0),
          forfettario: round2((t.forfettarioEsente && t.forfettarioEsente.totaleImponibile) || 0)
        }
      };
    });
    // prossimo versamento dovuto (primo trimestre con importo > 0), altrimenti Q corrente
    var pv = trimestri.filter(function (t) { return t.importoVersamento > 0; })[0]
          || trimestri.filter(function (t) { return t.stato === 'in_corso'; })[0]
          || trimestri[0] || {};
    return {
      regime: (statics && statics.ivaTesti && statics.ivaTesti.regime) || 'Trimestrale (contribuenti minori)',
      fonte: (statics && statics.ivaTesti && statics.ivaTesti.fonte) || (iva.note || ''),
      disclaimer: (statics && statics.ivaTesti && statics.ivaTesti.disclaimer) ||
        'Monitoraggio previsionale interno. La liquidazione IVA ufficiale è a cura del commercialista (Studio Mascolo).',
      prossimoVersamento: {
        importo: pv.importoVersamento || 0,
        data: pv.scadenza || '—',
        trimestre: pv.periodo || '',
        nota: pv.saldoTipo === 'credito' ? 'Credito IVA — nessun versamento' : (pv.note || '')
      },
      trimestri: trimestri
    };
  }
  function ddmmYYYY(d) { var p = parseISO(d); return pad2(p.day) + '/' + pad2(p.m) + '/' + p.y; }

  // ================================================================ SCADENZE
  var STATI_CHIUSI = { pagato: 1, pagata: 1, annullato: 1, annullata: 1, chiuso: 1, chiusa: 1 };
  var STATO_LABEL = {
    da_pagare: 'Da pagare', in_attesa_dati: 'In attesa dati',
    da_decidere: 'Da decidere', credito_iva: 'Credito (no versam.)'
  };
  function isISO(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }

  function calcScadenze(reg) {
    return (reg.scadenze || [])
      .filter(function (s) { return !STATI_CHIUSI[s.stato] && isISO(s.data); })
      .sort(function (a, b) { return a.data < b.data ? -1 : 1; })
      .map(function (s) {
        return {
          data: dataLunga(s.data),
          adempimento: s.descrizione + (typeof s.importo === 'number' && s.importo ? ' — €' + nf(s.importo) : ''),
          frequenza: tipoFreq(s.tipo),
          chi: s.chi || '—',
          stato: s.stato,
          statoLabel: STATO_LABEL[s.stato] || 'Da pagare'
        };
      });
  }

  // somma importi scadenze "da pagare": SCADUTE non pagate (passato) + imminenti (prossimi N giorni)
  function scadenzeImminenti(reg, giorni, dataRif) {
    var oggi = dataRif || new Date();
    var limite = new Date(oggi.getTime() + giorni * 86400000);
    var tot = 0, n = 0, scaduteTot = 0, scaduteN = 0;
    (reg.scadenze || []).forEach(function (s) {
      if (s.stato !== 'da_pagare' || !isISO(s.data) || typeof s.importo !== 'number') return;
      var d = new Date(s.data + 'T00:00:00');
      if (d < oggi) { scaduteTot += s.importo; scaduteN++; tot += s.importo; n++; }       // SCADUTA non pagata
      else if (d <= limite) { tot += s.importo; n++; }                                     // imminente
    });
    return { totale: round2(tot), count: n, scaduteTot: round2(scaduteTot), scaduteCount: scaduteN };
  }
  function tipoFreq(t) {
    switch (t) {
      case 'f24': return 'F24';
      case 'iva': return 'IVA';
      case 'inps': return 'Contributi';
      case 'inail': return 'INAIL';
      default: return 'Una tantum';
    }
  }

  // ================================================================== KPI
  function calcKPI(reg, banca, iva, mensili) {
    var scad = scadenzeImminenti(reg, 45);
    var totE = parseEuro(banca.totali.entrate);
    var totU = parseEuro(banca.totali.uscite);
    var subE = mensili.map(function (m) { return m.label + ' ' + compactEuro(parseEuro(m.totaleEntrate)); }).join(' · ');
    var subU = mensili.map(function (m) { return m.label + ' ' + compactEuro(parseEuro(m.totaleUscite)); }).join(' · ');
    var ultimo = mensili[mensili.length - 1];
    var nettoUltimo = ultimo ? parseEuro(ultimo.netto) : 0;
    var margine = totE > 0 ? round2((totE - totU) / totE * 100) : 0;

    // ricavi competenza 2026: fatture di vendita (al netto NC) anno corrente
    var ricComp = calcRicaviCompetenza(reg);

    var q1 = iva.trimestri[0] || {};
    var ivaSaldoLabel = q1.saldoTipo === 'credito'
      ? 'CREDITO €' + nf(q1.creditoIva)
      : '€' + nf(q1.saldo);

    return [
      { label: 'INCASSI YTD (' + ytdRange(mensili) + ')', value: money(totE), sub: subE, class: 'positive' },
      { label: 'Ricavi Competenza 2026', value: money(ricComp.netto), sub: ricComp.nota, class: 'success' },
      { label: 'COSTI YTD (' + ytdRange(mensili) + ')', value: money(totU), sub: subU, class: 'neutral' },
      { label: 'Margine Operativo', value: nf(margine) + '%', sub: 'Incassi vs costi YTD (cassa)', class: margine >= 0 ? 'positive' : 'negative' },
      { label: 'IVA Q1 — SALDO', value: ivaSaldoLabel, sub: q1.note ? 'Liquidazione Q1' : '', class: q1.saldoTipo === 'credito' ? 'success' : 'neutral' },
      { label: 'Saldo Banca', value: banca.saldoAttuale, sub: 'Da E/C ufficiale', class: 'positive' },
      { label: 'FLUSSO ' + (ultimo ? ultimo.label.toUpperCase() + ' ' + ultimo.mese.split(' ')[1] : ''), value: moneySigned(nettoUltimo), sub: 'Netto ultimo mese', class: nettoUltimo >= 0 ? 'positive' : 'negative' },
      { label: 'DA PAGARE (scadute + 45gg)', value: scad.count ? money(scad.totale) : '—', sub: (scad.scaduteCount ? '⚠ ' + scad.scaduteCount + ' SCADUTE (' + money(scad.scaduteTot) + ') + ' : '') + (scad.count - scad.scaduteCount) + ' in arrivo', class: scad.scaduteCount > 0 ? 'danger' : (scad.totale > 0 ? 'neutral' : 'success') }
    ];
  }
  function compactEuro(n) {
    if (Math.abs(n) >= 1000) return '€' + Math.round(n / 1000) + 'k';
    return '€' + Math.round(n);
  }
  function ytdRange(mensili) {
    if (!mensili.length) return '';
    return 'GEN-' + mensili[mensili.length - 1].label.toUpperCase();
  }

  // ricavi per competenza: vendite a cliente, meno NC emesse a cliente.
  // (le NC da fornitore NON toccano i ricavi — vedi calcBilancio)
  function calcRicaviCompetenza(reg) {
    var anno = String(reg.meta.annoFiscale || 2026);
    var fv = 0, nc = 0, count = 0;
    (reg.fatture || []).forEach(function (f) {
      var dir = f.tipo || f.direzione;
      if (dir !== 'vendita') return;
      var comp = f.competenza ? String(f.competenza) : String(parseISO(f.data).y);
      if (comp !== anno) return;
      var imp = f.imponibile || 0;
      var vb = f.voceBilancio || '';
      var isNCcliente = /note_credito|_nc_|^nc/i.test(vb) || /^NC/i.test(f.numero || '');
      if (isNCcliente) nc += Math.abs(imp);
      else { fv += imp; count++; }
    });
    return { netto: round2(fv - nc), nota: count + ' FV emesse (competenza ' + anno + ', netto NC clienti) — fonte registro' };
  }

  // imponibile di una fattura: usa il campo se presente, altrimenti lo scorpora
  // dall'importoTotale in base al regime IVA. Stima trasparente (non scrive nel
  // registro): serve perché molte FA hanno solo importoTotale, non l'imponibile.
  function imponibileDi(f) {
    if (typeof f.imponibile === 'number') return f.imponibile;
    var tot = f.importoTotale || 0;
    var reg = f.regimeIva || '';
    var div = 1;
    if (reg === 'ordinario_22') div = 1.22;
    else if (reg === 'ordinario_10') div = 1.10;
    else if (reg === 'ridotto_4') div = 1.04;
    // reverse_charge*, forfettario*, iva_estera*, esente, null -> costo = totale
    return round2(tot / div);
  }

  // ================================================================ BILANCIO
  // CE per competenza dalle fatture; SP da voci primarie registro + cassa.
  function calcBilancio(reg, banca, statics) {
    var anno = String(reg.meta.annoFiscale || 2026);
    var labelGruppo = pianoLabels(reg);

    // ---- Conto Economico (competenza) dalle fatture
    // NB: distinzione critica tra le note credito:
    //   - NC a CLIENTE (tipo 'vendita' + voceBilancio note_credito) → riduce i RICAVI (A)
    //   - NC da FORNITORE (tipo 'nota_credito') → riduce i COSTI del suo gruppo (B)
    var A = { vendite: 0, servizi: 0, nc: 0 };
    var B = {}; // gruppo -> {cat -> importo}
    function addB(cat, val) {
      var g = gruppoDi(cat);
      if (g === 'B10') return;            // cespiti: NON spesati nel CE (vanno a SP + ammortamento)
      if (g === 'A' || g === 'FUORI_CE') g = 'B7';
      if (!B[g]) B[g] = {};
      B[g][cat] = round2((B[g][cat] || 0) + val);
    }
    (reg.fatture || []).forEach(function (f) {
      var dir = f.tipo || f.direzione;
      var comp = f.competenza ? String(f.competenza) : String(parseISO(f.data).y);
      if (comp !== anno) return;
      var imp = imponibileDi(f);
      var vb = f.voceBilancio || f.categoria || '';
      var isNCcliente = /note_credito|_nc_|^nc/i.test(vb) || /^NC/i.test(f.numero || '');
      if (dir === 'vendita') {
        if (isNCcliente) A.nc += Math.abs(imp);                       // NC a cliente: riduce ricavi
        else if (vb.indexOf('vendite') >= 0 || vb.indexOf('vendita') >= 0) A.vendite += imp;
        else A.servizi += imp;
      } else if (dir === 'nota_credito') {
        addB(vb || 'DA_VERIFICARE', -Math.abs(imp));                  // NC da fornitore: riduce costi
      } else if (dir === 'acquisto') {
        addB(vb || 'DA_VERIFICARE', imp);
      }
    });

    var ceA = {
      label: 'A) Valore della produzione',
      dettaglio: [
        { label: 'A.1.1 Vendita merci', importo: round2(A.vendite) },
        { label: 'A.1.2 Prestazioni servizi', importo: round2(A.servizi) },
        { label: 'A.1.3 Note di credito', importo: round2(-A.nc) }
      ],
      totale: round2(A.vendite + A.servizi - A.nc)
    };

    function gruppoToSezione(g) {
      var dett = Object.keys(B[g]).map(function (cat) {
        return { label: labelLeggibile(cat), importo: round2(B[g][cat]) };
      }).sort(function (a, b) { return b.importo - a.importo; });
      var tg = dett.reduce(function (s, d) { return s + d.importo; }, 0);
      return { codice: g, label: labelGruppo[g] || g, totale: round2(tg), dettaglio: dett };
    }

    // B) Costi della produzione (B6..B14, escluso C finanziari)
    var ordineB = ['B6', 'B7', 'B8', 'B9', 'B14'];
    var totB = 0;
    var sottoGruppi = ordineB.filter(function (g) { return B[g]; }).map(function (g) {
      var sez = gruppoToSezione(g); totB += sez.totale; return sez;
    });

    // C) Oneri/spese finanziari (sezione separata)
    var ceC;
    if (B['C']) {
      var c = gruppoToSezione('C');
      ceC = { label: 'C) Spese e oneri finanziari', totale: c.totale, dettaglio: c.dettaglio };
    } else {
      ceC = { label: 'C) Spese e oneri finanziari', totale: 0, dettaglio: [] };
    }

    var diffAB = round2(ceA.totale - totB);
    var b9tot = (sottoGruppi.filter(function (g) { return g.codice === 'B9'; })[0] || {}).totale || 0;

    // ---- CASCATA: EBITDA -> EBIT -> EBT -> Utile netto (tutto live)
    var ebitda = diffAB; // Ricavi - Costi operativi (i miei B non includono ammortamenti ne oneri fin.)
    var ammortamenti = round2((reg.immobilizzazioni || []).reduce(function (s, i) {
      var q;
      if (typeof i['ammortamento' + anno] === 'number') q = i['ammortamento' + anno];
      else {
        // fallback: primo anno usa aliquotaPrimoAnno (dimezzata), poi aliquota piena
        var primoAnno = i.dataAcquisto && String(parseISO(i.dataAcquisto).y) === anno;
        var al = (primoAnno && i.aliquotaPrimoAnno != null) ? i.aliquotaPrimoAnno : (i.aliquota || 0);
        q = round2((i.costoAcquisto || i.valore || 0) * al);
      }
      return s + q;
    }, 0));
    // oneri finanziari (C) dai MOVIMENTI di competenza (spese bancarie/oneri) — non sono fatture
    var oneriFin = round2((reg.movimenti || []).filter(function (m) {
      return /^C/.test(m.categoria || '') && m.conto !== 'PERS-MARCO-001' && m.cassa !== false
        && (m.competenza ? String(m.competenza) === anno : String(parseISO(m.data).y) === anno);
    }).reduce(function (s, m) { return s + (m.tipo === 'uscita' ? Math.abs(m.importo) : -Math.abs(m.importo)); }, 0));
    var ebit = round2(ebitda - ammortamenti);
    var ebt = round2(ebit - oneriFin);
    var baseIRAP = Math.max(0, round2(diffAB + b9tot)); // base IRAP: (A-B)+B9 (personale non deducibile SAS)

    var pf = calcPrevisioneFiscale(reg, ebt, baseIRAP);  // tasse calcolate sull'EBT vero
    var imposte = { totale: round2(pf.irap.importo), nota: 'IRAP a carico societa (IRPEF/INPS soci in tab Previsione Fiscale).' };
    var utileNetto = round2(ebt - imposte.totale);

    // ceC = sezione C visualizzata nel CE (usa gli oneri reali dai movimenti)
    if (!ceC.dettaglio.length && oneriFin) ceC = { label: 'C) Spese e oneri finanziari', totale: oneriFin, dettaglio: [{ label: 'Spese bancarie e oneri (da movimenti)', importo: oneriFin }] };

    var ce = {
      label: 'Conto Economico (competenza ' + anno + ')',
      A: ceA,
      B: { label: 'B) Costi della produzione', totale: round2(totB), sottoGruppi: sottoGruppi },
      diffAB: { importo: diffAB },
      C: ceC,
      imposte: imposte,
      utile: { importo: utileNetto },
      cascata: {
        ebitda: ebitda, ammortamenti: ammortamenti, ebit: ebit,
        oneriFinanziari: oneriFin, ebt: ebt, imposte: imposte.totale, utileNetto: utileNetto
      }
    };

    // ---- Stato Patrimoniale (voci primarie registro + cassa calcolata)
    var imm = (reg.immobilizzazioni || []).reduce(function (s, i) {
      var v = (i.valoreNetto != null) ? i.valoreNetto : (i.valoreResiduo != null ? i.valoreResiduo : (i.costoAcquisto || i.valore || 0));
      return s + v;
    }, 0);
    function vociSP(rx) {
      return (reg.vociManualiSP || []).filter(function (v) { return rx.test(v.voce || v.descrizione || v.label || ''); })
        .reduce(function (s, v) { return s + (v.importo || 0); }, 0);
    }
    var cauzione = vociSP(/cauzion/i);
    var capitale = vociSP(/capitale/i);
    var debitiSoci = (reg.debitiVersoSoci || []).reduce(function (s, d) { return s + (d.saldo != null ? d.saldo : (d.importo || 0)); }, 0);
    var creditoIVA = (calcIVA(reg, statics).trimestri[0] || {}).creditoIva || 0;
    var liquidita = parseEuro(banca.saldoAttuale);
    var risconti = riscontiTotali(reg);

    var attivoGruppi = [
      { label: 'Immobilizzazioni nette', importo: round2(imm) },
      { label: 'Crediti tributari (IVA)', importo: round2(creditoIVA) },
      { label: 'Depositi cauzionali', importo: round2(cauzione) },
      { label: 'Disponibilita liquide', importo: round2(liquidita) },
      { label: 'Risconti attivi', importo: round2(risconti.attivi) }
    ];
    var totAttivo = attivoGruppi.reduce(function (s, g) { return s + g.importo; }, 0);

    var passivoGruppi = [
      { label: 'Debiti verso soci', importo: round2(debitiSoci) },
      { label: 'Risconti passivi', importo: round2(risconti.passivi) }
    ];
    var totPassivo = passivoGruppi.reduce(function (s, g) { return s + g.importo; }, 0);

    var utileEsercizio = ce.diffAB.importo; // ante imposte gestionale
    var pnDett = [
      { label: 'Capitale sociale', importo: round2(capitale) },
      { label: 'Utile esercizio (gestionale)', importo: round2(utileEsercizio) },
      { label: 'Utili pregressi', importo: 0 }
    ];
    var totPN = pnDett.reduce(function (s, g) { return s + g.importo; }, 0);
    var diff = round2(totAttivo - (totPassivo + totPN));

    var sp = {
      attivo: { gruppi: attivoGruppi, totale: round2(totAttivo) },
      passivo: { gruppi: passivoGruppi, totale: round2(totPassivo) },
      pn: { dettaglio: pnDett, totale: round2(totPN) },
      verifica: {
        differenza: diff,
        stato: Math.abs(diff) < 1 ? 'quadrato' : 'sbilancio',
        nota: 'Bilancio gestionale provvisorio: sbilancio atteso (utili pregressi 2023-2025 e riserve non ancora censiti).'
      }
    };

    return {
      disclaimer: (statics && statics.bilancioTesti && statics.bilancioTesti.disclaimer) || 'Bilancio gestionale interno provvisorio, non ufficiale.',
      notaCompetenza: (statics && statics.bilancioTesti && statics.bilancioTesti.notaCompetenza) || 'CE per competenza economica; SP a valori correnti.',
      dataRiferimento: (statics && statics.lastUpdate) || '',
      ce: ce,
      sp: sp,
      previsioneFiscale: pf
    };
  }

  function pianoLabels(reg) {
    var out = {};
    try {
      var sg = reg.pianoDeiConti.contoEconomico.B_costi_produzione.sottoGruppi;
      Object.keys(sg).forEach(function (k) { out[k] = k + ') ' + sg[k].label; });
    } catch (e) {}
    out.C = out.C || 'C) Spese e oneri finanziari';
    return out;
  }

  function riscontiTotali(reg) {
    var attivi = 0, passivi = 0;
    try {
      (reg.rateiRisconti.voci || []).forEach(function (v) {
        var q = (typeof v.quotaResidua === 'number') ? v.quotaResidua : (v.importoResiduo || 0);
        if (/risconto_attivo|rateo_attivo/.test(v.tipo || '')) attivi += q;
        else if (/risconto_passivo|rateo_passivo/.test(v.tipo || '')) passivi += q;
      });
    } catch (e) {}
    return { attivi: round2(attivi), passivi: round2(passivi) };
  }

  // CALCOLO FISCALE DAL VIVO (come il foglio Excel dei soci).
  // utileAnte = EBT (utile ante imposte, dopo ammortamenti e oneri finanziari).
  // Si ripartisce 50/50 ai soci (SAS = tassazione per trasparenza); IRAP a parte sulla
  // sua base (baseIRAP). Per socio: IRPEF a scaglioni + addizionali + (Marco) INPS.
  function calcPrevisioneFiscale(reg, utileAnteIn, baseIRAPin) {
    var p = (reg.previsioneFiscale && reg.previsioneFiscale.parametri) || {};
    var scaglioni = p.scaglioniIRPEF || [{ da: 0, a: 28000, aliquota: 0.23 }, { da: 28001, a: 50000, aliquota: 0.35 }, { da: 50001, a: null, aliquota: 0.43 }];
    var addiz = (p.addizionaleRegionale || 0) + (p.addizionaleComunale || 0);
    var inps = p.inpsCommercianti || { fissoAnnuo: 4515, aliquotaEccedenza: 0.2448, minimaleReddito: 18415 };
    var soci = (reg.previsioneFiscale && reg.previsioneFiscale.soci) || [];
    var sajayDip = (soci.filter(function (s) { return /sajay/i.test(s.nome); })[0] || {}).redditoDipendente || 0;

    function irpef(reddito) {
      if (reddito <= 0) return 0;
      var t = 0;
      scaglioni.forEach(function (sc) {
        var top = sc.a == null ? Infinity : sc.a;
        var base = Math.max(0, Math.min(reddito, top) - (sc.da - 1 < 0 ? 0 : sc.da - 1));
        // sc.da parte da 0 o 28001: la base è la porzione di reddito dentro lo scaglione
        var lo = sc.da === 0 ? 0 : sc.da - 1;
        base = Math.max(0, Math.min(reddito, top) - lo);
        t += base * sc.aliquota;
      });
      return round2(t);
    }

    var utileAnte = round2(utileAnteIn);                  // EBT (utile ante imposte)
    var quota = round2(utileAnte / 2);                    // 50/50
    var baseIRAP = Math.max(0, round2(baseIRAPin || 0));
    var irapImporto = round2(baseIRAP * (p.aliquotaIRAP || 0.039));

    // Marco (accomandatario): quota + IRPEF + addizionali + INPS commercianti
    var mReddito = Math.max(0, quota);
    var mIrpef = irpef(mReddito);
    var mAddiz = round2(mReddito * addiz);
    var mInpsFisso = inps.fissoAnnuo || 4515;            // dovuto sempre, anche con utile 0
    var mInpsEcc = round2(Math.max(0, mReddito - (inps.minimaleReddito || 18415)) * (inps.aliquotaEccedenza || 0.2448));
    var mTasse = round2(mIrpef + mAddiz + mInpsFisso + mInpsEcc);
    var mNetto = round2(quota - mTasse);

    // Sajay (accomandante): quota + reddito da dipendente, IRPEF + addizionali, no INPS commercianti
    var sReddito = round2(Math.max(0, quota) + sajayDip);
    var sIrpef = irpef(sReddito);
    var sAddiz = round2(sReddito * addiz);
    var sTasse = round2(sIrpef + sAddiz);
    var sNetto = round2(quota - sTasse + sajayDip);

    // TAX RATE a regola d'arte: il costo fiscale ATTRIBUIBILE all'utile.
    // Per Sajay si esclude l'IRPEF che pagherebbe COMUNQUE sullo stipendio (carico marginale).
    var sajayTasseStipendio = round2(irpef(sajayDip) + sajayDip * addiz);
    var sajayCaricoUtile = round2(sTasse - sajayTasseStipendio);
    var caricoUtile = round2(irapImporto + mTasse + sajayCaricoUtile); // Marco: tutto (no altri redditi)
    var taxRate = utileAnte > 0 ? round2(caricoUtile / utileAnte * 100) / 100 : null;
    var utileNettoFamiglia = round2(utileAnte - caricoUtile);

    var totaleCarico = round2(irapImporto + mTasse + sTasse);
    return {
      utileNegativo: utileAnte <= 0,
      utileAnteImposte: utileAnte,
      baseImponibileIRAP: baseIRAP,
      totaleCaricofiscale: totaleCarico,
      percentualeSuUtile: taxRate,
      famiglia: {
        fatturatoNetto: utileAnte,
        caricoUtile: caricoUtile,         // tasse attribuibili all'utile (no IRPEF stipendio Sajay)
        utileNetto: utileNettoFamiglia,   // quanto resta in famiglia dall'utile
        taxRate: taxRate,
        sajayTasseStipendio: sajayTasseStipendio,
        totaleCaricoConStipendio: totaleCarico
      },
      irap: { importo: irapImporto, aliquota: p.aliquotaIRAP || 0.039 },
      marco: {
        redditoImponibile: round2(mReddito), irpef: mIrpef, addizionali: mAddiz,
        inpsFisso: round2(mInpsFisso), inpsEccedenza: mInpsEcc,
        totaleTasse: mTasse, nettoStimato: mNetto,
        aliquotaEffettiva: mReddito > 0 ? round2(mTasse / mReddito * 100) / 100 : null
      },
      sajay: {
        redditoImponibile: sReddito, irpef: sIrpef, addizionali: sAddiz,
        totaleTasse: sTasse, nettoStimato: sNetto,
        aliquotaEffettiva: sReddito > 0 ? round2(sTasse / sReddito * 100) / 100 : null
      },
      disclaimer: 'Calcolo dal vivo sull\'utile di competenza maturato (SAS, tassazione per trasparenza 50/50). I costi non fatturati non sono nel CE → utile prudenziale. Liquidazione ufficiale a cura del commercialista.'
    };
  }

  // testi di sintesi calcolati dal vivo (non invecchiano)
  function calcStatusMessage(reg, banca, iva, mensili) {
    var nMov = (reg.movimenti || []).length, nFat = (reg.fatture || []).length, nSc = (reg.scadenze || []).length;
    var ric = banca.riconciliazione || {};
    var ultimo = mensili.length ? mensili[mensili.length - 1].label : '';
    var q1 = (iva.trimestri || [])[0] || {};
    var ivaTxt = q1.saldoTipo === 'credito' ? 'CREDITO €' + nf(q1.creditoIva) : '€' + nf(q1.saldo || 0);
    return 'Fonte: registro.json (' + nMov + ' mov, ' + nFat + ' fatt, ' + nSc + ' scad). ' +
      'Cassa gen-' + ultimo + ' riconciliata col saldo E/C ufficiale (' + (ric.mesiQuadrati || 0) + '/' + (ric.mesiTotali || 0) + ' mesi quadrati). ' +
      'Saldo banca: ' + banca.saldoAttuale + '. IVA Q1: ' + ivaTxt + '.';
  }
  function calcStatoLavori(reg, banca) {
    var ric = banca.riconciliazione || {};
    var antic = (reg.movimenti || []).filter(function (m) { return m.conto === 'PERS-MARCO-001'; })
      .reduce(function (s, m) { return s + Math.abs(m.importo || 0); }, 0);
    var rc = calcRicaviCompetenza(reg);
    return 'Soci: Marco Vurro 50% + Sajay Fernandez Espinosa 50%. ' +
      'Cassa ' + ric.mesiQuadrati + '/' + ric.mesiTotali + ' mesi quadrati al centesimo con E/C ufficiale Intesa. ' +
      (reg.fatture || []).length + ' fatture in registro. Ricavi competenza 2026: €' + nf(rc.netto) + '. ' +
      'Anticipazioni socio Marco (carta personale): €' + nf(antic) + '.';
  }

  // YoY ricavi calcolato dal vivo: confronta il 2026 (competenza) col 2025
  // SULLO STESSO periodo coperto dalle FV 2026 (si auto-estende a nuovi mesi).
  function calcYoY(reg, statics) {
    var anno = String(reg.meta.annoFiscale || 2026);
    var ultimoMese = 0;
    (reg.fatture || []).forEach(function (f) {
      if ((f.tipo || f.direzione) !== 'vendita') return;
      var comp = f.competenza ? String(f.competenza) : String(parseISO(f.data).y);
      if (comp !== anno) return;
      var m = parseISO(f.data).m;
      if (m > ultimoMese) ultimoMese = m;
    });
    if (!ultimoMese) return (statics.storico && statics.storico.yoyGenApr) || null;
    var r2026 = calcRicaviCompetenza(reg).netto;
    var mens = (statics.storico && statics.storico.mensile) || [];
    var r2025 = round2(mens.filter(function (x) { return String(x.anno) === '2025' && x.mese <= ultimoMese; })
      .reduce(function (s, x) { return s + (x.ricavi || 0); }, 0));
    var pct = r2025 ? round2((r2026 - r2025) / r2025 * 100) : 0;
    return { ricavi2025: r2025, ricavi2026: r2026, variazionePct: pct, label: 'YoY Gen-' + MESI_ABBR[ultimoMese - 1] };
  }

  // ========================================================== PARTITARIO F/C
  // Anagrafica fornitori/clienti DERIVATA dalle fatture (chiave = P.IVA, fallback
  // sul nome). Gli override manuali (nome pulito, merge alias, categoria, codice)
  // vivono in reg.controparti[] e si applicano qui. Per ogni controparte:
  // Fatturato / Pagato / Aperto, dedotti dallo stato pagamento delle fatture.
  function normNome(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }
  function chiaveControparte(f) { return (f.partitaIva && String(f.partitaIva).trim()) || normNome(f.controparte) || '?'; }

  function calcPartitario(reg) {
    var overrides = reg.controparti || [];
    var aliasMap = {}, ovByKey = {};
    overrides.forEach(function (o) {
      var k = String(o.chiave || '').trim(); if (!k) return;
      ovByKey[k] = o;
      (o.alias || []).forEach(function (a) { aliasMap[String(a).trim()] = k; aliasMap[normNome(a)] = k; });
    });
    function canon(k) { return aliasMap[k] || k; }

    var acc = {};
    (reg.fatture || []).forEach(function (f) {
      var dirz = f.direzione; if (dirz !== 'acquisto' && dirz !== 'vendita') return;
      var k = canon(chiaveControparte(f));
      var a = acc[k] || (acc[k] = {
        chiave: k, partitaIva: f.partitaIva || '', nomi: {}, dir: {},
        fatturatoForn: 0, pagatoForn: 0, fatturatoCli: 0, incassatoCli: 0, fatture: []
      });
      if (f.partitaIva && !a.partitaIva) a.partitaIva = f.partitaIva;
      var nm = String(f.controparte || '').trim(); if (nm) a.nomi[nm] = (a.nomi[nm] || 0) + 1;
      var seg = f.tipoDocumento === 'nota_credito' ? -1 : 1;
      var tot = seg * (f.importoTotale || 0);
      var pag = f.pagamento || {};
      var pagata = pag.stato === 'pagata' || pag.stato === 'pagato' || !!pag.movimentoId;
      if (dirz === 'acquisto') { a.dir.forn = 1; a.fatturatoForn += tot; if (pagata) a.pagatoForn += tot; }
      else { a.dir.cli = 1; a.fatturatoCli += tot; if (pagata) a.incassatoCli += tot; }
      a.fatture.push({ id: f.id, data: f.data, direzione: dirz, importo: round2(tot), stato: pagata ? 'pagata' : (pag.stato || 'aperta'), nc: f.tipoDocumento === 'nota_credito' });
    });

    function buildList(which) {
      var isForn = which === 'fornitori';
      var out = [];
      Object.keys(acc).forEach(function (k) {
        var a = acc[k]; if (!a.dir[isForn ? 'forn' : 'cli']) return;
        var ov = ovByKey[k] || {};
        var nomeFreq = Object.keys(a.nomi).sort(function (x, y) { return a.nomi[y] - a.nomi[x]; })[0] || a.chiave;
        var alias = Object.keys(a.nomi).filter(function (n) { return n !== nomeFreq; });
        var fatt = isForn ? a.fatturatoForn : a.fatturatoCli;
        var pag = isForn ? a.pagatoForn : a.incassatoCli;
        var aperto = round2(fatt - pag);
        var fatts = a.fatture.filter(function (x) { return x.direzione === (isForn ? 'acquisto' : 'vendita'); })
                             .sort(function (x, y) { return x.data < y.data ? 1 : -1; });
        out.push({
          chiave: k, codice: ov.codice || '',
          ragioneSociale: ov.ragioneSociale || nomeFreq,
          partitaIva: a.partitaIva || '',
          tipo: (a.dir.forn && a.dir.cli) ? 'entrambi' : (isForn ? 'fornitore' : 'cliente'),
          categoriaDefault: ov.categoriaDefault || '', note: ov.note || '',
          nFatture: fatts.length,
          fatturato: round2(fatt), pagato: round2(pag), aperto: aperto,
          fatturatoFmt: money(round2(fatt)), pagatoFmt: money(round2(pag)), apertoFmt: money(aperto),
          daSistemare: !ovByKey[k] && alias.length > 0,
          alias: alias, fatture: fatts
        });
      });
      return out.sort(function (x, y) { return y.fatturato - x.fatturato; });
    }

    var fornitori = buildList('fornitori'), clienti = buildList('clienti');
    function tot(list, campo) { return round2(list.reduce(function (s, r) { return s + r[campo]; }, 0)); }
    return {
      fornitori: fornitori, clienti: clienti,
      totali: {
        fornitori: { n: fornitori.length, fatturato: money(tot(fornitori, 'fatturato')), pagato: money(tot(fornitori, 'pagato')), aperto: money(tot(fornitori, 'aperto')) },
        clienti: { n: clienti.length, fatturato: money(tot(clienti, 'fatturato')), incassato: money(tot(clienti, 'pagato')), aperto: money(tot(clienti, 'aperto')) }
      }
    };
  }

  // ========================================================= RICONCILIAZIONE
  // Espone fatture (aperte/collegate) e movimenti di pagamento, per abbinarli.
  // Flusso: si parte dalle FATTURE APERTE (poche) e si abbina il movimento che
  // le paga; un movimento puo' coprire piu' fatture (fattureCollegate[]).
  function fattAperta(f) { var p = f.pagamento || {}; return !(p.stato === 'pagata' || p.stato === 'pagato' || p.movimentoId); }
  function calcRiconciliazione(reg) {
    var fatture = (reg.fatture || []).filter(function (f) { return f.direzione === 'acquisto' || f.direzione === 'vendita'; }).map(function (f) {
      var nc = f.tipoDocumento === 'nota_credito';
      return {
        id: f.id, direzione: f.direzione, controparte: f.controparte || '', partitaIva: f.partitaIva || '',
        data: f.data, importo: round2((nc ? -1 : 1) * (f.importoTotale || 0)), importoFmt: money(round2((nc ? -1 : 1) * (f.importoTotale || 0))),
        nc: nc, aperta: fattAperta(f), movimentoId: (f.pagamento || {}).movimentoId || ''
      };
    });
    var movimenti = movBanca(reg).filter(function (m) { return m.tipo === 'uscita' || m.tipo === 'entrata'; }).map(function (m) {
      return {
        id: m.id, data: m.data, tipo: m.tipo, controparte: m.controparte || '',
        importo: round2(Math.abs(m.importo)), importoFmt: money(round2(Math.abs(m.importo))),
        descrizione: m.descrizione || m.descrizioneBanca || '', fattureCollegate: (m.fattureCollegate || []).slice()
      };
    });
    var aperte = fatture.filter(function (f) { return f.aperta; });
    return {
      fatture: fatture, movimenti: movimenti,
      conta: { aperte: aperte.length, aperteAcquisto: aperte.filter(function (f) { return f.direzione === 'acquisto'; }).length, aperteVendita: aperte.filter(function (f) { return f.direzione === 'vendita'; }).length }
    };
  }

  // ========================================================= COSTI RICORRENTI
  // Normalizza scadenzeRicorrenti per la gestione e il previsionale.
  // mensilizzato = importo riportato a mese secondo la frequenza (annuale=/12, trimestrale=/3).
  var FREQ_FATTORE = { mensile: 1, bimestrale: 1 / 2, trimestrale: 1 / 3, semestrale: 1 / 6, annuale: 1 / 12 };
  function calcCostiRicorrenti(reg) {
    var lista = (reg.scadenzeRicorrenti || []).map(function (r) {
      var freq = r.frequenza || 'mensile';
      var imp = (typeof r.importo === 'number') ? r.importo : null;
      var fatt = FREQ_FATTORE[freq] != null ? FREQ_FATTORE[freq] : 1;
      var mensile = (imp != null) ? round2(imp * fatt) : null;
      return {
        id: r.id, tipo: r.tipo || '', descrizione: r.descrizione || r.tipo || r.beneficiario || '(senza nome)',
        beneficiario: r.beneficiario || '', importo: imp, importoFmt: imp != null ? money(imp) : '—',
        frequenza: freq, categoria: r.categoria || '', attiva: r.attiva !== false,
        mensilizzato: mensile, mensilizzatoFmt: mensile != null ? money(mensile) : '—',
        inizioValidita: r.inizioValidita || '', fineValidita: r.fineValidita || '',
        note: r.note || '', variabile: imp == null
      };
    });
    var attiviFissi = lista.filter(function (x) { return x.attiva && x.mensilizzato != null; });
    var totMensile = round2(attiviFissi.reduce(function (s, x) { return s + x.mensilizzato; }, 0));
    return {
      lista: lista, totaleMensile: totMensile, totaleMensileFmt: money(totMensile),
      totaleAnnuo: round2(totMensile * 12), totaleAnnuoFmt: money(round2(totMensile * 12)),
      nAttivi: attiviFissi.length, nVariabili: lista.filter(function (x) { return x.attiva && x.variabile; }).length,
      nDisattivi: lista.filter(function (x) { return !x.attiva; }).length
    };
  }
  // costi fissi ricorrenti attivi e validi nel mese (anno-m), riportati a mese
  function fissiMese(reg, anno, m) {
    var mISO = anno + '-' + pad2(m);
    return round2((reg.scadenzeRicorrenti || []).reduce(function (s, r) {
      if (r.attiva === false || typeof r.importo !== 'number') return s;
      if (r.inizioValidita && String(r.inizioValidita).slice(0, 7) > mISO) return s;
      if (r.fineValidita && String(r.fineValidita).slice(0, 7) < mISO) return s;
      var fatt = FREQ_FATTORE[r.frequenza || 'mensile']; if (fatt == null) fatt = 1;
      return s + r.importo * fatt;
    }, 0));
  }

  // ============================================================ BUILD COMPLETO
  function buildDashboardData(reg, statics) {
    statics = statics || {};
    var mensili = calcMensili(reg);
    var banca = calcBanca(reg, statics);
    var iva = calcIVA(reg, statics);
    var kpi = calcKPI(reg, banca, iva, mensili);
    var forecast = calcForecastCassa(reg, statics, mensili, banca);

    return {
      // calcolati dal vivo dal registro
      lastUpdate: statics.lastUpdate || (reg.meta && reg.meta.ultimoAggiornamento) || '',
      ebitdaTargetAnnuo: (reg.configurazione && reg.configurazione.ebitdaTargetAnnuo) || statics.ebitdaTargetAnnuo || 100000,
      kpi: kpi,
      scadenze: calcScadenze(reg),
      movimentiMensili: mensili,
      banca: banca,
      iva: iva,
      bilancio: calcBilancio(reg, banca, statics),
      bancaAliasDescrizioni: aliasDescrizioni(reg, statics),

      // testi di sintesi: CALCOLATI dal vivo (prima erano statici e invecchiavano)
      statusMessage: calcStatusMessage(reg, banca, iva, mensili),
      statoLavori: calcStatoLavori(reg, banca),

      // input non derivabili (statici): storico anni chiusi, forecast, config
      suggerimenti: statics.suggerimenti || '',
      setupChecklist: statics.setupChecklist || [],
      alert: statics.alert || [],
      previsionale: calcPrevisionaleFuturo(reg, statics, forecast),
      forecastCassa: forecast,
      partitario: calcPartitario(reg),
      storico: yoyLive(reg, statics)
    };
  }

  // storico statico con il YoY ricalcolato dal vivo
  function yoyLive(reg, statics) {
    var st = statics.storico || {};
    var yoy = calcYoY(reg, statics);
    if (!yoy) return st;
    var out = {}; for (var k in st) out[k] = st[k];
    out.yoyGenApr = yoy;
    return out;
  }

  // FORECAST CASSA dal vivo: reali gen→ultimo mese (dai movimenti), poi proiezione:
  // incassi = MEDIA vendite 2023-2025 netto SiliconDev (statics.mediaMensileVendite),
  // uscite = media costi dei mesi a regime + scadenze straordinarie del mese.
  function calcForecastCassa(reg, statics, mensili, banca) {
    var anno = (reg.meta && reg.meta.annoFiscale) || 2026;
    var media = (statics && statics.mediaMensileVendite) || [];
    var saldoInizio = parseEuro(banca.saldoInizialeAnno);
    var realiInc = {}, realiUsc = {}, ultimoReale = 0;
    mensili.forEach(function (mm) {
      var mIdx = MESI.indexOf(mm.mese.split(' ')[0]) + 1;
      realiInc[mIdx] = parseEuro(mm.totaleEntrate);
      realiUsc[mIdx] = parseEuro(mm.totaleUscite);
      if (mIdx > ultimoReale) ultimoReale = mIdx;
    });
    // uscita operativa RICORRENTE media: ultimi 3 mesi reali, ESCLUSE le voci
    // straordinarie/una-tantum (distribuzione utili, rimborsi/anticipi soci, da verificare)
    // E le imposte/F24 (che si aggiungono SOLO via scadMese, sennò sarebbero contate due volte).
    var STRAORD = /distribuzione_utili|STR_strao|anticipazione_socio|rimborsi_spese_soci|DA_VERIFICARE|B14_imposte|TRIB_debiti/i;
    var uscOp = {};
    movBanca(reg).forEach(function (m) {
      if (m.tipo !== 'uscita' || STRAORD.test(m.categoria || '')) return;
      var mi = parseISO(m.data).m; uscOp[mi] = (uscOp[mi] || 0) + Math.abs(m.importo);
    });
    var regime = [];
    for (var k = Math.max(2, ultimoReale - 2); k <= ultimoReale; k++) if (uscOp[k]) regime.push(uscOp[k]);
    var usciteMedia = regime.length ? round2(regime.reduce(function (a, b) { return a + b; }, 0) / regime.length) : 5000;
    // costi fissi ricorrenti gia' censiti da Marco (mensilizzati). Cio' che la media
    // reale ha in piu' = costi operativi NON ancora dettagliati: cala man mano che
    // i ricorrenti vengono censiti, cosi' la stima non sotto/sovra-stima.
    var fissiTot = calcCostiRicorrenti(reg).totaleMensile;
    var altriCosti = round2(Math.max(0, usciteMedia - fissiTot)); // fallback se manca lo storico merce
    // costi variabili (merce/fornitori) STAGIONALI: media dello stesso mese 2024-2025
    var variabili = (statics && statics.mediaMensileCostiMerce) || [];
    function scadMese(m) {
      return round2((reg.scadenze || []).filter(function (s) {
        if (!isISO(s.data) || typeof s.importo !== 'number') return false;
        var p = parseISO(s.data);
        return p.y === anno && p.m === m && s.stato !== 'pagato' && s.stato !== 'pagata' &&
          /inps|inail|iva|imposte|acconto|cciaa/i.test((s.tipo || '') + ' ' + (s.descrizione || ''));
      }).reduce(function (a, s) { return a + s.importo; }, 0));
    }
    // INCASSI FUTURI A 2 COMPONENTI (no doppio conteggio):
    //  (1) rate certe a portafoglio = proforma gia contrattualizzate non ancora incassate
    //      (registro.portafoglioOrdini.perMese, derivate dai Payments Danea con Paid=false e data futura)
    //  (2) nuovi ordini stimati = MEDIA storica del mese MENO la quota gia a portafoglio
    //      (se il portafoglio supera la media -> stima 0, vince il dato certo).
    var portMese = (reg.portafoglioOrdini && reg.portafoglioOrdini.perMese) || {};
    var labels = [], incassi = [], incassiCerti = [], incassiStimati = [], uscite = [], saldo = [], prev = saldoInizio;
    for (var m = 1; m <= 12; m++) {
      var inc, usc, certo = 0, stima = 0;
      if (m <= ultimoReale) { inc = realiInc[m] || 0; usc = realiUsc[m] || 0; }
      else {
        certo = round2(portMese[anno + '-' + pad2(m)] || 0);
        stima = round2(Math.max(0, (media[m - 1] || 0) - certo));
        inc = round2(certo + stima);
        var varM = (variabili[m - 1] != null) ? variabili[m - 1] : altriCosti; usc = round2(fissiMese(reg, anno, m) + varM + scadMese(m));
      }
      var fine = round2(prev + inc - usc);
      labels.push(MESI_ABBR[m - 1]); incassi.push(Math.round(inc)); incassiCerti.push(Math.round(certo)); incassiStimati.push(Math.round(stima)); uscite.push(Math.round(usc)); saldo.push(Math.round(fine));
      prev = fine;
    }
    var incassiCertiResidui = incassiCerti.reduce(function (a, b) { return a + b; }, 0);
    var saldoOggi = Math.round(ultimoReale ? saldo[ultimoReale - 1] : saldoInizio);
    var meseZero = null;
    for (var i = 0; i < 12; i++) if (saldo[i] < 0) { meseZero = MESI[i]; break; }
    return {
      titolo: 'Previsione Cassa ' + anno,
      nota: 'Reale gen→' + MESI_ABBR[ultimoReale - 1] + ' (estratti conto ufficiali). Da ' + (MESI_ABBR[ultimoReale] || 'fine anno') + ' gli incassi sono divisi in due: (1) rate già contrattualizzate (proforma a portafoglio, certe) + (2) nuovi ordini stimati = media fatturato 2023-2025 netto consulenza, meno la quota già a portafoglio (niente doppio conteggio). Uscite = costi fissi ricorrenti + costi merce stagionali (media stesso mese 2024-2025) + scadenze fiscali del mese. Calcolato dal vivo.',
      realCount: ultimoReale,
      labels: labels, incassi: incassi, incassiCerti: incassiCerti, incassiStimati: incassiStimati, uscite: uscite, saldo: saldo,
      kpi: {
        saldoOggi: saldoOggi,
        saldoFine: saldo[11],
        meseSottoZero: meseZero || '—',
        venditeNecessarie: saldo[11] < 5000 ? Math.round(5000 - saldo[11]) : 0,
        incassiCertiResidui: Math.round(incassiCertiResidui),
        portafoglioTotaleFuturo: Math.round((reg.portafoglioOrdini && reg.portafoglioOrdini.totaleRateCerte) || 0)
      }
    };
  }

  // PREVISIONALE dal vivo: per ogni mese FUTURO genera le voci certe (ricorrenti +
  // scadenze del mese) + incassi attesi, con totali/saldo coerenti col grafico
  // Cash Flow (forecastCassa). I mesi passati non si mostrano (sono già realtà).
  function calcPrevisionaleFuturo(reg, statics, forecast) {
    var fc = forecast || (statics && statics.forecastCassa) || {};
    var inc = fc.incassi || [], usc = fc.uscite || [], sal = fc.saldo || [];
    var anno = (reg.meta && reg.meta.annoFiscale) || 2026;
    var oggi = new Date();
    var startM = (oggi.getFullYear() > anno) ? 13 : (oggi.getFullYear() < anno ? 1 : oggi.getMonth() + 1);
    // i costi fissi del mese sono calcolati nel loop (validità + mensilizzazione per frequenza)
    var out = [];
    for (var m = startM; m <= 12; m++) {
      var idx = m - 1;
      var voci = [];
      var certe = 0;
      // costi fissi ricorrenti attivi e validi questo mese (mensilizzati per frequenza)
      var mISO = anno + '-' + pad2(m);
      (reg.scadenzeRicorrenti || []).forEach(function (r) {
        if (r.attiva === false || typeof r.importo !== 'number' || r.importo <= 0) return;
        if (r.inizioValidita && String(r.inizioValidita).slice(0, 7) > mISO) return;
        if (r.fineValidita && String(r.fineValidita).slice(0, 7) < mISO) return;
        var fatt = FREQ_FATTORE[r.frequenza || 'mensile']; if (fatt == null) fatt = 1;
        var q = round2(r.importo * fatt);
        var etich = (r.descrizione || r.beneficiario || r.tipo) + ((r.frequenza && r.frequenza !== 'mensile') ? ' (quota mens.)' : '');
        voci.push({ voce: etich, tipo: 'uscita', importo: money(q), certezza: 'certo' });
        certe += q;
      });
      // scadenze puntuali del mese (INPS/INAIL/IVA/F24)
      (reg.scadenze || []).forEach(function (s) {
        if (!isISO(s.data) || typeof s.importo !== 'number' || s.importo <= 0) return;
        var p = parseISO(s.data);
        if (p.y !== anno || p.m !== m || s.stato === 'pagato' || s.stato === 'pagata') return;
        voci.push({ voce: s.descrizione, tipo: 'uscita', importo: money(s.importo), certezza: s.stato === 'da_pagare' ? 'certo' : 'stimato' });
        certe += s.importo;
      });
      // altri costi operativi stimati (per quadrare col forecast)
      var altri = round2((usc[idx] || 0) - certe);
      if (altri > 1) voci.push({ voce: 'Altri costi operativi non ancora dettagliati', tipo: 'uscita', importo: money(altri), certezza: 'stimato' });
      // incassi attesi — 2 componenti: rate certe a portafoglio + nuovi ordini stimati
      var incCerti = fc.incassiCerti || [], incStimati = fc.incassiStimati || [];
      if ((incCerti[idx] || 0) > 0) voci.push({ voce: 'Rate già firmate dai clienti (manutenzioni + saldi proforma)', tipo: 'entrata', importo: money(incCerti[idx]), certezza: 'certo' });
      if ((incStimati[idx] || 0) > 0) voci.push({ voce: 'Nuovi ordini stimati (sulla media degli ultimi 3 anni)', tipo: 'entrata', importo: money(incStimati[idx]), certezza: 'stimato' });
      // fallback se il forecast non porta la suddivisione
      if (!incCerti.length && !incStimati.length && (inc[idx] || 0) > 0) voci.push({ voce: 'Incassi attesi (proforma + manutenzioni a rate)', tipo: 'entrata', importo: money(inc[idx]), certezza: 'stimato' });
      out.push({
        mese: MESI[m - 1] + ' ' + anno,
        saldoStimato: '~' + money(sal[idx] || 0),
        voci: voci,
        totaleUsciteStimate: money(usc[idx] || 0),
        totaleEntrateStimate: money(inc[idx] || 0)
      });
    }
    return out;
  }

  // ORDINI (proforma Danea consolidate): riepilogo per anno + lista 2026 con stato
  // incasso reale + portafoglio rate certe future. Read-only. Difensiva: se manca
  // reg.ordini (versione pubblica sanitizzata) ritorna struttura vuota.
  function calcOrdini(reg) {
    var ordini = reg.ordini || [];
    var esclusi = (reg.configurazione || {}).clientiEsclusiBusiness || {};
    var rxEsc = (esclusi.attivo && esclusi.pattern) ? new RegExp(esclusi.pattern, 'i') : null;
    function isEscluso(o) { return rxEsc ? rxEsc.test(o.cliente || '') : false; }

    var perAnnoMap = {};
    ordini.forEach(function (o) {
      if (isEscluso(o)) return;
      var y = (o.data || '').slice(0, 4); if (!y) return;
      var a = perAnnoMap[y] || (perAnnoMap[y] = { count: 0, fatturato: 0, margine: 0 });
      a.count++;
      a.fatturato += (o.vendita && o.vendita.fatturatoNetto) || 0;
      if (typeof o.margineContribuzione === 'number') a.margine += o.margineContribuzione;
    });
    var perAnno = Object.keys(perAnnoMap).sort().map(function (y) {
      var a = perAnnoMap[y];
      return { anno: y, count: a.count, fatturato: round2(a.fatturato), fatturatoFmt: money(a.fatturato),
        margine: round2(a.margine), margineFmt: money(a.margine),
        marginePerc: a.fatturato > 0 ? Math.round(a.margine / a.fatturato * 100) : null };
    });

    var STATO = { incassato: { label: 'Pagato', cls: 'ok' }, parziale: { label: 'In parte', cls: 'warn' }, aperto: { label: 'Da incassare', cls: 'open' } };
    var ordini2026 = ordini.filter(function (o) { return (o.data || '').slice(0, 4) === '2026'; }).map(function (o) {
      var valore = (o.vendita && (o.vendita.totale || o.vendita.fatturatoNetto)) || 0;
      var ric = o.riconciliazione || null;
      var inc = ric ? (ric.totaleIncassatoLordo || 0) : 0;
      var st = STATO[o.stato] || STATO.aperto;
      var label = st.label, cls = st.cls;
      var manca = Math.max(0, round2(valore - inc));
      return { cliente: o.cliente, data: o.data, valore: round2(valore), valoreFmt: money(valore),
        stato: o.stato, statoLabel: label, statoCls: cls,
        incassato: round2(inc), incassatoFmt: inc > 0 ? money(inc) : '—',
        lag: ric ? ric.lagGiorni : null, manca: manca, mancaFmt: manca > 0 ? money(manca) : '—',
        nota: o.notaRiconciliazione || null };
    });

    var pf = reg.portafoglioOrdini || {};
    var perMese = pf.perMese || {};
    var mesiOrd = Object.keys(perMese).sort().map(function (k) {
      var mi = parseInt(k.split('-')[1], 10);
      return { mese: k, meseFmt: MESI_ABBR[mi - 1] + ' ' + k.split('-')[0], importo: perMese[k], importoFmt: money(perMese[k]) };
    });
    var portafoglio = { totale: pf.totaleRateCerte || 0, totaleFmt: money(pf.totaleRateCerte || 0),
      numeroRate: pf.numeroRate || 0, perMese: mesiOrd, nota: pf.nota || null,
      batchDaSpacchettare: (pf.batchSddDaSpacchettare || []).length, notaBatch: pf.notaBatchCiechi || null };

    return { perAnno: perAnno, ordini2026: ordini2026, portafoglio: portafoglio, nessunDato: ordini.length === 0 };
  }

  function aliasDescrizioni(reg, statics) {
    if (reg.configurazione && reg.configurazione.bancaAlias) return reg.configurazione.bancaAlias;
    return statics.bancaAliasDescrizioni || {};
  }

  return {
    buildDashboardData: buildDashboardData,
    CATEGORIE: CATEGORIE,
    gruppoDi: gruppoDi,
    parseEuro: parseEuro,
    // esposte per il gate / debug
    _calc: { calcMensili: calcMensili, calcBanca: calcBanca, calcIVA: calcIVA, calcKPI: calcKPI, calcBilancio: calcBilancio, calcScadenze: calcScadenze, calcPartitario: calcPartitario, calcRiconciliazione: calcRiconciliazione, calcCostiRicorrenti: calcCostiRicorrenti, calcOrdini: calcOrdini }
  };
});
