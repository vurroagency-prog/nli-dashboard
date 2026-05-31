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

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

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

  // movimenti realmente transitati sul conto NLI (= estratto conto).
  // Esclude: conto personale del socio (anticipazioni con carta personale) e i
  // movimenti marcati cassa:false (riepiloghi gestionali non presenti in E/C).
  function movBanca(reg) {
    return (reg.movimenti || []).filter(function (m) {
      return m.conto !== 'PERS-MARCO-001' && m.cassa !== false;
    });
  }

  // =========================================================== MOVIMENTI MENSILI
  function calcMensili(reg) {
    var byMonth = {}; // "2026-01" -> {entrate:[], uscite:[]}
    movBanca(reg).forEach(function (m) {
      var p = parseISO(m.data);
      if (p.y !== reg.meta.annoFiscale && p.y !== 2026) { /* tieni anno corrente */ }
      var key = p.y + '-' + pad2(p.m);
      if (!byMonth[key]) byMonth[key] = { y: p.y, m: p.m, entrate: [], uscite: [] };
      var voce = (m.controparte || '') + (m.descrizione ? ' — ' + m.descrizione : '');
      var row = {
        data: ddmm(m.data),
        voce: voce.trim().replace(/^—\s*/, ''),
        voceBilancio: m.categoria || 'DA_VERIFICARE',
        importo: m.tipo === 'uscita' ? money(-Math.abs(m.importo)) : money(Math.abs(m.importo)),
        note: m.riconciliato ? '✓ Ric.' : '',
        competenza: m.competenza ? String(m.competenza) : '',
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
    var saldoInizio = (saldi[0] && /-01-01$/.test(saldi[0].data)) ? saldi[0].importo : (saldi[0] ? saldi[0].importo : 0);
    var saldoFineByMonth = {}; // m(1-12) -> importo ufficiale fine mese
    saldi.forEach(function (s) {
      var p = parseISO(s.data);
      // ultimo saldo per ciascun mese = saldo di fine mese
      saldoFineByMonth[p.m] = s.importo;
    });
    var saldoAttuale = saldi.length ? saldi[saldi.length - 1].importo : 0;

    // flussi mensili calcolati dai movimenti
    var mens = calcMensili(reg);
    var prevFine = saldoInizio;
    var totE = 0, totU = 0, totMov = 0;
    var riepilogo = mens.map(function (mm) {
      var mIdx = MESI.indexOf(mm.mese.split(' ')[0]) + 1;
      var e = parseEuro(mm.totaleEntrate), u = parseEuro(mm.totaleUscite);
      var n = e - u;
      var nMov = mm.entrate.length + mm.uscite.length;
      var inizio = prevFine;
      var fine = (saldoFineByMonth[mIdx] != null) ? saldoFineByMonth[mIdx] : round2(inizio + n);
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

    // RICONCILIAZIONE — criterio robusto: la quadratura con l'E/C ufficiale.
    // Il flag `riconciliato` sul singolo movimento e' incompleto (i ~152 mov.
    // storici gen-apr non lo hanno), quindi NON e' una metrica affidabile.
    // Un mese e' "riconciliato" se la somma dei suoi movimenti combacia col
    // saldo di fine mese dell'E/C ufficiale (tolleranza 1€). Un movimento e'
    // riconciliato se il suo mese quadra OPPURE ha flag riconciliato===true.
    var meseQuadra = {}; // m(1-12) -> bool
    var prevF = saldoInizio;
    riepilogo.forEach(function (r) {
      var mIdx = MESI.indexOf(r.mese.split(' ')[0]) + 1;
      var diff = parseEuro(r.saldoFine) - (prevF + parseEuro(r.entrate) - parseEuro(r.uscite));
      meseQuadra[mIdx] = Math.abs(round2(diff)) < 1;
      prevF = parseEuro(r.saldoFine);
    });
    var mb = movBanca(reg);
    var ric = 0;
    var aperti = [];
    mb.forEach(function (m) {
      var mIdx = parseISO(m.data).m;
      var isRic = (m.riconciliato === true) || meseQuadra[mIdx];
      if (isRic) { ric++; return; }
      aperti.push({
        id: m.id,
        data: m.data,
        controparte: m.controparte || m.descrizione || '',
        importo: money(Math.abs(m.importo)),
        tipo: m.tipo,
        motivo: m.descrizione || ''
      });
    });
    var mesiTot = Object.keys(meseQuadra).length;
    var mesiOk = Object.keys(meseQuadra).filter(function (k) { return meseQuadra[k]; }).length;

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

  function parseEuro(s) {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    var neg = /[−-]/.test(String(s).trim().charAt(0)) || String(s).indexOf('−') === 0;
    var n = parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    if (isNaN(n)) n = 0;
    return neg && n > 0 ? -n : n;
  }

  // ================================================================== IVA
  // L'IVA e' un dato ufficiale (liquidazione a cura del commercialista) gia'
  // strutturato in registro.iva.trimestri. Qui si mappa sul contratto che il
  // rendering si aspetta (ivaDebito/ivaCredito/mesi/breakdown), senza inventare.
  function calcIVA(reg, statics) {
    var iva = reg.iva || {};
    var anno = (reg.meta && reg.meta.annoFiscale) || 2026;
    var trimestri = (iva.trimestri || []).map(function (t) {
      var debito = (t.ivaDebito && t.ivaDebito.totale) || 0;
      var credito = (t.ivaCredito && t.ivaCredito.totale) || 0;
      var creditoRip = t.creditoRiportato || 0;
      var saldo, creditoIva, importoVers;
      if (t.liquidazioneUfficiale && typeof t.liquidazioneUfficiale.credito === 'number') {
        // liquidazione UFFICIALE Mascolo: e' la verita'
        creditoIva = t.liquidazioneUfficiale.credito;
        saldo = -creditoIva;
        importoVers = 0;
        credito = round2(debito + creditoIva); // coerenza: acquisti = vendite + credito
      } else if (typeof t.saldoIva === 'number') {
        saldo = t.saldoIva;
        creditoIva = t.creditoIva || (saldo < 0 ? -saldo : 0);
        importoVers = t.importoVersamento || (saldo > 0 ? saldo : 0);
      } else {
        saldo = round2(debito - credito - creditoRip);
        creditoIva = saldo < 0 ? -saldo : 0;
        importoVers = saldo > 0 ? saldo : 0;
      }
      var mesiLabel = (t.mesi || []).map(function (m) { return MESI_ABBR[parseISO(m + '-01').m - 1]; });
      var mesiStr = mesiLabel.length ? mesiLabel[0] + '-' + mesiLabel[mesiLabel.length - 1] : '';
      var d = t.ivaDebito || {}, c = t.ivaCredito || {};
      return {
        id: t.id,
        periodo: t.periodo + ' ' + anno,
        mesi: mesiStr,
        stato: t.stato,
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

  // somma importi scadenze "da pagare" nei prossimi N giorni (per il KPI)
  function scadenzeImminenti(reg, giorni) {
    var oggi = new Date();
    var limite = new Date(oggi.getTime() + giorni * 86400000);
    var tot = 0, n = 0;
    (reg.scadenze || []).forEach(function (s) {
      if (s.stato !== 'da_pagare' || !isISO(s.data)) return;
      var d = new Date(s.data + 'T00:00:00');
      if (d >= oggi && d <= limite && typeof s.importo === 'number') { tot += s.importo; n++; }
    });
    return { totale: round2(tot), count: n };
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
      { label: 'SCADENZE PROSSIMI 45GG', value: scad.count ? money(scad.totale) : '—', sub: scad.count + ' adempimenti da pagare', class: scad.totale > 0 ? 'danger' : 'success' }
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
    var pf = mapPrevisioneFiscale(reg);
    var imposte = { totale: round2(pf.irap.importo), nota: 'IRAP a carico societa (IRPEF/INPS soci in tab Previsione Fiscale).' };
    var utile = round2(diffAB - ceC.totale - imposte.totale);

    var ce = {
      label: 'Conto Economico (competenza ' + anno + ')',
      A: ceA,
      B: { label: 'B) Costi della produzione', totale: round2(totB), sottoGruppi: sottoGruppi },
      diffAB: { importo: diffAB },
      C: ceC,
      imposte: imposte,
      utile: { importo: utile }
    };

    // ---- Stato Patrimoniale (voci primarie registro + cassa calcolata)
    var imm = (reg.immobilizzazioni || []).reduce(function (s, i) {
      return s + (i.valoreResiduo != null ? i.valoreResiduo : (i.valore || 0));
    }, 0);
    var cauzione = (reg.vociManualiSP || []).filter(function (v) { return /cauzion/i.test(v.descrizione || v.label || ''); })
      .reduce(function (s, v) { return s + (v.importo || 0); }, 0);
    var capitale = (reg.vociManualiSP || []).filter(function (v) { return /capitale/i.test(v.descrizione || v.label || ''); })
      .reduce(function (s, v) { return s + (v.importo || 0); }, 0);
    var debitiSoci = (reg.debitiVersoSoci || []).reduce(function (s, d) { return s + (d.importo || d.saldo || 0); }, 0);
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
      previsioneFiscale: mapPrevisioneFiscale(reg)
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

  function mapPrevisioneFiscale(reg) {
    var s = (reg.previsioneFiscale && reg.previsioneFiscale.stima) || {};
    var m = s.marco || {}, sj = s.sajay || {}, ir = s.irap || {};
    var utileNeg = (s.utileAnteImposte || 0) <= 0;
    return {
      utileNegativo: utileNeg,
      utileAnteImposte: round2(s.utileAnteImposte || 0),
      baseImponibileIRAP: round2(s.baseImponibileIRAP || 0),
      totaleCaricofiscale: round2(s.totaleCaricofiscale || 0),
      percentualeSuUtile: s.percentualeSuUtile,
      irap: { importo: round2(ir.importo || 0), aliquota: (reg.previsioneFiscale && reg.previsioneFiscale.parametri && reg.previsioneFiscale.parametri.aliquotaIRAP) || 0.039 },
      marco: {
        redditoImponibile: round2(m.redditoImponibile || 0),
        irpef: round2(m.irpef || 0),
        addizionali: round2(m.addizionali || 0),
        inpsFisso: round2(m.inpsFisso || 0),
        inpsEccedenza: round2(m.inpsEccedenza || 0),
        totaleTasse: round2(m.totaleTasse || 0),
        nettoStimato: round2(m.nettoStimato || 0),
        aliquotaEffettiva: (m.redditoImponibile > 0) ? round2((m.totaleTasse || 0) / m.redditoImponibile * 100) / 100 : null
      },
      sajay: {
        redditoImponibile: round2(sj.redditoImponibile || sj.redditoDipendente || 0),
        irpef: round2(sj.irpef || 0),
        addizionali: round2(sj.addizionali || 0),
        totaleTasse: round2(sj.totaleTasse || 0),
        nettoStimato: round2(sj.nettoStimato || 0),
        aliquotaEffettiva: (sj.redditoImponibile > 0) ? round2((sj.totaleTasse || 0) / sj.redditoImponibile * 100) / 100 : null
      },
      disclaimer: (reg.previsioneFiscale && reg.previsioneFiscale.disclaimer) || s.nota || ''
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

  // ============================================================ BUILD COMPLETO
  function buildDashboardData(reg, statics) {
    statics = statics || {};
    var mensili = calcMensili(reg);
    var banca = calcBanca(reg, statics);
    var iva = calcIVA(reg, statics);
    var kpi = calcKPI(reg, banca, iva, mensili);

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
      previsionale: statics.previsionale || [],
      forecastCassa: statics.forecastCassa || {},
      storico: statics.storico || {}
    };
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
    _calc: { calcMensili: calcMensili, calcBanca: calcBanca, calcIVA: calcIVA, calcKPI: calcKPI, calcBilancio: calcBilancio, calcScadenze: calcScadenze }
  };
});
