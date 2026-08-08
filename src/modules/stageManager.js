// ---------------------------------------------------------------------------
// Stage manager
//
// The real image-recognition / solving pipeline doesn't exist yet. This
// module is the single place that tracks "which stage of the workflow are
// we showing" so it can be swapped for real async logic later without
// touching the rendering code.
//
// To jump straight to a stage from code (e.g. while building a later stage's
// UI), call `stageManager.setStage(STAGES.REVIEW)` from anywhere — or open
// the app with `?stage=review` in the URL, or `?dev=1` for a floating panel
// with buttons for every stage.
// ---------------------------------------------------------------------------

export const STAGES = {
  UPLOAD: 'upload', // default: waiting for a screenshot
  DETECTING: 'detecting', // image accepted, locating the puzzle grid
  RECOGNIZING: 'recognizing', // OCR-ing letters
  REVIEW: 'review', // recognition done, showing confidence results — final stage
};

export const STAGE_ORDER = [
  STAGES.UPLOAD,
  STAGES.DETECTING,
  STAGES.RECOGNIZING,
  STAGES.REVIEW,
];

// How long each simulated step "takes". Tune freely — there is no real
// work happening, it's just for the demo pipeline to feel alive. Note
// DETECTING has no entry here: its duration is genuinely however long
// ocr.js's recognizeLetters takes to resolve, not an artificial pacing
// delay layered on top (see pipeline.js).
export const SIMULATED_DELAYS_MS = {
  [STAGES.RECOGNIZING]: 1800,
};

function createStageManager() {
  let state = {
    stage: STAGES.UPLOAD,
    fileName: null,
    // Orthogonal to `stage` — any stage can carry an error (a bad upload on
    // UPLOAD, a failed solution fetch on REVIEW, etc). Each stage's banner
    // shows it instead of that stage's normal message when present. Always
    // pass `errorMessage: null` explicitly when clearing it, since setStage
    // merges rather than replaces.
    errorMessage: null,
  };

  const listeners = new Set();

  function notify() {
    listeners.forEach((fn) => fn(state));
  }

  return {
    getState() {
      return state;
    },
    setStage(stage, extra = {}) {
      state = { ...state, stage, ...extra };
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const stageManager = createStageManager();
