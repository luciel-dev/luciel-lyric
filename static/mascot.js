/* Chibi angel mascot. Follows mascot/manifest.json:
   - default: idle still
   - onEvent: play the mapped dance reaction exactly once, then return to idle; ignore new events while one is
     playing unless the new one has higher priority (manifest "behavior").
   App events -> manifest events: sync done = task_finished (mid), render done = big_win (fast),
   font uploaded = message_liked (slow). Emote stills are used for moods (surprised, crying, confused...).
   Two user-requested extras: a dance loop while the clip preview is playing, and sleepy emotes after
   inactivity (the manifest says reactions are never timer-driven, so inactivity only swaps the *still*). */
(() => {
  const el = document.getElementById('mascot'), img = document.getElementById('mascotImg'),
        vid = document.getElementById('mascotVid'), bubble = document.getElementById('mascotBubble'),
        toggle = document.getElementById('mascotToggle');
  const BASE = '/mascot/';
  const PRIO = {idle: 0, emote: 1, preview: 2, message_liked: 2, task_finished: 3, big_win: 4, error: 5};
  let manifest = null, state = {kind: 'idle', prio: 0}, bubbleT = 0, emoteT = 0, idleT = 0, sleepT = 0, deepT = 0;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);   // no VP9-alpha in Safari
  const KEY = 'lc-mascot-hidden';

  fetch(BASE + 'manifest.json').then(r => r.json()).then(m => { manifest = m; }).catch(() => {});
  // preload stills
  ['idle', 'happy', 'surprised', 'crying', 'confused', 'music', 'flying', 'love', 'sleepy', 'cloud-sleep', 'shy', 'smug']
    .forEach(n => { const i = new Image(); i.src = n === 'idle' ? BASE + 'idle.webp' : BASE + `emote-${n}.webp`; });

  function placeBubble() {
    const pad = 8;
    bubble.style.marginRight = '0px';
    bubble.style.marginBottom = '0px';
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let rect = bubble.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    let shiftX = 0;
    if (rect.right > vw - pad) shiftX += rect.right - (vw - pad);
    if (rect.left - shiftX < pad) shiftX -= pad - (rect.left - shiftX);
    if (rect.right - shiftX > vw - pad) shiftX += rect.right - shiftX - (vw - pad);
    if (shiftX) bubble.style.marginRight = shiftX.toFixed(1) + 'px';
    rect = bubble.getBoundingClientRect();
    let shiftY = 0;
    if (rect.top < pad) shiftY = rect.top - pad;
    if (rect.bottom - shiftY > vh - pad) shiftY += rect.bottom - shiftY - (vh - pad);
    if (shiftY) bubble.style.marginBottom = shiftY.toFixed(1) + 'px';
  }
  function say(text, ms = 3200) {
    if (!text) return;
    bubble.textContent = text; bubble.classList.add('show');
    placeBubble();
    requestAnimationFrame(placeBubble);
    clearTimeout(bubbleT); bubbleT = setTimeout(() => bubble.classList.remove('show'), ms);
  }
  function still(name) {
    const src = name === 'idle' ? BASE + 'idle.webp' : BASE + `emote-${name}.webp`;
    if (!img.src.endsWith(src)) { img.src = src; img.classList.remove('pop'); void img.offsetWidth; img.classList.add('pop'); }
    el.classList.toggle('idle', name === 'idle');
  }
  function stopVideo() { vid.pause(); vid.removeAttribute('src'); vid.load(); el.classList.remove('playing'); vid.onended = null; }
  function toIdle() { clearTimeout(emoteT); stopVideo(); state = {kind: 'idle', prio: 0}; still('idle'); }
  function canTake(p) { return p >= state.prio || state.kind === 'idle'; }

  function emote(name, text, ms = 2800, prio = PRIO.emote) {
    if (!canTake(prio)) return;
    clearTimeout(emoteT); stopVideo();
    state = {kind: 'emote', prio}; still(name); say(text);
    if (ms) emoteT = setTimeout(toIdle, ms);
  }
  function tempoFor(evt) {
    const map = manifest?.behavior?.events || {message_liked: 'slow', task_finished: 'mid', big_win: 'fast'};
    return map[evt] || 'mid';
  }
  function dance(evtOrTempo, {loop = false, prio, text, after} = {}) {
    const tempo = ['slow', 'mid', 'fast'].includes(evtOrTempo) ? evtOrTempo : tempoFor(evtOrTempo);
    prio = prio ?? PRIO[evtOrTempo] ?? 2;
    if (!canTake(prio)) return;
    clearTimeout(emoteT);
    state = {kind: loop ? 'preview' : 'reaction', prio};
    if (text) say(text);
    if (isSafari) {            // animated WebP fallback (alpha everywhere); play ~one loop
      still('idle'); img.src = BASE + `dance-${tempo}.webp`; el.classList.remove('idle');
      if (!loop) emoteT = setTimeout(() => { state = {kind: 'idle', prio: 0}; after ? after() : toIdle(); }, 6000);
      return;
    }
    vid.loop = loop; vid.src = BASE + `dance-${tempo}.webm`;
    vid.onended = () => { state = {kind: 'idle', prio: 0}; after ? after() : toIdle(); };
    vid.play().then(() => el.classList.add('playing')).catch(() => { el.classList.remove('playing'); toIdle(); });
  }

  // ---- app events ----
  const on = (n, f) => addEventListener('lc:' + n, e => { wake(); f(e.detail || {}); });
  on('audio', d => emote('surprised', `Ooh, “${(d.name || 'a new track').replace(/\.[^.]+$/, '')}”! Pick a 15–30 s part.`, 3200));
  on('sync-start', () => emote('music', 'Listening closely… 🎧', 0, PRIO.task_finished));
  on('sync-done', d => {
    state.prio = 0;
    if (d.ok === false) { emote('confused', 'These timings need a check.', 4000, PRIO.error); return; }
    const n = d.stats && (d.stats.ref_words_used || d.stats.hyp_words);
    dance('task_finished', {prio: PRIO.task_finished, text: n ? `Synced ${n} words.` : 'Lyrics synced.',
                         after: () => emote('happy', '', 2200)});
  });
  on('render-start', () => emote('flying', 'Rendering your video…', 0, PRIO.big_win));
  on('render-done', () => { state.prio = 0; dance('big_win', {prio: PRIO.big_win, text: 'It’s ready! ⬇ Download it 🎉', after: () => emote('love', '', 2500)}); });
  on('error', d => { state.prio = 0; d.where === 'render' || d.where === 'sync' ? emote('crying', 'Oh no, something went wrong…', 4500, PRIO.error)
                                                                   : emote('confused', 'Hmm, that file didn’t work?', 3500, PRIO.error); });
  on('play', () => dance('slow', {loop: true, prio: PRIO.preview, text: Math.random() < .5 ? '♪ ♫' : 'This part slaps!'}));
  on('stop', () => { if (state.kind === 'preview') toIdle(); });
  on('font', d => dance('message_liked', {prio: PRIO.message_liked, text: `New font: ${d.family}! 💕`}));
  on('bgvideo', () => emote('happy', 'Nice clip! Lyrics go on top.', 2600));
  on('theme', d => { if (el.dataset.ready) emote(d === 'winamp' ? 'smug' : d === 'y2k' ? 'love' : 'shy', d === 'winamp' ? 'It really whips the llama’s… 🦙' : d === 'y2k' ? 'Link established. Jacked in.' : 'So glossy~', 2000); });

  // click = say hi
  const hi = [['happy', 'Hi! I’m the Luciel Lyric angel 👼'], ['shy', 'Eh? You poked me…'], ['smug', 'Your video’s gonna look great.'], ['love', '💕']];
  document.getElementById('mascotBody').addEventListener('click', () => { wake(); const [e, t] = hi[Math.floor(Math.random() * hi.length)]; emote(e, t, 2400); });

  // inactivity -> sleepy still (after 90 s), deeper sleep after 3 min; any input wakes her up
  function wake() {
    clearTimeout(sleepT); clearTimeout(deepT);
    if (state.kind === 'sleep') toIdle();
    sleepT = setTimeout(() => { if (state.kind === 'idle') { state = {kind: 'sleep', prio: 0}; still('sleepy'); say('zzz…', 2500); } }, 90000);
    deepT = setTimeout(() => { if (state.kind === 'sleep') still('cloud-sleep'); }, 180000);
  }
  ['pointerdown', 'keydown', 'wheel'].forEach(t => addEventListener(t, () => { if (state.kind === 'sleep') { toIdle(); } wake(); }, {passive: true}));

  // hide / show
  function setHidden(h) {
    el.classList.toggle('off', h); toggle.querySelector('span').textContent = h ? 'Show' : 'Hide';
    try { localStorage.setItem(KEY, h ? '1' : '0'); } catch (e) {}
    if (h) stopVideo();
  }
  document.getElementById('mascotClose').addEventListener('click', e => { e.stopPropagation(); setHidden(true); });
  toggle.addEventListener('click', () => setHidden(!el.classList.contains('off')));
  let hidden = false; try { hidden = localStorage.getItem(KEY) === '1'; } catch (e) {}
  setHidden(hidden);
  toIdle(); wake();
  setTimeout(() => { el.dataset.ready = '1'; if (!hidden) say('Welcome to Luciel Lyric ✨ Drop a song to start!', 3800); }, 600);
  addEventListener('resize', () => { if (bubble.classList.contains('show')) placeBubble(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (bubble.classList.contains('show')) placeBubble(); });
  window.Mascot = {emote, dance, say, idle: toIdle};
})();
