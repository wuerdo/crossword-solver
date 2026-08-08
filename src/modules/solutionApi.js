// ---------------------------------------------------------------------------
// solutionApi.js
//
// Step 3 of the pipeline — fetch the verified solution for today's date
// from the crossword solutions API.
//
// GET {CROSSWORD_API_URL}?date=YYYYMMDD
//
// Success response:
//   { "date": "20260730", "grid": [["R","E","S","E","T","■",...], ...] }
//   (grid uses '■' for black squares, letters elsewhere — no empty cells,
//   since this is the solution, not a guess)
//
// No solution saved for that date yet:
//   { "error": "No crossword saved for date 20260728" }
// ---------------------------------------------------------------------------

import { charGridToCellGrid } from './puzzleFixtures.js';

const CROSSWORD_API_URL =
  'https://faas-fra1-afec6ce7.doserverless.co/api/v1/web/fn-f6f1f5d4-823c-406f-8203-ce7bc303d5a7/api/get-crossword';

/** Thrown when the API has no crossword saved yet for the requested date. */
export class NoSolutionAvailableError extends Error {
  constructor(date, apiMessage) {
    super(apiMessage || `No crossword saved for date ${date}`);
    this.name = 'NoSolutionAvailableError';
    this.date = date;
  }
}

/** @returns {string} today's date as YYYYMMDD, e.g. "20260731" */
function todayDateParam() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Fetches today's verified solution grid.
 *
 * @param {{rows:number, cols:number, blackFields: Array}} layout - unused
 *   for now (the API is keyed by date, not by the detected grid shape),
 *   kept so this step's signature stays consistent with the rest of the
 *   pipeline (see recognizeLetters/fetchCorrectSolution call sites).
 * @returns {Promise<Array>} the verified solution grid, converted to the
 *   app's cell-object shape.
 * @throws {NoSolutionAvailableError} if the API has no crossword for today.
 * @throws {Error} on any other network/response failure.
 */
export async function fetchCorrectSolution(layout) {
  const date = todayDateParam();

  let res;
  try {
    res = await fetch(`${CROSSWORD_API_URL}?date=${date}`);
  } catch (err) {
    throw new Error(`Failed to reach the crossword solutions API: ${err.message}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error('Crossword solutions API returned an unreadable response.');
  }

  if (data.error) {
    throw new NoSolutionAvailableError(date, data.error);
  }

  if (!res.ok) {
    throw new Error(`Crossword solutions API request failed (${res.status}).`);
  }

  return charGridToCellGrid(data.grid);
}
