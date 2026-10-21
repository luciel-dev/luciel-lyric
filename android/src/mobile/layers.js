/* Video framing is its own layer. These edits never receive lyric lines. */
(function (G) {
  const ASPECTS = { "9:16": 1, "1:1": 1, "16:9": 1, "4:5": 1 };
  const FITS = { fit: 1, fill: 1, crop: 1 };

  function num(v, d) {
    const n = +v;
    return Number.isFinite(n) ? n : d;
  }
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function copyClip(c) {
    const speed = num(c && c.speed, 1);
    return {
      t0: Math.max(0, num(c && c.t0, 0)),
      t1: Math.max(0, num(c && c.t1, 0)),
      srcIn: Math.max(0, num(c && c.srcIn, 0)),
      speed: speed > 0 ? speed : 1,
    };
  }
  function readVideo(video) {
    const length = Math.max(0.25, num(video && video.length, 20));
    const aspect = ASPECTS[video && video.aspect] ? video.aspect : "9:16";
    const vfit = FITS[video && video.vfit] ? video.vfit : "fill";
    return {
      aspect: aspect,
      vfit: vfit,
      vscale: clamp(num(video && video.vscale, 1), 1, 2.5),
      vx: clamp(num(video && video.vx, 0.5), 0, 1),
      vy: clamp(num(video && video.vy, 0.5), 0, 1),
      videoName: video && typeof video.videoName === "string" ? video.videoName : "",
      length: length,
      clips: ((video && video.clips) || []).map(copyClip),
    };
  }

  function lyricStamp(lines, textStyle) {
    return JSON.stringify({
      textStyle: textStyle || null,
      lines: (lines || []).map((ln) => ({
        style: ln && ln.style ? ln.style : null,
        low_confidence: !!(ln && ln.low_confidence),
        words: ((ln && ln.words) || []).map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          low_confidence: !!w.low_confidence,
        })),
      })),
    });
  }

  function applyVideoEdit(video, edit) {
    const v = readVideo(video);
    const op = edit && edit.op;
    if (op === "aspect" && ASPECTS[edit.aspect]) v.aspect = edit.aspect;
    else if (op === "fit" && FITS[edit.fit]) v.vfit = edit.fit;
    else if (op === "zoom") v.vscale = clamp(num(edit.vscale, v.vscale), 1, 2.5);
    else if (op === "pan") {
      if (edit.vx != null) v.vx = clamp(num(edit.vx, v.vx), 0, 1);
      if (edit.vy != null) v.vy = clamp(num(edit.vy, v.vy), 0, 1);
    } else if (op === "trim") {
      const i = edit.index | 0;
      const c = v.clips[i];
      if (c) {
        const base = edit.base ? copyClip(edit.base) : copyClip(c);
        const speed = base.speed > 0 ? base.speed : 1;
        const dt = num(edit.dt, 0);
        if (edit.edge === "slip") c.srcIn = Math.max(0, base.srcIn - dt * speed);
        else if (edit.edge === "left") {
          const nt = Math.max(0, Math.min(base.t1 - 0.25, base.t0 + dt));
          c.t0 = nt;
          c.srcIn = Math.max(0, base.srcIn + (nt - base.t0) * speed);
          c.t1 = base.t1;
        } else if (edit.edge === "right") {
          c.t0 = base.t0;
          c.srcIn = base.srcIn;
          c.t1 = Math.max(base.t0 + 0.25, Math.min(v.length, base.t1 + dt));
        }
        c.speed = speed;
      }
    } else if (op === "shift") {
      const i = edit.index | 0;
      const c = v.clips[i];
      if (c) {
        const span = Math.max(0.25, c.t1 - c.t0);
        let t0 = c.t0 + num(edit.dt, 0);
        if (t0 < 0) t0 = 0;
        if (t0 + span > v.length) t0 = Math.max(0, v.length - span);
        c.t0 = t0;
        c.t1 = t0 + span;
      }
    } else if (op === "speed") {
      const i = edit.index | 0;
      const speed = num(edit.speed, 1);
      if (v.clips[i] && speed > 0) v.clips[i].speed = speed;
    } else if (op === "split") {
      const t = num(edit.t, 0);
      const i = v.clips.findIndex((c) => t > c.t0 + 0.12 && t < c.t1 - 0.12);
      if (i >= 0) {
        const c = v.clips[i];
        const speed = c.speed > 0 ? c.speed : 1;
        const left = { t0: c.t0, t1: t, srcIn: c.srcIn, speed: speed };
        const right = { t0: t, t1: c.t1, srcIn: c.srcIn + (t - c.t0) * speed, speed: speed };
        v.clips = v.clips.slice(0, i).concat([left, right], v.clips.slice(i + 1));
      }
    } else if (op === "delete") {
      const i = Math.max(0, edit.index | 0);
      if (v.clips.length) v.clips = v.clips.filter((_, idx) => idx !== i);
    } else if (op === "add") {
      const t0 = clamp(num(edit.t0, 0), 0, Math.max(0, v.length - 0.25));
      const t1 = Math.min(v.length, Math.max(t0 + 0.25, num(edit.t1, t0 + 3)));
      v.clips = v.clips.concat([{ t0: t0, t1: t1, srcIn: 0, speed: 1 }]);
    } else if (op === "swap") {
      v.videoName = typeof edit.name === "string" && edit.name ? edit.name : "video";
      v.clips = [{ t0: 0, t1: v.length, srcIn: 0, speed: 1 }];
    } else if (op === "clear") {
      v.videoName = "";
      v.clips = [];
    }
    return v;
  }

  // Resize, crop, trim, and swap. Ten edits, in this order.
  const VIDEO_EDITS = [
    { op: "aspect", aspect: "1:1" },
    { op: "aspect", aspect: "16:9" },
    { op: "aspect", aspect: "4:5" },
    { op: "fit", fit: "fit" },
    { op: "fit", fit: "crop" },
    { op: "zoom", vscale: 1.85 },
    { op: "pan", vx: 0.18, vy: 0.8 },
    { op: "trim", index: 0, edge: "left", dt: 1.2 },
    { op: "speed", index: 0, speed: 2 },
    { op: "swap", name: "second-take.mp4" },
  ];

  function runVideoEdits(video, lines, textStyle, edits) {
    const before = lyricStamp(lines, textStyle);
    let v = readVideo(video);
    const trace = [];
    (edits || VIDEO_EDITS).forEach((edit) => {
      v = applyVideoEdit(v, edit);
      trace.push({
        op: edit.op,
        aspect: v.aspect,
        vfit: v.vfit,
        vscale: v.vscale,
        t0: v.clips[0] ? v.clips[0].t0 : null,
        speed: v.clips[0] ? v.clips[0].speed : null,
        videoName: v.videoName,
      });
      if (lyricStamp(lines, textStyle) !== before) {
        throw new Error("video edit changed lyric text");
      }
    });
    return { video: v, trace: trace, stamp: before };
  }

  G.LucielLayers = {
    lyricStamp: lyricStamp,
    applyVideoEdit: applyVideoEdit,
    runVideoEdits: runVideoEdits,
    VIDEO_EDITS: VIDEO_EDITS,
  };
})(typeof window !== "undefined" ? window : globalThis);
