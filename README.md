# Crossword Puzzle Solver

A vanilla JS + SCSS Vite app that mirrors the "Crossword Puzzle Solver" mock
screens: upload a screenshot, watch it get detected, have the letters
"recognized", then review results.

**No real image recognition or solving is implemented yet.** Everything past
the file upload is simulated with placeholder functions and timers, so the
whole flow can be seen end-to-end while the real backend/OCR gets built.

This app never recognizes or shows clues or cell numbers — only the grid
structure, letters, and correctness matter here.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (defaults to `http://localhost:5173`).

## How the stages work

The app is a small state machine (`src/modules/stageManager.js`) with six
stages:

| Stage         | What it shows                                                  |
|---------------|--------------------------------------------------------------------|
| `upload`      | Default view — drag & drop / choose file                          |
| `error`       | "Could not process image" + the uploaded photo (uncropped) + retry |
| `detecting`   | Empty grid — just the detected structure (rows + black squares)    |
| `recognizing` | Same grid, with recognized letters filled in (some left blank)     |
| `review`      | The **correct solution**, colored by how it compares to what was recognized |
| `complete`    | Same as review, with the "analysis complete" banner                |

Percentage cards (Solved / Wrong / Missing) are always three separate
bordered cards built from one shared component (`statCardsTemplate`) — every
stage uses the exact same markup/CSS, just with zeros before recognition
finishes.

### The recognition pipeline (all placeholders)

`src/modules/recognition.js` has one function per real pipeline step, each
written as a drop-in placeholder for the real thing:

- **`recognizeGridLayout()`** — stands in for grid-structure detection.
  Returns `{ rows, cols, blackFields }`.
- **`recognizeLetters(layout)`** — stands in for OCR-ing the cells the user
  has already filled in. Returns a grid where some cells' `letter` is `null`
  (left blank / unrecognized).
- **`fetchCorrectSolution(layout)`** — stands in for a GET call to an
  external solutions API (it's `async` and documents the real `fetch` call
  in a comment, just simulated with a delay instead).
- **`compareResults(recognized, correct)`** — pure diff: returns the correct
  grid with a `correct` / `wrong` / `missing` status per cell.
- **`computeStats(compared)`** — turns that diff into Solved/Wrong/Missing
  percentages.

`src/modules/puzzleStore.js` is the shared state these write into and the
UI reads from. `src/modules/upload.js` calls the three pipeline functions in
order, on a timer, writing each result into the store before moving to the
next stage. Swap the bodies of the `recognition.js` functions for real API
calls whenever that exists — nothing else needs to change.

### Jumping directly to a stage (for building/testing UI)

Three ways, from least to most code:

1. **URL param** — open the app with `?stage=review` (or `detecting`,
   `recognizing`, `complete`, `error`) to boot straight into that view. Mock
   data is fabricated on the spot if you skip the upload step.
2. **Dev panel** — open the app with `?dev=1` to get a floating panel with a
   button per stage.
3. **From code** — import the store and call it directly:

   ```js
   import { stageManager, STAGES } from './modules/stageManager.js';
   stageManager.setStage(STAGES.COMPLETE);
   ```

## Placeholder image

`public/placeholder-puzzle.png` is the "uploaded" screenshot shown on the
error stage (recognition failed, so it's shown plain — there's no detected
grid to crop to). Swap it for the user's real uploaded file once uploads are
actually persisted somewhere; see `src/modules/placeholderImage.js`.

## Project structure

```
index.html
public/
  placeholder-puzzle.png    # stand-in "uploaded" screenshot
src/
  main.js                   # app bootstrap + per-stage rendering
  modules/
    stageManager.js          # stage state machine (upload/error/.../complete)
    puzzleStore.js             # shared state written by the pipeline, read by the UI
    recognition.js              # the three placeholder pipeline functions + diff/stats
    upload.js                    # dropzone + file input wiring, drives the pipeline
    placeholderImage.js           # placeholder "uploaded" image path
    templates.js                   # HTML string builders for each UI block
    devPanel.js                     # optional floating stage switcher (?dev=1)
    icons.js                         # inline SVG icons
  scss/
    style.scss              # entry point, imports the partials below
    _variables.scss          # colors, fonts, spacing tokens
    _base.scss               # reset + global styles
    _layout.scss              # page shell, header, card
    _components.scss          # banner, dropzone, buttons, stat cards
    _grid.scss                 # crossword grid panel
    _devpanel.scss             # floating dev panel
```
