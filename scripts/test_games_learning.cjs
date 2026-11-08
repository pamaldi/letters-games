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
const numberGames = ['conta-le-meteore.html', 'fiori-dei-numeri.html', 'palloncini-dei-colori.html', 'palloncini-dei-numeri.html'];
const vowelGames = files.filter(f => !numberGames.includes(f));
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
    for (const file of vowelGames) {
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
    // Numbers: Bolt counts the meteors aloud with recorded English clips, then the child taps the number.
    await page.goto(`${url}/games/conta-le-meteore.html`);
    assert.equal(await page.locator('.home-link').getAttribute('href'), '../index.html?v=20261025-come-2');
    assert.equal(await page.locator('.num').count(), 10);
    const numberClips = await page.evaluate(()=>__gameEval(`(async()=>{ensureAudio(); await clipsReady; return Object.keys(CLIPS).map(k=>[k,clipBuffers[k]?.duration||0]);})()`));
    assert.equal(numberClips.length, 19);
    assert(numberClips.every(([,d])=>d>0.3), 'every English clip must decode: '+JSON.stringify(numberClips));
    await page.evaluate(()=>__gameEval("speed=0; window.__played=[]; playClip=async k=>{__played.push(k);}; setVoiceMode(false);"));
    await page.getByRole('button',{name:'▶ Inizia'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask'"));
    const first = await page.evaluate(()=>__gameEval("({target,order:[...order],played:[...__played],meteors:meteors.length,counted:document.querySelectorAll('.meteor.counted').length})"));
    assert.deepEqual([...first.order].sort((a,b)=>a-b), [1,2,3,4,5,6,7,8,9,10]);
    assert.equal(first.meteors, first.target); assert.equal(first.counted, first.target);
    const t = first.target, counted = Array.from({length:t},(_,i)=>'n'+(i+1));
    assert.deepEqual(first.played, ['hello','count',...counted,'n'+t,t===1?'meteorite':'meteorites','find','n'+t]);
    // A wrong number bonks Bolt but keeps the round and the progress.
    await page.evaluate(t=>__gameEval(`__played.length=0; choose(${t===10?1:t+1})`), t);
    assert.deepEqual(await page.evaluate(()=>__gameEval("[phase,roundIdx,[...__played]]")), ['ask',0,['oops','find','n'+t]]);
    assert.equal(await page.evaluate(()=>document.getElementById('bolt').classList.contains('dizzy')), true);
    // The right number says "Great job!", then only the number ("five"): the child draws that many balls.
    await page.evaluate(()=>__gameEval("__played.length=0; choose(target)"));
    await page.waitForFunction(()=>__gameEval("phase==='draw'"));
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['great','n'+t]);
    assert.equal(await page.locator('#board').isVisible(), true);
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.click(box.x+30, box.y+30);   // a dot is not a ball
    assert.equal(await page.evaluate(()=>__gameEval('balls.length')), 0);
    for (let b = 0; b < t; b++) {
      const cx = box.x + 70 + (b % 5) * 110, cy = box.y + 80 + Math.floor(b / 5) * 120;
      await page.mouse.move(cx + 35, cy); await page.mouse.down();
      for (let a = 1; a <= 16; a++) await page.mouse.move(cx + 35*Math.cos(a*Math.PI/8), cy + 35*Math.sin(a*Math.PI/8));
      await page.mouse.up();
    }
    await page.waitForFunction(()=>__gameEval("__played.includes('hero')"));
    assert.equal(await page.locator('#slots i.on').count(), t);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'meteore-draw.png')});
    // Ten rounds (count, tap, draw) finish the mission.
    for (let r = 1; r < 10; r++) {
      await page.waitForFunction(r=>__gameEval(`phase==='ask' && roundIdx===${r}`), r);
      await page.evaluate(()=>__gameEval("choose(target)"));
      await page.waitForFunction(()=>__gameEval("phase==='draw'"));
      await page.evaluate(()=>__gameEval("for(let i=0;i<target;i++) endStroke(Array.from({length:12},(_,a)=>({x:100+40*Math.cos(a/2),y:100+40*Math.sin(a/2)})))"));
    }
    await page.waitForFunction(()=>__gameEval("phase==='done'"));
    assert.equal(await page.locator('#ov-win').isVisible(), true);
    assert.equal(await page.locator('.stars span.on').count(), 10);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'↻ Gioca ancora'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask'")); await page.waitForTimeout(1500);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.getElementById('pad').getBoundingClientRect().bottom<=innerHeight));
    assert(await page.evaluate(()=>[...document.querySelectorAll('.meteor')].every(m=>{const r=m.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})));
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'meteore-mobile.png')});
    await page.setViewportSize({width:1100,height:850});
    // Meteors, voice mode: the child counts aloud and Bolt zaps a meteor for each right number.
    await page.goto(`${url}/games/conta-le-meteore.html`);
    await page.evaluate(()=>__gameEval(`speed=0; window.__played=[]; playClip=async k=>{__played.push(k);};
      Recognition=class { start(){} abort(){} }; shuffle=()=>[4,1,2,3,5,6,7,8,9,10]; setVoiceMode(true);`));
    await page.getByRole('button',{name:'▶ Inizia'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='count' && rec!==null"));
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['hello','count']);
    assert.equal(await page.locator('#count-voice').isVisible(), true);
    await page.evaluate(()=>__gameEval("handleCount([{transcript:'one two',isFinal:false}])"));
    assert.equal(await page.locator('.meteor.counted').count(), 2);
    await page.evaluate(()=>__gameEval("__played.length=0; handleCount([{transcript:'one two four',isFinal:true}])"));
    assert.equal(await page.locator('.meteor.counted').count(), 2);
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['oops','n3']);
    await page.waitForFunction(()=>__gameEval("rec!==null"));
    await page.getByRole('button',{name:/Ha detto «three»/}).click();
    await page.evaluate(()=>__gameEval("handleCount([{transcript:'for',isFinal:true}])"));
    await page.waitForFunction(()=>__gameEval("phase==='ask'"));
    assert.equal(await page.locator('.meteor.counted').count(), 4);
    assert.equal(await page.locator('#count-voice').isVisible(), false);
    assert(await page.evaluate(()=>__gameEval("__played.join(' ').endsWith('n4 meteorites find n4')")));
    // Number flowers: the child counts aloud (fake recogniser), each right number colours a flower; then says the pair.
    await page.goto(`${url}/games/fiori-dei-numeri.html`);
    assert.equal(await page.locator('.home-link').getAttribute('href'), '../index.html?v=20261025-come-2');
    const flowerClips = await page.evaluate(()=>__gameEval(`(async()=>{ensureAudio(); await clipsReady; return Object.keys(CLIPS).map(k=>[k,clipBuffers[k]?.duration||0]);})()`));
    assert.equal(flowerClips.length, 25);
    assert(flowerClips.every(([,d])=>d>0.3), 'every flower clip must decode: '+JSON.stringify(flowerClips));
    await page.evaluate(()=>__gameEval(`speed=0; window.__played=[]; playClip=async k=>{__played.push(k);}; listen=()=>{};
      window.__recs=0; Recognition=class { start(){ __recs++; } abort(){} };
      shuffle=()=>[5,1,2,3,4,6,7,8,9,10]; setVoiceMode(true); HOLD_MS=400;`));
    await page.getByRole('button',{name:'▶ Inizia'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='colour' && __played.length>=2 && rec"));
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['hello','ask5']);
    assert.equal(await page.locator('#count-voice').isVisible(), true);
    await page.locator('.flower').first().click();            // in voice mode a tap does not colour
    assert.equal(await page.locator('.flower.on').count(), 0);
    await page.evaluate(()=>__gameEval("__played.length=0; handleCount([{transcript:'one',isFinal:false}])"));
    await page.evaluate(()=>__gameEval("handleCount([{transcript:'one to',isFinal:false}])"));   // homophone of two, interim
    assert.equal(await page.locator('.flower.on').count(), 2);
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), [], 'no English numbers while counting');
    await page.evaluate(()=>__gameEval("handleCount([{transcript:'one to four',isFinal:true}])"));   // skipped three
    assert.equal(await page.locator('.flower.on').count(), 2);
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['again']);
    assert(await page.locator('#count-heard').evaluate(e=>e.classList.contains('bad')));
    await page.waitForFunction(()=>__gameEval("rec!==null"));    // listening again after the correction
    await page.evaluate(()=>__gameEval("handleCount([{transcript:'3 4',isFinal:true}])"));
    assert.equal(await page.locator('.flower.on').count(), 4);
    await page.getByRole('button',{name:/Ha detto «five»/}).click();   // adult fallback for a missed word
    // Five reached: the row stays open; going on to "six" is a mistake and the row starts again.
    await page.waitForFunction(()=>__gameEval("rec!==null"));
    assert.equal(await page.evaluate(()=>__gameEval("phase")), 'colour');
    await page.evaluate(()=>__gameEval("__played.length=0; consumed=[]; handleCount([{transcript:'six',isFinal:false}])"));
    assert.equal(await page.locator('.flower.on').count(), 0);
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['again']);
    assert.match(await page.locator('#prompt').textContent(), /Erano 5/);
    await page.waitForFunction(()=>__gameEval("rec!==null"));
    await page.evaluate(()=>__gameEval("__played.length=0; handleCount([{transcript:'one two three four five',isFinal:true}])"));
    assert.equal(await page.locator('.flower.on').count(), 5);
    assert.equal(await page.evaluate(()=>__gameEval("phase")), 'colour');
    await page.waitForFunction(()=>!document.getElementById('say').hidden && __played.includes('sayit'));
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['pair5','sayit']);
    assert.equal(await page.locator('.flower.on').count(), 5);
    assert.equal(await page.locator('#mini .mini-row.now i.on').count(), 5);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'fiori-say.png')});
    assert.equal(await page.evaluate(()=>__gameEval("heard(['five red'])")), false);
    assert(await page.evaluate(()=>__gameEval("__played.includes('again') && phase==='say'")));
    assert.equal(await page.evaluate(()=>__gameEval("heard(['I think five green'])")), true);
    await page.waitForFunction(()=>__gameEval("__played.includes('hero')"));
    // Round two in tap mode: the parent switches the microphone off.
    await page.waitForFunction(()=>__gameEval("phase==='colour' && roundIdx===1"));
    await page.locator('#voice-mode').click();
    assert.equal(await page.locator('#count-voice').isVisible(), false);
    await page.locator('.flower').first().click();
    await page.waitForFunction(()=>__gameEval("phase==='say'"));
    await page.locator('.flower').nth(9).click({force:true});   // an extra flower does nothing
    assert.equal(await page.locator('.flower.on').count(), 1);
    await page.waitForFunction(()=>!document.getElementById('say').hidden);
    await page.getByRole('button',{name:'✓ L\'ha detto'}).click();
    for (let r = 2; r < 10; r++) {
      await page.waitForFunction(r=>__gameEval(`phase==='colour' && roundIdx===${r}`), r);
      await page.evaluate(()=>__gameEval("[...document.querySelectorAll('.flower')].slice(0,target).forEach(f=>f.click())"));
      await page.waitForFunction(()=>__gameEval("phase==='say' && !document.getElementById('say').hidden"));
      await page.getByRole('button',{name:'✓ L\'ha detto'}).click();
    }
    await page.waitForFunction(()=>__gameEval("phase==='done'"));
    assert.equal(await page.locator('#ov-win').isVisible(), true);
    assert.equal(await page.locator('#mini .mini-row.done').count(), 10);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>__gameEval("setVoiceMode(true)"));
    await page.getByRole('button',{name:'↻ Gioca ancora'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='colour' && __played.at(-1)==='ask5'"));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.flower, #count-adult')].every(f=>{const r=f.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})));
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'fiori-mobile.png')});
    await page.setViewportSize({width:1100,height:850});
    // Colour balloons: the voice names a colour, the child pops that balloon.
    await page.goto(`${url}/games/palloncini-dei-colori.html`);
    assert.equal(await page.locator('.home-link').getAttribute('href'), '../index.html?v=20261025-come-2');
    const balloonClips = await page.evaluate(()=>__gameEval(`(async()=>{ensureAudio(); await clipsReady; return Object.keys(CLIPS).map(k=>[k,clipBuffers[k]?.duration||0]);})()`));
    assert.equal(balloonClips.length, 15);
    assert(balloonClips.every(([,d])=>d>0.3), 'every balloon clip must decode: '+JSON.stringify(balloonClips));
    await page.evaluate(()=>__gameEval("speed=0; window.__played=[]; playClip=async k=>{__played.push(k);};"));
    await page.getByRole('button',{name:'▶ Inizia'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask' && __played.length>=2"));
    const bl = await page.evaluate(()=>__gameEval("({target,order:[...order],played:[...__played]})"));
    assert.deepEqual([...bl.order].sort(), ['black','blue','brown','green','orange','pink','purple','red','white','yellow']);
    assert.deepEqual(bl.played, ['hello','pop_'+bl.target]);
    assert.equal(await page.locator('.balloon').count(), 3);
    assert.equal(await page.locator(`.balloon[data-item="${bl.target}"]`).count(), 1);
    await page.evaluate(()=>__gameEval("__played.length=0"));
    await page.locator(`.balloon:not([data-item="${bl.target}"])`).first().click({force:true});
    assert.deepEqual(await page.evaluate(()=>__gameEval("[phase,[...__played]]")), ['ask',['oops','pop_'+bl.target]]);
    await page.evaluate(()=>__gameEval("__played.length=0"));
    await page.locator(`.balloon[data-item="${bl.target}"]`).click({force:true});
    assert.equal(await page.evaluate(()=>__gameEval("__played[0]")), 'great');
    assert.equal(await page.locator('#word').textContent(), bl.target);
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'palloncini.png')});
    for (let r = 1; r < 10; r++) {
      await page.waitForFunction(r=>__gameEval(`phase==='ask' && roundIdx===${r}`), r);
      assert.equal(await page.locator('.balloon').count(), r < 3 ? 3 : r < 6 ? 4 : 5);
      await page.evaluate(()=>__gameEval("document.querySelector(`.balloon[data-item='${target}']`).click()"));
    }
    await page.waitForFunction(()=>__gameEval("phase==='done' && __played.includes('hero')"));
    assert.equal(await page.locator('#ov-win').isVisible(), true);
    assert.equal(await page.locator('.progress span.on').count(), 10);
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'↻ Gioca ancora'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask'")); await page.waitForTimeout(1000);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.balloon')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;})));
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'palloncini-mobile.png')});
    await page.setViewportSize({width:1100,height:850});
    // Number balloons: the voice says "Find five balloons!", the child counts and taps the bunch of five.
    await page.goto(`${url}/games/palloncini-dei-numeri.html`);
    const numBalloonClips = await page.evaluate(()=>__gameEval(`(async()=>{ensureAudio(); await clipsReady; return Object.keys(CLIPS).map(k=>[k,clipBuffers[k]?.duration||0]);})()`));
    assert.equal(numBalloonClips.length, 15);
    assert(numBalloonClips.every(([,d])=>d>0.3));
    await page.evaluate(()=>__gameEval("speed=0; window.__played=[]; playClip=async k=>{__played.push(k);};"));
    await page.getByRole('button',{name:'▶ Inizia'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask' && __played.length>=2"));
    const nb = await page.evaluate(()=>__gameEval("({target,order:[...order],played:[...__played]})"));
    assert.deepEqual([...nb.order].sort((a,b)=>a-b), [1,2,3,4,5,6,7,8,9,10]);
    assert.deepEqual(nb.played, ['hello','findb'+nb.target]);
    assert.equal(await page.locator('.bunch').count(), 2);
    assert.equal(await page.locator(`.bunch[data-item="${nb.target}"] .mini-balloon`).count(), nb.target);
    assert(await page.evaluate(t=>[...document.querySelectorAll('.bunch')].every(b=>b.dataset.item==t||Math.abs(b.dataset.item-t)>=2), nb.target), 'early rounds: clearly different bunches');
    await page.evaluate(()=>__gameEval("__played.length=0"));
    await page.locator(`.bunch:not([data-item="${nb.target}"])`).first().click({force:true});
    assert.deepEqual(await page.evaluate(()=>__gameEval("[...__played]")), ['oops','findb'+nb.target]);
    await page.evaluate(()=>__gameEval("speed=1"));
    await page.locator(`.bunch[data-item="${nb.target}"]`).click({force:true});
    await page.waitForFunction(()=>document.getElementById('word').classList.contains('show'));
    assert.equal(await page.locator('.bunch.chosen .mini-balloon.counted').count(), nb.target);
    await page.evaluate(()=>__gameEval("speed=0"));
    assert.equal(await page.locator('#word').textContent(), nb.target+' '+['one','two','three','four','five','six','seven','eight','nine','ten'][nb.target-1]);
    for (let r = 1; r < 10; r++) {
      await page.waitForFunction(r=>__gameEval(`phase==='ask' && roundIdx===${r}`), r);
      await page.evaluate(()=>__gameEval("document.querySelector(`.bunch[data-item='${target}']`).click()"));
    }
    await page.waitForFunction(()=>__gameEval("phase==='done' && __played.includes('hero')"));
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'↻ Gioca ancora'}).click();
    await page.waitForFunction(()=>__gameEval("phase==='ask'")); await page.waitForTimeout(1000);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.bunch')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})));
    await page.screenshot({path:path.join(require('node:os').tmpdir(),'palloncini-numeri-mobile.png')});
    await page.setViewportSize({width:1100,height:850});
    // Single selected vowel remains playable in all games.
    for(const file of vowelGames.filter(f=>f!=='index.html')) {
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
    console.log('PASS: syntax, links, all 11 pages, calm retries, writing validation and reward, autonomous Luna, unlimited Caccia, goalkeeper, letter race, meteor counting (aloud or by Bolt) and drawing, number flowers counted aloud, colour and number balloons, selected vowels, reading, progress, mobile layout.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode=1; });

