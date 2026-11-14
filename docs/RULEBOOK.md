# Writing a game's rule book

Every game has a rule book at `public/games/<id>/rules.html`. Players open it from the **?**
button at the table, the **Rule book** button on the game's Options page, and the **How to
play** link in the Single player / Multiplayer pop-up. The Game Center shows it full screen
with a contents bar built from the `<h2>` headings (`data-short="…"` gives a heading a
shorter label in that bar).

The file is an HTML **fragment** (no `<html>`, `<head>`, `<script>` or `<style>`), styled by
`public/css/center.css`. Pictures are **inline SVG** drawn in the file: no image files, no
external links, no fonts beyond the page's own. Keep the whole file under about 120 KB.

## What a rule book covers

Write for someone who has never played. Plain words, short paragraphs, second person ("you").
Every rule in the book must match what the game's code does (`engine.js` / `index.js`):
house rules, table options and their defaults, scoring numbers, end conditions. When the
code and a well-known version of the game differ, the book follows the code and says so.

In this order (skip a section only when it truly doesn't apply):

1. **Hero**: `<header class="rb-hero">` with `<h1>`, a one-sentence `<p class="rb-lede">`
   and `<ul class="rb-facts">` chips: players, length, ages or difficulty, "Pass and play"
   when the manifest has `sameDevice`.
2. **Goal** (`<h2>`): how you win, in two or three sentences.
3. **What's in the game**: cards, board, pieces, dice, with a picture of each kind.
4. **Setup**: what the deal or board looks like at the start, with a picture.
5. **How a turn works** or **How a round works**: `<ol class="rb-steps">`, one step per
   `<li>`, with pictures of the important moments.
6. Rules that need their own section: bidding, trump, trading, building, special
   cards, and so on. One `<h2>` each.
7. **Scoring** and **Winning**: tables of point values, worked arithmetic.
8. **Example**: a short worked example of a turn or a hand, with pictures.
9. **Table options**: every option in the manifest's `options`, what each choice changes,
   and which is the default. Computer player levels, if any.
10. **Playing in the Game Center**: how to do each action in this app (tap, drag, keys,
    gamepad), the helpers (hints, coach, auto-play), online play, pass and play, rematch.
11. **Tips and strategy**: five to ten real tips, beginner to advanced.
12. **Quick reference**: `<div class="rb-ref">` cards (each `<div>` with an `<h3>`) or a
    table: the whole game on one screen.
13. **Glossary**: `<dl class="rb-glossary">` of the game's terms.

## Building blocks

```html
<header class="rb-hero">
  <h1>Four in a Row</h1>
  <p class="rb-lede">Drop discs into the frame and be first to line up four.</p>
  <ul class="rb-facts"><li><b>Players</b>2</li><li><b>Time</b>5 minutes</li></ul>
</header>

<h2 id="goal" data-short="Goal">Goal of the game</h2>
<p>…</p>

<ol class="rb-steps"><li><b>Pick a column.</b> …</li><li>…</li></ol>

<figure class="rb-fig">
  <svg viewBox="0 0 400 220" role="img" aria-label="What the picture shows">…</svg>
  <figcaption>What to notice in the picture.</figcaption>
</figure>
<div class="rb-figs"><figure class="rb-fig">…</figure><figure class="rb-fig">…</figure></div>

<aside class="rb-tip">A tip.</aside>
<aside class="rb-note">A side note or a difference from other versions.</aside>
<aside class="rb-warn">A common mistake.</aside>

<div class="rb-table-wrap"><table><tr><th>Card</th><th>Points</th></tr><tr><td>…</td><td>…</td></tr></table></div>
<div class="rb-ref"><div><h3>On your turn</h3><p>…</p></div><div>…</div></div>
<dl class="rb-glossary"><dt>Trump</dt><dd>…</dd></dl>
<span class="rb-key">Space</span>
```

## Pictures

- Draw them to look like the game: the same colours, card faces, pieces and board as its
  screen and its home tile (`tile` in `index.js`). Reuse its palette.
- The page background is dark navy. Figures sit on a darker panel (`#0d1a2e`), so use
  light lines and text (`#eef2f8`, muted `#9fb0c6`, gold `#f0c35a`) and bright game colours.
- Always set `viewBox`, never fixed `width`/`height`, so pictures scale to phones. Text in
  a picture must stay readable at 340 px wide: font-size 14 or more in a 400-wide viewBox.
- Use `font-family="Inter, system-ui, sans-serif"`, and give every `<svg>` a
  `role="img"` and an `aria-label`.
- Arrows, highlights and numbered markers (gold circles with a number) make a picture explain
  a move. Every picture gets a `<figcaption>` that says what to look at.
- IDs inside SVGs (gradients, markers) must be unique across the whole file: prefix them
  with the game id, e.g. `rook-grad1`.
- Aim for 8 to 15 pictures in a rule book.

## Keeping it up to date

A rule book is only useful while it's right. The hero header records the game version it was
last checked against:

```html
<header class="rb-hero" data-checked="1.8">
```

`tests/rulebook.test.mjs` fails when `data-checked` differs from the `version` in the game's
`index.js`. So whenever you change a game and bump its version (see CLAUDE.md):

1. Read the whole rule book next to the code you changed.
2. Fix every rule, number, table option, control, screen description and picture that is now
   wrong, and add sections for anything new.
3. Set `data-checked` to the new version.

Never change `data-checked` without re-reading the book. A change that truly leaves the rules
and controls untouched (a faster renderer, say) still needs that read-through; then only the
number changes.

## Checking it

Open the game in a browser, tap **?** and read the whole book on a phone-sized screen
(390 × 844) and on a desktop. Every picture must be readable and nothing may overflow
sideways. `npm test` must pass.
