# Proposal: bring the MCE306 "formula card" into Lecting

> **Status: Phases 1-3 implemented** in `public/render.js` (new, shared with tests), `public/style.css`, `public/app.js`, `public/index.html`, `tools/build.js`, `test/render.test.js`. Section 4's sketch is superseded by `render.js`.

Source studied: `MCE306/notes/css/design-system.css` (v3.1 "Breathable Mathematical Editorial", 1,400 lines) and its real usage in `module-4-failure-theories.html` etc.
Visual mock (real `style.css` + KaTeX, light/dark toggle): [`formula-card-mockup.html`](formula-card-mockup.html). Open it in Chrome (`open docs/formula-card-mockup.html`); it links `../public/style.css` and `../node_modules/katex`.
Proposed CSS (drop-in): [`formula-card.proposed.css`](formula-card.proposed.css).

## 1. What the formula card actually is

Three nested classes, nothing else:

```
.formula-grid                  grid, auto-fit minmax(295px,1fr), gap 1rem
 └ .formula-box                surface bg · 1px hairline · 8px radius · subtle shadow · flex column, space-between
    ├ .formula-box-label       sans 0.73rem, 600, UPPERCASE, .05em tracking, accent colour
    ├ $$ KaTeX display $$      centred, on the card itself (no inner box)
    └ .formula-box-note        sans 0.8rem, secondary colour, 1px top rule, 0.55rem gap
```

**Why it reads as tidy** (these are the rules to keep, in order of impact):

1. **Role separation by type.** Serif is for prose, sans is for label and note, math sits alone on its own line. The eye knows what each line is before reading it.
2. **One container grammar.** One radius, one border weight, one shadow, used for every card. Nothing is decorated (no icons, no fills, no coloured borders).
3. **Colour only on the label.** A single accent colour tags *what* the formula is; everything else is neutral ink and grey.
4. **`justify-content: space-between` pins the note to the bottom.** In a row of two cards the formulas can differ in height but the dividers and notes still line up.
5. **`auto-fit` grid.** Two columns when there is room, one column when there is not, with no breakpoint for the grid itself (the mobile block only trims padding).
6. **`min-width: 0` + scrollable KaTeX.** A wide equation scrolls inside its card instead of stretching the layout.

Siblings in the same file, *not* proposed now: `.equation-banner` (card plus inner "math well", `(1)` tag, variable legend), `.result-box` (green final answer), `.deriv-step` (numbered derivation steps), `.concept-block`. They reuse the same grammar, so they can follow later.

## 2. How Lecting differs (and what that forces)

| | MCE306 notes | Lecting |
|---|---|---|
| Content | Hand-written HTML | LLM-written **markdown**, rendered by `markdown-it` with `html:false` in `public/app.js` |
| Consequence | Write `<div class="formula-box">` | Raw HTML is escaped, so the card needs a **markdown convention** handled in `render()` |
| Surfaces | one page, warm paper | two: `.fcard` (focus session) and `.paper` (ruled notebook) |
| Palette | warm paper, Inter/Newsreader webfonts, 3 accents | cool grey-teal, system fonts (offline), `--ok` and `--acc` are the same teal |
| Units / themes | rem; `[data-theme]` | rem; theme tokens defined in **two** blocks (`prefers-color-scheme` and `[data-theme=dark]`) plus print |
| Existing math | n/a | **46 display equations in 35 generated notes** (MCE350: 9, MCE402: 16, MCE412: 22), currently bare `$$…$$` |

**Token mapping (no new colours):** `bg-surface→--surface`, `border-hairline→--line`, `accent-primary→--acc`, `text-secondary→--mut`, `font-sans→--sans`. The paper variant uses `--paper` / `--rule` so the ruled lines do not show through the card. Because every token already has light, dark and print values, **the card works in all three with no extra theme rules** (confirmed in the mock, light and dark).

**Deliberately not ported:** the warm palette and webfonts (would clash with the rest of Lecting and break offline use), the strict 3-accent semantic scheme (Lecting's `--ok` equals `--acc`, so blue/green would collapse; the amber "exam watchout" role is already the yellow sticky `> **Sınav ipucu:**`), and a new shadow token (an inline alpha shadow works in both themes).

## 3. Proposed plan

### Phase 1: CSS + automatic wrap (instant win, zero regeneration)

- Append [`formula-card.proposed.css`](formula-card.proposed.css) (about 10 rules) to `public/style.css`.
- In `render()`, wrap any paragraph that is *only* a display equation in an unlabelled card. All 46 existing equations upgrade immediately; no note is regenerated (that would spend subscription quota).
- Only for notes, not questions/quiz (a card inside an answer button looks wrong): `render(src, id, yt, cards)` gets a 4th argument, passed `true` at the three `.note` call sites (`app.js` lines 262, 294, 296).

### Phase 2: labelled card with a note (new notes only)

Authoring convention (survives as readable text anywhere `:::` is not understood):

```
:::formül Doğrusal regülatör verimi
$$\text{Verim} \approx \frac{V_o}{V_i}, \qquad V_o < V_i$$

5 V → 3.3 V için verim ≈ %66; kalan enerji ısıya gider.
:::
```

First paragraph = formula, remaining paragraphs = note. Add 2 lines to the note prompt in `tools/build.js` (≈ line 59) telling Claude to use it for the 1-3 key formulas per section. Older notes keep Phase 1 cards; they get labels only if regenerated.

### Phase 3: side-by-side pairs

Consecutive `:::formül` blocks (separated only by blank lines) become one `.fgrid`; a lone block stays full width. This is the "compare two formulas" layout from the design system, and it only needs the grouping regex already in the sketch below.

### Optional later (not in scope now)

Variable legend (`.equation-legend`) for symbol meanings; a green `result` variant for final answers; tinting the label with the course colour (`--c0…--c5`).

## 4. Code sketch for `public/app.js`

Not applied to the repo. The block below is a copy of what I ran in a node test (`markdown-it` + `katex` from `node_modules`), every assertion green: lone `$$` wrapped, no wrap with `cards=false`, no wrap for `$$` mixed into a paragraph, two cards grouped into a grid, one card not gridded, note markdown rendered, KaTeX in the title, plain-text `aria-label`, no leftover placeholders, raw HTML in a title escaped.

```js
// Formül kartı: tek başına $$ paragrafı karta sarılır; ":::formül Başlık" etiket + not ekler.
const FORMUL = /^:::[ \t]*form[üu]l[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*$/gm;
const fbox = (label, eq, note) => `<div class="fbox" role="group"${label ? ` aria-label="${esc(label.replace(/<[^>]*>/g, ''))}"` : ''}><div>${label ? `<div class="flabel">${label}</div>` : ''}${eq}</div>${note ? `<div class="fnote">${note}</div>` : ''}</div>`;

// render(): `const maths = [], boxes = [];`, math extraction aynen kalır, ondan hemen sonra:
if (cards) src = src.replace(FORMUL, (_, title, body) => { // ilk paragraf formül, kalanı not
  const [eq, ...rest] = body.trim().split(/\n\s*\n/);
  boxes.push(fbox(md.renderInline(title.trim()), md.render(eq).replace(/<\/?p>/g, '').trim(),
    rest.length ? md.render(rest.join('\n\n')).replace(/<\/?p>/g, '').trim() : ''));
  return `\n@@F${boxes.length - 1}@@\n`;
});
// `md.render(src)` sonucu `out` olsun; M yer tutucuları değiştirilmeden önce:
if (cards) out = out
  .replace(/(?:<p>@@F\d+@@<\/p>\n?)+/g, run => { const b = run.match(/@@F(\d+)@@/g).map(m => boxes[+m.slice(3, -2)]); return b.length > 1 ? `<div class="fgrid">${b.join('')}</div>` : b[0]; })
  .replace(/<p>@@M(\d+)@@<\/p>/g, (p, n) => maths[n].display ? fbox('', `@@M${n}@@`) : p);
```

Phase 1 alone is only the last `.replace` plus the CSS (about 8 lines total). Security: title, equation and note all go through `markdown-it` with `html:false`, and `aria-label` goes through `esc()`, so a title cannot inject markup (asserted in the test).

## 5. Risks and open decisions

- **Notebook rhythm.** In `.paper` a card's height is not a multiple of the 2rem ruled-line grid, so text after it sits slightly off the lines (visible in the mock). KaTeX display and images already cause this today; the CSS uses `2rem` bottom margins to limit it. If it bothers you, a `min-height` snap or hiding rules behind the card is possible, but I would not spend effort on it.
- **Flat in focus mode.** `.fcard` and `.fbox` are both `--surface`, so only the hairline and faint shadow separate them. It reads fine in the mock; if you want more separation, set `.fbox` background to `var(--bg)` (one-line change).
- **LLM compliance (Phase 2).** Claude may forget the `:::` syntax or put a note first. The failure mode is graceful: text shows as plain paragraphs, and `$$` still gets the Phase 1 card. A tiny `lib/` validator is not warranted yet.
- **Other readers of `notes.md`.** The `lectnote` MCP and any GitHub view will show `:::formül …` as plain text. Acceptable for a personal tool.
- **Decision for you:** ship Phase 1 only, or Phases 1-3 together? Phases 2-3 only matter for newly generated notes.
