// ---------------------------------------------------------------------------
// pipeline.js
//
// Owns everything that happens *after* a file is successfully uploaded:
// running recognition and fetching the verified solution, storing each
// result in its own store — guessStore.js / solutionStore.js — and pacing
// the staged RECOGNIZING -> REVIEW stage transition. Derived data (layout,
// the comparison, stats) isn't stored anywhere; it's computed on demand
// from those two stores wherever it's needed (see main.js).
//
// upload.js's only job is accepting/validating/storing the file — it hands
// off to runRecognitionPipeline() here rather than knowing anything about
// recognition or the staged timers itself.
// ---------------------------------------------------------------------------

import { stageManager, STAGES, SIMULATED_DELAYS_MS } from './stageManager.js';
import { setGuessGrid } from './guessStore.js';
import { setSolutionGrid } from './solutionStore.js';
import { layoutFromCellGrid } from './gridLayout.js';
import { charGridToCellGrid } from './puzzleFixtures.js';
import { recognizeLetters } from './ocr.js';
import { fetchCorrectSolution } from './solutionApi.js';

let pendingTimers = [];
// Bumped on every cancel so timers from a superseded run (e.g. the user hit
// retry, or uploaded a second file, while the first was still mid-flight)
// know not to act even if they'd already been scheduled.
let runId = 0;

function clearPendingTimers() {
  pendingTimers.forEach((id) => clearTimeout(id));
  pendingTimers = [];
}

function after(ms, fn) {
  const id = setTimeout(fn, ms);
  pendingTimers.push(id);
}

/** Cancels any in-flight staged pipeline — e.g. retry/back-to-upload mid-run. */
export function cancelRecognitionPipeline() {
  clearPendingTimers();
  runId += 1;
}

/**
 * Runs recognition for a freshly uploaded file, then fetches the verified
 * solution once it's done:
 *
 *   (await recognizeLetters) -> RECOGNIZING -> (await fetchCorrectSolution) -> REVIEW
 *
 * recognizeLetters resolves with the raw OCR character grid ('■' black,
 * ' ' empty, else a letter) — it's stored in guessStore as-is. Anything
 * that needs it in the app's cell-object shape converts it with
 * charGridToCellGrid at the point of use, same as here for deriving layout.
 * Layout (rows/cols/black-square positions) isn't precalculated ahead of
 * time — it's derived from whatever recognizeLetters actually found.
 *
 * There's no artificial pacing delay between OCR resolving and moving to
 * RECOGNIZING — recognizeLetters' own (fake) async delay already accounts
 * for the wait; the stage transition happens as soon as it genuinely
 * resolves.
 *
 * If fetching the solution fails (network error, or the API has no
 * crossword saved for today yet — see solutionApi.js's
 * NoSolutionAvailableError), REVIEW is still reached but with an
 * errorMessage set instead of a solutionGrid — there's no dedicated error
 * stage; every stage's banner shows its own error state when one applies.
 *
 * Assumes the caller (upload.js) has already validated the file, saved it
 * via fileStore.js, reset the stores, and set stage to DETECTING.
 *
 * Replace recognizeLetters with a real OCR call later — the stage
 * transitions and store writes are the only contract the rest of the app
 * relies on. REVIEW is the final stage; there's nothing after it.
 */
export async function runRecognitionPipeline(file) {
  cancelRecognitionPipeline();
  const thisRun = runId;

  const guessGrid = await recognizeLetters(file);
  if (thisRun !== runId) return; // superseded while OCR was in flight — bail quietly

  setGuessGrid(guessGrid);
  const layout = layoutFromCellGrid(charGridToCellGrid(guessGrid));

  stageManager.setStage(STAGES.RECOGNIZING, { fileName: file.name });

  after(SIMULATED_DELAYS_MS[STAGES.RECOGNIZING], async () => {
    if (thisRun !== runId) return;

    let solutionGrid;
    try {
      solutionGrid = await fetchCorrectSolution(layout);
    } catch (err) {
      if (thisRun !== runId) return; // superseded while the request was in flight
      stageManager.setStage(STAGES.REVIEW, { fileName: file.name, errorMessage: err.message });
      return;
    }
    if (thisRun !== runId) return;

    setSolutionGrid(solutionGrid);
    stageManager.setStage(STAGES.REVIEW, { fileName: file.name });
  });
}
