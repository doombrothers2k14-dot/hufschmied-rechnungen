import { h, render } from 'preact';
import { useState, useEffect, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
import * as db from './db.js';
import {
  euro, parseEuro, centToInput, parseZahl, zahl, heuteISO, deDatum, plusTage, berechne, faelligkeit, faelligText,
  statusVon, zeitraumGrenzen, uid, EINHEITEN, STEUERSAETZE, dateiname
} from './logic.js';
import { erzeugeDateien, exportZip } from './export.js';
import * as konto from './konto.js';
import { KATEGORIEN, ZAHLARTEN, dateiVorbereiten, anhangText, groesseText, ausBrutto } from './belege.js';

const html = htm.bind(h);
const VERSION = '1.3.0';

// ---------------------------------------------------------------------------
// Icons (Strich-Icons, 24er Raster)
const ICON = {
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  home: 'M4 11l8-7 8 7v9H4z M10 20v-6h4v6',
  doc: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  people: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 4.5a3.5 3.5 0 010 6.5 M18 14c1.9.8 3 3 3 6',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7',
  mail: 'M4 6h16v12H4z M4 7l8 6 8-6',
  chevron: 'M9 5l7 7-7 7',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
  building: 'M4 21V5l8-2v18 M12 9h8v12 M8 8h.01 M8 12h.01 M8 16h.01 M16 13h.01 M16 17h.01',
  safe: 'M4 5h16v14H4z M12 9a3 3 0 100 6 3 3 0 000-6z M4 9h2 M4 15h2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  cloud: 'M7 18h10a4 4 0 00.5-7.97A6 6 0 006.1 9.1 4.5 4.5 0 007 18z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  clip: 'M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.3 3.3 0 014.7 4.7L9.2 17.2a1.7 1.7 0 01-2.4-2.4L14.5 7',
  close: 'M6 6l12 12 M18 6L6 18'
};
const Icon = ({ n, w = 2 }) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n].split(' M').map((d, i) => html`<path d=${i ? 'M' + d : d}></path>`)}</svg>`;

// ---------------------------------------------------------------------------
// Hilfen

async function teilen(dateien, { titel, text } = {}) {
  const files = dateien.map((d) => new File([d.bytes], d.name, { type: d.type }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: titel, text });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.warn('Teilen fehlgeschlagen, lade stattdessen herunter', e);
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return true;
}

function mailText(s, inv) {
  return (s.mailText || '')
    .replaceAll('{nr}', inv.nr)
    .replaceAll('{betrag}', euro(inv.summen.brutto))
    .replaceAll('{firma}', s.firma.name)
    .replaceAll('{kunde}', inv.kunde.name);
}

function rechnungsDateien(inv, pdf, xml) {
  const list = [{ bytes: pdf, name: dateiname(inv.nr) + '.pdf', type: 'application/pdf' }];
  if (xml) list.push({ bytes: xml, name: dateiname(inv.nr) + '.xml', type: 'application/xml' });
  return list;
}

function useDateien(inv) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!inv) return;
    (async () => {
      const pdf = await db.datei(inv.id, 'pdf');
      const xml = inv.hatXml ? await db.datei(inv.id, 'xml') : null;
      if (alive) setD({ pdf, xml, url: pdf ? URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' })) : null });
    })();
    return () => { alive = false; };
  }, [inv && inv.id]);
  useEffect(() => () => { if (d && d.url) URL.revokeObjectURL(d.url); }, [d]);
  return d;
}

const sortNeu = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');

// ---------------------------------------------------------------------------
// Bausteine

function Head({ title, sub, onBack, right }) {
  return html`<header class="head">
    ${onBack && html`<button class="icon-btn" aria-label="Zurück" onClick=${onBack}><${Icon} n="back" w="2.2" /></button>`}
    <div style="flex:1;min-width:0;padding-left:${onBack ? 0 : 8}px">
      <h1>${title}</h1>
      ${sub && html`<div class="sub">${sub}</div>`}
    </div>
    ${right}
  </header>`;
}

function Tabs({ tab, go }) {
  const t = [['home', 'Übersicht', 'home'], ['rechnungen', 'Rechnungen', 'doc'], ['belege', 'Belege', 'receipt'], ['kunden', 'Kunden', 'people'], ['mehr', 'Mehr', 'more']];
  return html`<nav class="tabs" aria-label="Hauptmenü">
    ${t.map(([id, label, icon]) => html`<button class="tab" aria-current=${tab === id ? 'page' : null} onClick=${() => go({ name: 'tab', tab: id }, true)}><${Icon} n=${icon} /><span>${label}</span></button>`)}
  </nav>`;
}

function Field({ label, hint, children }) {
  return html`<label class="field"><span>${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}

function Badge({ inv }) {
  const st = statusVon(inv);
  return html`<span class=${'badge ' + st.key}>${st.text}</span>`;
}

function RechnungRow({ inv, onClick }) {
  return html`<button class="row" onClick=${onClick}>
    <span class="main"><span class="t">${inv.kunde.name}</span><span class="s">${inv.nr} · ${deDatum(inv.datum)}</span></span>
    <span class="end"><span class="amt">${euro(inv.summen.brutto)}</span><${Badge} inv=${inv} /></span>
  </button>`;
}

function Stepper({ value, onChange, label }) {
  const [txt, setTxt] = useState(zahl(value));
  useEffect(() => { if (parseZahl(txt) !== value) setTxt(zahl(value)); }, [value]);
  return html`<div class="stepper">
    <button aria-label=${label + ' weniger'} onClick=${() => onChange(Math.max(0, Math.round((value - 1) * 1000) / 1000))}><${Icon} n="minus" w="2.4" /></button>
    <input aria-label=${label + ' Menge'} inputmode="decimal" value=${txt}
      style="width:46px;min-height:40px;text-align:center;border:0;background:transparent;font-size:17px;font-weight:600"
      onInput=${(e) => { setTxt(e.target.value); const n = parseZahl(e.target.value); if (n !== null && n >= 0) onChange(n); }}
      onBlur=${() => setTxt(zahl(value))} />
    <button class="plus" aria-label=${label + ' mehr'} onClick=${() => onChange(Math.round((value + 1) * 1000) / 1000)}><${Icon} n="plus" w="2.4" /></button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Übersicht

function Uebersicht({ ctx }) {
  const { data, go } = ctx;
  const heute = heuteISO();
  const rechnungen = data.invoices.filter((i) => i.typ !== 'storno');
  const heuteErstellt = rechnungen.filter((i) => i.datum === heute).length;
  const offen = rechnungen.filter((i) => ['offen', 'ueberfaellig'].includes(statusVon(i).key));
  const ueber = offen.filter((i) => statusVon(i).key === 'ueberfaellig');
  const faellig = data.horses
    .map((p) => ({ p, f: faelligkeit(p, heute), k: data.customers.find((c) => c.id === p.customerId) }))
    .filter((x) => x.f && x.k && x.f.inTagen <= 14)
    .sort((a, b) => a.f.inTagen - b.f.inTagen)
    .slice(0, 8);
  const letzte = [...data.invoices].sort(sortNeu).slice(0, 5);
  const s = data.settings;
  const sicherungAlt = data.invoices.length > 0 && (!s.letzteSicherung || plusTage(s.letzteSicherung, 30) < heute);
  const wochentag = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  return html`<div class="screen">
    <div class="head-big"><div><p>${wochentag}</p><h1>Übersicht</h1></div>
      ${ctx.sync.angemeldet && html`<button class="sync-pill" data-status=${ctx.sync.status} onClick=${() => go({ name: 'sync' })}><${Icon} n="cloud" />${syncKurz(ctx.sync)}</button>`}
    </div>
    <main class="body with-tabs">
      ${!db.firmaVollstaendig(s) && html`<div class="note">
        <b>Willkommen!</b> Bevor die erste Rechnung rausgeht, brauchen wir deine Firmendaten: Name, Adresse, Steuernummer und Bankverbindung.
        <div><button class="btn small" onClick=${() => go({ name: 'firma' })}>Firmendaten eintragen</button></div>
      </div>`}
      ${sicherungAlt && html`<div class="note warn">
        Die letzte Datensicherung ist ${s.letzteSicherung ? 'über 30 Tage her' : 'noch nicht gemacht'}. ${ctx.sync.angemeldet ? 'Supabase (kostenloser Plan) macht keine eigenen Backups.' : 'Die Daten liegen nur auf diesem Gerät.'}
        <div><button class="btn small" onClick=${() => go({ name: 'sicherung' })}>Jetzt sichern</button></div>
      </div>`}
      <div class="stats">
        <div class="stat"><span>Heute erstellt</span><b>${heuteErstellt}</b></div>
        <button class="stat" style="border:0;text-align:left;cursor:pointer" onClick=${() => go({ name: 'tab', tab: 'rechnungen', filter: 'offen' }, true)}>
          <span>Offen</span><b>${offen.length}</b><em>${euro(offen.reduce((a, i) => a + i.summen.brutto, 0))}${ueber.length ? ` · ${ueber.length} überfällig` : ''}</em>
        </button>
      </div>
      <section class="section">
        <h2>Fällig zum Beschlag <small>nächste 14 Tage</small></h2>
        <div class="list">
          ${faellig.length ? faellig.map(({ p, f, k }) => html`<button class="row" onClick=${() => go({ name: 'neu', kundeId: k.id, pferdId: p.id })}>
            <span class="main"><span class="t">${p.name}</span><span class="s">${k.name}${p.stall ? ' · ' + p.stall : ''}</span></span>
            <span class=${'badge ' + (f.inTagen < 0 ? 'ueberfaellig' : f.inTagen <= 3 ? 'offen' : '')}>${faelligText(f.inTagen)}</span>
          </button>`) : html`<p class="empty">Keine Pferde in den nächsten 14 Tagen fällig.</p>`}
        </div>
      </section>
      <section class="section">
        <h2>Letzte Rechnungen</h2>
        <div class="list">
          ${letzte.length ? letzte.map((inv) => html`<${RechnungRow} inv=${inv} onClick=${() => go({ name: 'rechnung', id: inv.id })} />`) : html`<p class="empty">Noch keine Rechnungen.</p>`}
        </div>
      </section>
    </main>
    <button class="btn fab" onClick=${() => go({ name: 'neu' })}><${Icon} n="plus" w="2.4" />Neue Rechnung</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rechnungen

function Rechnungen({ ctx, filter: startFilter }) {
  const { data, go } = ctx;
  const [filter, setFilter] = useState(startFilter || 'alle');
  const [q, setQ] = useState('');
  const liste = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...data.invoices].sort(sortNeu).filter((i) => {
      const k = statusVon(i).key;
      if (filter === 'offen' && !['offen', 'ueberfaellig'].includes(k)) return false;
      if (filter === 'ueberfaellig' && k !== 'ueberfaellig') return false;
      if (filter === 'bezahlt' && k !== 'bezahlt') return false;
      if (t && !(i.nr.toLowerCase().includes(t) || i.kunde.name.toLowerCase().includes(t) || (i.pferde || []).join(' ').toLowerCase().includes(t))) return false;
      return true;
    });
  }, [data.invoices, filter, q]);
  const f = [['alle', 'Alle'], ['offen', 'Offen'], ['ueberfaellig', 'Überfällig'], ['bezahlt', 'Bezahlt']];
  return html`<div class="screen">
    <div class="head-big"><div><h1>Rechnungen</h1></div></div>
    <main class="body with-tabs">
      <input class="search" type="search" placeholder="Suche: Nummer, Kunde oder Pferd" aria-label="Rechnungen suchen" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">${f.map(([id, l]) => html`<button class="chip" aria-pressed=${filter === id ? 'true' : 'false'} onClick=${() => setFilter(id)}>${l}</button>`)}</div>
      <div class="list">
        ${liste.length ? liste.slice(0, 200).map((inv) => html`<${RechnungRow} inv=${inv} onClick=${() => go({ name: 'rechnung', id: inv.id })} />`) : html`<p class="empty">Keine Rechnungen gefunden.</p>`}
      </div>
      ${liste.length > 200 && html`<p class="small-print">Es werden die neuesten 200 angezeigt. Nutze die Suche oder den Export.</p>`}
    </main>
  </div>`;
}

function RechnungDetail({ ctx, id }) {
  const { data, back, go, reload, toast } = ctx;
  const inv = data.invoices.find((i) => i.id === id);
  const dateien = useDateien(inv);
  const [datum, setDatum] = useState(heuteISO());
  const [busy, setBusy] = useState(false);
  if (!inv) return html`<div class="screen"><${Head} title="Rechnung" onBack=${back} /><p class="empty">Nicht gefunden.</p></div>`;
  const st = statusVon(inv);
  const s = data.settings;
  const kannBezahlen = inv.typ !== 'storno' && ['offen', 'ueberfaellig'].includes(st.key);

  const senden = async () => {
    if (!dateien) return;
    const ok = await teilen(rechnungsDateien(inv, dateien.pdf, dateien.xml), { titel: `Rechnung ${inv.nr}`, text: mailText(s, inv) });
    if (ok) { await db.alsGesendetMarkieren(inv); await reload(); }
  };
  const bezahlt = async () => {
    if (!datum) return;
    await db.zahlungSetzen(inv, 'bank', datum);
    await reload();
    toast(`${inv.nr} als bezahlt gespeichert`);
  };
  const zuruecksetzen = async () => {
    if (!confirm('Zahlung wirklich zurücksetzen? Die Rechnung ist dann wieder offen.')) return;
    await db.zahlungZuruecksetzen(inv);
    await reload();
  };
  const stornieren = async () => {
    if (!confirm(`Rechnung ${inv.nr} stornieren?\n\nEs wird eine Stornorechnung mit neuer Nummer erstellt. Die Originalrechnung bleibt erhalten.`)) return;
    setBusy(true);
    try {
      const heute = heuteISO();
      const positionen = inv.positionen.map((p) => ({ ...p, menge: -p.menge }));
      const rabatt = inv.rabatt ? (inv.rabatt.art === 'betrag' ? { ...inv.rabatt, wert: -inv.rabatt.wert } : inv.rabatt) : null;
      const entwurf = {
        typ: 'storno', datum: heute, leistungsdatum: inv.leistungsdatum, faelligAm: heute,
        kunde: inv.kunde, kundeId: inv.kundeId, pferde: inv.pferde, pferdIds: inv.pferdIds,
        positionen, rabatt, summen: berechne(positionen, rabatt), zahlart: inv.zahlart,
        status: 'offen', bezugNr: inv.nr, bezugDatum: inv.datum
      };
      const storno = await db.festschreiben(entwurf, erzeugeDateien, konto.nummerReservierer());
      await db.stornoVermerken(inv, storno);
      await reload();
      go({ name: 'rechnung', id: storno.id }, false, true);
      toast(`Stornorechnung ${storno.nr} erstellt`);
    } catch (e) {
      alert('Storno fehlgeschlagen: ' + e.message);
    } finally { setBusy(false); }
  };

  return html`<div class="screen">
    <${Head} title=${inv.nr} sub=${(inv.typ === 'storno' ? 'Stornorechnung · ' : '') + deDatum(inv.datum)} onBack=${back} />
    <main class="body">
      <div class="card pad">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div><div style="font-size:17px;font-weight:600">${inv.kunde.name}</div><div class="small-print" style="font-size:13px">${inv.kunde.strasse}, ${inv.kunde.plz} ${inv.kunde.ort}</div></div>
          <${Badge} inv=${inv} />
        </div>
        ${inv.pferde && inv.pferde.length ? html`<p style="font-size:14px;color:var(--ink2)">Pferde: ${inv.pferde.join(', ')}</p>` : null}
        <div class="sep"></div>
        ${inv.summen.zeilen.map((z) => html`<div class="kv"><span>${zahl(z.menge)} × ${z.name}${z.rabattProzent ? ` (−${zahl(z.rabattProzent)} %)` : ''}</span><span>${euro(z.zeileNetto)}</span></div>`)}
        ${inv.summen.gesamtRabatt ? html`<div class="kv green"><span>Rabatt</span><span>${euro(-inv.summen.gesamtRabatt)}</span></div>` : null}
        <div class="sep"></div>
        <div class="kv muted"><span>Netto</span><span>${euro(inv.summen.netto)}</span></div>
        ${inv.summen.steuern.map((t) => html`<div class="kv muted"><span>USt ${t.satz} %</span><span>${euro(t.steuer)}</span></div>`)}
        <div class="kv big"><span>Gesamt</span><span>${euro(inv.summen.brutto)}</span></div>
      </div>

      <div class="section">
        <button class="btn block" disabled=${!dateien} onClick=${senden}><${Icon} n="mail" />Per Mail senden / teilen</button>
        <div class="grid2">
          ${dateien && dateien.url ? html`<a class="btn secondary small" href=${dateien.url} target="_blank" rel="noopener"><${Icon} n="eye" />PDF ansehen</a>` : html`<span></span>`}
          <button class="btn secondary small" onClick=${async () => { try { await navigator.clipboard.writeText(inv.kunde.email || ''); toast('E-Mail-Adresse kopiert'); } catch { toast(inv.kunde.email || 'Keine E-Mail hinterlegt'); } }}><${Icon} n="copy" />E-Mail kopieren</button>
        </div>
        <p class="small-print">${inv.gesendetAm ? `Zuletzt geteilt am ${deDatum(inv.gesendetAm.slice(0, 10))}.` : 'Noch nicht geteilt.'} ${inv.hatXml ? 'Mit E-Rechnung (XML) für Geschäftskunden.' : ''}</p>
      </div>

      ${kannBezahlen && html`<div class="card pad">
        <${Field} label="Per Bank bezahlt am" hint="Datum vom Kontoauszug">
          <input type="date" value=${datum} max=${heuteISO()} onInput=${(e) => setDatum(e.target.value)} />
        <//>
        <button class="btn block" disabled=${!datum} onClick=${bezahlt}>Als bezahlt speichern</button>
        <p class="small-print">Fällig am ${deDatum(inv.faelligAm)}.</p>
      </div>`}
      ${st.key === 'bezahlt' && html`<div class="note ok">
        ${inv.bezahltArt === 'bar' ? 'Bar bezahlt.' : `Per Bank bezahlt am ${deDatum(inv.bezahltAm)}.`}
        ${inv.bezahltArt === 'bank' && html`<div><button class="btn ghost" style="padding:0" onClick=${zuruecksetzen}>Zahlung zurücksetzen</button></div>`}
      </div>`}
      ${inv.status === 'storniert' && html`<div class="note">Storniert durch ${inv.storniertDurch}.</div>`}
      ${inv.typ === 'storno' && html`<div class="note">Storniert die Rechnung ${inv.bezugNr}.</div>`}

      ${inv.typ !== 'storno' && inv.status !== 'storniert' && html`<button class="btn danger block" disabled=${busy} onClick=${stornieren}>Rechnung stornieren</button>`}
      <p class="small-print">Festgeschrieben am ${new Date(inv.createdAt).toLocaleString('de-DE')}. Prüfsumme (SHA-256) der PDF: ${inv.pdfHash}</p>
    </main>
  </div>`;
}

// ---------------------------------------------------------------------------
// Neue Rechnung

function NeueRechnung({ ctx, kundeId: startKunde, pferdId }) {
  const { data, back, go, reload, toast } = ctx;
  const s = data.settings;
  const [step, setStep] = useState(startKunde ? 'positionen' : 'kunde');
  const [kundeId, setKundeId] = useState(startKunde || null);
  const [q, setQ] = useState('');
  const [pferdSel, setPferdSel] = useState(() => {
    if (pferdId) return { [pferdId]: true };
    if (startKunde) { const p = data.horses.find((x) => x.customerId === startKunde); return p ? { [p.id]: true } : {}; }
    return {};
  });
  const [mengen, setMengen] = useState({});
  const [posRabatt, setPosRabatt] = useState({});
  const [freie, setFreie] = useState([]);
  const [neuFrei, setNeuFrei] = useState(null);
  const [rabattArt, setRabattArt] = useState('keiner');
  const [rabattWert, setRabattWert] = useState('');
  const [leistungsdatum, setLeistungsdatum] = useState(heuteISO());
  const [zahlart, setZahlart] = useState('ueberweisung');
  const [busy, setBusy] = useState(false);
  const [fertig, setFertig] = useState(null);

  const kunde = data.customers.find((c) => c.id === kundeId);
  const pferde = kunde ? data.horses.filter((p) => p.customerId === kunde.id) : [];
  const leistungen = data.services.filter((x) => x.aktiv !== false).sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0) || a.name.localeCompare(b.name));

  const positionen = [
    ...leistungen.filter((l) => mengen[l.id] > 0).map((l) => ({
      name: l.name, menge: mengen[l.id], einheit: l.einheit, preisCent: l.preisCent, steuersatz: l.steuersatz,
      rabattProzent: Math.min(100, Math.max(0, parseZahl(posRabatt[l.id]) || 0))
    })),
    ...freie
  ];
  const rabatt = rabattArt === 'prozent' ? { art: 'prozent', wert: Math.min(100, Math.max(0, parseZahl(rabattWert) || 0)) }
    : rabattArt === 'betrag' ? { art: 'betrag', wert: Math.max(0, parseEuro(rabattWert) || 0) } : null;
  const summen = berechne(positionen, rabatt);
  const adresseFehlt = kunde && !(kunde.strasse && kunde.plz && kunde.ort);

  if (!db.firmaVollstaendig(s)) {
    return html`<div class="screen"><${Head} title="Neue Rechnung" onBack=${back} /><main class="body">
      <div class="note warn">Für Rechnungen fehlen noch Firmendaten (Name, Adresse, Steuernummer oder USt-IdNr., IBAN).
        <div><button class="btn small" onClick=${() => go({ name: 'firma' })}>Firmendaten eintragen</button></div></div>
    </main></div>`;
  }

  const erstellen = async () => {
    setBusy(true);
    try {
      const heute = heuteISO();
      const bar = zahlart === 'bar';
      const gewaehlt = pferde.filter((p) => pferdSel[p.id]);
      const entwurf = {
        typ: 'rechnung', datum: heute, leistungsdatum, faelligAm: plusTage(heute, Number(s.zahlungszielTage) || 14),
        kundeId: kunde.id,
        kunde: { name: kunde.name, zusatz: kunde.zusatz || '', strasse: kunde.strasse, plz: kunde.plz, ort: kunde.ort, land: kunde.land || 'DE', email: kunde.email || '', typ: kunde.typ, ustid: kunde.ustid || '', leitwegId: kunde.leitwegId || '' },
        pferde: gewaehlt.map((p) => p.name), pferdIds: gewaehlt.map((p) => p.id),
        positionen, rabatt, summen, zahlart,
        status: bar ? 'bezahlt' : 'offen', bezahltArt: bar ? 'bar' : null, bezahltAm: bar ? heute : null
      };
      const inv = await db.festschreiben(entwurf, erzeugeDateien, konto.nummerReservierer());
      await db.termineNachtragen(entwurf.pferdIds, leistungsdatum);
      await reload();
      const pdf = await db.datei(inv.id, 'pdf');
      const xml = inv.hatXml ? await db.datei(inv.id, 'xml') : null;
      setFertig({ inv, pdf, xml });
      setStep('fertig');
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      alert('Die Rechnung konnte nicht erstellt werden: ' + e.message);
    } finally { setBusy(false); }
  };

  if (step === 'kunde') {
    const t = q.trim().toLowerCase();
    const liste = data.customers
      .map((c) => ({ c, p: data.horses.filter((p) => p.customerId === c.id) }))
      .filter(({ c, p }) => !t || c.name.toLowerCase().includes(t) || p.some((x) => x.name.toLowerCase().includes(t)) || (c.ort || '').toLowerCase().includes(t))
      .sort((a, b) => a.c.name.localeCompare(b.c.name));
    return html`<div class="screen">
      <${Head} title="Kunde wählen" onBack=${back} />
      <main class="body">
        <input class="search" type="search" placeholder="Suche nach Kunde, Pferd oder Ort" aria-label="Kunde suchen" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <div class="list">
          ${liste.length ? liste.map(({ c, p }) => html`<button class="row" onClick=${() => { setKundeId(c.id); setPferdSel(p[0] ? { [p[0].id]: true } : {}); setStep('positionen'); window.scrollTo(0, 0); }}>
            <span class="main"><span class="t">${c.name}</span><span class="s">${p.map((x) => x.name).join(', ') || 'keine Pferde'}${c.ort ? ' · ' + c.ort : ''}</span></span>
            <span class=${'badge ' + (c.typ === 'gewerbe' ? 'gewerbe' : '')}>${c.typ === 'gewerbe' ? 'Gewerbe' : 'Privat'}</span>
          </button>`) : html`<p class="empty">Kein Kunde gefunden.</p>`}
        </div>
        <button class="btn secondary block" onClick=${() => go({ name: 'kundeForm' })}><${Icon} n="plus" />Neuen Kunden anlegen</button>
      </main>
    </div>`;
  }

  if (step === 'fertig' && fertig) {
    const { inv, pdf, xml } = fertig;
    const naechste = pferde.filter((p) => pferdSel[p.id] && p.intervallWochen).map((p) => `${p.name} am ${deDatum(plusTage(leistungsdatum, p.intervallWochen * 7))}`);
    return html`<div class="screen">
      <main class="body">
        <div class="done">
          <div class="ring"><${Icon} n="check" w="2.4" /></div>
          <h1>Rechnung erstellt</h1>
          <p>${inv.nr} · ${euro(inv.summen.brutto)} · ${inv.zahlart === 'bar' ? 'bar bezahlt' : 'per Überweisung'}</p>
          <p>${inv.kunde.email ? 'An ' + inv.kunde.email : 'Beim Kunden ist keine E-Mail hinterlegt.'}</p>
        </div>
        <button class="btn block" onClick=${async () => {
          const ok = await teilen(rechnungsDateien(inv, pdf, xml), { titel: `Rechnung ${inv.nr}`, text: mailText(s, inv) });
          if (ok) { await db.alsGesendetMarkieren(inv); await reload(); }
        }}><${Icon} n="mail" />Per Mail senden</button>
        ${inv.kunde.email && html`<button class="btn secondary block small" onClick=${async () => { try { await navigator.clipboard.writeText(inv.kunde.email); toast('E-Mail-Adresse kopiert – im Mail-Feld „An“ einfügen'); } catch { toast(inv.kunde.email); } }}><${Icon} n="copy" />E-Mail-Adresse kopieren</button>`}
        ${naechste.length ? html`<div class="card pad"><span class="small-print" style="font-size:13px">Nächster Termin</span><b>${naechste.join(' · ')}</b></div>` : null}
        <div class="grid2">
          <button class="btn secondary small" onClick=${() => go({ name: 'neu', n: Date.now() }, false, true)}>Nächste Rechnung</button>
          <button class="btn secondary small" onClick=${() => go({ name: 'tab', tab: 'home' }, true)}>Zur Übersicht</button>
        </div>
      </main>
    </div>`;
  }

  if (step === 'vorschau') {
    return html`<div class="screen">
      <${Head} title="Rechnung prüfen" onBack=${() => setStep('positionen')} />
      <main class="body with-bar">
        ${adresseFehlt && html`<div class="note warn">Beim Kunden fehlt die Anschrift. Sie ist Pflicht auf der Rechnung.
          <div><button class="btn small" onClick=${() => go({ name: 'kundeForm', id: kunde.id })}>Kunde bearbeiten</button></div></div>`}
        <div class="card pad">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div><div style="font-size:17px;font-weight:600">${kunde.name}</div><div style="font-size:13px;color:var(--muted)">${kunde.strasse || '–'}, ${kunde.plz} ${kunde.ort}</div></div>
            ${kunde.typ === 'gewerbe' && html`<span class="badge gewerbe">E-Rechnung</span>`}
          </div>
          <p style="font-size:14px;color:var(--ink2)">Pferde: ${pferde.filter((p) => pferdSel[p.id]).map((p) => p.name).join(', ') || '–'}</p>
          <div class="sep"></div>
          ${summen.zeilen.map((z) => html`<div class="kv"><span>${zahl(z.menge)} × ${z.name}${z.rabattProzent ? ` (−${zahl(z.rabattProzent)} %)` : ''}</span><span>${euro(z.zeileNetto)}</span></div>`)}
          ${summen.gesamtRabatt ? html`<div class="kv green"><span>Rabatt${rabatt.art === 'prozent' ? ' ' + zahl(rabatt.wert) + ' %' : ''}</span><span>${euro(-summen.gesamtRabatt)}</span></div>` : null}
          <div class="sep"></div>
          <div class="kv muted"><span>Netto</span><span>${euro(summen.netto)}</span></div>
          ${summen.steuern.map((t) => html`<div class="kv muted"><span>USt ${t.satz} %</span><span>${euro(t.steuer)}</span></div>`)}
          <div class="kv big"><span>Gesamt</span><span>${euro(summen.brutto)}</span></div>
        </div>
        <${Field} label="Leistungsdatum"><input type="date" value=${leistungsdatum} max=${heuteISO()} onInput=${(e) => setLeistungsdatum(e.target.value)} /><//>
        <section class="section">
          <h2>Zahlart</h2>
          <button class="radio" aria-pressed=${zahlart === 'ueberweisung' ? 'true' : 'false'} onClick=${() => setZahlart('ueberweisung')}><span class="dot"></span><span><span class="t">Überweisung</span><span class="s">Zahlbar in ${s.zahlungszielTage} Tagen, mit QR-Code auf der Rechnung</span></span></button>
          <button class="radio" aria-pressed=${zahlart === 'bar' ? 'true' : 'false'} onClick=${() => setZahlart('bar')}><span class="dot"></span><span><span class="t">Bar erhalten</span><span class="s">Rechnung wird als bezahlt markiert</span></span></button>
        </section>
        <p class="small-print">Nach dem Erstellen ist die Rechnung festgeschrieben und kann nicht mehr geändert werden. Korrekturen laufen über ein Storno.</p>
      </main>
      <div class="bar">
        <button class="btn block" disabled=${busy || adresseFehlt || !positionen.length || !leistungsdatum} onClick=${erstellen}>${busy ? 'Wird erstellt …' : 'Rechnung erstellen'}</button>
      </div>
    </div>`;
  }

  // step === 'positionen'
  return html`<div class="screen">
    <${Head} title=${kunde ? kunde.name : 'Neue Rechnung'} sub=${kunde ? `${kunde.ort || ''} · ${kunde.typ === 'gewerbe' ? 'Gewerbe' : 'Privat'}` : ''} onBack=${() => (startKunde ? back() : setStep('kunde'))} />
    <main class="body with-bar">
      <section class="section">
        <h2>Pferde</h2>
        ${pferde.length ? html`<div class="chips">${pferde.map((p) => html`<button class="chip" aria-pressed=${pferdSel[p.id] ? 'true' : 'false'} onClick=${() => setPferdSel({ ...pferdSel, [p.id]: !pferdSel[p.id] })}>${p.name}</button>`)}</div>`
          : html`<p class="small-print">Für diesen Kunden sind keine Pferde angelegt. <button class="btn ghost small" style="padding:0" onClick=${() => go({ name: 'pferdForm', customerId: kunde.id })}>Pferd anlegen</button></p>`}
      </section>
      <section class="section">
        <h2>Leistungen <small>Preise netto</small></h2>
        ${leistungen.length ? leistungen.map((l) => {
          const m = mengen[l.id] || 0;
          return html`<div class=${'svc' + (m > 0 ? ' on' : '')}>
            <div class="top">
              <div style="min-width:0"><div class="t">${l.name}</div><div class="s">${euro(l.preisCent)} / ${(EINHEITEN[l.einheit] || EINHEITEN.Stk).label} · ${l.steuersatz} %</div></div>
              <${Stepper} label=${l.name} value=${m} onChange=${(n) => setMengen({ ...mengen, [l.id]: n })} />
            </div>
            ${m > 0 && html`<div class="extra"><label>Rabatt auf diese Position <input inputmode="decimal" placeholder="0" value=${posRabatt[l.id] || ''} onInput=${(e) => setPosRabatt({ ...posRabatt, [l.id]: e.target.value })} /> %</label></div>`}
          </div>`;
        }) : html`<div class="note">Noch keine Leistungen angelegt. <div><button class="btn small" onClick=${() => go({ name: 'leistungForm' })}>Leistung anlegen</button></div></div>`}
        ${freie.map((p, i) => html`<div class="svc on"><div class="top">
          <div style="min-width:0"><div class="t">${p.name}</div><div class="s">${zahl(p.menge)} × ${euro(p.preisCent)} · ${p.steuersatz} %</div></div>
          <button class="btn ghost small" onClick=${() => setFreie(freie.filter((_, j) => j !== i))}>Entfernen</button>
        </div></div>`)}
        ${neuFrei ? html`<div class="card pad">
          <${Field} label="Bezeichnung"><input value=${neuFrei.name} onInput=${(e) => setNeuFrei({ ...neuFrei, name: e.target.value })} /><//>
          <div class="grid2">
            <${Field} label="Menge"><input inputmode="decimal" value=${neuFrei.menge} onInput=${(e) => setNeuFrei({ ...neuFrei, menge: e.target.value })} /><//>
            <${Field} label="Einheit"><select value=${neuFrei.einheit} onChange=${(e) => setNeuFrei({ ...neuFrei, einheit: e.target.value })}>${Object.entries(EINHEITEN).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select><//>
            <${Field} label="Preis netto (€)"><input inputmode="decimal" value=${neuFrei.preis} onInput=${(e) => setNeuFrei({ ...neuFrei, preis: e.target.value })} /><//>
            <${Field} label="USt"><select value=${neuFrei.steuersatz} onChange=${(e) => setNeuFrei({ ...neuFrei, steuersatz: Number(e.target.value) })}>${STEUERSAETZE.map((x) => html`<option value=${x}>${x} %</option>`)}</select><//>
          </div>
          <div class="grid2">
            <button class="btn secondary small" onClick=${() => setNeuFrei(null)}>Abbrechen</button>
            <button class="btn small" disabled=${!neuFrei.name.trim() || parseEuro(neuFrei.preis) === null || !(parseZahl(neuFrei.menge) > 0)} onClick=${() => {
              setFreie([...freie, { name: neuFrei.name.trim(), menge: parseZahl(neuFrei.menge), einheit: neuFrei.einheit, preisCent: parseEuro(neuFrei.preis), steuersatz: neuFrei.steuersatz, rabattProzent: 0 }]);
              setNeuFrei(null);
            }}>Hinzufügen</button>
          </div>
        </div>` : html`<button class="btn ghost" onClick=${() => setNeuFrei({ name: '', menge: '1', einheit: 'Stk', preis: '', steuersatz: 19 })}><${Icon} n="plus" />Freie Position</button>`}
      </section>
      <section class="section">
        <h2>Rabatt auf die Rechnung</h2>
        <div class="chips">
          ${[['keiner', 'Kein Rabatt'], ['prozent', 'in %'], ['betrag', 'in €']].map(([id, l]) => html`<button class="chip" aria-pressed=${rabattArt === id ? 'true' : 'false'} onClick=${() => { setRabattArt(id); setRabattWert(''); }}>${l}</button>`)}
        </div>
        ${rabattArt !== 'keiner' && html`<${Field} label=${rabattArt === 'prozent' ? 'Rabatt in Prozent' : 'Rabatt in Euro (netto)'}><input inputmode="decimal" value=${rabattWert} placeholder=${rabattArt === 'prozent' ? 'z. B. 5' : 'z. B. 10,00'} onInput=${(e) => setRabattWert(e.target.value)} /><//>`}
      </section>
    </main>
    <div class="bar">
      <div class="total"><span>Gesamt inkl. USt</span><b>${euro(summen.brutto)}</b></div>
      <button class="btn block" disabled=${!positionen.length} onClick=${() => { setStep('vorschau'); window.scrollTo(0, 0); }}>Weiter zur Vorschau</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Kunden & Pferde

function Kunden({ ctx }) {
  const { data, go } = ctx;
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const liste = data.customers
    .map((c) => ({ c, p: data.horses.filter((p) => p.customerId === c.id) }))
    .filter(({ c, p }) => !t || c.name.toLowerCase().includes(t) || p.some((x) => x.name.toLowerCase().includes(t)) || (c.ort || '').toLowerCase().includes(t))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));
  return html`<div class="screen">
    <div class="head-big"><div><h1>Kunden</h1></div></div>
    <main class="body with-tabs">
      <input class="search" type="search" placeholder="Suche nach Kunde, Pferd oder Ort" aria-label="Kunden suchen" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="list">
        ${liste.length ? liste.map(({ c, p }) => html`<button class="row" onClick=${() => go({ name: 'kunde', id: c.id })}>
          <span class="main"><span class="t">${c.name}</span><span class="s">${p.map((x) => x.name).join(', ') || 'keine Pferde'}${c.ort ? ' · ' + c.ort : ''}</span></span>
          <span class=${'badge ' + (c.typ === 'gewerbe' ? 'gewerbe' : '')}>${c.typ === 'gewerbe' ? 'Gewerbe' : 'Privat'}</span>
        </button>`) : html`<p class="empty">${data.customers.length ? 'Kein Treffer.' : 'Noch keine Kunden angelegt.'}</p>`}
      </div>
    </main>
    <button class="btn fab" onClick=${() => go({ name: 'kundeForm' })}><${Icon} n="plus" w="2.4" />Neuer Kunde</button>
  </div>`;
}

function KundeDetail({ ctx, id }) {
  const { data, back, go } = ctx;
  const k = data.customers.find((c) => c.id === id);
  if (!k) return html`<div class="screen"><${Head} title="Kunde" onBack=${back} /><p class="empty">Nicht gefunden.</p></div>`;
  const pferde = data.horses.filter((p) => p.customerId === id).sort((a, b) => a.name.localeCompare(b.name));
  const rechnungen = data.invoices.filter((i) => i.kundeId === id).sort(sortNeu);
  return html`<div class="screen">
    <${Head} title=${k.name} sub=${k.typ === 'gewerbe' ? 'Gewerbe' : 'Privat'} onBack=${back}
      right=${html`<button class="btn ghost small" onClick=${() => go({ name: 'kundeForm', id })}>Bearbeiten</button>`} />
    <main class="body">
      <div class="card pad">
        <div style="font-size:15px">${k.zusatz && html`${k.zusatz}<br />`}${k.strasse || 'Keine Straße'}<br />${k.plz} ${k.ort}</div>
        ${k.email && html`<a href=${'mailto:' + k.email} style="font-size:15px">${k.email}</a>`}
        ${k.telefon && html`<a href=${'tel:' + k.telefon.replace(/\s/g, '')} style="font-size:15px">${k.telefon}</a>`}
        ${k.notiz && html`<p style="font-size:14px;color:var(--ink2)">${k.notiz}</p>`}
      </div>
      <button class="btn block" onClick=${() => go({ name: 'neu', kundeId: id })}><${Icon} n="plus" />Neue Rechnung</button>
      <section class="section">
        <h2>Pferde</h2>
        <div class="list">
          ${pferde.length ? pferde.map((p) => {
            const f = faelligkeit(p);
            return html`<button class="row" onClick=${() => go({ name: 'pferdForm', id: p.id, customerId: id })}>
              <span class="main"><span class="t">${p.name}</span><span class="s">${[p.beschlag, p.intervallWochen ? `alle ${p.intervallWochen} Wo.` : '', p.stall].filter(Boolean).join(' · ') || 'keine Angaben'}</span></span>
              ${f && html`<span class=${'badge ' + (f.inTagen < 0 ? 'ueberfaellig' : f.inTagen <= 3 ? 'offen' : '')}>${faelligText(f.inTagen)}</span>`}
            </button>`;
          }) : html`<p class="empty">Noch keine Pferde.</p>`}
        </div>
        <button class="btn ghost" onClick=${() => go({ name: 'pferdForm', customerId: id })}><${Icon} n="plus" />Pferd hinzufügen</button>
      </section>
      <section class="section">
        <h2>Rechnungen</h2>
        <div class="list">${rechnungen.length ? rechnungen.slice(0, 50).map((inv) => html`<${RechnungRow} inv=${inv} onClick=${() => go({ name: 'rechnung', id: inv.id })} />`) : html`<p class="empty">Noch keine Rechnungen.</p>`}</div>
      </section>
    </main>
  </div>`;
}

function KundeForm({ ctx, id }) {
  const { data, back, reload, toast } = ctx;
  const vorhanden = id ? data.customers.find((c) => c.id === id) : null;
  const [k, setK] = useState(vorhanden || { name: '', zusatz: '', strasse: '', plz: '', ort: '', land: 'DE', email: '', telefon: '', typ: 'privat', ustid: '', leitwegId: '', notiz: '' });
  const set = (f) => (e) => setK({ ...k, [f]: e.target.value });
  const hatRechnungen = id && data.invoices.some((i) => i.kundeId === id);
  const speichern = async () => {
    const neu = { ...k, id: k.id || uid(), name: k.name.trim() };
    await db.put('customers', neu);
    await db.log(vorhanden ? 'kunde_geaendert' : 'kunde_angelegt', neu.id, { name: neu.name });
    await reload();
    toast('Kunde gespeichert');
    back();
  };
  const loeschen = async () => {
    if (!confirm(`${k.name} und alle Pferde löschen?`)) return;
    for (const p of data.horses.filter((x) => x.customerId === id)) await db.del('horses', p.id);
    await db.del('customers', id);
    await db.log('kunde_geloescht', id, { name: k.name });
    await reload();
    back(2);
  };
  return html`<div class="screen">
    <${Head} title=${vorhanden ? 'Kunde bearbeiten' : 'Neuer Kunde'} onBack=${() => back()} />
    <main class="body with-bar">
      <div class="chips">
        <button class="chip" aria-pressed=${k.typ === 'privat' ? 'true' : 'false'} onClick=${() => setK({ ...k, typ: 'privat' })}>Privatkunde</button>
        <button class="chip" aria-pressed=${k.typ === 'gewerbe' ? 'true' : 'false'} onClick=${() => setK({ ...k, typ: 'gewerbe' })}>Geschäftskunde</button>
      </div>
      <${Field} label="Name / Firma"><input value=${k.name} onInput=${set('name')} autocomplete="off" /><//>
      <${Field} label="Zusatz (optional)" hint="z. B. Ansprechpartner oder Abteilung"><input value=${k.zusatz} onInput=${set('zusatz')} /><//>
      <${Field} label="Straße und Hausnummer"><input value=${k.strasse} onInput=${set('strasse')} /><//>
      <div class="grid-plz">
        <${Field} label="PLZ"><input inputmode="numeric" value=${k.plz} onInput=${set('plz')} /><//>
        <${Field} label="Ort"><input value=${k.ort} onInput=${set('ort')} /><//>
      </div>
      <${Field} label="E-Mail"><input type="email" autocapitalize="off" value=${k.email} onInput=${set('email')} /><//>
      <${Field} label="Telefon"><input type="tel" value=${k.telefon} onInput=${set('telefon')} /><//>
      ${k.typ === 'gewerbe' && html`
        <${Field} label="USt-IdNr. des Kunden (optional)"><input value=${k.ustid} onInput=${set('ustid')} /><//>
        <${Field} label="Leitweg-ID (nur bei Behörden)" hint="Wird als Käuferreferenz in die E-Rechnung geschrieben."><input value=${k.leitwegId} onInput=${set('leitwegId')} /><//>`}
      <${Field} label="Notiz"><textarea value=${k.notiz} onInput=${set('notiz')}></textarea><//>
      ${vorhanden && (hatRechnungen
        ? html`<p class="small-print">Kunden mit Rechnungen können nicht gelöscht werden.</p>`
        : html`<button class="btn danger block" onClick=${loeschen}>Kunde löschen</button>`)}
    </main>
    <div class="bar"><button class="btn block" disabled=${!k.name.trim()} onClick=${speichern}>Speichern</button></div>
  </div>`;
}

function PferdForm({ ctx, id, customerId }) {
  const { data, back, reload, toast } = ctx;
  const vorhanden = id ? data.horses.find((p) => p.id === id) : null;
  const [p, setP] = useState(vorhanden ? { ...vorhanden, intervallWochen: vorhanden.intervallWochen ? String(vorhanden.intervallWochen) : '' }
    : { name: '', stall: '', beschlag: '', intervallWochen: '7', letzterTermin: '', notiz: '' });
  const set = (f) => (e) => setP({ ...p, [f]: e.target.value });
  const speichern = async () => {
    const neu = { ...p, id: p.id || uid(), customerId: p.customerId || customerId, name: p.name.trim(), intervallWochen: parseZahl(p.intervallWochen) || null };
    await db.put('horses', neu);
    await reload();
    toast('Pferd gespeichert');
    back();
  };
  const loeschen = async () => {
    if (!confirm(`${p.name} löschen?`)) return;
    await db.del('horses', id);
    await reload();
    back();
  };
  return html`<div class="screen">
    <${Head} title=${vorhanden ? p.name || 'Pferd' : 'Neues Pferd'} onBack=${() => back()} />
    <main class="body with-bar">
      <${Field} label="Name"><input value=${p.name} onInput=${set('name')} /><//>
      <${Field} label="Stall / Standort"><input value=${p.stall} onInput=${set('stall')} /><//>
      <${Field} label="Beschlag" hint="z. B. Beschlag vorne, 4-fach, Barhuf"><input value=${p.beschlag} onInput=${set('beschlag')} /><//>
      <div class="grid2">
        <${Field} label="Intervall (Wochen)"><input inputmode="numeric" value=${p.intervallWochen} onInput=${set('intervallWochen')} /><//>
        <${Field} label="Letzter Termin"><input type="date" value=${p.letzterTermin || ''} onInput=${set('letzterTermin')} /><//>
      </div>
      <${Field} label="Notizen" hint="z. B. Hufprobleme, Besonderheiten"><textarea value=${p.notiz} onInput=${set('notiz')}></textarea><//>
      ${vorhanden && html`<button class="btn danger block" onClick=${loeschen}>Pferd löschen</button>`}
    </main>
    <div class="bar"><button class="btn block" disabled=${!p.name.trim()} onClick=${speichern}>Speichern</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Eingangsrechnungen (Belege von Lieferanten)

const monatsName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
};

function Belege({ ctx }) {
  const { data, go } = ctx;
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const liste = data.expenses.filter((b) => !b.geloescht)
    .filter((b) => !t || (b.lieferant || '').toLowerCase().includes(t) || (b.nummer || '').toLowerCase().includes(t) || (b.kategorie || '').toLowerCase().includes(t))
    .sort((a, b) => (b.datum + b.createdAt).localeCompare(a.datum + a.createdAt));
  const gruppen = [];
  for (const b of liste) {
    const ym = b.datum.slice(0, 7);
    let g = gruppen[gruppen.length - 1];
    if (!g || g.ym !== ym) { g = { ym, belege: [] }; gruppen.push(g); }
    g.belege.push(b);
  }
  return html`<div class="screen">
    <div class="head-big"><div><h1>Eingangsrechnungen</h1></div></div>
    <main class="body with-tabs">
      <input class="search" type="search" placeholder="Suche: Lieferant, Nummer, Kategorie" aria-label="Belege suchen" value=${q} onInput=${(e) => setQ(e.target.value)} />
      ${gruppen.length ? gruppen.slice(0, 24).map((g) => html`<section class="section">
        <h2>${monatsName(g.ym)} <small>${g.belege.length} Belege · ${euro(g.belege.reduce((a, b) => a + (b.brutto || 0), 0))}</small></h2>
        <div class="list">${g.belege.map((b) => html`<button class="row" onClick=${() => go({ name: 'beleg', id: b.id })}>
          <span class="main"><span class="t">${b.lieferant || 'Ohne Lieferant'}</span><span class="s">${deDatum(b.datum)} · ${b.kategorie || 'ohne Kategorie'}</span></span>
          <span class="end"><span class="amt">${euro(b.brutto || 0)}</span>${b.quelle === 'e-rechnung' ? html`<span class="badge gewerbe">E-Rechnung</span>` : !b.anhaenge.length ? html`<span class="badge offen">ohne Beleg</span>` : null}</span>
        </button>`)}</div>
      </section>`) : html`<div class="list"><p class="empty">${data.expenses.length ? 'Kein Treffer.' : 'Noch keine Eingangsrechnungen. Tippe auf „Beleg erfassen“ und fotografiere die Rechnung oder wähle eine PDF bzw. E-Rechnung aus.'}</p></div>`}
    </main>
    <button class="btn fab" onClick=${() => go({ name: 'beleg' })}><${Icon} n="camera" w="2.2" />Beleg erfassen</button>
  </div>`;
}

function BelegForm({ ctx, id }) {
  const { data, back, reload, toast } = ctx;
  const vorhanden = id ? data.expenses.find((b) => b.id === id) : null;
  const [b, setB] = useState(() => vorhanden ? { ...vorhanden, bruttoText: centToInput(vorhanden.brutto || 0) }
    : { id: uid(), datum: heuteISO(), lieferant: '', nummer: '', kategorie: KATEGORIEN[0], bruttoText: '', satz: 19, steuern: null, zahlart: 'ueberweisung', notiz: '', anhaenge: [], quelle: 'manuell' });
  const [neu, setNeu] = useState([]);            // neu hinzugefügte Dateien { anhang, bytes, url }
  const [urls, setUrls] = useState({});          // Vorschau-URLs vorhandener Anhänge
  const [busy, setBusy] = useState(false);
  const [hinweis, setHinweis] = useState(null);
  const kamera = useRef(null);
  const datei = useRef(null);

  useEffect(() => {
    let alive = true;
    const erzeugt = [];
    (async () => {
      const u = {};
      for (const a of (vorhanden ? vorhanden.anhaenge : [])) {
        const bytes = await db.datei(b.id, a.id);
        if (bytes) { u[a.id] = URL.createObjectURL(new Blob([bytes], { type: a.typ })); erzeugt.push(u[a.id]); }
      }
      if (alive) setUrls(u);
    })();
    return () => { alive = false; erzeugt.forEach((x) => URL.revokeObjectURL(x)); };
  }, [id]);
  useEffect(() => () => neu.forEach((n) => URL.revokeObjectURL(n.url)), []);

  const bruttoCent = parseEuro(b.bruttoText);
  const aufgeteilt = b.steuern && b.steuern.length && b.satz === 'gemischt'
    ? { netto: b.steuern.reduce((a, t) => a + t.netto, 0), steuer: b.steuern.reduce((a, t) => a + t.steuer, 0) }
    : bruttoCent !== null ? ausBrutto(bruttoCent, Number(b.satz) || 0) : null;
  const alleAnhaenge = [...b.anhaenge.map((a) => ({ a, url: urls[a.id], neu: false })), ...neu.map((n) => ({ a: n.anhang, url: n.url, neu: true }))];

  const hinzufuegen = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const fertig = [];
      let er = null;
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) { alert(`${f.name} ist größer als 25 MB und wurde nicht übernommen.`); continue; }
        const v = await dateiVorbereiten(f);
        fertig.push({ ...v, url: URL.createObjectURL(new Blob([v.bytes], { type: v.anhang.typ })) });
        if (v.eRechnung && !er) er = v.eRechnung;
      }
      setNeu((alt) => [...alt, ...fertig]);
      if (er) {
        const mehrereSaetze = er.steuern.filter((t) => t.netto || t.steuer).length > 1;
        const ersterSatz = er.steuern[0] ? er.steuern[0].satz : 19;
        setB((alt) => ({
          ...alt,
          datum: er.datum || alt.datum,
          lieferant: er.lieferant || alt.lieferant,
          nummer: er.nummer || alt.nummer,
          bruttoText: er.brutto !== null ? centToInput(er.brutto) : alt.bruttoText,
          satz: mehrereSaetze ? 'gemischt' : ([19, 7, 0].includes(ersterSatz) ? ersterSatz : 'gemischt'),
          steuern: er.steuern.length ? er.steuern : null,
          quelle: 'e-rechnung',
          gutschrift: er.gutschrift || undefined
        }));
        setHinweis(`Angaben aus der E-Rechnung übernommen (${er.format}${er.gutschrift ? ', Gutschrift' : ''}). Bitte kurz prüfen.`);
      }
    } catch (err) {
      alert('Datei konnte nicht gelesen werden: ' + err.message);
    } finally { setBusy(false); }
  };

  const entfernen = (eintrag) => {
    if (eintrag.neu) {
      URL.revokeObjectURL(eintrag.url);
      setNeu(neu.filter((n) => n.anhang.id !== eintrag.a.id));
    } else if (confirm('Anhang aus diesem Beleg entfernen? Die Datei bleibt zur Aufbewahrung gespeichert.')) {
      setB({ ...b, anhaenge: b.anhaenge.filter((a) => a.id !== eintrag.a.id), entfernteAnhaenge: [...(b.entfernteAnhaenge || []), eintrag.a] });
    }
  };

  const speichern = async () => {
    if (!alleAnhaenge.length && !confirm('Es ist kein Foto und keine Datei angehängt. Trotzdem speichern?')) return;
    setBusy(true);
    try {
      const { bruttoText, ...rest } = b;
      const beleg = {
        ...rest,
        lieferant: b.lieferant.trim(), nummer: (b.nummer || '').trim(),
        brutto: bruttoCent, netto: aufgeteilt.netto, steuer: aufgeteilt.steuer,
        steuern: b.satz === 'gemischt' ? b.steuern : [{ satz: Number(b.satz), netto: aufgeteilt.netto, steuer: aufgeteilt.steuer }],
        anhaenge: [...b.anhaenge, ...neu.map((n) => n.anhang)],
        createdAt: b.createdAt || new Date().toISOString(), geaendertAm: vorhanden ? new Date().toISOString() : undefined
      };
      await db.belegSpeichern(beleg, neu.map((n) => ({ id: n.anhang.id, bytes: n.bytes })));
      await reload();
      toast(vorhanden ? 'Beleg gespeichert' : 'Beleg erfasst');
      back();
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + err.message);
    } finally { setBusy(false); }
  };

  const loeschen = async () => {
    if (!confirm('Diesen Beleg löschen? Er verschwindet aus Liste und Export, bleibt aber zur Aufbewahrung gespeichert.')) return;
    await db.belegLoeschen(vorhanden);
    await reload();
    toast('Beleg gelöscht');
    back();
  };

  const set = (f) => (e) => setB({ ...b, [f]: e.target.value });
  return html`<div class="screen">
    <${Head} title=${vorhanden ? (vorhanden.lieferant || 'Beleg') : 'Beleg erfassen'} sub=${vorhanden ? deDatum(vorhanden.datum) : ''} onBack=${back} />
    <main class="body with-bar">
      <section class="section">
        <h2>Fotos und Dateien</h2>
        ${alleAnhaenge.length ? html`<div class="anhaenge">${alleAnhaenge.map((e) => html`<div class="anhang">
          ${e.a.typ.startsWith('image/') && e.url ? html`<a href=${e.url} target="_blank" rel="noopener" class="thumb" style=${`background-image:url(${e.url})`} aria-label=${'Foto ' + e.a.name + ' öffnen'}></a>`
            : html`<a href=${e.url || '#'} target="_blank" rel="noopener" class="thumb datei" aria-label=${e.a.name + ' öffnen'}>${e.a.art === 'xrechnung' || e.a.art === 'xml' ? 'XML' : 'PDF'}</a>`}
          <div class="info"><span class="t">${anhangText(e.a)}</span><span class="s">${groesseText(e.a.groesse)}</span></div>
          <button class="icon-btn" aria-label=${'Anhang ' + e.a.name + ' entfernen'} onClick=${() => entfernen(e)}><${Icon} n="close" /></button>
        </div>`)}</div>` : html`<p class="small-print" style="font-size:14px">Rechnung fotografieren oder eine Datei auswählen (PDF, E-Rechnung als XML oder ZUGFeRD-PDF). Mehrere Dateien pro Beleg sind möglich.</p>`}
        <input ref=${kamera} type="file" accept="image/*" capture="environment" class="visually-hidden" onChange=${hinzufuegen} />
        <input ref=${datei} type="file" accept="image/*,application/pdf,.pdf,.xml,application/xml,text/xml" multiple class="visually-hidden" data-test="datei" onChange=${hinzufuegen} />
        <div class="grid2">
          <button class="btn secondary small" disabled=${busy} onClick=${() => kamera.current.click()}><${Icon} n="camera" />Fotografieren</button>
          <button class="btn secondary small" disabled=${busy} onClick=${() => datei.current.click()}><${Icon} n="clip" />Datei</button>
        </div>
        ${hinweis && html`<div class="note ok">${hinweis}</div>`}
      </section>
      <div class="grid2">
        <${Field} label="Rechnungsdatum"><input type="date" value=${b.datum} onInput=${set('datum')} /><//>
        <${Field} label="Rechnungsnummer"><input value=${b.nummer} onInput=${set('nummer')} /><//>
      </div>
      <${Field} label="Lieferant"><input value=${b.lieferant} onInput=${set('lieferant')} list="lieferanten" autocomplete="off" /><//>
      <datalist id="lieferanten">${[...new Set(data.expenses.map((x) => x.lieferant).filter(Boolean))].sort().map((l) => html`<option value=${l}></option>`)}</datalist>
      <div class="grid2">
        <${Field} label="Betrag brutto (€)"><input inputmode="decimal" value=${b.bruttoText} placeholder="z. B. 119,00" onInput=${(e) => setB({ ...b, bruttoText: e.target.value, satz: b.satz === 'gemischt' ? 19 : b.satz })} /><//>
        <${Field} label="Umsatzsteuer"><select value=${b.satz} onChange=${(e) => setB({ ...b, satz: e.target.value === 'gemischt' ? 'gemischt' : Number(e.target.value) })}>
          <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 % / ohne</option>
          ${b.steuern && b.steuern.length > 1 && html`<option value="gemischt">gemischt</option>`}
        </select><//>
      </div>
      ${aufgeteilt && html`<div class="card pad">
        <div class="kv muted"><span>Netto</span><span>${euro(aufgeteilt.netto)}</span></div>
        <div class="kv muted"><span>Vorsteuer${b.satz === 'gemischt' ? ' (' + b.steuern.map((t) => t.satz + ' %').join(' / ') + ')' : ''}</span><span>${euro(aufgeteilt.steuer)}</span></div>
      </div>`}
      <div class="grid2">
        <${Field} label="Kategorie"><select value=${b.kategorie} onChange=${set('kategorie')}>${KATEGORIEN.map((k) => html`<option value=${k}>${k}</option>`)}</select><//>
        <${Field} label="Bezahlt per"><select value=${b.zahlart} onChange=${set('zahlart')}>${Object.entries(ZAHLARTEN).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select><//>
      </div>
      <${Field} label="Notiz"><textarea value=${b.notiz} onInput=${set('notiz')} style="min-height:80px"></textarea><//>
      ${vorhanden && html`<button class="btn danger block" onClick=${loeschen}>Beleg löschen</button>`}
    </main>
    <div class="bar"><button class="btn block" disabled=${busy || !b.datum || !b.lieferant.trim() || bruttoCent === null} onClick=${speichern}>${busy ? 'Einen Moment …' : 'Speichern'}</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Mehr: Leistungen, Firma, Export, Sicherung

function Mehr({ ctx }) {
  const { go, data } = ctx;
  const items = [
    ['leistungen', 'Leistungen und Preise', `${data.services.filter((x) => x.aktiv !== false).length} aktiv`, 'tag'],
    ['firma', 'Firmendaten', db.firmaVollstaendig(data.settings) ? 'vollständig' : 'unvollständig', 'building'],
    ['export', 'Export für den Steuerberater', 'Rechnungen und Belege als ZIP', 'download'],
    ['sync', 'Synchronisierung', syncText(ctx.sync), 'cloud'],
    ['sicherung', 'Datensicherung', data.settings.letzteSicherung ? 'zuletzt ' + deDatum(data.settings.letzteSicherung) : 'noch nie', 'safe']
  ];
  return html`<div class="screen">
    <div class="head-big"><div><h1>Mehr</h1></div></div>
    <main class="body with-tabs">
      <div class="list menu">
        ${items.map(([r, t, s, icon]) => html`<button class="row" onClick=${() => go({ name: r })}>
          <span style="display:flex;gap:14px;align-items:center;min-width:0"><span style="color:var(--accent);display:flex"><${Icon} n=${icon} /></span>
          <span class="main"><span class="t">${t}</span><span class="s">${s}</span></span></span>
          <${Icon} n="chevron" />
        </button>`)}
      </div>
      <p class="small-print">Version ${VERSION}. Bitte regelmäßig eine Datensicherung machen und an einem sicheren Ort ablegen.</p>
    </main>
  </div>`;
}

function Leistungen({ ctx }) {
  const { data, back, go } = ctx;
  const liste = [...data.services].sort((a, b) => (a.aktiv === false) - (b.aktiv === false) || a.name.localeCompare(b.name));
  return html`<div class="screen">
    <${Head} title="Leistungen und Preise" onBack=${back} />
    <main class="body">
      <div class="list">
        ${liste.length ? liste.map((l) => html`<button class="row" onClick=${() => go({ name: 'leistungForm', id: l.id })}>
          <span class="main"><span class="t">${l.name}</span><span class="s">${euro(l.preisCent)} netto / ${(EINHEITEN[l.einheit] || EINHEITEN.Stk).label} · ${l.steuersatz} % USt</span></span>
          ${l.aktiv === false ? html`<span class="badge">inaktiv</span>` : html`<${Icon} n="chevron" />`}
        </button>`) : html`<p class="empty">Noch keine Leistungen. Lege z. B. „Beschlag 4-fach“, „Barhuf“ oder „Anfahrt“ an.</p>`}
      </div>
      <button class="btn block" onClick=${() => go({ name: 'leistungForm' })}><${Icon} n="plus" />Leistung anlegen</button>
    </main>
  </div>`;
}

function LeistungForm({ ctx, id }) {
  const { data, back, reload, toast } = ctx;
  const vorhanden = id ? data.services.find((x) => x.id === id) : null;
  const [l, setL] = useState(vorhanden ? { ...vorhanden, preis: centToInput(vorhanden.preisCent) } : { name: '', einheit: 'Stk', preis: '', steuersatz: 19, aktiv: true });
  const preisCent = parseEuro(l.preis);
  const speichern = async () => {
    const { preis, ...rest } = l;
    await db.put('services', { ...rest, id: l.id || uid(), name: l.name.trim(), preisCent, steuersatz: Number(l.steuersatz) });
    await reload();
    toast('Leistung gespeichert');
    back();
  };
  return html`<div class="screen">
    <${Head} title=${vorhanden ? 'Leistung bearbeiten' : 'Neue Leistung'} onBack=${back} />
    <main class="body with-bar">
      <${Field} label="Bezeichnung"><input value=${l.name} onInput=${(e) => setL({ ...l, name: e.target.value })} /><//>
      <div class="grid2">
        <${Field} label="Preis netto (€)" hint=${preisCent !== null ? `brutto ${euro(Math.round(preisCent * (1 + l.steuersatz / 100)))}` : ''}><input inputmode="decimal" value=${l.preis} onInput=${(e) => setL({ ...l, preis: e.target.value })} /><//>
        <${Field} label="Einheit"><select value=${l.einheit} onChange=${(e) => setL({ ...l, einheit: e.target.value })}>${Object.entries(EINHEITEN).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select><//>
      </div>
      <${Field} label="Umsatzsteuer" hint="Hufbeschlag ist in der Regel mit 19 % zu versteuern. Im Zweifel den Steuerberater fragen.">
        <select value=${l.steuersatz} onChange=${(e) => setL({ ...l, steuersatz: Number(e.target.value) })}>${STEUERSAETZE.map((x) => html`<option value=${x}>${x} %</option>`)}</select>
      <//>
      ${vorhanden && html`<button class="btn secondary block" onClick=${() => setL({ ...l, aktiv: l.aktiv === false })}>${l.aktiv === false ? 'Wieder aktivieren' : 'Deaktivieren (nicht mehr anbieten)'}</button>`}
      <p class="small-print">Preisänderungen gelten nur für neue Rechnungen. Bestehende Rechnungen bleiben unverändert.</p>
    </main>
    <div class="bar"><button class="btn block" disabled=${!l.name.trim() || preisCent === null} onClick=${speichern}>Speichern</button></div>
  </div>`;
}

function Firma({ ctx }) {
  const { data, back, reload, toast } = ctx;
  const periode = heuteISO().slice(0, 7);
  const monatsName = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const [s, setS] = useState(structuredClone(data.settings));
  const [start, setStart] = useState('');
  const setF = (f) => (e) => setS({ ...s, firma: { ...s.firma, [f]: e.target.value } });
  const zaehlerFrei = !(data.settings.zaehler && data.settings.zaehler[periode]);
  const speichern = async () => {
    const neu = { ...s, zahlungszielTage: Number(s.zahlungszielTage) || 14, prefix: (s.prefix || 'RE').trim().replace(/[^A-Za-z0-9]/g, '') || 'RE' };
    const n = parseInt(start, 10);
    if (zaehlerFrei && n > 1) neu.zaehler = { ...neu.zaehler, [periode]: n - 1 };
    await db.speichereEinstellungen(neu);
    await db.log('einstellungen_geaendert', null, null);
    await reload();
    toast('Firmendaten gespeichert');
    back();
  };
  const f = s.firma;
  return html`<div class="screen">
    <${Head} title="Firmendaten" onBack=${back} />
    <main class="body with-bar">
      <p class="small-print" style="font-size:14px">Diese Angaben stehen auf jeder Rechnung und sind Pflicht (§ 14 UStG).</p>
      <${Field} label="Firmenname"><input value=${f.name} onInput=${setF('name')} /><//>
      <${Field} label="Inhaber"><input value=${f.inhaber} onInput=${setF('inhaber')} /><//>
      <${Field} label="Straße und Hausnummer"><input value=${f.strasse} onInput=${setF('strasse')} /><//>
      <div class="grid-plz">
        <${Field} label="PLZ"><input inputmode="numeric" value=${f.plz} onInput=${setF('plz')} /><//>
        <${Field} label="Ort"><input value=${f.ort} onInput=${setF('ort')} /><//>
      </div>
      <${Field} label="Telefon"><input type="tel" value=${f.telefon} onInput=${setF('telefon')} /><//>
      <${Field} label="E-Mail"><input type="email" autocapitalize="off" value=${f.email} onInput=${setF('email')} /><//>
      <${Field} label="Steuernummer"><input value=${f.steuernummer} onInput=${setF('steuernummer')} /><//>
      <${Field} label="USt-IdNr. (falls vorhanden)"><input value=${f.ustid} onInput=${setF('ustid')} /><//>
      <${Field} label="Bank"><input value=${f.bank} onInput=${setF('bank')} /><//>
      <${Field} label="IBAN"><input autocapitalize="characters" value=${f.iban} onInput=${setF('iban')} /><//>
      <${Field} label="BIC"><input autocapitalize="characters" value=${f.bic} onInput=${setF('bic')} /><//>
      <div class="grid2">
        <${Field} label="Zahlungsziel (Tage)"><input inputmode="numeric" value=${s.zahlungszielTage} onInput=${(e) => setS({ ...s, zahlungszielTage: e.target.value })} /><//>
        <${Field} label="Kürzel Rechnungsnr."><input value=${s.prefix} onInput=${(e) => setS({ ...s, prefix: e.target.value })} /><//>
      </div>
      ${zaehlerFrei
        ? html`<${Field} label=${`Erste Rechnungsnummer im ${monatsName}`} hint=${`Die Nummern beginnen jeden Monat neu, z. B. ${s.prefix || 'RE'}-${periode}-0001. Falls in diesem Monat schon Rechnungen geschrieben wurden: nächste freie Nummer eintragen.`}><input inputmode="numeric" value=${start} placeholder="1" onInput=${(e) => setStart(e.target.value)} /><//>`
        : html`<p class="small-print">Letzte vergebene Nummer im ${monatsName}: ${s.prefix || 'RE'}-${periode}-${String(data.settings.zaehler[periode]).padStart(4, '0')}. Die Nummern beginnen jeden Monat neu.</p>`}
      <${Field} label="Text für die Mail" hint="Platzhalter: {nr}, {betrag}, {kunde}, {firma}"><textarea value=${s.mailText} onInput=${(e) => setS({ ...s, mailText: e.target.value })}></textarea><//>
    </main>
    <div class="bar"><button class="btn block" onClick=${speichern}>Speichern</button></div>
  </div>`;
}

function Export({ ctx }) {
  const { data, back, toast } = ctx;
  const jetzt = new Date();
  const [art, setArt] = useState('monat');
  const [jahr, setJahr] = useState(jetzt.getFullYear());
  const [monat, setMonat] = useState(jetzt.getMonth() + 1);
  const [quartal, setQuartal] = useState(Math.floor(jetzt.getMonth() / 3) + 1);
  const [von, setVon] = useState({ jahr: jetzt.getFullYear(), monat: Math.max(1, jetzt.getMonth()) });
  const [bis, setBis] = useState({ jahr: jetzt.getFullYear(), monat: jetzt.getMonth() + 1 });
  const [busy, setBusy] = useState(false);
  const [zip, setZip] = useState(null);
  const zr = zeitraumGrenzen(art, jahr, art === 'monat' ? monat : art === 'bereich' ? { von, bis } : quartal);
  const liste = data.invoices.filter((i) => i.datum >= zr.von && i.datum <= zr.bis);
  const belegeZr = data.expenses.filter((b) => !b.geloescht && b.datum >= zr.von && b.datum <= zr.bis);
  const sum = (k) => liste.reduce((a, i) => a + i.summen[k], 0);
  const bsum = (k) => belegeZr.reduce((a, b) => a + (b[k] || 0), 0);
  const jahre = [...new Set([jetzt.getFullYear(), ...data.invoices.map((i) => Number(i.datum.slice(0, 4)))])].sort((a, b) => b - a);
  const monate = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  useEffect(() => setZip(null), [art, jahr, monat, quartal, von.jahr, von.monat, bis.jahr, bis.monat]);

  const erstellen = async () => {
    setBusy(true);
    try {
      const z = await exportZip(liste, zr, data.settings, (obj, a) => db.datei(obj.id, a), belegeZr);
      await db.log('export_erstellt', zr.datei, { rechnungen: z.anzahl, belege: z.belege });
      setZip(z);
    } catch (e) {
      alert('Export fehlgeschlagen: ' + e.message);
    } finally { setBusy(false); }
  };

  return html`<div class="screen">
    <${Head} title="Export für den Steuerberater" onBack=${back} />
    <main class="body">
      <div class="chips">${[['monat', 'Ein Monat'], ['bereich', 'Mehrere Monate'], ['quartal', 'Quartal'], ['jahr', 'Jahr']].map(([id, l]) => html`<button class="chip" aria-pressed=${art === id ? 'true' : 'false'} onClick=${() => setArt(id)}>${l}</button>`)}</div>
      ${art === 'bereich' ? html`
      <div class="grid2">
        <${Field} label="Von Monat"><select value=${von.monat} onChange=${(e) => setVon({ ...von, monat: Number(e.target.value) })}>${monate.map((m, i) => html`<option value=${i + 1}>${m}</option>`)}</select><//>
        <${Field} label="Jahr"><select value=${von.jahr} onChange=${(e) => setVon({ ...von, jahr: Number(e.target.value) })}>${jahre.map((j) => html`<option value=${j}>${j}</option>`)}</select><//>
        <${Field} label="Bis Monat"><select value=${bis.monat} onChange=${(e) => setBis({ ...bis, monat: Number(e.target.value) })}>${monate.map((m, i) => html`<option value=${i + 1}>${m}</option>`)}</select><//>
        <${Field} label="Jahr"><select value=${bis.jahr} onChange=${(e) => setBis({ ...bis, jahr: Number(e.target.value) })}>${jahre.map((j) => html`<option value=${j}>${j}</option>`)}</select><//>
      </div>` : html`
      <div class="grid2">
        <${Field} label="Jahr"><select value=${jahr} onChange=${(e) => setJahr(Number(e.target.value))}>${jahre.map((j) => html`<option value=${j}>${j}</option>`)}</select><//>
        ${art === 'monat' && html`<${Field} label="Monat"><select value=${monat} onChange=${(e) => setMonat(Number(e.target.value))}>${monate.map((m, i) => html`<option value=${i + 1}>${m}</option>`)}</select><//>`}
        ${art === 'quartal' && html`<${Field} label="Quartal"><select value=${quartal} onChange=${(e) => setQuartal(Number(e.target.value))}>${[1, 2, 3, 4].map((x) => html`<option value=${x}>${x}. Quartal</option>`)}</select><//>`}
      </div>`}
      <div class="card pad">
        <div class="kv"><b>${zr.label}</b></div>
        <div class="kv"><span>Ausgangsrechnungen (${liste.length})</span><span>${euro(sum('brutto'))}</span></div>
        <div class="kv muted"><span>davon Umsatzsteuer</span><span>${euro(sum('steuer'))}</span></div>
        <div class="sep"></div>
        <div class="kv"><span>Eingangsrechnungen (${belegeZr.length})</span><span>${euro(bsum('brutto'))}</span></div>
        <div class="kv muted"><span>davon Vorsteuer</span><span>${euro(bsum('steuer'))}</span></div>
        ${belegeZr.some((b) => !b.anhaenge.length) && html`<p class="small-print">${belegeZr.filter((b) => !b.anhaenge.length).length} Beleg(e) ohne Foto oder Datei.</p>`}
      </div>
      <p class="small-print" style="font-size:14px">Die ZIP-Datei enthält eine Excel-Datei mit den Blättern „Übersicht“, „Rechnungen“ und „Eingangsrechnungen“ sowie die Ordner mit allen PDFs, Fotos und E-Rechnungen. Jede Zeile in Excel hat einen Link auf die passende Datei, sobald die ZIP entpackt ist.</p>
      ${!zip
        ? html`<button class="btn block" disabled=${busy || !(liste.length || belegeZr.length)} onClick=${erstellen}>${busy ? 'Wird erstellt …' : 'Export erstellen'}</button>`
        : html`<div class="note ok">Export fertig: ${zip.name} (${zip.anzahl} Rechnungen, ${zip.belege} Eingangsrechnungen).</div>
          <button class="btn block" onClick=${async () => { await teilen([{ bytes: zip.bytes, name: zip.name, type: 'application/zip' }], { titel: zip.name, text: `Rechnungen und Belege ${zr.label} – ${data.settings.firma.name}` }); toast('Export geteilt'); }}><${Icon} n="share" />Teilen / per Mail senden</button>`}
    </main>
  </div>`;
}

function Sicherung({ ctx }) {
  const { data, back, reload, toast } = ctx;
  const input = useRef(null);
  const [fertig, setFertig] = useState(null);
  const [busy, setBusy] = useState(false);
  const erstellen = async () => {
    setBusy(true);
    try {
      const json = await db.sicherungErstellen();
      setFertig({ bytes: new TextEncoder().encode(json), name: `Sicherung-Hufschmied-${heuteISO()}.json` });
      await reload();
    } finally { setBusy(false); }
  };
  const einspielen = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('Sicherung einspielen? Alle aktuellen Daten auf diesem Gerät werden dabei ersetzt.')) return;
    try {
      await db.sicherungEinspielen(await file.text());
      await reload();
      toast('Sicherung eingespielt');
    } catch (err) {
      alert('Einspielen fehlgeschlagen: ' + err.message);
    }
  };
  return html`<div class="screen">
    <${Head} title="Datensicherung" onBack=${back} />
    <main class="body">
      <p style="font-size:15px;color:var(--ink2)">Ohne Synchronisierung liegen alle Daten nur auf diesem Gerät. Mit Synchronisierung liegen sie zusätzlich verschlüsselt bei Supabase, der kostenlose Plan macht dort aber keine Backups. Rechnungen müssen 8 Jahre aufbewahrt werden. Speichere die Sicherung deshalb regelmäßig, zum Beispiel in iCloud Drive oder per Mail an dich selbst.</p>
      <div class="card pad">
        <div class="kv"><span>Letzte Sicherung</span><b>${data.settings.letzteSicherung ? deDatum(data.settings.letzteSicherung) : 'noch nie'}</b></div>
        <div class="kv muted"><span>Rechnungen</span><span>${data.invoices.length}</span></div>
        <div class="kv muted"><span>Kunden</span><span>${data.customers.length}</span></div>
      </div>
      ${!fertig
        ? html`<button class="btn block" disabled=${busy} onClick=${erstellen}>${busy ? 'Wird erstellt …' : 'Sicherung erstellen'}</button>`
        : html`<button class="btn block" onClick=${async () => { await teilen([{ bytes: fertig.bytes, name: fertig.name, type: 'application/json' }], { titel: fertig.name }); toast('Sicherung geteilt'); }}><${Icon} n="share" />Sicherung speichern / teilen</button>`}
      <section class="section">
        <h2>Wiederherstellen</h2>
        <p class="small-print" style="font-size:14px">Zum Beispiel auf einem neuen iPhone: Sicherungsdatei auswählen. Die Daten auf diesem Gerät werden ersetzt.</p>
        <input ref=${input} type="file" accept="application/json,.json" class="visually-hidden" onChange=${einspielen} />
        <button class="btn secondary block" onClick=${() => input.current.click()}>Sicherung einspielen</button>
      </section>
    </main>
  </div>`;
}

function uhrzeit(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const heute = new Date().toDateString() === d.toDateString();
  return heute ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function syncKurz(z) {
  if (z.status === 'laeuft') return 'Gleicht ab …';
  if (z.status === 'offline') return z.wartend ? `Offline · ${z.wartend} warten` : 'Offline';
  if (z.status === 'fehler') return 'Abgleich gestört';
  if (z.status === 'abgemeldet') return 'Abgemeldet';
  return z.letzterLauf ? `Abgeglichen ${uhrzeit(z.letzterLauf)}` : 'Bereit';
}
function syncText(z) {
  if (!z.angemeldet) return z.status === 'abgemeldet' ? 'abgemeldet – bitte neu anmelden' : 'aus';
  return syncKurz(z);
}

function Synchronisierung({ ctx }) {
  const { back, toast, sync: z } = ctx;
  const [verb, setVerb] = useState(null);
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  const [email, setEmail] = useState(z.email || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [neu, setNeu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [aendern, setAendern] = useState(false);
  useEffect(() => { konto.verbindung().then((v) => { setVerb(v); setUrl(v.url || ''); setAnon(v.anon || ''); }); }, [z.konfiguriert]);
  if (!verb) return html`<div class="screen"><${Head} title="Synchronisierung" onBack=${back} /></div>`;
  const konfiguriert = !!(verb.url && verb.anon) && !aendern;

  const verbindungSpeichern = async () => {
    await konto.verbindungSpeichern(url, anon);
    setVerb(await konto.verbindung());
    setAendern(false);
  };
  const anmelden = async () => {
    setFehler(null);
    if (neu && pw !== pw2) { setFehler('Die Passwörter stimmen nicht überein.'); return; }
    if (neu && pw.length < 10) { setFehler('Bitte ein Passwort mit mindestens 10 Zeichen wählen.'); return; }
    setBusy(true);
    try {
      await konto.anmelden(email, pw, neu);
      setPw(''); setPw2('');
      toast('Angemeldet – Daten werden abgeglichen');
    } catch (e) {
      setFehler(e.message);
    } finally { setBusy(false); }
  };

  return html`<div class="screen">
    <${Head} title="Synchronisierung" onBack=${back} />
    <main class="body">
      ${z.angemeldet ? html`
        <div class="card pad">
          <div class="kv"><span>Konto</span><b style="overflow-wrap:anywhere;text-align:right">${z.email}</b></div>
          <div class="kv muted"><span>Status</span><span>${syncKurz(z)}</span></div>
          <div class="kv muted"><span>Noch nicht hochgeladen</span><span>${z.wartend} Änderungen</span></div>
        </div>
        ${z.status === 'fehler' && html`<div class="note bad">Der letzte Abgleich hat nicht geklappt: ${z.fehler}</div>`}
        <button class="btn block" disabled=${z.status === 'laeuft'} onClick=${() => konto.abgleichen()}>Jetzt abgleichen</button>
        <p class="small-print" style="font-size:14px">Die App gleicht automatisch ab: beim Öffnen, kurz nach jeder Änderung und jede Minute. Ohne Netz wird gespeichert und später nachgeholt. Alle Daten werden auf dem Gerät verschlüsselt, bevor sie den Server erreichen.</p>
        <button class="btn danger block" onClick=${async () => { if (confirm('Auf diesem Gerät abmelden? Die Daten bleiben auf dem Gerät, werden aber nicht mehr abgeglichen.')) { await konto.abmelden(); toast('Abgemeldet'); } }}>Auf diesem Gerät abmelden</button>
      ` : !konfiguriert ? html`
        <p style="font-size:15px;color:var(--ink2)">Damit iPhone und PC dieselben Daten haben, werden sie verschlüsselt über Supabase abgeglichen. Trage hier die Verbindungsdaten deines Supabase-Projekts ein. Du findest sie in Supabase unter <b>Project Settings → API Keys</b> bzw. <b>Data API</b>.</p>
        <${Field} label="Project URL" hint="z. B. https://abcdefgh.supabase.co"><input type="url" autocapitalize="off" value=${url} onInput=${(e) => setUrl(e.target.value)} /><//>
        <${Field} label="Publishable key (oder anon public key)"><textarea style="min-height:90px;font-size:13px" autocapitalize="off" value=${anon} onInput=${(e) => setAnon(e.target.value)}></textarea><//>
        <button class="btn block" disabled=${!/^(https:\/\/.+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(url.trim()) || anon.trim().length < 20} onClick=${verbindungSpeichern}>Weiter</button>
      ` : html`
        ${z.status === 'abgemeldet' && html`<div class="note warn">Die Anmeldung ist abgelaufen. Bitte neu anmelden.</div>`}
        <div class="chips">
          <button class="chip" aria-pressed=${!neu ? 'true' : 'false'} onClick=${() => setNeu(false)}>Anmelden</button>
          <button class="chip" aria-pressed=${neu ? 'true' : 'false'} onClick=${() => setNeu(true)}>Neues Konto</button>
        </div>
        <${Field} label="E-Mail"><input type="email" autocapitalize="off" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
        <${Field} label="Passwort"><input type="password" autocomplete=${neu ? 'new-password' : 'current-password'} value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
        ${neu && html`<${Field} label="Passwort wiederholen"><input type="password" autocomplete="new-password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} /><//>`}
        <div class="note warn"><b>Wichtig:</b> Aus dem Passwort wird der Schlüssel für die Verschlüsselung erzeugt. Es kann nicht zurückgesetzt werden. Wer es vergisst, kommt nicht mehr an die Daten auf dem Server. Bitte sicher aufschreiben, zum Beispiel im iPhone-Schlüsselbund.</div>
        ${fehler && html`<div class="note bad">${fehler}</div>`}
        <button class="btn block" disabled=${busy || !email.includes('@') || !pw} onClick=${anmelden}>${busy ? 'Einen Moment …' : neu ? 'Konto anlegen' : 'Anmelden'}</button>
        <p class="small-print" style="font-size:14px">Auf dem ersten Gerät „Neues Konto“ wählen, auf allen weiteren Geräten mit denselben Daten „Anmelden“.</p>
        ${!verb.ausConfig && html`<button class="btn ghost" onClick=${() => setAendern(true)}>Verbindung ändern</button>`}
      `}
    </main>
  </div>`;
}

// ---------------------------------------------------------------------------
// App & Navigation

function App() {
  const [data, setData] = useState(null);
  const [stack, setStack] = useState([{ name: 'tab', tab: 'home' }]);
  const [toastMsg, setToastMsg] = useState(null);
  const [syncZustand, setSyncZustand] = useState(konto.zustandJetzt());
  const toastTimer = useRef(null);

  const reload = async () => {
    const [settings, customers, horses, services, invoices, expenses] = await Promise.all([
      db.einstellungen(), db.all('customers'), db.all('horses'), db.all('services'), db.all('invoices'), db.all('expenses')
    ]);
    setData({ settings, customers, horses, services, invoices, expenses });
  };
  useEffect(() => {
    reload();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const ab = konto.onZustand(setSyncZustand);
    konto.start(() => reload()).catch((e) => console.error('Sync-Start', e));
    return ab;
  }, []);

  const go = (route, root = false, replace = false) => {
    setStack((st) => (root ? [route] : replace ? [...st.slice(0, -1), route] : [...st, route]));
    window.scrollTo(0, 0);
  };
  const back = (n = 1) => {
    setStack((st) => (st.length > n ? st.slice(0, st.length - n) : [{ name: 'tab', tab: 'home' }]));
    window.scrollTo(0, 0);
  };
  const toast = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  };

  if (!data) return html`<p class="empty" style="padding-top:40vh">Lädt …</p>`;
  const ctx = { data, reload, go, back, toast, sync: syncZustand };
  const ansicht = (r) => {
    switch (r.name) {
      case 'tab':
        return html`${r.tab === 'home' && html`<${Uebersicht} ctx=${ctx} />`}
          ${r.tab === 'rechnungen' && html`<${Rechnungen} ctx=${ctx} filter=${r.filter} />`}
          ${r.tab === 'belege' && html`<${Belege} ctx=${ctx} />`}
          ${r.tab === 'kunden' && html`<${Kunden} ctx=${ctx} />`}
          ${r.tab === 'mehr' && html`<${Mehr} ctx=${ctx} />`}
          <${Tabs} tab=${r.tab} go=${go} />`;
      case 'neu': return html`<${NeueRechnung} ctx=${ctx} kundeId=${r.kundeId} pferdId=${r.pferdId} />`;
      case 'rechnung': return html`<${RechnungDetail} ctx=${ctx} id=${r.id} />`;
      case 'kunde': return html`<${KundeDetail} ctx=${ctx} id=${r.id} />`;
      case 'kundeForm': return html`<${KundeForm} ctx=${ctx} id=${r.id} />`;
      case 'pferdForm': return html`<${PferdForm} ctx=${ctx} id=${r.id} customerId=${r.customerId} />`;
      case 'leistungen': return html`<${Leistungen} ctx=${ctx} />`;
      case 'leistungForm': return html`<${LeistungForm} ctx=${ctx} id=${r.id} />`;
      case 'firma': return html`<${Firma} ctx=${ctx} />`;
      case 'export': return html`<${Export} ctx=${ctx} />`;
      case 'sicherung': return html`<${Sicherung} ctx=${ctx} />`;
      case 'sync': return html`<${Synchronisierung} ctx=${ctx} />`;
      case 'beleg': return html`<${BelegForm} ctx=${ctx} id=${r.id} />`;
      default: return html`<${Uebersicht} ctx=${ctx} />`;
    }
  };
  // Alle Ebenen bleiben eingehängt (nur ausgeblendet), damit z. B. eine angefangene Rechnung
  // erhalten bleibt, während man zwischendurch den Kunden bearbeitet.
  const view = stack.map((r, i) => html`<div key=${i + ':' + JSON.stringify(r)} style=${i === stack.length - 1 ? '' : 'display:none'}>${ansicht(r)}</div>`);
  return html`${view}${toastMsg && html`<div class="toast" role="status">${toastMsg}</div>`}`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker nicht registriert', e));
}
