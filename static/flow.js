/* Guided steps, undo, shortcuts, tour, and friendly errors. */
(() => {
  const STEPS = [1, 2, 3, 4, 5];
  let step = 1;
  const hist = [];
  let cursor = -1;
  let mute = false;
  let timer = 0;

  function snap() {
    const E = window.ED && ED.state ? ED.state() : {};
    return JSON.stringify({
      lines: S.lines,
      start: S.start,
      len: S.len,
      lyrics: $('#lyricsIn') ? $('#lyricsIn').value : '',
      place: E.place || null,
      clips: (E.clips || []).map(c => ({id: c.id, videoId: c.videoId, name: c.name, duration: c.duration, in: c.in, out: c.out, start: c.start, url: c.url, thumbs: c.thumbs})),
      overlays: E.overlays || [],
      styleOv: E.styleOv || {},
      aspect: $('#aspectIn') ? $('#aspectIn').value : '9:16',
      skipped: !!(ED.videoSkipped && ED.videoSkipped()),
    });
  }
  function apply(raw) {
    const d = JSON.parse(raw);
    mute = true;
    S.lines = d.lines || [];
    S.start = d.start || 0;
    S.len = d.len || 20;
    if ($('#lyricsIn')) $('#lyricsIn').value = d.lyrics || '';
    if ($('#startIn')) $('#startIn').value = (+S.start).toFixed(1);
    if ($('#lenIn')) { $('#lenIn').value = S.len; $('#lenVal').textContent = S.len; }
    if ($('#aspectIn') && d.aspect) $('#aspectIn').value = d.aspect;
    if (window.ED && ED.restore) ED.restore(d);
    if (typeof renderLines === 'function') renderLines();
    if (typeof drawWave === 'function') drawWave();
    if (typeof updateStage === 'function') updateStage();
    mute = false;
    hints();
  }
  function capture() {
    if (mute) return;
    const s = snap();
    if (hist[cursor] === s) return;
    hist.splice(cursor + 1);
    hist.push(s);
    if (hist.length > 80) hist.shift();
    cursor = hist.length - 1;
    try { localStorage.setItem('lc-draft', s); } catch (e) {}
    paintHist();
  }
  function touch() {
    clearTimeout(timer);
    timer = setTimeout(capture, 280);
  }
  function undo() {
    if (cursor <= 0) return;
    cursor -= 1;
    apply(hist[cursor]);
    paintHist();
  }
  function redo() {
    if (cursor >= hist.length - 1) return;
    cursor += 1;
    apply(hist[cursor]);
    paintHist();
  }
  function paintHist() {
    const u = $('#btnUndo'), r = $('#btnRedo');
    if (u) u.disabled = cursor <= 0;
    if (r) r.disabled = cursor >= hist.length - 1;
  }

  function ready(n) {
    if (n === 1) return !!S.audio;
    if (n === 2) return !!(S.lines && S.lines.length);
    if (n === 3) return !!(window.ED && ((ED.clipCount && ED.clipCount() > 0) || (ED.videoSkipped && ED.videoSkipped())));
    if (n === 4) return !!(S.lines && S.lines.length);
    return true;
  }
  const hintText = {
    1: () => S.audio ? 'Song loaded. Continue to sync the words.' : 'Drop an mp3, wav, or m4a.',
    2: () => (S.lines && S.lines.length) ? 'Words are synced and locked. Continue when the times look right.' : 'Paste lyrics or let the computer listen.',
    3: () => ready(3) ? 'Video is set. Lyric text in the preview stays read-only.' : 'Add a video, or continue with a gradient background.',
    4: () => 'Edit the words, then set the look. Times stay on Sync.',
    5: () => 'Pick a 15–30 second section, then export.',
  };
  function hints() {
    STEPS.forEach(i => {
      const el = document.getElementById('hint' + i);
      const text = hintText[i]();
      if (el && i === step) el.textContent = text;
      const b = document.getElementById('next' + i);
      if (!b) return;
      const ok = ready(i);
      b.disabled = !ok;
      b.title = ok ? 'Continue' : text;
    });
    if (window.LCTheme && LCTheme.refresh) LCTheme.refresh();
  }
  function show(n) {
    n = Math.max(1, Math.min(5, n));
    if (n > 1 && !ready(n - 1) && n > step) return;
    step = n;
    STEPS.forEach(i => {
      const el = document.getElementById('step' + i);
      if (el) el.classList.toggle('step-off', i !== n);
    });
    const dock = $('#dock');
    const main = document.querySelector('main');
    const on = n >= 2;
    if (dock) dock.classList.toggle('step-off', !on);
    if (main) main.classList.toggle('nodock', !on);
    const ws = $('#wsWrap'), vt = $('#videoTl'), tt = $('#textTl');
    if (ws) ws.classList.toggle('step-off', n !== 2);
    if (vt) vt.classList.toggle('step-off', n !== 3);
    if (tt) tt.classList.toggle('step-off', n !== 4);
    const handle = $('#vidHandle');
    if (handle) handle.classList.toggle('on', n === 3 && S.bgMode === 'video');
    if (window.ED && ED.onStep) ED.onStep(n);
    if (n === 5 && typeof drawWave === 'function') drawWave();
    hints();
    window.scrollTo(0, 0);
  }
  function fail(message, fixStep, fixLabel) {
    let box = document.getElementById('toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast';
      box.className = 'syncbanner bad';
      box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:50;max-width:560px';
      document.body.appendChild(box);
    }
    box.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    if (fixStep) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary';
      b.textContent = fixLabel || 'Fix this';
      b.onclick = () => { box.remove(); show(fixStep); };
      box.appendChild(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn ghost';
    close.textContent = 'Close';
    close.onclick = () => box.remove();
    box.appendChild(close);
  }

  function typing(el) {
    const tag = (el && el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable);
  }
  function shuttle(dir) {
    if (!S.audio) return;
    const audio = $('#audio');
    if (dir === 0) { if (typeof stopPlay === 'function') stopPlay(); return; }
    const t = Math.max(S.start, Math.min(S.start + S.len - 0.05, audio.currentTime + dir));
    audio.currentTime = t;
    if (audio.paused && typeof playClip === 'function') playClip(true, $('#stagePlay'), t - S.start);
  }

  const tour = [
    ['Drop the song', 'Step 1 is only the audio file. Drag it onto the big box.'],
    ['Sync the words', 'Paste lyrics or let the computer listen. Lock, tap, and nudge live only on this step.'],
    ['Edit the video', 'Upload a clip, then resize it in the preview. Extra titles go on their own track. Lyrics stay read-only.'],
    ['Style the lyrics', 'Edit the words, then the font and colours. Times do not move.'],
    ['Export', 'Pick a 15–30 second section and render. Press ? any time for shortcuts.'],
  ];
  let tourI = 0;
  function paintTour() {
    $('#tourTitle').textContent = tour[tourI][0];
    $('#tourBody').textContent = tour[tourI][1];
    $('#tourNext').textContent = tourI === tour.length - 1 ? 'Done' : 'Next';
  }
  function closeTour() {
    $('#tour').classList.add('hidden');
    try { localStorage.setItem('lc-tour-skip', '1'); } catch (e) {}
  }

  document.querySelectorAll('#stepper a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    show(+a.dataset.step);
  }));
  STEPS.forEach(i => {
    const b = document.getElementById('next' + i);
    if (b) b.onclick = () => { if (ready(i)) show(i + 1); else hints(); };
  });
  const skip = $('#skipVideo');
  if (skip) skip.onclick = () => {
    if (window.ED && ED.skipVideo) ED.skipVideo();
    if (S.bgMode === 'video' && typeof setBgMode === 'function') setBgMode('gradient');
    hints();
    show(4);
  };
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnHelp').onclick = () => $('#helpOverlay').classList.remove('hidden');
  $('#helpClose').onclick = () => $('#helpOverlay').classList.add('hidden');
  $('#tourSkip').onclick = closeTour;
  $('#tourNext').onclick = () => { if (tourI >= tour.length - 1) closeTour(); else { tourI += 1; paintTour(); } };

  document.addEventListener('keydown', e => {
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      if (typing(document.activeElement)) return;
      e.preventDefault();
      $('#helpOverlay').classList.toggle('hidden');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing(document.activeElement)) return;
    if (e.key === 'j' || e.key === 'J') { e.preventDefault(); shuttle(-1); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); shuttle(0); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); shuttle(1); }
    else if ((e.key === 's' || e.key === 'S') && step === 3 && window.ED && ED.splitAtPlayhead) { e.preventDefault(); ED.splitAtPlayhead(); }
  });

  addEventListener('lc:audio', () => { hints(); capture(); });
  addEventListener('lc:sync-done', () => { hints(); capture(); });
  addEventListener('lc:render-done', () => hints());

  window.LCFlow = {show, step: () => step, hints, fail, ready};
  window.LCHist = {capture, touch, undo, redo};
  show(1);
  capture();
  let skipped = false;
  try { skipped = localStorage.getItem('lc-tour-skip') === '1'; } catch (e) {}
  if (!skipped) { tourI = 0; paintTour(); $('#tour').classList.remove('hidden'); }
})();
