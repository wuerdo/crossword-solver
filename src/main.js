import './scss/style.scss';

import { stageManager, STAGES } from './modules/stageManager.js';
import { getGuessGrid, setGuessGrid } from './modules/guessStore.js';
import { getSolutionGrid, setSolutionGrid } from './modules/solutionStore.js';
import { getPreviewUrl, getUploadedFile } from './modules/fileStore.js';
import { charGridToCellGrid } from './modules/puzzleFixtures.js';
import { layoutFromCellGrid, buildBlankGrid } from './modules/gridLayout.js';
import { recognizeLetters } from './modules/ocr.js';
import { fetchCorrectSolution } from './modules/solutionApi.js';
import { compareResults, computeStats, gridShapesMatch } from './modules/comparison.js';
import { sendMismatchReport } from './modules/mismatchReport.js';
import { wireUploadControls } from './modules/upload.js';
import { devPanelTemplate, wireDevPanel } from './modules/devPanel.js';
import { initTheme, toggleTheme, getTheme } from './modules/themeToggle.js';
import { applyLogoJitter } from './modules/logoAnimation.js';
import {
  headerTemplate,
  bannerTemplate,
  loadingDots,
  dropzoneTemplate,
  uploadedPhotoTemplate,
  statCardsTemplate,
  gridPanelTemplate,
  themeToggleTemplate,
  explainerTemplate,
  iconUpload,
  iconAlert,
  iconCheckCircle,
} from './modules/templates.js';

// Dark is the default; a stored preference (if any) is applied immediately,
// before the first render, so there's no flash of the wrong theme.
initTheme();

// Today's date, e.g. "Thursday, July 23, 2026" — pulled straight from the
// browser rather than hardcoded.
const DATE_LABEL = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date());

// Query-string helper, purely for development convenience:
//   ?stage=review   -> boot straight into a given stage
const params = new URLSearchParams(window.location.search);
const initialStage = params.get('stage');
if (initialStage && Object.values(STAGES).includes(initialStage)) {
  stageManager.setStage(initialStage);
}

const app = document.getElementById('app');

// The header (logo + strips) is rendered and jittered exactly once here,
// then reused as a static HTML string on every render — app.innerHTML gets
// replaced wholesale on every stage change, but the letter jitter shouldn't
// reshuffle every time that happens. Rendering into a detached element and
// reading back its innerHTML captures the jitter's inline styles as plain
// markup, so no per-render JS work is needed to keep it looking right.
const HEADER_HTML = (() => {
  const scratch = document.createElement('div');
  scratch.innerHTML = headerTemplate(DATE_LABEL);
  applyLogoJitter(scratch);
  return scratch.innerHTML;
})();

const ZERO_STATS = { solved: 0, wrong: 0, missing: 0 };

// ---------------------------------------------------------------------------
// Derived puzzle data.
//
// There's no store for layout/comparison/stats — those are pure functions
// of the two real stores (guessStore.js, solutionStore.js), so they're just
// recomputed each render rather than cached anywhere. guessStore holds the
// raw OCR character grid, so it's converted to the app's cell-object shape
// here before anything downstream touches it.
//
// Before diffing guess against solution, their shapes (dimensions and
// black-square layout) must match exactly — a mismatch means OCR detected
// a different grid than today's accepted solution, so a cell-by-cell
// comparison would be meaningless. In that case comparedGrid/stats are
// left null and shapeMismatch is set instead; the caller shows the
// solution plain (no comparison coloring) with an error banner.
// ---------------------------------------------------------------------------
function derivePuzzleData() {
  const rawGuessGrid = getGuessGrid();
  const guessGrid = rawGuessGrid ? charGridToCellGrid(rawGuessGrid) : null;
  const layout = guessGrid ? layoutFromCellGrid(guessGrid) : null;
  const layoutGrid = layout ? buildBlankGrid(layout) : null;

  const solutionGrid = getSolutionGrid();

  let shapeMismatch = false;
  let comparedGrid = null;
  let stats = null;

  if (guessGrid && solutionGrid) {
    if (gridShapesMatch(guessGrid, solutionGrid)) {
      comparedGrid = compareResults(guessGrid, solutionGrid);
      stats = computeStats(comparedGrid);
    } else {
      shapeMismatch = true;
    }
  }

  return { guessGrid, layout, layoutGrid, solutionGrid, comparedGrid, stats, shapeMismatch };
}

// Guards ensurePuzzleDataFor's fallback calls against firing again while a
// previous call is still in flight (e.g. a theme toggle re-render
// happening mid-await).
let guessRequestInFlight = false;
let resultsRequestInFlight = false;

// Makes sure the stores have whatever mock data a given stage needs to
// render, fabricating it on the spot if it's missing. During the normal
// upload flow `upload.js`/`pipeline.js` already populate the stores before
// each stage transition, so this is a no-op — it only matters when jumping
// straight to a stage (dev panel / `?stage=`) without uploading anything
// first.
function ensurePuzzleDataFor(stage) {
  const needsGuess = [STAGES.RECOGNIZING, STAGES.REVIEW].includes(stage);
  if (!needsGuess) return;

  if (!getGuessGrid()) {
    if (!guessRequestInFlight) {
      guessRequestInFlight = true;
      recognizeLetters(getUploadedFile()).then((guessGrid) => {
        guessRequestInFlight = false;
        setGuessGrid(guessGrid); // raw character grid, same as pipeline.js stores
        render(stageManager.getState());
      });
    }
    return; // nothing else to fabricate until the guess resolves
  }

  const needsResults = stage === STAGES.REVIEW;
  // Don't retry if an error is already showing — otherwise a failed fetch
  // (e.g. no crossword saved for today) would retry every single render
  // forever, since it never gets a solutionGrid to satisfy the check below.
  if (needsResults && !getSolutionGrid() && !resultsRequestInFlight && !stageManager.getState().errorMessage) {
    resultsRequestInFlight = true;
    // Layout isn't precalculated ahead of time — it's derived from the
    // (converted) guess grid, same as pipeline.js does.
    const layout = layoutFromCellGrid(charGridToCellGrid(getGuessGrid()));
    fetchCorrectSolution(layout)
      .then((solutionGrid) => {
        resultsRequestInFlight = false;
        setSolutionGrid(solutionGrid);
        render(stageManager.getState());
      })
      .catch((err) => {
        resultsRequestInFlight = false;
        stageManager.setStage(STAGES.REVIEW, { errorMessage: err.message });
      });
  }
}

// ---------------------------------------------------------------------------
// Recognizing stage: two-phase reveal.
//
// The grid doesn't exist visually until this stage (detecting only shows
// the raw photo). On entering RECOGNIZING with fresh data, nothing is shown
// for a brief moment, then the OCR guess grid reveals in with every cell —
// black, empty, and filled — popping in with a staggered delay, rather than
// a static/unrevealed grid flashing in first.
//
// Both this and the REVIEW-stage reveal below are keyed off the actual data
// (the guess/solution grid reference currently in the store), not off
// stage entry/exit — so switching screens via the dev panel and back with
// the same data shows the already-revealed grid immediately, no replay.
// Only genuinely fresh data (a new upload, which always produces new grid
// objects) plays the reveal again.
// ---------------------------------------------------------------------------
const RECOGNIZING_REVEAL_DELAY_MS = 400;

const revealedFor = { recognizing: null, review: null };

function shouldReveal(bucket, key) {
  if (!key) return false;
  if (revealedFor[bucket] === key) return false;
  revealedFor[bucket] = key;
  return true;
}

let recognizingRevealTimer = null;
let recognizingPhaseReadyFor = null; // raw guessGrid reference the pre-reveal wait has completed for

function ensureRecognizingRevealPhase(stage) {
  const rawGuess = getGuessGrid();

  if (stage !== STAGES.RECOGNIZING || !rawGuess) {
    if (recognizingRevealTimer) {
      clearTimeout(recognizingRevealTimer);
      recognizingRevealTimer = null;
    }
    return;
  }

  if (recognizingPhaseReadyFor === rawGuess || recognizingRevealTimer) {
    return; // already ready, or already waiting, for this exact data
  }

  if (revealedFor.recognizing === rawGuess) {
    // Already played its reveal on a previous visit to this stage with the
    // same data — show it immediately, no artificial wait this time.
    recognizingPhaseReadyFor = rawGuess;
    return;
  }

  recognizingRevealTimer = setTimeout(() => {
    recognizingRevealTimer = null;
    recognizingPhaseReadyFor = rawGuess;
    render(stageManager.getState());
  }, RECOGNIZING_REVEAL_DELAY_MS);
}

function bannerForStage(stage, puzzle, errorMessage) {
  switch (stage) {
    case STAGES.UPLOAD:
      if (errorMessage) {
        return bannerTemplate({
          variant: 'error',
          icon: iconAlert(),
          html: errorMessage,
        });
      }
      return bannerTemplate({
        variant: 'info',
        icon: iconUpload(),
        html: 'Upload a screenshot of your daily NYT crossword puzzle.',
      });

    case STAGES.DETECTING:
      return bannerTemplate({
        variant: 'info',
        spin: true,
        html: `Image uploaded successfully. Detecting crossword${loadingDots()}`,
      });

    case STAGES.RECOGNIZING:
      return bannerTemplate({
        variant: 'info',
        spin: true,
        html: 'Recognizing letters in the puzzle&hellip; <br><small>This may take a few seconds.</small>',
      });

    case STAGES.REVIEW:
      if (errorMessage) {
        return bannerTemplate({
          variant: 'error',
          icon: iconAlert(),
          html: errorMessage,
          actionHtml: `<button class="btn btn--primary" data-action="back-to-upload">Back to Upload</button>`,
        });
      }
      if (puzzle.shapeMismatch) {
        return bannerTemplate({
          variant: 'error',
          icon: iconAlert(),
          html:
            "The accepted solution for today's crossword and the uploaded image don't match up " +
            'after the OCR. <br><small>If you think the recognition is faulty, send an automated report ' +
            'to our engineers by <a href="#" data-action="report-mismatch">clicking here</a>.</small>',
          actionHtml: `<button class="btn btn--primary" data-action="back-to-upload">Back to Upload</button>`,
        });
      }
      return bannerTemplate({
        variant: 'success',
        icon: iconCheckCircle(),
        html: '<strong>Recognition complete!</strong> Review the results below.',
        actionHtml: `<button class="btn btn--primary" data-action="back-to-upload">Back to Upload</button>`,
      });

    default:
      return '';
  }
}

function workspaceForStage(stage, puzzle, errorMessage) {
  if (stage === STAGES.RECOGNIZING) {
    if (!puzzle.guessGrid) return '';

    const rawGuess = getGuessGrid();
    if (recognizingPhaseReadyFor !== rawGuess) {
      // Nothing shown yet — the grid doesn't exist visually until it
      // reveals in below, rather than flashing an empty structural grid
      // first.
      return '';
    }

    const reveal = shouldReveal('recognizing', rawGuess);
    return `<div class="workspace">${gridPanelTemplate(puzzle.guessGrid, { reveal })}</div>`;
  }

  if (stage === STAGES.REVIEW) {
    if (errorMessage) {
      // No solution was available to compare against — show whatever was
      // recognized, plain, rather than leaving the review stage empty.
      if (!puzzle.guessGrid) return '';
      const reveal = shouldReveal('review', getGuessGrid());
      return `<div class="workspace">${gridPanelTemplate(puzzle.guessGrid, { reveal })}</div>`;
    }

    if (puzzle.shapeMismatch) {
      // No valid comparison is possible — show the solution plain, with no
      // correct/wrong/missing coloring or legend, and no reveal-race with a
      // comparison that never happens. The banner explains why.
      const reveal = shouldReveal('review', getSolutionGrid());
      return `<div class="workspace">${gridPanelTemplate(puzzle.solutionGrid, { reveal })}</div>`;
    }

    // Only the correct solution is ever shown here — colored by how it
    // compares to what was recognized, not the recognized letters
    // themselves. Falls back to the plain layout while the (simulated)
    // solution request is still in flight.
    const grid = puzzle.comparedGrid || puzzle.layoutGrid;
    if (!grid) return '';
    const hasResults = !!puzzle.comparedGrid;
    // Same staggered reveal as the recognizing stage, so the jump from the
    // OCR guess to the verified/colored solution also feels like it's
    // being read in rather than just swapped out. Only once results have
    // actually arrived, and only the first time this exact data is shown —
    // no point animating the plain fallback layout, or replaying the
    // reveal on an unrelated re-render of the same result.
    const reveal = hasResults ? shouldReveal('review', getSolutionGrid()) : false;
    return `<div class="workspace">${gridPanelTemplate(grid, { legend: hasResults, reveal })}</div>`;
  }

  return '';
}

function statsForStage(stage, puzzle) {
  if (stage === STAGES.REVIEW && puzzle.stats) {
    return statCardsTemplate(puzzle.stats);
  }
  return statCardsTemplate(ZERO_STATS);
}

// Placeholder "notify engineers" action, shown only in the shape-mismatch
// banner. Re-wired after every render since app.innerHTML is replaced
// wholesale each time (same pattern as wireUploadControls/wireThemeToggle).
function wireMismatchReport(root, puzzle) {
  const link = root.querySelector('[data-action="report-mismatch"]');
  if (!link) return;

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    if (link.dataset.sent === 'true') return;

    link.dataset.sent = 'true';
    const originalText = link.textContent;
    link.textContent = 'sending report…';

    const { fileName } = stageManager.getState();
    await sendMismatchReport({
      fileName,
      guessGrid: puzzle.guessGrid,
      solutionGrid: puzzle.solutionGrid,
    });

    link.textContent = 'report sent — thank you';
  });
}

// Tracks whether this render represents an actual stage change (vs. a
// same-stage re-render like a theme toggle or the recognizing reveal
// timer), so the stage-enter animation only plays when the visible stage
// genuinely transitions.
let lastAnimatedStage = null;

function render(state) {
  const { stage, errorMessage } = state;
  ensurePuzzleDataFor(stage);
  ensureRecognizingRevealPhase(stage);

  const puzzle = derivePuzzleData();

  const isUpload = stage === STAGES.UPLOAD;
  const isDetecting = stage === STAGES.DETECTING;
  const showDropzone = isUpload;
  // Detecting only shows the raw photo briefly (no grid exists yet). A
  // rejected upload's error shows on the UPLOAD banner instead — no photo,
  // since a rejected file was never actually stored.
  const showPhoto = isDetecting;
  const showWorkspace = !isUpload && !isDetecting;
  // Stat cards only carry meaning once there's a valid comparison — not on
  // a shape mismatch or an error, where no comparison ran at all.
  // Only once a real score exists — not while still fetching (which would
  // otherwise flash a premature 0%/0%/0% placeholder), and not on a shape
  // mismatch or error, where no comparison ever ran.
  const showStats = stage === STAGES.REVIEW && !!puzzle.stats;

  const stageChanged = stage !== lastAnimatedStage;
  lastAnimatedStage = stage;
  const cardClass = stageChanged ? 'card card--stage-enter' : 'card';

  const cardMarkup = `
    <div class="${cardClass}">
      ${bannerForStage(stage, puzzle, errorMessage)}
      ${showPhoto ? `<div class="section-gap">${uploadedPhotoTemplate(getPreviewUrl())}</div>` : ''}
      ${showDropzone ? `<div class="section-gap">${dropzoneTemplate()}</div>` : ''}
      ${showWorkspace ? `<div class="section-gap">${workspaceForStage(stage, puzzle, errorMessage)}</div>` : ''}
      ${showStats ? `<div class="workspace section-gap">${statsForStage(stage, puzzle)}</div>` : ''}
    </div>
  `;

  // The upload stage gets a second column explaining what the site does,
  // with a baked-in example result — everywhere else it's just the card.
  const mainContent = isUpload
    ? `<div class="upload-layout">${cardMarkup}${explainerTemplate()}</div>`
    : cardMarkup;

  app.innerHTML = `
    ${themeToggleTemplate(getTheme())}

    <div class="page">
      <div class="page__inner">
        ${HEADER_HTML}
        ${mainContent}
      </div>
    </div>

    ${devPanelTemplate(stage)}
  `;

  wireUploadControls(app);
  wireThemeToggle(app);
  wireMismatchReport(app, puzzle);
  wireDevPanel(app);
}

// Re-wired after every render since app.innerHTML is replaced wholesale
// each time (same pattern as wireUploadControls/wireDevPanel).
function wireThemeToggle(root) {
  const btn = root.querySelector('[data-theme-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    toggleTheme();
    render(stageManager.getState());
  });
}

stageManager.subscribe(render);
render(stageManager.getState());
