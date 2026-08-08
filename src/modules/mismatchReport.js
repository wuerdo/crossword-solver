// ---------------------------------------------------------------------------
// mismatchReport.js
//
// Placeholder for reporting a suspected-faulty recognition to engineers —
// shown when the OCR'd guess grid and the accepted solution don't line up
// in shape (different dimensions or black-square layout), so a real
// comparison can't be run.
//
// Real version: POST the details to a support/bug-report endpoint. Mock:
// simulates a network delay and logs what would have been sent.
// ---------------------------------------------------------------------------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{fileName: string|null, guessGrid: Array|null, solutionGrid: Array|null}} details
 * @returns {Promise<{success: boolean}>}
 */
export async function sendMismatchReport(details) {
  await wait(500);
  console.info('[mismatchReport] automated report sent:', details);
  return { success: true };
}
