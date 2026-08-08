// ---------------------------------------------------------------------------
// puzzleFixtures.js
//
// Hardcoded puzzle data shared by the pipeline placeholders. Both grids use
// the same character format: '■' marks a black square, ' ' marks an empty
// white cell, anything else is a letter. Keeping both in one format/file
// means the grid structure (black squares) can be derived from either one
// consistently, and swapping in real OCR/API data later is a one-file change.
//
//   SOLUTION_LETTERS         -> the verified answer key (solutionApi.js)
//   SAMPLE_RECOGNIZED_LETTERS -> a plausible OCR "guess" of the same puzzle,
//                                 with some cells misread or left blank (ocr.js)
// ---------------------------------------------------------------------------

export const SOLUTION_LETTERS = [
  ['A', 'L', 'M', 'S', '■', 'H', 'E', 'S', 'S', 'E', '■', 'O', 'P', 'A', 'L'],
  ['G', 'O', 'A', 'T', '■', 'A', 'C', 'M', 'E', 'S', '■', 'P', 'A', 'L', 'E'],
  ['O', 'G', 'R', 'E', '■', 'B', 'O', 'O', 'N', 'S', '■', 'E', 'E', 'L', 'S'],
  ['■', 'B', 'L', 'A', 'Z', 'I', 'N', 'G', 'S', 'A', 'D', 'D', 'L', 'E', 'S'],
  ['G', 'O', 'B', 'L', 'E', 'T', '■', '■', 'E', 'Y', 'E', '■', 'L', 'Y', 'E'],
  ['T', 'O', 'O', '■', 'D', 'A', 'M', 'P', '■', '■', 'P', 'H', 'A', 'S', 'E'],
  ['O', 'K', 'R', 'A', '■', 'B', 'O', 'O', '■', 'B', 'O', 'A', '■', '■', '■'],
  ['■', 'S', 'O', 'M', 'E', 'L', 'I', 'K', 'E', 'I', 'T', 'H', 'O', 'T', '■'],
  ['■', '■', '■', 'I', 'N', 'E', '■', 'E', 'R', 'R', '■', 'A', 'B', 'E', 'D'],
  ['A', 'S', 'H', 'E', 'N', '■', '■', 'R', 'E', 'D', 'O', '■', 'D', 'E', 'Y'],
  ['R', 'A', 'E', '■', 'U', 'P', 'S', '■', '■', 'S', 'A', 'L', 'U', 'T', 'E'],
  ['C', 'H', 'A', 'R', 'I', 'O', 'T', 'S', 'O', 'F', 'F', 'I', 'R', 'E', '■'],
  ['T', 'A', 'L', 'E', '■', 'P', 'I', 'A', 'N', 'O', '■', 'C', 'A', 'R', 'E'],
  ['I', 'R', 'E', 'S', '■', 'P', 'L', 'U', 'T', 'O', '■', 'I', 'T', 'E', 'M'],
  ['C', 'A', 'R', 'T', '■', 'A', 'L', 'L', 'O', 'T', '■', 'T', 'E', 'D', 'S'],
];

export const SAMPLE_RECOGNIZED_LETTERS = [
  ['A', 'L', 'M', ' ', '■', 'H', 'E', ' ', 'S', 'E', '■', 'O', ' ', 'A', 'K'],
  ['G', 'O', ' ', 'T', '■', 'A', 'C', ' ', 'E', 'S', '■', 'P', ' ', 'L', 'E'],
  [' ', 'G', 'R', 'E', '■', ' ', 'O', 'U', 'N', 'S', '■', ' ', 'E', 'L', 'S'],
  ['■', ' ', 'L', 'A', 'Z', ' ', 'N', 'G', ' ', 'A', 'D', 'D', ' ', 'E', 'R'],
  ['G', 'O', ' ', 'L', 'E', 'T', '■', '■', ' ', 'Y', 'E', '■', 'L', ' ', 'E'],
  ['T', ' ', 'O', '■', 'D', 'A', ' ', 'P', '■', '■', 'W', 'H', 'A', ' ', 'E'],
  ['O', 'K', ' ', 'A', '■', 'B', 'O', ' ', '■', 'B', 'O', ' ', '■', '■', '■'],
  ['■', 'S', 'O', 'M', ' ', 'L', 'V', 'K', 'E', ' ', 'T', 'H', 'O', ' ', '■'],
  ['■', '■', '■', 'I', 'N', 'E', '■', ' ', 'R', 'R', '■', ' ', 'B', 'E', 'D'],
  [' ', 'S', 'E', 'E', 'N', '■', '■', ' ', 'E', 'D', 'O', '■', ' ', 'E', 'Y'],
  ['R', ' ', 'E', '■', 'U', ' ', 'S', '■', '■', 'S', 'A', ' ', 'U', 'G', 'E'],
  ['C', ' ', 'A', 'R', 'I', ' ', 'T', 'S', 'O', ' ', 'F', 'I', ' ', 'E', '■'],
  ['T', 'A', ' ', 'E', '■', 'A', 'I', 'A', ' ', 'O', '■', 'C', 'A', ' ', 'E'],
  ['I', 'R', ' ', 'S', '■', 'P', ' ', 'U', 'T', 'O', '■', ' ', 'T', 'O', 'M'],
  ['C', ' ', 'R', 'T', '■', 'A', ' ', 'L', 'O', 'T', '■', ' ', 'E', 'D', ' '],
];

const BLACK = '■';
const EMPTY = ' ';

/**
 * Converts one of the character grids above into the cell-object shape the
 * rest of the app works with: { row, col, black, letter, status }.
 *
 * @param {string[][]} charGrid - SOLUTION_LETTERS or SAMPLE_RECOGNIZED_LETTERS
 * @returns {Array} grid of cells
 */
export function charGridToCellGrid(charGrid) {
  return charGrid.map((row, r) =>
    row.map((ch, c) => ({
      row: r,
      col: c,
      black: ch === BLACK,
      letter: ch === BLACK || ch === EMPTY ? null : ch,
      status: null,
    }))
  );
}
