// ---------------------------------------------------------------------------
// guessStore.js
//
// Holds the raw grid OCR'd from the user's filled-in cells (the "guess"),
// separate from the verified solution (solutionStore.js). Written by
// pipeline.js/main.js right after the OCR step (ocr.js).
//
// Stores whatever recognizeLetters returns as-is — a raw character grid
// ('■' black, ' ' empty, else a letter) — NOT the app's cell-object shape.
// Anything reading this grid to render it or diff it against the solution
// must convert it first with puzzleFixtures.js's charGridToCellGrid.
// ---------------------------------------------------------------------------

let guessGrid = null;

/** @returns {string[][]|null} the current raw OCR'd guess character grid */
export function getGuessGrid() {
  return guessGrid;
}

/** @param {string[][]} grid - raw character grid, as returned by ocr.js's recognizeLetters */
export function setGuessGrid(grid) {
  guessGrid = grid;
}

export function clearGuessGrid() {
  guessGrid = null;
}
