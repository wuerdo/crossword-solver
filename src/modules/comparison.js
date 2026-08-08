// ---------------------------------------------------------------------------
// comparison.js
//
// Step 4 of the pipeline — pure diff logic. Given the OCR'd guess grid (from
// guessStore.js / ocr.js) and the verified solution grid (from
// solutionStore.js / solutionApi.js) — both arrays of
// { row, col, black, letter } cells — produces a grid of the same shape
// whose cells always show the CORRECT letter, annotated with a status
// describing how the guess compared to it. Also turns that diff into
// Solved/Wrong/Missing percentages.
//
// Pure and store-free by design: it only ever reads the two grids it's
// handed, so it doesn't care where they came from or how they got stored.
// ---------------------------------------------------------------------------

/**
 * Checks that two cell grids describe the same puzzle shape — same
 * dimensions and the same black-square positions — before it's safe to
 * diff them cell-by-cell. A mismatch here means OCR detected a different
 * grid than today's accepted solution (wrong puzzle, bad crop, garbled
 * recognition, etc.); the caller should show that as an error instead of
 * running the comparison.
 *
 * @param {Array} guessGrid - the OCR'd grid (guessStore.js, converted)
 * @param {Array} solutionGrid - the verified solution grid (solutionStore.js)
 * @returns {boolean} true only if dimensions and every black-square
 *   position match exactly
 */
export function gridShapesMatch(guessGrid, solutionGrid) {
  if (guessGrid.length !== solutionGrid.length) return false;

  for (let r = 0; r < solutionGrid.length; r++) {
    if (guessGrid[r].length !== solutionGrid[r].length) return false;

    for (let c = 0; c < solutionGrid[r].length; c++) {
      if (guessGrid[r][c].black !== solutionGrid[r][c].black) return false;
    }
  }

  return true;
}

/**
 * @param {Array} guessGrid - the OCR'd grid (guessStore.js)
 * @param {Array} solutionGrid - the verified solution grid (solutionStore.js)
 * @returns {Array} a grid of cells with `status`: 'correct' | 'wrong' | 'missing',
 *   always carrying the correct letter (black cells passed through as-is).
 *   Callers should check gridShapesMatch first — this assumes the two
 *   grids already line up cell-for-cell.
 */
export function compareResults(guessGrid, solutionGrid) {
  if (import.meta.env?.DEV) {
    const guessLetterCount = guessGrid.flat().filter((c) => c.letter).length;
    if (guessLetterCount === 0) {
      // Real OCR could legitimately return an all-blank grid, but the mock
      // (ocr.js) never should — this almost always means guessGrid is
      // stale/wrong (e.g. an empty layoutGrid got passed in by mistake)
      // rather than a genuine "nothing recognized" result.
      console.warn(
        '[comparison] compareResults received a guess grid with zero recognized letters — ' +
          'every cell will show as "missing". If this is unexpected, check what produced guessGrid.'
      );
    }
  }

  return solutionGrid.map((row, r) =>
    row.map((correctCell, c) => {
      if (correctCell.black) return { ...correctCell };

      const guessCell = guessGrid[r][c];
      let status;
      if (!guessCell.letter) {
        status = 'missing';
      } else if (guessCell.letter === correctCell.letter) {
        status = 'correct';
      } else {
        status = 'wrong';
      }

      return { ...correctCell, status };
    })
  );
}

/**
 * @param {Array} comparedGrid - output of compareResults
 * @returns {{solved:number, wrong:number, missing:number}} rounded percentages
 */
export function computeStats(comparedGrid) {
  let correct = 0;
  let wrong = 0;
  let missing = 0;
  let total = 0;

  for (const row of comparedGrid) {
    for (const cell of row) {
      if (cell.black) continue;
      total += 1;
      if (cell.status === 'correct') correct += 1;
      else if (cell.status === 'wrong') wrong += 1;
      else if (cell.status === 'missing') missing += 1;
    }
  }

  if (total === 0) return { solved: 0, wrong: 0, missing: 0 };

  return {
    solved: Math.round((correct / total) * 100),
    wrong: Math.round((wrong / total) * 100),
    missing: Math.round((missing / total) * 100),
  };
}
