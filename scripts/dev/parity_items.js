// node scripts/dev/parity_items.js > /tmp/js_items.json  (deterministic measure; compared by parity_items.py)
global.window = {}; const fs = require('fs');
eval(fs.readFileSync(__dirname + '/../../static/engine/textanim.js', 'utf8'));
const P = JSON.parse(fs.readFileSync(__dirname + '/../../static/engine/presets.json', 'utf8'));
const lines = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const measure = (s, f) => [...s].reduce((a, c) => a + (c === ' ' ? 0.28 : 0.4 + (c.charCodeAt(0) % 7) * 0.05), 0) * f.px * (f.weight >= 700 ? 1.05 : 1);
const out = {};
const EX = {"titleGrad": true, "titleColor": "#ff85c0", "titleColor2": "#ffd23f", "titleSize": 0.7, "titlePosY": 0.12, "titleAlpha": 0.95, "titleWeight": 800, "titleUpper": true, "titleStroke": 0.06, "titleStrokeColor": "#4b1035", "titleShadowAlpha": 0.6, "titleShadowBlur": 0.1};
for (const [ap, sfx, extra] of P.anims.flatMap(a => [[a, '', {}], [a, '+pal', {...P.palettes.find(p => p.id === 'candy').colors, ...EX}]])) {
  const style = {...P.styleDefaults, ...P.looks.neon.style, ...(ap.style || {}), ...extra};
  const anim = {...P.animDefaults, ...(ap.anim || {})};
  const groups = window.LL.prepare(lines, style, anim, 20);
  const sc = {W: 1080, H: 1920, style, anim, measure, groups, title: 'Hello', clipLen: 20, layKey: 'a'};
  out[ap.id + sfx] = [];
  for (let f = 0; f < 600; f += 7) out[ap.id + sfx].push(window.LL.buildItems(f / 30, sc).items);
}
console.log(JSON.stringify(out));
