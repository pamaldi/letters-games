/* Shared learning settings and local progress. No network or account required. */
(() => {
  'use strict';
  const gamesBase = new URL('.', document.currentScript.src);
  const refreshToken = new URL(location.href).searchParams.get('refresh');
  function freshLink(url) {
    const target = new URL(url, location.href);
    if (refreshToken) target.searchParams.set('refresh', refreshToken);
    return target.href;
  }
  const vowels = ['A', 'E', 'I', 'O', 'U'];
  const key = 'vocali-learning-v1';
  const defaults = { vowels: ['A', 'E', 'I', 'O', 'U'], challenge: false, autonomous: false, neutral: false, effects: true, writing: true, lower: false };
  function read() { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } }
  let saved = read();
  const settings = { ...defaults, ...saved.settings };
  settings.vowels = Array.isArray(settings.vowels) ? vowels.filter(v => settings.vowels.includes(v)) : defaults.vowels;
  if (!settings.vowels.length) settings.vowels = [...defaults.vowels];
  let progress = saved.progress && typeof saved.progress === 'object' ? saved.progress : {};
  function save() { try { localStorage.setItem(key, JSON.stringify({ settings, progress })); } catch { /* Private browsing can disable storage. */ } }
  function record(v, kind, success, helped = false, chosen = '') {
    if (!vowels.includes(v)) return;
    const p = progress[v] ||= {};
    const stat = p[kind] ||= { first: 0, helped: 0, errors: 0, swaps: {} };
    if (success) stat[helped ? 'helped' : 'first']++;
    else { stat.errors++; if (vowels.includes(chosen)) stat.swaps[chosen] = (stat.swaps[chosen] || 0) + 1; }
    save();
  }
  let voicePlayer;
  function speak(text) {
    if (voicePlayer) { voicePlayer(text); return; }
    const synth = window.speechSynthesis;
    const voice = synth?.getVoices().find(v => v.lang.startsWith('it'));
    if (!synth || !voice) { const note = document.querySelector('#learn-status'); if (note) note.textContent = 'Voce italiana non disponibile: leggi tu la vocale al bambino.'; return; }
    synth.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; u.voice = voice; u.rate = .8; synth.speak(u);
  }
  function active() { return [...settings.vowels]; }
  function pool(last) { const list = active().filter(v => v !== last); return list.length ? list : active(); }
  function pick(last) {
    const list = pool(last);
    // Give extra practice to vowels with errors, while retaining all selected vowels.
    const weights = list.map(v => 1 + Math.min(2, (progress[v]?.recognition?.errors || 0) / 3));
    let n = Math.random() * weights.reduce((a, b) => a + b, 0);
    return list.find((v, i) => (n -= weights[i]) < 0) || list[0];
  }
  const api = window.Learning = { settings, active, pool, pick, record, speak, setVoice: fn => { voicePlayer = fn; }, busy: () => !!document.querySelector('.learn-dialog[open]') };
  const showLetter = v => settings.lower ? v.toLowerCase() : v;
  api.letter = showLetter;
  function dialog(title) {
    const d = document.createElement('dialog'); d.className = 'learn-dialog';
    const h = document.createElement('h2'); h.textContent = title; h.id = 'learning-dialog-title'; d.setAttribute('aria-labelledby', h.id); d.append(h);
    // The game's document-level keyboard handlers must not fire behind a lesson.
    const block = e => { if (d.open && e.key !== 'Escape') e.stopImmediatePropagation(); };
    document.addEventListener('keydown', block, true);
    d.addEventListener('close', () => { document.removeEventListener('keydown', block, true); d.remove(); });
    document.body.append(d); return d;
  }
  function button(parent, text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; parent.append(b); return b; }
  function reading() {
    const d = dialog('Leggiamo insieme'); let v, revealed = false;
    const letter = document.createElement('div'); letter.className = 'read-letter'; d.append(letter);
    const p = document.createElement('p'); p.textContent = 'Di’ questa vocale. Poi ascoltala insieme a un adulto.'; d.append(p);
    const row = document.createElement('div'); row.className = 'learn-row'; d.append(row);
    const feedback = document.createElement('p'); feedback.setAttribute('role', 'status'); d.append(feedback);
    function next() { v = pick(v); revealed = false; letter.textContent = showLetter(v); feedback.textContent = ''; }
    button(row, 'Ascolta', () => { revealed = true; speak(v); });
    button(row, 'L’ha letta', () => { record(v, 'reading', true, revealed); next(); });
    button(row, 'La ripassiamo', () => { record(v, 'reading', false); revealed = true; speak(v); feedback.textContent = 'Guardala e ripetila insieme. Quando vuoi, passa alla prossima.'; });
    button(row, 'Prossima', next); button(row, 'Fine', () => d.close());
    next(); d.showModal();
  }
  // Coordinates describe pen strokes in a 300 × 300 writing area.
  const paths = {
    A: [[[65,245],[150,55],[235,245]], [[103,165],[197,165]]],
    E: [[[220,60],[80,60],[80,240],[220,240]], [[80,150],[195,150]]],
    I: [[[150,60],[150,240]]],
    O: [Array.from({length: 65}, (_, i) => { const a = -Math.PI / 2 - i * Math.PI / 32; return [150 + 85 * Math.cos(a),150 + 98 * Math.sin(a)]; })],
    U: [[[70,60],[70,180], ...Array.from({length: 25}, (_, i) => { const a = Math.PI - i * Math.PI / 24; return [150 + 80 * Math.cos(a),180 + 65 * Math.sin(a)]; }), [230,60]]]
  };
  api.write = function(v, done = () => {}, cancelled = () => {}) {
    const d = dialog('Scrivi la ' + v);
    let stroke = [], strokes = [], pointer = null, finished = false;
    const p = document.createElement('p'); p.textContent = 'Ripassa la lettera con il dito o il mouse. Quando è pronta, si va avanti da soli!'; d.append(p);
    const c = document.createElement('canvas'); c.width = c.height = 300; c.setAttribute('aria-label', 'Ripassa la vocale ' + v); d.append(c);
    const ctx = c.getContext('2d');
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Puoi cominciare subito.'; d.append(status);
    const row = document.createElement('div'); row.className = 'learn-row'; d.append(row);
    function line(points, color, width) {
      if (!points.length) return;
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round';
      points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke();
    }
    function draw() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,300,300);
      ctx.strokeStyle = '#e4eaf2'; ctx.lineWidth = 1;
      [60,150,245].forEach(y => { ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(280,y); ctx.stroke(); });
      paths[v].forEach(points => line(points, '#c0ccdc', 20));
      paths[v].forEach(points => { const [x,y] = points[0]; ctx.fillStyle = '#156c59'; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill(); });
      strokes.forEach(s => line(s,'#1256a0',10)); line(stroke,'#1256a0',10);
    }
    // Resample segments so a quick pen movement counts as a continuous line.
    function samples(path) {
      const out = path.length ? [path[0]] : [];
      path.slice(1).forEach((b,i) => { const a=path[i], n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5));
        for(let j=1;j<=n;j++) out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);
      }); return out;
    }
    const guides = paths[v].map(samples), guide = guides.flat();
    function check() {
      const ink=strokes.flatMap(samples);
      const close=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<25;
      const coverage=part=>part.filter(a=>ink.some(b=>close(a,b))).length/part.length;
      const accuracy=ink.length ? ink.filter(a=>guide.some(b=>close(a,b))).length/ink.length : 0;
      // Every part must be traced: for example, an A needs its crossbar as well.
      if (coverage(guide) >= .80 && guides.every(part=>coverage(part)>=.75) && accuracy>=.65) {
        finished=true; record(v,'writing',true,true); d.close(); done();
      } else {
        status.textContent = accuracy < .65 && ink.length > 8 ? 'Segui la lettera grigia. Puoi cancellare e riprovare.' : 'Continua a ripassare la lettera.';
      }
    }
    const point=e=> { const r=c.getBoundingClientRect(); return [(e.clientX-r.left)*300/r.width,(e.clientY-r.top)*300/r.height]; };
    c.onpointerdown=e=> {
      if (pointer !== null || finished) return;
      e.preventDefault(); c.setPointerCapture(e.pointerId); pointer=e.pointerId; stroke=[point(e)]; draw();
    };
    c.onpointermove=e=> { if(pointer===e.pointerId) { e.preventDefault(); stroke.push(point(e)); draw(); } };
    c.onpointerup=e=> {
      if(pointer!==e.pointerId) return;
      stroke.push(point(e)); strokes.push(stroke); stroke=[]; pointer=null; draw(); check();
    };
    c.onpointercancel=e=> { if(pointer===e.pointerId) { pointer=null; stroke=[]; draw(); } };
    button(row,'Cancella',()=> { pointer=null; strokes=[]; stroke=[]; draw(); status.textContent='Puoi ricominciare subito.'; });
    button(row,'Chiudi',()=>d.close());
    d.addEventListener('close',()=> { if(!finished) cancelled(); });
    d.showModal(); draw();
  };
  function mount() {
    if (refreshToken) document.querySelectorAll('a.game, a.home-link').forEach(a => { a.href = freshLink(a.href); });
    document.body.classList.toggle('learn-neutral',settings.neutral);
    const home = !document.querySelector('#ov-menu');
    const host = home ? document.querySelector('header') : document.querySelector('#ov-menu .card');
    if(!host) return;
    const panel=document.createElement('section'); panel.className='learn-panel';
    panel.innerHTML='<h2>Il nostro percorso</h2><p>Scegli poche vocali, poi aggiungine altre quando vuoi.</p><div class="learn-row" id="learn-vowels"></div><div id="learn-options"></div><p class="learn-note" id="learn-status" role="status">Le scelte si applicano alla prossima partita. I progressi restano in questo browser.</p><div class="learn-row" id="learn-actions"></div>';
    panel.addEventListener('keydown', e => e.stopPropagation());
    if (home) host.append(panel);
    else {
      const details=document.createElement('details'); details.className='learn-settings';
      const summary=document.createElement('summary'); summary.textContent='Vocali, percorso e progressi'; details.append(summary,panel);
      host.insertBefore(details,host.querySelector('.actions'));
    }
    const choices=panel.querySelector('#learn-vowels');
    vowels.forEach(v=> { const label=document.createElement('label'), input=document.createElement('input'); input.type='checkbox'; input.checked=settings.vowels.includes(v); label.append(input,document.createTextNode(v)); choices.append(label); input.onchange=()=> { const checked=[...choices.querySelectorAll('input')].flatMap((el,i)=>el.checked?[vowels[i]]:[]); if(!checked.length) { input.checked=true; panel.querySelector('#learn-status').textContent='Scegli almeno una vocale.'; return; } settings.vowels=checked; save(); }; });
    const options=panel.querySelector('#learn-options');
    const opts=[['effects','Effetti sonori'],['neutral','Lettere dello stesso colore'],['challenge','Sfida con velocità e penalità']];
    if(home || location.pathname.includes('luna')) opts.push(['autonomous','Luna: trova la vocale senza sentirne il nome']);
    if(home || location.pathname.includes('miniera')) opts.push(['writing','Miniera: scrivi per costruire']);
    opts.forEach(([name,text])=> { const label=document.createElement('label'), input=document.createElement('input'); input.type='checkbox'; input.checked=settings[name]; label.append(input,document.createTextNode(text)); options.append(label); input.onchange=()=> {settings[name]=input.checked; save(); document.body.classList.toggle('learn-neutral',settings.neutral);}; });
    if(home) {
      const label=document.createElement('label'); label.textContent='Lettere nella lettura: '; const select=document.createElement('select'); select.innerHTML='<option value="upper">MAIUSCOLE</option><option value="lower">minuscole</option>'; select.value=settings.lower?'lower':'upper'; select.onchange=()=> {settings.lower=select.value==='lower';save();}; label.append(select); options.append(label);
    }
    const actions=panel.querySelector('#learn-actions');
    button(actions,'Ascolta e trova',()=> { location.href=freshLink(new URL('gol-delle-vocali.html', gamesBase).href); });
    button(actions,'Leggi',reading);
    button(actions,'Scrivi',()=> { api.write(pick(),()=>speak('Bravo! Ora prova anche su carta.')); });
    button(actions,'Come si gioca',()=> { const d=dialog('Proviamo insieme'); const p=document.createElement('p'); p.textContent='Ascolta la vocale, ripetila e cerca la stessa lettera. Nel gioco della lettura, di’ la lettera prima di ascoltarla. Nella Miniera ripassa la lettera: il gioco controlla il tratto e continua automaticamente. Puoi riascoltare e riprovare.'; d.append(p); button(d,'Ascolta la spiegazione',()=>speak(p.textContent)); button(d,'Ho capito',()=>d.close()); d.showModal(); });
    button(actions,'Progressi',()=> {
      const d=dialog('Progressi in questo browser'), wrapper=document.createElement('div'); wrapper.className='learn-panel learn-table';
      const table=document.createElement('table'); table.innerHTML='<thead><tr><th>Vocale</th><th>Trova: da solo / aiuto</th><th>Leggi: da solo / aiuto</th><th>Scrivi: percorsi completati</th><th>Confusioni</th></tr></thead>'; const body=document.createElement('tbody');
      vowels.forEach(v=> { const p=progress[v]||{}, r=p.recognition||{}, l=p.reading||{}, w=p.writing||{}; const row=document.createElement('tr'); const swaps=Object.entries(r.swaps||{}).map(([ch,n])=>v+' → '+ch+': '+n).join(', ')||'—'; [v,`${r.first||0} / ${r.helped||0}`,`${l.first||0} / ${l.helped||0}`,String((w.first||0)+(w.helped||0)),swaps].forEach(t=> { const cell=document.createElement('td');cell.textContent=t;row.append(cell); });body.append(row); });table.append(body);wrapper.append(table);d.append(wrapper);
      const p=document.createElement('p'); p.textContent='La lettura è confermata dall’adulto. La scrittura conta i percorsi completati, non certifica la capacità di scrivere senza modello. I punteggi dei giochi restano separati.';d.append(p);button(d,'Chiudi',()=>d.close());d.showModal();
    });
  }
  document.addEventListener('DOMContentLoaded', mount);
})();
