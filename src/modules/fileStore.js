// ---------------------------------------------------------------------------
// fileStore.js
//
// Holds the most recently uploaded file (plus a preview URL for it) so any
// module can read it without the file having to be threaded through as an
// argument everywhere. Used by:
//   - upload.js          -> writes the file on a successful upload
//   - ocr.js              -> will read the file once real OCR replaces the
//                           placeholder step function
//   - presentation layer -> reads the preview URL to show the uploaded image
//
// Pre-loaded with the placeholder image before any real upload happens, so
// getPreviewUrl() always has something sensible to return rather than null.
// ---------------------------------------------------------------------------

import { PHOTO_SRC } from './placeholderImage.js';

let state = {
  file: null,
  previewUrl: PHOTO_SRC,
};

/** @returns {File|null} the currently stored file (null until a real upload happens) */
export function getUploadedFile() {
  return state.file;
}

/** @returns {string} an object URL for the real upload, or the placeholder if none yet */
export function getPreviewUrl() {
  return state.previewUrl;
}

/**
 * Stores a new file, replacing (and cleaning up) any previous one.
 * @param {File} file
 * @returns {string} the preview URL created for this file
 */
export function setUploadedFile(file) {
  clearUploadedFile();
  state.file = file;
  state.previewUrl = file ? URL.createObjectURL(file) : PHOTO_SRC;
  return state.previewUrl;
}

/** Clears the stored file and reverts the preview back to the placeholder. */
export function clearUploadedFile() {
  if (state.previewUrl && state.previewUrl !== PHOTO_SRC) {
    URL.revokeObjectURL(state.previewUrl);
  }
  state = { file: null, previewUrl: PHOTO_SRC };
}
