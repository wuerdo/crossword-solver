// ---------------------------------------------------------------------------
// explainerExample.js
//
// A baked-in, fully static example shown on the upload screen's explainer
// sidebar, illustrating what a reviewed result looks like before the
// person has uploaded anything real.
// ---------------------------------------------------------------------------

import { charGridToCellGrid } from './puzzleFixtures.js';

const EXAMPLE_LETTERS = [
  ['■', '■', 'T', 'A', 'X', '■', 'F', 'A', 'D', '■', '■', 'M'],
  ['■', 'K', 'A', 'M', 'A', 'S', 'U', 'T', 'R', 'A', '■', 'I'],
  ['S', 'E', 'R', 'E', 'N', 'A', 'S', 'L', 'A', 'M', '■', 'D'],
  ['P', 'E', 'T', 'N', 'A', 'M', 'E', '■', 'G', 'E', 'L', '■'],
  ['O', 'N', 'L', 'S', 'D', '■', '■', 'P', 'O', 'N', 'Y', 'T'],
  ['R', 'O', 'E', '■', 'U', 'P', 'S', 'A', 'N', 'D', 'D', 'O'],
  ['E', 'N', 'T', 'S', '■', 'A', 'L', 'L', 'S', 'M', 'I', 'L'],
  ['■', '■', '■', 'T', 'O', 'R', 'E', '■', 'D', 'E', 'A', 'L'],
  ['■', 'I', 'C', 'A', 'N', 'T', 'E', 'V', 'E', 'N', '■', 'S'],
  ['S', 'M', 'A', 'R', 'T', 'Y', 'P', 'A', 'N', 'T', 'S', '■'],
  ['O', 'P', 'E', 'R', 'A', 'B', 'O', 'X', '■', '■', 'P', 'Y'],
  ['W', 'E', 'S', '■', 'P', 'O', 'V', '■', 'S', 'N', 'E', 'A'],
];

// Two deliberately "wrong" cells, picked at random (from a fixed seed, so
// the baked-in example stays stable rather than reshuffling on every
// reload) — everything else white reads as correct, nothing is left
// missing. 2 wrong / 119 white cells works out to 98% solved / 2% wrong /
// 0% missing once run through computeStats.
const WRONG_CELLS = [
  { row: 8, col: 4 },
  { row: 1, col: 8 },
];

function isWrongCell(row, col) {
  return WRONG_CELLS.some((cell) => cell.row === row && cell.col === col);
}

function buildExampleComparedGrid() {
  const grid = charGridToCellGrid(EXAMPLE_LETTERS);
  return grid.map((row) =>
    row.map((cell) => {
      if (cell.black) return cell;
      return { ...cell, status: isWrongCell(cell.row, cell.col) ? 'wrong' : 'correct' };
    })
  );
}

export const EXAMPLE_COMPARED_GRID = buildExampleComparedGrid();

export const EXAMPLE_STATS = { solved: 98, wrong: 2, missing: 0 };
