// ---------------------------------------------------------------------------
// upload.js
//
// Only concerned with the upload itself: accepting a file, validating it,
// handling errors, and storing the result. Recognition and the staged
// DETECTING -> RECOGNIZING -> REVIEW pipeline are someone else's job — see
// pipeline.js, which this hands off to once an upload succeeds.
// ---------------------------------------------------------------------------

import { stageManager, STAGES } from './stageManager.js';
import { setUploadedFile, clearUploadedFile } from './fileStore.js';
import { clearGuessGrid } from './guessStore.js';
import { clearSolutionGrid } from './solutionStore.js';
import { runRecognitionPipeline, cancelRecognitionPipeline } from './pipeline.js';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function resetAll() {
  clearGuessGrid();
  clearSolutionGrid();
}

function handleFile(file) {
  if (!file) return;

  if (!ACCEPTED_TYPES.includes(file.type)) {
    stageManager.setStage(STAGES.UPLOAD, {
      fileName: file.name,
      errorMessage:
        'Could not process image. The image may be too blurry, cropped incorrectly, or not a NYT crossword.',
    });
    return;
  }

  cancelRecognitionPipeline();
  resetAll();

  // Save the raw file so any module (OCR, presentation layer preview, etc.)
  // can read it via fileStore.js regardless of what happens next.
  setUploadedFile(file);
  // errorMessage explicitly cleared — setStage merges rather than replaces,
  // so without this a stale error (from a rejected file, or an earlier
  // failed solution fetch) could otherwise linger into this new attempt.
  stageManager.setStage(STAGES.DETECTING, { fileName: file.name, errorMessage: null });

  // Hand off to pipeline.js for everything past this point.
  runRecognitionPipeline(file);
}

// Wires up whichever dropzone/file-input is currently in the DOM. Safe to
// call after every render since it just no-ops when the elements are absent.
export function wireUploadControls(root) {
  const dropzone = root.querySelector('[data-dropzone]');
  const fileInput = root.querySelector('[data-file-input]');
  const backToUploadBtns = root.querySelectorAll('[data-action="back-to-upload"]');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleFile(file);
    });
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach((evt) => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(file);
    });
  }

  backToUploadBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      cancelRecognitionPipeline();
      resetAll();
      clearUploadedFile();
      stageManager.setStage(STAGES.UPLOAD, { fileName: null, errorMessage: null });
    });
  });
}
