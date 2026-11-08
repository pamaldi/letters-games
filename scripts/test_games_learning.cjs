// Run with NODE_PATH pointing at a node_modules directory containing Playwright.
// Test-only server exposes each game's closure; published files have no test API.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../games');
const files = ['index.html', ...fs.readdirSync(root).filter(f => f.endsWith('.html'))];
const filePath = file => file === 'index.html' ? path.resolve(root, '../index.html') : path.join(root, file);
const pagePath = file => file === 'index.html' ? 'index.html' : 'games/' + file;
for (const file of files) {
  const html = fs.readFileSync(filePath(file), 'utf8');
  for (const [, code] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(code, { filename: file });
  for (const [, href] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!href.includes(':')) assert(fs.existsSync(path.resolve(path.dirname(filePath(file)), href.split('?')[0])), `${file}: missing ${href}`);
  }
}
new vm.Script(fs.readFileSync(path.join(root, 'learning.js'), 'utf8'));
const server = http.createServer((req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  const file = path.basename(requested) || 'index.html';
  const full = path.resolve(root, '..', '.' + (requested === '/' ? '/index.html' : requested));
  if (!full.startsWith(path.resolve(root, '..') + path.sep)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(full)) { res.writeHead(404).end(); return; }
  let content = fs.readFileSync(full, 'utf8');
  if (file.endsWith('.html') && file !== 'index.html') {
    const at = content.lastIndexOf('})();');
    content = content.slice(0, at) + 'window.__gameEval = code => eval(code);\n' + content.slice(at);
  }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(content);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    for (const file of files) {
      await page.goto(`${url}/${pagePath(file)}`); await page.waitForTimeout(200);
      assert.equal(await page.locator('.learn-panel').count(), 1, file);
      assert.equal(await page.evaluate(() => Learning.active().join('')), 'AEIOU');
      if(file !== 'index.html') assert.equal(await page.locator('.home-link').getAttribute('href'), '../index.html?v=20261025-come-2');
      if(file !== 'index.html') {
        const recordings = await page.evaluate(()=>__gameEval(`(async()=> {
          ensureAudio(); await clipsReady;
          const originalVoice=voice, originalPlay=playClip, originalSay=sayText;
          const played=[], synthesized=[];
          voice=null; playClip=async key=>played.push(key); sayText=async text=>synthesized.push(text);
          try {
            for(const v of VOWELS) { speakSeq([v]); await voiceChain; }
            return {played,synthesized,durations:VOWELS.map(v=>clipBuffers[v]?.duration||0),phrases:VOWELS.map(v=>Learning.exampleText(v))};
          } finally { voice=originalVoice;playClip=originalPlay;sayText=originalSay; }
        })()`));
        assert.deepEqual(recordings.played,['A','E','I','O','U'],file+' recorded examples');
        assert.deepEqual(recordings.synthesized,[]);
        assert(recordings.durations.every(duration=>duration>1));
        assert.deepEqual(recordings.phrases,['a come ape','e come elicottero','i come ippopotamo','o come orso','u come uva']);
        const playedToEnd = await page.evaluate(()=>__gameEval(`(async()=> {
          ensureAudio(); await clipsReady; await actx.resume();
          const originalVoice=voice, originalPlay=playClip, originalSay=sayText;
          let completed=false;
          voice=null;
          playClip=async key=>{await originalPlay(key);if(key==='E')completed=true;};
          sayText=async()=>{throw Error('unexpected speech before the recorded example');};
          try {speakSeq([Learning.exampleText('E')]);await voiceChain;return completed;}
          finally {voice=originalVoice;playClip=originalPlay;sayText=originalSay;}
        })()`));
        assert(playedToEnd,file+' E come elicottero must actually play to completion');
        const primaryPrompt = await page.evaluate(file=>__gameEval(`
          const spoken=[], originalSpeech=speakSeq; speakSeq=parts=>spoken.push(parts);
          try {
            if(${JSON.stringify(file)}==='caccia-alle-vocali.html') say('E');
            else if(${JSON.stringify(file)}==='parole-per-la-luna.html') {
              word={text:'MELA',letters:['M','E','L','A'],missing:new Set([1]),filled:new Set(),reserved:new Set()};announce();
            } else if(${JSON.stringify(file)}==='para-le-vocali.html') {round={v:'E'};phase='run';repeatVoice();phase='menu';round=null;}
            else {round={v:'E',word:null};promptVoice();round=null;}
          } finally {speakSeq=originalSpeech;}
          spoken;
        `),file);
        assert.equal(primaryPrompt[0][0],'e come elicottero',file+' must start with the complete example');
        const frequency = await page.evaluate(()=> {
          const counts={A:0,E:0,I:0,O:0,U:0};let last=null;
          for(let i=0;i<1000;i++){
            const next=Learning.pick(last,Learning.active(),'test-balance');
            if(next===last) throw Error('unexpected consecutive vowel');
            last=next; counts[last]++;
            if(Math.max(...Object.values(counts))-Math.min(...Object.values(counts))>1) throw Error('unbalanced prefix');
          }
          return counts;
        });
        assert.deepEqual(Object.values(frequency),[200,200,200,200,200],file+' balanced vowels');
        if(file==='gol-delle-vocali.html'||file==='miniera-delle-vocali.html') {
          const words = await page.evaluate(()=>__gameEval(`
            const counts={A:0,E:0,I:0,O:0,U:0};
            for(let i=0;i<100;i++){const r=pickWordRound();counts[r.v]++;lastVowel=r.v;}
            counts;
          `));
          assert.deepEqual(Object.values(words),[20,20,20,20,20],file+' balanced word rounds');
        }
        if(file==='parole-per-la-luna.html') {
          const words = await page.evaluate(()=>__gameEval(`
            level=1; const counts={A:0,E:0,I:0,O:0,U:0};
            for(let i=0;i<100;i++)for(const [word,pic,target] of pickTripWords()){
              if(!word.includes(target))throw Error('target missing from word');counts[target]++;
            }
            counts;
          `));
          assert.deepEqual(Object.values(words),[140,140,140,140,140]);
        }
        if(file==='caccia-alle-vocali.html') {
          const calls = await page.evaluate(()=>__gameEval(`
            const oldVowels=vowels, oldSay=say;const counts={A:0,E:0,I:0,O:0,U:0};say=()=>{};
            try {
              vowels=VOWELS.map(v=>({v,x:100,y:orbR*3,r:orbR,locked:false}));
              for(let i=0;i<100;i++){call=null;nextCallV=null;callDelay=0;updateCall(1);counts[call.v]++;lastCallV=call.v;}
            } finally {vowels=oldVowels;say=oldSay;call=null;nextCallV=null;}
            counts;
          `));
          assert.deepEqual(Object.values(calls),[20,20,20,20,20]);
          assert(await page.evaluate(()=>__gameEval(`
            const oldVowels=vowels, oldSay=say; say=()=>{};
            let result=false;
            try {
              call=null;nextCallV='E';callDelay=0;vowels=[{v:'A',x:100,y:orbR*3,r:orbR,locked:false}];
              updateCall(1);
              const spawned=vowels.find(o=>o.v==='E');
              if(spawned) {spawned.y=orbR*3;updateCall(1);result=call?.v==='E';}
            } finally {vowels=oldVowels;say=oldSay;call=null;nextCallV=null;}
            result;
          `)), 'Caccia must introduce E when the next balanced target is missing');
        }
      }

    }
    await page.goto(`${url}/games/gol-delle-vocali.html`);
    await page.evaluate(() => __gameEval("startMatch(); nextRound(); round.v='A'; round.errors=0; chooseBall(balls.findIndex(b=>b.v==='E'))"));
    assert.deepEqual(await page.evaluate(() => __gameEval('[match.us,match.them,phase,round.errors]')), [0,0,'prompt',1]);
    await page.evaluate(() => __gameEval("chooseBall(balls.findIndex(b=>b.v==='A'))"));
    assert.equal(await page.evaluate(() => __gameEval('phase')), 'kick');
    await page.goto(`${url}/games/miniera-delle-vocali.html`);
    const minePrompts = await page.evaluate(() => __gameEval(`
      const spoken=[], originalSpeech=speakSeq;
      speakSeq=parts=>spoken.push(parts);
      try { for(const v of VOWELS) { round={v,word:null}; promptVoice(); } }
      finally { speakSeq=originalSpeech; round=null; }
      spoken;
    `));
    assert.deepEqual(minePrompts, [
      ['a come ape'], ['e come elicottero'],
      ['i come ippopotamo'], ['o come orso'],
      ['u come uva']
    ]);
    const recordedExamples = await page.evaluate(() => __gameEval(`(async () => {
      ensureAudio(); await clipsReady;
      const originalVoice=voice, originalPlay=playClip, originalSay=sayText;
      const played=[], synthesized=[];
      voice=null;
      playClip=async key=>played.push(key);
      sayText=async text=>synthesized.push(text);
      try {
        for(const v of VOWELS) { speakSeq([v]); await voiceChain; }
        return {played,synthesized,durations:VOWELS.map(v=>clipBuffers[v]?.duration||0)};
      } finally { voice=originalVoice; playClip=originalPlay; sayText=originalSay; }
    })()`));
    assert.deepEqual(recordedExamples.played,['A','E','I','O','U']);
    assert.deepEqual(recordedExamples.synthesized,[], 'complete phrases must work without device TTS');
    assert(recordedExamples.durations.every(duration=>duration>1), 'all five complete recordings must decode');
    await page.evaluate(() => __gameEval("Learning.settings.writing=false; startGame(); nextRound(); round.v='A'; build.placed=['A']; press('E')"));
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => __gameEval('build.placed.length')), 1);
    // Reading comes first: neither starting a round nor a wrong choice opens writing.
    await page.evaluate(() => __gameEval("Learning.settings.writing=true; Learning.settings.vowels=['A','E']; nextRound(); round.v='A'"));
    assert.equal(await page.locator('.learn-dialog[open]').count(), 0);
    await page.evaluate(() => __gameEval("press('E')"));
    assert.equal(await page.locator('.learn-dialog[open]').count(), 0);
    await page.waitForTimeout(700);
    await page.evaluate(() => __gameEval("press('A')"));
    assert.equal(await page.locator('.learn-dialog[open]').count(), 1);
    const recognizedBeforeWriting = await page.evaluate(() => JSON.parse(localStorage.getItem('vocali-learning-v1')).progress.A.recognition.helped);
    assert.equal(await page.getByRole('button', { name: 'Ora provo', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Controlla e continua', exact: true }).count(), 0);
    async function tracePaths(paths) {
      await page.locator('.learn-dialog[open] canvas').evaluate((c,paths) => {
        const r=c.getBoundingClientRect();
        for(const path of paths) {
          const points=[];
          path.slice(1).forEach((b,i)=> {const a=path[i];for(let k=0;k<=40;k++)points.push([a[0]+(b[0]-a[0])*k/40,a[1]+(b[1]-a[1])*k/40]);});
          c.setPointerCapture=()=>{};
          const ev=([x,y])=>({clientX:r.left+x*r.width/300,clientY:r.top+y*r.height/300,pointerId:1,preventDefault(){}});
          c.onpointerdown(ev(points[0])); points.slice(1).forEach(p=>c.onpointermove(ev(p)));c.onpointerup(ev(points.at(-1)));
        }
      }, paths);
    }
    await tracePaths([[[65,245],[150,55],[235,245]]]);
    assert.equal(await page.locator('.learn-dialog[open]').count(),1, 'A without its crossbar must not pass');
    await tracePaths([[[103,165],[197,165]]]);
    assert.equal(await page.locator('.learn-dialog[open]').count(), 0);
    assert.equal(await page.evaluate(() => __gameEval('round.written')), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vocali-learning-v1')).progress.A.recognition.helped), recognizedBeforeWriting, 'writing callback must not count recognition twice');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vocali-learning-v1')).progress.A.writing.helped), 1);
    await page.waitForFunction(() => __gameEval('build.placed.length===2'));
    // All vowels advance automatically, and off-target scribbles do not pass.
    await page.goto(`${url}/index.html`);
    const letterPaths={
      A:[[[65,245],[150,55],[235,245]],[[103,165],[197,165]]],
      E:[[[220,60],[80,60],[80,240],[220,240]],[[80,150],[195,150]]],
      I:[[[150,60],[150,240]]],
      O:[Array.from({length:65},(_,i)=>{const a=-Math.PI/2-i*Math.PI/32;return[150+85*Math.cos(a),150+98*Math.sin(a)];})],
      U:[[[70,60],[70,180],...Array.from({length:25},(_,i)=>{const a=Math.PI-i*Math.PI/24;return[150+80*Math.cos(a),180+65*Math.sin(a)];}),[230,60]]]
    };
    for(const [v,paths] of Object.entries(letterPaths)) {
      await page.evaluate(v=> {window.writingDone=0;Learning.write(v,()=>window.writingDone++);},v);
      await tracePaths([[[5,5],[290,5]]]);
      assert.equal(await page.evaluate(()=>window.writingDone),0);
      await page.getByRole('button',{name:'Cancella',exact:true}).click();
      await tracePaths(paths);
      assert.equal(await page.evaluate(()=>window.writingDone),1, v+' automatically completes');
      assert.equal(await page.locator('.learn-dialog[open]').count(),0);
    }
    await page.goto(`${url}/games/parole-per-la-luna.html`);
    const spoken = await page.evaluate(() => __gameEval("Learning.settings.autonomous=true; word={text:'CASA',letters:['C','A','S','A'],missing:new Set([1]),filled:new Set(),reserved:new Set()}; window.spoken=[]; speakSeq=p=>window.spoken.push(p); announce(); window.spoken"));
    assert.deepEqual(spoken, [['casa']]);
    await page.goto(`${url}/games/caccia-alle-vocali.html`);
    await page.evaluate(() => __gameEval("startGame(); vowels=[]; spawnVowel(); vowels[0].y=groundY*.38;"));
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => __gameEval('lives')), 3);
    assert(await page.evaluate(() => __gameEval('vowels.every(o=>o.y <= groundY*.39)')));
    await page.goto(`${url}/games/para-le-vocali.html`);
    await page.evaluate(() => __gameEval("startMatch(); startRound(); round.v='A'; choose('E');"));
    assert.equal(await page.evaluate(() => __gameEval('phase')), 'shot');
    await page.evaluate(() => __gameEval("choose('A'); update(.63)"));
    assert.equal(await page.evaluate(() => __gameEval('phase')), 'scored');
    assert.equal(await page.evaluate(() => __gameEval('match.goals')), 1);
    await page.evaluate(() => __gameEval('startRound()'));
    assert.equal(await page.evaluate(() => __gameEval('RUN_TIME')), 10);
    // The striker stays on the penalty spot while the ball travels for 10 seconds.
    assert(await page.evaluate(() => __gameEval('penaltyFlight(.8).r > penaltyFlight(.2).r')));
    const beforeDeadline = await page.evaluate(() => __gameEval('phaseT=9.95; update(.04); phase'));
    assert.equal(beforeDeadline, 'run');
    await page.evaluate(() => __gameEval('update(.02)'));
    assert.equal(await page.evaluate(() => __gameEval('phase')), 'scored');
    assert.equal(await page.evaluate(() => __gameEval('match.goals')), 2);
    // A correct answer just before arrival still produces a save.
    await page.evaluate(() => __gameEval("startRound(); round.v='A'; phaseT=9.99; choose('A'); update(.63)"));
    assert.equal(await page.evaluate(() => __gameEval('phase')), 'saved');
    assert.equal(await page.evaluate(() => __gameEval('match.saves')), 1);
    await page.evaluate(() => __gameEval('startRound(); phaseT=7; render()'));
    const listeningOnly = await page.evaluate(() => __gameEval(`
      round.v='U';
      const labels=[], originalFill=ctx.fillText, originalSpeech=speakSeq;
      const spoken=[];
      ctx.fillText=function(text,...args) { labels.push(String(text)); return originalFill.call(this,text,...args); };
      speakSeq=parts=>spoken.push(parts);
      try { render(); repeatVoice(); }
      finally { ctx.fillText=originalFill; speakSeq=originalSpeech; }
      ({labels,spoken});
    `));
    assert(!listeningOnly.labels.some(text=>text==='U'||text==='?'), 'the ball must not reveal the vowel');
    assert(listeningOnly.spoken.some(parts=>parts.includes('u come uva')), 'the target vowel is spoken');
    assert.equal(await page.getByText('Guarda e ascolta',{exact:true}).count(),0);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'vocali-penalty.png')});
    // Race: M and L have their own recordings; a right letter overtakes, a calm mistake keeps the position.
    await page.goto(`${url}/games/corsa-delle-lettere.html`);
    const raceClips = await page.evaluate(()=>__gameEval(`(async()=> {
      ensureAudio(); await clipsReady;
      const originalVoice=voice, originalPlay=playClip, originalSay=sayText;
      const played=[], synthesized=[];
      voice=null; playClip=async key=>played.push(key); sayText=async text=>synthesized.push(text);
      try { speakSeq(['emme come mela']); await voiceChain; speakSeq(['L']); await voiceChain; return {played,synthesized,durations:['M','L'].map(v=>clipBuffers[v]?.duration||0)}; }
      finally { voice=originalVoice;playClip=originalPlay;sayText=originalSay; }
    })()`));
    assert.deepEqual(raceClips.played,['M','L']);
    assert.deepEqual(raceClips.synthesized,[]);
    assert(raceClips.durations.every(d=>d>1), 'M and L recordings must decode');
    await page.evaluate(()=>__gameEval("Learning.settings.vowels=['A','E','I','O','U']; data.consonants={M:true,L:true}"));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.key:not([hidden])').count(), 7);
    await page.evaluate(()=>__gameEval("Learning.settings.challenge=false; Learning.settings.vowels=['A','E','I','O','U']; data.consonants={M:true,L:true}; startRace(); askLetter(); round.v='M'; choose('A')"));
    assert.deepEqual(await page.evaluate(()=>__gameEval('[phase,race.pos]')), ['slip',8]);
    await page.evaluate(()=>__gameEval('update(1.1)'));
    assert.equal(await page.evaluate(()=>__gameEval('phase')), 'ask');
    await page.evaluate(()=>__gameEval("choose('M')"));
    assert.deepEqual(await page.evaluate(()=>__gameEval('[phase,race.pos,race.passes]')), ['pass',7,1]);
    // Calm mode never hurries: no timeout even after a long wait.
    await page.evaluate(()=>__gameEval('update(2); update(1.3); for(let i=0;i<60;i++) update(0.5)'));
    assert.deepEqual(await page.evaluate(()=>__gameEval('[phase,race.pos]')), ['ask',7]);
    // Challenge: a mistake lets a car overtake us.
    await page.evaluate(()=>__gameEval("Learning.settings.challenge=true; choose(round.v==='A'?'E':'A')"));
    assert.deepEqual(await page.evaluate(()=>__gameEval('[phase,race.pos]')), ['lost',8]);
    await page.evaluate(()=>__gameEval('Learning.settings.challenge=false; update(1.6)'));
    // Seven right answers win the race.
    const finished = await page.evaluate(()=>__gameEval(`
      for(let i=0;i<20 && phase!=='summary';i++){ if(phase==='ask') choose(round.v); for(let k=0;k<12;k++) update(0.4); }
      [phase,race.pos,data.cups>0]
    `));
    assert.deepEqual(finished, ['summary',1,true]);
    assert.equal(await page.locator('#ov-summary').isVisible(), true);
    // Single selected vowel remains playable in all games.
    for(const file of files.filter(f=>f!=='index.html')) {
      await page.goto(`${url}/${pagePath(file)}`);
      await page.evaluate(()=> {Learning.settings.vowels=['I'];});
      if(file==='parole-per-la-luna.html') assert(await page.evaluate(()=>__gameEval('level=1;pickTripWords().every(([w])=>w.includes("I"))')));
      else if(file==='caccia-alle-vocali.html') assert.equal(await page.evaluate(()=>__gameEval("mode='play';vowels=[];pickVowel()")), 'I');
      else if(file==='corsa-delle-lettere.html') {
        assert.equal(await page.evaluate(()=>__gameEval("data.consonants={M:false,L:false};pickLetter(null)")), 'I');
        assert.deepEqual(await page.evaluate(()=>__gameEval("data.consonants={M:true,L:true};[pickLetter(null),pickLetter(null),pickLetter(null)].sort().join('')")), 'ILM');
      }
      else assert.equal(await page.evaluate(()=>__gameEval('pickVowel()')), 'I');
    }
    await page.goto(`${url}/index.html`);
    await page.getByRole('button',{name:'Leggi',exact:true}).click();
    await page.getByRole('button',{name:'L’ha letta',exact:true}).click();
    await page.getByRole('button',{name:'Fine',exact:true}).click();
    await page.getByRole('button',{name:'Progressi',exact:true}).click();
    assert.equal(await page.locator('.learn-dialog tbody tr').count(),5);
    await page.getByRole('button',{name:'Chiudi',exact:true}).click();
    // Mobile layout and lesson dialog must remain within the viewport.
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Scrivi',exact:true}).click();
    assert(await page.locator('.learn-dialog').evaluate(d=> {const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'vocali-writing-mobile.png')});
    await page.getByRole('button',{name:'Chiudi',exact:true}).click();
    const savedProgress = await page.evaluate(()=>localStorage.getItem('vocali-learning-v1'));
    // A failed refresh remains retryable; a successful refresh preserves local progress.
    await page.route('**/games/learning.css*', route=>route.abort());
    await page.getByRole('button',{name:'Aggiorna giochi'}).click();
    await page.waitForFunction(()=>document.querySelector('#refresh-status').textContent.includes('Non riesco'));
    assert.equal(await page.getByRole('button',{name:'Aggiorna giochi'}).isEnabled(),true);
    await page.unroute('**/games/learning.css*');
    await page.getByRole('button',{name:'Aggiorna giochi'}).click();
    await page.waitForURL(/refresh=\d+/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('vocali-learning-v1')),savedProgress);
    assert(await page.locator('a.game').evaluateAll(links=>links.every(a=>new URL(a.href).searchParams.has('refresh'))));
    await page.locator('a.game').first().click();
    assert(await page.locator('a.home-link').evaluate(a=>new URL(a.href).searchParams.has('refresh')));
    assert.deepEqual(errors,[]);
    console.log('PASS: syntax, links, all 7 pages, calm retries, writing validation and reward, autonomous Luna, unlimited Caccia, goalkeeper, letter race, selected vowels, reading, progress, mobile layout.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode=1; });

