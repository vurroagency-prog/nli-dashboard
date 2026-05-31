/* editor-smoke.mjs — Smoke test dell'editor causali.
 * Verifica che modificando UNA categoria e "scaricando", il registro risultante:
 *  - sia JSON valido
 *  - abbia lo stesso numero di movimenti/fatture/scadenze (niente perso)
 *  - differisca SOLO nel campo categoria del movimento toccato (+meta.ultimoAggiornamento)
 */
import { readFileSync } from 'fs';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const html = readFileSync('./editor.html', 'utf8');
const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0];

function makeEl() {
  return new Proxy({ _c: [], style: {}, dataset: {}, classList: { add(){},remove(){},contains(){return false;} },
    appendChild(c){this._c.push(c);return c;}, addEventListener(){}, querySelectorAll(){return [];},
    querySelector(){return makeEl();}, innerHTML:'', textContent:'', value:'' },
    { get(t,p){ return p in t ? t[p] : (()=>{}); }, set(t,p,v){ t[p]=v; return true; } });
}
const elCache = {};
const document = {
  getElementById:(id)=> elCache[id]||(elCache[id]=makeEl()),
  createElement:()=> makeEl(), querySelector:()=>makeEl(), querySelectorAll:()=>[], addEventListener(){}
};

let blobContent = null;
class Blob { constructor(parts){ blobContent = parts[0]; } }
const URL = { createObjectURL:()=> 'blob:x', revokeObjectURL(){} };
async function fetchMock(url){ const f=url.split('?')[0]; const body=readFileSync('./'+f,'utf8'); return { ok:true, async json(){return JSON.parse(body);}, async text(){return body;} }; }

const sandbox = {
  document, fetch:fetchMock, Blob, URL, console,
  sessionStorage:{ getItem:()=>null, setItem(){} },
  crypto:{ subtle:{ async digest(){ return new ArrayBuffer(32);} } },
  TextEncoder, setTimeout, clearTimeout, Date, Math, JSON, Promise, Array, Object,
  alert(){}, confirm(){return true;}, NLICompute:require('./compute.js')
};
sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(appScript, sandbox, { filename:'editor-inline.js' });

const orig = JSON.parse(readFileSync('./registro.json','utf8'));
const target = orig.movimenti[5];           // un movimento qualsiasi
const newCat = target.categoria === 'B7_servizi' ? 'B6_materie_prime' : 'B7_servizi';

const run = async () => {
  await sandbox.init();                       // carica registro + render
  // simula il cambio categoria via l'handler reale dell'editor
  sandbox.onChange({ target:{ dataset:{ id:target.id, f:'categoria' }, value:newCat } });
  sandbox.scarica();                          // genera il blob

  console.log('\n=== EDITOR SMOKE TEST ===');
  if(!blobContent){ console.log('❌ Nessun file generato'); process.exit(1); }
  let out;
  try { out = JSON.parse(blobContent); } catch(e){ console.log('❌ JSON non valido:', e.message); process.exit(1); }

  let fail = 0;
  const eq = (a,b,label)=>{ const ok=a===b; console.log(`  ${ok?'✓':'❌'} ${label}: ${a}${ok?'':' ≠ '+b}`); if(!ok) fail++; };
  eq(out.movimenti.length, orig.movimenti.length, 'n. movimenti invariato');
  eq(out.fatture.length, orig.fatture.length, 'n. fatture invariato');
  eq(out.scadenze.length, orig.scadenze.length, 'n. scadenze invariato');
  eq(Object.keys(out).length, Object.keys(orig).length, 'n. sezioni top-level invariato');

  const tNew = out.movimenti.find(m=>m.id===target.id);
  eq(tNew.categoria, newCat, 'categoria target aggiornata');
  eq(tNew.importo, target.importo, 'importo target invariato');
  eq(tNew.data, target.data, 'data target invariata');

  // nessun ALTRO movimento deve essere cambiato
  let othersChanged = 0;
  out.movimenti.forEach((m,i)=>{
    if(m.id===target.id) return;
    if(JSON.stringify(m)!==JSON.stringify(orig.movimenti.find(x=>x.id===m.id))) othersChanged++;
  });
  eq(othersChanged, 0, 'nessun altro movimento modificato');

  // tutte le altre sezioni identiche
  ['fatture','scadenze','iva','saldi','conti','pianoDeiConti'].forEach(sec=>{
    eq(JSON.stringify(out[sec]), JSON.stringify(orig[sec]), 'sezione '+sec+' identica');
  });

  console.log(fail===0 ? '\n✓ Editor preserva il registro e applica solo la correzione.\n' : `\n❌ ${fail} problemi.\n`);
  process.exit(fail?1:0);
};
run();
