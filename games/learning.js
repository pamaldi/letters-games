/* Shared learning settings and local progress. No network or account required. */
(() => {
  'use strict';
  const gamesBase = new URL('.', document.currentScript.src);
  const vowels = ['A', 'E', 'I', 'O', 'U'];
  const key = 'vocali-learning-v1';
  const defaults = { vowels: ['A', 'E'], challenge: false, autonomous: false, neutral: false, effects: true, writing: true, lower: false };
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
    const d = dialog('Scriviamo la ' + v); let stage = 0, stroke = [], strokes = [], drawing = false, retry = false, finished = false, anim = 0, token = 0;
    const p = document.createElement('p'); d.append(p);
    const c = document.createElement('canvas'); c.width = c.height = 300; c.setAttribute('aria-label', 'Spazio per scrivere la vocale ' + v); d.append(c); const ctx = c.getContext('2d');
    const status = document.createElement('p'); status.setAttribute('role', 'status'); d.append(status);
    const row = document.createElement('div'); row.className = 'learn-row'; d.append(row);
    function line(points, color, width) { if (!points.length) return; ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = ctx.lineCap = 'round'; points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke(); }
    function draw() {
      ctx.clearRect(0,0,300,300); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,300,300);
      ctx.strokeStyle = '#dce4ee'; ctx.lineWidth = 1; [60,150,245].forEach(y => { ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(280,y); ctx.stroke(); });
      if (stage < 3) paths[v].forEach(points => line(points, stage === 2 ? '#d5dce6' : '#c0ccdc', stage === 2 ? 3 : 18));
      else { ctx.fillStyle = '#64748b'; ctx.font = 'bold 38px Arial'; ctx.fillText(v,12,42); }
      if (stage === 0) {
        const flat = samples(); line(flat.slice(0,Math.floor(anim)), '#167a63', 9);
      } else if (stage === 1) paths[v].forEach((pts,i) => { const [x,y] = pts[0]; ctx.fillStyle = '#156c59'; ctx.beginPath(); ctx.arc(x,y,11,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='bold 14px Arial'; ctx.fillText(String(i+1),x-4,y+5); const q=pts[1]; const angle=Math.atan2(q[1]-y,q[0]-x); const ax=x+Math.cos(angle)*30, ay=y+Math.sin(angle)*30; line([[ax-10*Math.cos(angle-.5),ay-10*Math.sin(angle-.5)],[ax,ay],[ax-10*Math.cos(angle+.5),ay-10*Math.sin(angle+.5)]], '#156c59',3); });
      strokes.forEach(s => line(s,'#1256a0',9)); line(stroke,'#1256a0',9);
    }
    function samples() { const out=[]; paths[v].forEach(path => { path.slice(1).forEach((b,i) => { const a=path[i], n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5)); for(let j=0;j<=n;j++) out.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]); }); }); return out; }
    function animate() { const id=++token; anim=0; const total=samples().length; if (matchMedia('(prefers-reduced-motion: reduce)').matches) { anim=total; draw(); return; } const frame=()=> { if(id!==token || !d.open) return; anim+=2; draw(); if(anim<total) requestAnimationFrame(frame); }; requestAnimationFrame(frame); }
    function update() { p.textContent = ['Guarda il movimento. Premi «Ora provo» quando sei pronto.', 'Segui la traccia. Parti dai punti numerati e segui le frecce.', 'Ripassa la traccia leggera.', 'Prova da solo. Il modello è piccolo, in alto.'][stage]; check.textContent=stage===0?'Ora provo':stage===3?'Ho finito':'Controlla e continua'; strokes=[]; stroke=[]; status.textContent=''; draw(); if(stage===0) animate(); }
    const point=e=> { const r=c.getBoundingClientRect(); return [(e.clientX-r.left)*300/r.width,(e.clientY-r.top)*300/r.height]; };
    c.onpointerdown=e=> { if(stage===0) return; e.preventDefault(); c.setPointerCapture(e.pointerId); drawing=true; stroke=[point(e)]; };
    c.onpointermove=e=> { if(drawing) { stroke.push(point(e)); draw(); } };
    c.onpointerup=e=> { if(!drawing) return; stroke.push(point(e)); strokes.push(stroke); stroke=[]; drawing=false; draw(); };
    c.onpointercancel=()=> { drawing=false; stroke=[]; draw(); };
    const check=button(row,'Ora provo',()=> {
      if(stage===0) { token++; stage++; update(); return; }
      const ink=strokes.flat(), guide=samples();
      const close=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<25;
      const coverage=guide.filter(a=>ink.some(b=>close(a,b))).length/guide.length;
      const accuracy=ink.length ? ink.filter(a=>guide.some(b=>close(a,b))).length/ink.length : 0;
      if(coverage<.68 || accuracy<.60) { retry=true; status.textContent='Proviamo ancora insieme: segui tutta la lettera. Puoi cancellare e riprovare.'; return; }
      if(stage<3) { stage++; update(); return; }
      record(v,'writing',true,retry); finished=true; d.close(); done();
    });
    button(row,'Riprova',()=> { retry=true; strokes=[]; stroke=[]; draw(); status.textContent='Riparti quando vuoi.'; if(stage===0) animate(); });
    button(row,'Rivedi il movimento',()=> { retry=true; stage=0; update(); });
    button(row,'Chiudi',()=>d.close());
    const paper=document.createElement('p'); paper.className='learn-note'; paper.textContent='Dopo il gioco, prova la stessa vocale su carta con un adulto. Il controllo del tratto è un aiuto, non una valutazione della scrittura.'; d.append(paper);
    d.addEventListener('close',()=> { token++; if(!finished) cancelled(); }); d.showModal(); update();
  };
  function mount() {
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
    button(actions,'Ascolta e trova',()=> { location.href=new URL('gol-delle-vocali.html', gamesBase).href; });
    button(actions,'Leggi',reading);
    button(actions,'Scrivi',()=> { api.write(pick(),()=>speak('Bravo! Ora prova anche su carta.')); });
    button(actions,'Come si gioca',()=> { const d=dialog('Proviamo insieme'); const p=document.createElement('p'); p.textContent='Ascolta la vocale, ripetila e cerca la stessa lettera. Nel gioco della lettura, di’ la lettera prima di ascoltarla. Nella Miniera segui il movimento per scriverla. Puoi riascoltare e riprovare.'; d.append(p); button(d,'Ascolta la spiegazione',()=>speak(p.textContent)); button(d,'Ho capito',()=>d.close()); d.showModal(); });
    button(actions,'Progressi',()=> {
      const d=dialog('Progressi in questo browser'), wrapper=document.createElement('div'); wrapper.className='learn-panel learn-table';
      const table=document.createElement('table'); table.innerHTML='<thead><tr><th>Vocale</th><th>Trova: da solo / aiuto</th><th>Leggi: da solo / aiuto</th><th>Scrivi: percorsi completati</th><th>Confusioni</th></tr></thead>'; const body=document.createElement('tbody');
      vowels.forEach(v=> { const p=progress[v]||{}, r=p.recognition||{}, l=p.reading||{}, w=p.writing||{}; const row=document.createElement('tr'); const swaps=Object.entries(r.swaps||{}).map(([ch,n])=>v+' → '+ch+': '+n).join(', ')||'—'; [v,`${r.first||0} / ${r.helped||0}`,`${l.first||0} / ${l.helped||0}`,String((w.first||0)+(w.helped||0)),swaps].forEach(t=> { const cell=document.createElement('td');cell.textContent=t;row.append(cell); });body.append(row); });table.append(body);wrapper.append(table);d.append(wrapper);
      const p=document.createElement('p'); p.textContent='La lettura è confermata dall’adulto. La scrittura conta i percorsi completati, non certifica la capacità di scrivere senza modello. I punteggi dei giochi restano separati.';d.append(p);button(d,'Chiudi',()=>d.close());d.showModal();
    });
  }
  document.addEventListener('DOMContentLoaded', mount);
})();
