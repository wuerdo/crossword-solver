// ---------------------------------------------------------------------------
// solutionStore.js
//
// Holds the verified solution grid fetched from the (simulated) solutions
// API (solutionApi.js), separate from the user's OCR'd guess
// (guessStore.js). Written by pipeline.js/main.js right after the fetch
// step; read wherever the correct answers are needed — diffing in
// comparison.js, or a future "reveal solution" UI.
//
// Unlike guessStore.js, this already holds the app's cell-object shape —
// solutionApi.js converts it internally before returning, since (unlike raw
// OCR text) a real solutions API would hand back structured data, not
// characters to parse.
// ---------------------------------------------------------------------------

let solutionGrid = null;

/** @returns {Array|null} the current verified solution grid (cell objects) */
export function getSolutionGrid() {
  return solutionGrid;
}

/** @param {Array} grid - cell-object grid, as returned by solutionApi.js's fetchCorrectSolution */
export function setSolutionGrid(grid) {
  solutionGrid = grid;
}

export function clearSolutionGrid() {
  solutionGrid = null;
}
