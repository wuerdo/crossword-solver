// ---------------------------------------------------------------------------
// gridLayout.js
//
// Grid structure helpers. There's no independent "detect the grid" step —
// layout (rows, cols, black-square positions) isn't precalculated ahead of
// time; it's derived from whatever recognizeLetters (ocr.js) actually
// found, same as it would be with real OCR.
// ---------------------------------------------------------------------------

/**
 * Derives a { rows, cols, blackFields } layout by reading the `black` flag
 * off each cell of an already-recognized grid — e.g. the output of ocr.js's
 * recognizeLetters.
 *
 * @param {Array} cellGrid - array of rows of { row, col, black, ... } cells
 * @returns {{rows:number, cols:number, blackFields: Array}}
 */
export function layoutFromCellGrid(cellGrid) {
  const blackFields = [];
  cellGrid.forEach((row) => {
    row.forEach((cell) => {
      if (cell.black) blackFields.push({ row: cell.row, col: cell.col });
    });
  });
  return {
    rows: cellGrid.length,
    cols: cellGrid[0] ? cellGrid[0].length : 0,
    blackFields,
  };
}

function isBlack(layout, r, c) {
  return layout.blackFields.some((f) => f.row === r && f.col === c);
}

// Builds a same-shaped placeholder grid from a layout — still used for the
// review stage's fallback while the verified solution is in flight.
export function buildBlankGrid(layout) {
  const grid = [];
  for (let r = 0; r < layout.rows; r++) {
    const row = [];
    for (let c = 0; c < layout.cols; c++) {
      row.push({ row: r, col: c, black: isBlack(layout, r, c), letter: null, status: null });
    }
    grid.push(row);
  }
  return grid;
}
