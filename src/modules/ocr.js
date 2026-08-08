/**
 * recognizeLetters.js
 * -----------------------------------------------------------------------
 * Browser port of the crossword-ocr pipeline (step1_crop -> step2_gridlines
 * -> step3_analyze), ported from the Node/Jimp CLI to run entirely in a
 * browser using Canvas + tesseract.js's browser build.
 *
 * This version matches the theme-aware algorithm: STEP 1 detects light vs.
 * dark screenshot theme and searches for the largest border RECTANGLE
 * matching a fixed color for that theme (falling back to the other theme's
 * color if nothing valid is found), rejecting false positives carved out of
 * a large uniform background via a "bounded frame" check. Before searching,
 * the color-match matrix is passed through a morphological closing step to
 * bridge single-pixel gaps anti-aliasing punches into thin border lines.
 *
 * STEP 2 builds its match matrix theme-aware (a tolerance-based near-color
 * match against the same fixed border color STEP 1 uses, for dark theme;
 * for light theme, a luminance threshold derived ADAPTIVELY from each
 * image's own background-luma histogram rather than a fixed constant,
 * since the true background/gridline luma gap shifts per renderer,
 * anti-aliasing, and compression). It then PRIMARILY detects grid lines
 * directly by finding indices that are matching across nearly the full
 * length of the cross axis — i.e. an actual continuous line, as opposed to
 * a solid block cell. Only if that's inconclusive does it fall back to the
 * older solid-square + autocorrelation-period approach, reconciling the two
 * signals by only trusting a measured period when it's corroborated by (or
 * cleanly explains a merged-block inflation of) the direct square
 * measurement.
 *
 * STEP 3 binarizes with theme-correct polarity, masks clue numbers via
 * connected components — first checking whether every ink component stays
 * confined to a top-left corner region (if so, nothing found is an actual
 * letter yet, so the whole cell is cleared), otherwise identifying the
 * TALLEST component as the real letter and stripping only shorter
 * components that both sit above it and stay within that same corner
 * region — and applies several geometry-based corrections for
 * OCR-confusable letters (A/V/Z, Y/V/M, V/U, J/U, K/S) — each triggered
 * only for the specific letter it corrects, so ordinary correct answers
 * pass through untouched.
 *
 * Usage:
 *   import { recognizeLetters } from './recognizeLetters.js';
 *
 *   const grid = await recognizeLetters(fileOrImageElement);
 *   // grid is a string[][]  (rows of cell values)
 *   //   - a letter 'A'-'Z'  -> OCR'd filled cell
 *   //   - ' ' (space)       -> cell judged blank/empty
 *   //   - '■'               -> a blocked (solid) cell
 *
 * Input:
 *   `image` may be any of: HTMLImageElement, HTMLCanvasElement,
 *   OffscreenCanvas, HTMLVideoElement, ImageBitmap, ImageData, Blob/File,
 *   or a URL string. Whatever is passed is drawn to an internal canvas and
 *   read back as raw RGBA pixels — nothing here mutates or depends on the
 *   original element.
 *
 * Dependencies:
 *   This module expects `tesseract.js` to be installed in the host project
 *   (https://www.npmjs.com/package/tesseract.js) since it uses that
 *   package's browser-compatible `createWorker` API to OCR each filled
 *   cell. No other runtime dependency is required — all pixel math is
 *   plain Canvas/TypedArray code with no other third-party library.
 *
 * Logging:
 *   Each recognized row is logged to the console as it's produced (see
 *   analyzeCells below) so progress is visible while OCR runs. All
 *   failures are additionally surfaced by throwing an `Error` (tagged
 *   "STEP 0/1/2/3 - Error: ..." to identify which stage failed).
 * -----------------------------------------------------------------------
 */

import { createWorker } from 'tesseract.js';

/* =========================================================================
 * Generic pixel-buffer helpers
 * A "buffer" here is always a plain { width, height, data } object where
 * `data` is a Uint8ClampedArray of RGBA bytes — the same shape as a Canvas
 * ImageData.data buffer. Every image-processing function below operates
 * only on this plain shape.
 * ========================================================================= */

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('No canvas implementation available in this environment (need OffscreenCanvas or document)');
}

function getPixelIndex(buf, x, y) {
  return (y * buf.width + x) * 4;
}

function getPixelRGBA(buf, x, y) {
  const i = getPixelIndex(buf, x, y);
  return { r: buf.data[i], g: buf.data[i + 1], b: buf.data[i + 2], a: buf.data[i + 3] };
}

function makeBuffer(width, height, fillRGBA) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fillRGBA) {
    const [r, g, b, a] = fillRGBA;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

function cloneBuffer(buf) {
  return { width: buf.width, height: buf.height, data: new Uint8ClampedArray(buf.data) };
}

function cropBuffer(buf, x, y, w, h) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(Math.round(w), buf.width - x));
  h = Math.max(1, Math.min(Math.round(h), buf.height - y));

  const out = makeBuffer(w, h, null);
  for (let yy = 0; yy < h; yy++) {
    const srcStart = getPixelIndex(buf, x, y + yy);
    out.data.set(buf.data.subarray(srcStart, srcStart + w * 4), yy * w * 4);
  }
  return out;
}

function greyscaleInPlace(buf) {
  const d = buf.data;
  for (let i = 0; i < d.length; i += 4) {
    const luma = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = luma;
    d[i + 1] = luma;
    d[i + 2] = luma;
  }
  return buf;
}

function compositeBuffer(dest, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const destY = dy + y;
    if (destY < 0 || destY >= dest.height) continue;
    for (let x = 0; x < src.width; x++) {
      const destX = dx + x;
      if (destX < 0 || destX >= dest.width) continue;

      const si = getPixelIndex(src, x, y);
      const alpha = src.data[si + 3] / 255;
      if (alpha <= 0) continue;

      const di = getPixelIndex(dest, destX, destY);
      if (alpha >= 1) {
        dest.data[di] = src.data[si];
        dest.data[di + 1] = src.data[si + 1];
        dest.data[di + 2] = src.data[si + 2];
        dest.data[di + 3] = 255;
      } else {
        for (let c = 0; c < 3; c++) {
          dest.data[di + c] = Math.round(src.data[si + c] * alpha + dest.data[di + c] * (1 - alpha));
        }
        dest.data[di + 3] = 255;
      }
    }
  }
  return dest;
}

function bufferToCanvas(buf) {
  const canvas = createCanvas(buf.width, buf.height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(buf.width, buf.height);
  imgData.data.set(buf.data);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function resizeBuffer(buf, newWidth, newHeight) {
  newWidth = Math.max(1, Math.round(newWidth));
  newHeight = Math.max(1, Math.round(newHeight));

  const src = bufferToCanvas(buf);
  const dst = createCanvas(newWidth, newHeight);
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, newWidth, newHeight);

  const outData = ctx.getImageData(0, 0, newWidth, newHeight);
  return { width: newWidth, height: newHeight, data: new Uint8ClampedArray(outData.data) };
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from the provided Blob/File'));
    };
    img.src = url;
  });
}

function urlToImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image from URL: ${url}`));
    img.src = url;
  });
}

/**
 * Normalizes any supported input into a plain { width, height, data } RGBA
 * pixel buffer.
 */
async function loadImageBuffer(input) {
  if (!input) {
    throw new Error('No image was provided');
  }

  // Already a plain/ImageData-like buffer.
  if (
    typeof input === 'object' &&
    !(typeof Blob !== 'undefined' && input instanceof Blob) &&
    input.data &&
    typeof input.width === 'number' &&
    typeof input.height === 'number'
  ) {
    return { width: input.width, height: input.height, data: new Uint8ClampedArray(input.data) };
  }

  let drawable = input;

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    drawable = await blobToImage(input);
  } else if (typeof input === 'string') {
    drawable = await urlToImage(input);
  } else if (typeof drawable.decode === 'function' && drawable.complete === false) {
    await drawable.decode().catch(() => {});
  }

  const width = drawable.naturalWidth || drawable.videoWidth || drawable.width;
  const height = drawable.naturalHeight || drawable.videoHeight || drawable.height;

  if (!width || !height) {
    throw new Error('Unable to determine image dimensions from the provided input');
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(drawable, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(imgData.data) };
}

/* =========================================================================
 * STEP 1 - locate + crop the grid border rectangle
 * (ported from src/imageCoreManual.js)
 * ========================================================================= */

function detectTheme(buf, opts = {}) {
  const marginFraction = opts.marginFraction ?? 0.05;
  const threshold = opts.threshold ?? 128;

  const { width, height, data } = buf;
  const mx = Math.floor(width * marginFraction);
  const my = Math.floor(height * marginFraction);

  let sum = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    const inVerticalMargin = marginFraction === 0 || y < my || y >= height - my;
    for (let x = 0; x < width; x++) {
      const inHorizontalMargin = marginFraction === 0 || x < mx || x >= width - mx;
      if (marginFraction !== 0 && !inVerticalMargin && !inHorizontalMargin) continue;

      const idx = (y * width + x) * 4;
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count++;
    }
  }

  const avgLuminance = sum / count;
  return { isLightTheme: avgLuminance > threshold, avgLuminance };
}

function isNearColor(r, g, b, target, tolerance) {
  return Math.abs(r - target.r) <= tolerance && Math.abs(g - target.g) <= tolerance && Math.abs(b - target.b) <= tolerance;
}

/**
 * Binary dilation: a pixel becomes a match if ANY pixel within `radius`
 * (Chebyshev distance, i.e. a square neighborhood) is currently a match.
 */
function dilateMatch(match, width, height, radius) {
  const out = new Array(height);
  for (let y = 0; y < height; y++) out[y] = new Uint8Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let found = 0;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const row = match[ny];
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (row[nx]) {
            found = 1;
            break;
          }
        }
      }
      out[y][x] = found;
    }
  }
  return out;
}

/**
 * Binary erosion: a pixel stays a match only if EVERY pixel within
 * `radius` is currently a match. Out-of-bounds neighbors count as
 * non-match, so matches shrink away from the image edge too.
 */
function erodeMatch(match, width, height, radius) {
  const out = new Array(height);
  for (let y = 0; y < height; y++) out[y] = new Uint8Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let all = 1;
      for (let dy = -radius; dy <= radius && all; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          all = 0;
          break;
        }
        const row = match[ny];
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || !row[nx]) {
            all = 0;
            break;
          }
        }
      }
      out[y][x] = all;
    }
  }
  return out;
}

/**
 * Morphological closing (dilate then erode) with a `radius`-sized square
 * structuring element. Fills small gaps in an otherwise-continuous line
 * without growing the overall shape, which matters here specifically for
 * thin (often ~1px) border/gridlines: anti-aliasing or re-encoding can
 * shift an occasional pixel just outside the color tolerance, breaking
 * the run-length continuity that findLargestBorderRectangle relies on to
 * treat an edge as fully matching. A radius of 1 bridges single-pixel
 * gaps; raise it if lines are still breaking up after that.
 *
 * @param {Uint8Array[]} match
 * @param {number} width
 * @param {number} height
 * @param {number} radius - 0 disables closing entirely (returns match as-is)
 */
function closeMatchGaps(match, width, height, radius) {
  if (!radius) return match;
  const dilated = dilateMatch(match, width, height, radius);
  return erodeMatch(dilated, width, height, radius);
}

/**
 * Rejects false-positive rectangles carved arbitrarily out of a large
 * uniform region (e.g. a keyboard/status-bar background). A real grid
 * border is a bounded frame: the pixels just outside it are NOT the
 * border color. A rectangle sliced out of a bigger uniform-color area
 * fails this, because the same matching color continues past its edges.
 */
function isBoundedFrame(match, x, y, w, h, width, height, margin = 6) {
  const x2 = x + w - 1;
  const y2 = y + h - 1;
  let outsideMatches = 0;
  let outsideChecked = 0;

  const checkPoint = (px, py) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return; // image edge, skip
    outsideChecked++;
    if (match[py][px]) outsideMatches++;
  };

  for (let d = 1; d <= margin; d++) {
    for (let px = x; px <= x2; px++) {
      checkPoint(px, y - d); // above top edge
      checkPoint(px, y2 + d); // below bottom edge
    }
    for (let py = y; py <= y2; py++) {
      checkPoint(x - d, py); // left of left edge
      checkPoint(x2 + d, py); // right of right edge
    }
  }

  if (outsideChecked === 0) return true; // rectangle touches image edge; can't check, allow it
  const outsideMatchFraction = outsideMatches / outsideChecked;
  return outsideMatchFraction < 0.5; // mostly non-matching just outside = real bounded frame
}

/**
 * Searches for the largest-area RECTANGLE (width and height may differ)
 * whose border is entirely pixels matching `target` (within `tolerance`).
 * Returns null instead of throwing if none is found, so callers can try
 * multiple candidate colors.
 */
function findLargestBorderRectangle(buf, target, tolerance, minSize, closingRadius = 1) {
  const { width, height } = buf;

  let match = new Array(height);
  for (let y = 0; y < height; y++) {
    match[y] = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      match[y][x] = isNearColor(r, g, b, target, tolerance) ? 1 : 0;
    }
  }

  // Bridge single-pixel gaps in thin border/gridlines before searching —
  // without this, a single broken pixel anywhere along the true outer
  // border silently disqualifies it, and the search instead returns
  // whichever smaller, fully-intact rectangle it can find.
  match = closeMatchGaps(match, width, height, closingRadius);

  const right = new Array(height);
  const down = new Array(height);
  for (let y = 0; y < height; y++) {
    right[y] = new Int32Array(width);
    down[y] = new Int32Array(width);
  }
  for (let y = 0; y < height; y++) {
    for (let x = width - 1; x >= 0; x--) {
      right[y][x] = match[y][x] ? (x + 1 < width ? right[y][x + 1] : 0) + 1 : 0;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) {
      down[y][x] = match[y][x] ? (y + 1 < height ? down[y + 1][x] : 0) + 1 : 0;
    }
  }

  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (match[y][x]) points.push([x, y]);
    }
  }

  let best = null; // { x, y, w, h, area }

  for (const [x1, y1] of points) {
    const maxW = Math.min(width - x1, right[y1][x1]);
    const maxH = Math.min(height - y1, down[y1][x1]);
    if (maxW < minSize || maxH < minSize) continue;

    // Upper bound on area achievable from this corner at all — cheap prune.
    if (best && maxW * maxH <= best.area) continue;

    for (let w = maxW; w >= minSize; w--) {
      if (best && w * maxH <= best.area) break; // w only decreases from here

      const rightCol = x1 + w - 1;
      const effectiveMaxH = Math.min(maxH, down[y1][rightCol]);
      if (effectiveMaxH < minSize) continue;
      if (best && w * effectiveMaxH <= best.area) continue;

      for (let h = effectiveMaxH; h >= minSize; h--) {
        if (best && w * h <= best.area) break; // h only decreases from here too

        const bottomRow = y1 + h - 1;
        if (right[bottomRow][x1] < w) continue; // bottom edge
        if (down[y1][rightCol] < h) continue; // right edge
        if (!isBoundedFrame(match, x1, y1, w, h, width, height)) continue;

        const area = w * h;
        if (!best || area > best.area) {
          best = { x: x1, y: y1, w, h, area };
        }
        break; // largest valid h for this (corner, w) found
      }
    }
  }

  if (!best) return null;
  return { x: best.x, y: best.y, w: best.w, h: best.h, match };
}

/**
 * Fixed border colors keyed by theme: light-themed screenshots have a pure
 * black (0,0,0) border/gridline color, dark-themed screenshots have a
 * (23,23,25) border/gridline color.
 */
const LIGHT_THEME_BORDER_COLOR = { r: 0, g: 0, b: 0 };
const DARK_THEME_BORDER_COLOR = { r: 23, g: 23, b: 25 };

function runDarkThemePipeline(buf, minSize, opts) {
  const tolerance = opts.tolerance ?? 15;
  const closingRadius = opts.closingRadius ?? 1;
  const target = DARK_THEME_BORDER_COLOR;
  const result = findLargestBorderRectangle(buf, target, tolerance, minSize, closingRadius);
  return { target, result };
}

function runLightThemePipeline(buf, minSize, opts) {
  const tolerance = opts.tolerance ?? 15;
  const closingRadius = opts.closingRadius ?? 1;
  const target = LIGHT_THEME_BORDER_COLOR;
  const result = findLargestBorderRectangle(buf, target, tolerance, minSize, closingRadius);
  return { target, result };
}

/**
 * Finds the largest RECTANGLE (width and height may differ) whose border
 * is entirely a "match" color, and crops it. Theme is detected up front,
 * and dark vs. light screenshots are routed through separate pipelines
 * using their respective fixed border color. If the theme-matching
 * pipeline finds nothing, the other fixed color is tried as a fallback (in
 * case theme detection was borderline).
 *
 * @param {object} buf
 * @param {number} [minSize] - minimum width AND height to consider valid
 *   (defaults to 20% of the shorter image dimension)
 * @param {object} [opts]
 * @param {number} [opts.closingRadius=1] - morphological closing radius
 *   applied to the color-match matrix before searching, to bridge
 *   single-pixel gaps in thin/anti-aliased border lines. Raise to 2 if the
 *   detected crop is still coming back smaller than the real grid; set to
 *   0 to disable.
 * @returns {{buffer:object, x:number, y:number, width:number, height:number, isLightTheme:boolean, borderColor:object}}
 */
function cropLargestBorderRectangle(buf, minSize, opts = {}) {
  const { width, height } = buf;
  if (minSize == null) {
    minSize = Math.floor(Math.min(width, height) * 0.2);
  }

  const { isLightTheme } = detectTheme(buf, {
    marginFraction: opts.themeMarginFraction ?? 0.05,
    threshold: opts.themeThreshold ?? 128,
  });

  let pipelineResult = isLightTheme ? runLightThemePipeline(buf, minSize, opts) : runDarkThemePipeline(buf, minSize, opts);
  let usedPipeline = isLightTheme ? 'light' : 'dark';

  if (!pipelineResult.result) {
    pipelineResult = isLightTheme ? runDarkThemePipeline(buf, minSize, opts) : runLightThemePipeline(buf, minSize, opts);
    usedPipeline = isLightTheme ? 'dark' : 'light';
  }

  const { target, result } = pipelineResult;

  if (!result) {
    throw new Error(`No rectangle with a valid border was found. Tried dark and light candidate pipelines (minSize ${minSize}).`);
  }

  if (result.w < 10 || result.h < 10) {
    throw new Error(`Detected crop region is implausibly small (${result.w}x${result.h}px) - grid detection likely failed on this image`);
  }

  const cropped = cropBuffer(buf, result.x, result.y, result.w, result.h);
  return {
    buffer: cropped,
    x: result.x,
    y: result.y,
    width: result.w,
    height: result.h,
    isLightTheme,
    borderColor: target,
    usedPipeline,
  };
}

/* =========================================================================
 * STEP 2 - gridline / row-col detection
 * (ported from src/step2_gridlines.js)
 * ========================================================================= */

function findLargestSolidSquare(match, width, height) {
  const dp = new Array(height);
  for (let y = 0; y < height; y++) dp[y] = new Int32Array(width);

  let maxSize = 0;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (match[y][x]) {
        dp[y][x] = x === 0 || y === 0 ? 1 : Math.min(dp[y - 1][x], dp[y][x - 1], dp[y - 1][x - 1]) + 1;
        if (dp[y][x] > maxSize) {
          maxSize = dp[y][x];
          maxX = x;
          maxY = y;
        }
      }
    }
  }

  if (maxSize === 0) return null;
  return { size: maxSize, x: maxX - maxSize + 1, y: maxY - maxSize + 1 };
}

// Independent tile-size estimate: autocorrelation of the dark-fraction
// profile along one axis. Unlike the single-square heuristic, this isn't
// thrown off by one oversized/merged black cell — the true tile period
// shows up consistently across the whole grid.
//
// axis: 'col' profiles each column (collapsing over y) to estimate the
//   HORIZONTAL period. axis: 'row' profiles each row (collapsing over x)
//   to estimate the VERTICAL period.
function estimatePeriodFromProjection(match, width, height, axis, minTile = 20, maxTile = 150) {
  const length = axis === 'row' ? height : width;
  const other = axis === 'row' ? width : height;

  const profile = new Float64Array(length);
  if (axis === 'row') {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) sum += match[y][x];
      profile[y] = sum / other;
    }
  } else {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = 0; y < height; y++) sum += match[y][x];
      profile[x] = sum / other;
    }
  }

  const mean = profile.reduce((a, b) => a + b, 0) / length;
  for (let i = 0; i < length; i++) profile[i] -= mean;

  let bestLag = null;
  let bestScore = -Infinity;
  for (let lag = minTile; lag <= maxTile && lag < length; lag++) {
    let score = 0;
    for (let i = 0; i < length - lag; i++) score += profile[i] * profile[i + lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return bestLag;
}

function rowMatchFraction(match, y, width) {
  let count = 0;
  for (let x = 0; x < width; x++) if (match[y][x]) count++;
  return count / width;
}

function colMatchFraction(match, x, height) {
  let count = 0;
  for (let y = 0; y < height; y++) if (match[y][x]) count++;
  return count / height;
}

// Two-phase trim: skip any light margin before looking for the dark border.
function computeEdgeTrim(match, width, height, threshold = 0.6) {
  const rowFrac = (y) => rowMatchFraction(match, y, width);
  const colFrac = (x) => colMatchFraction(match, x, height);

  let top = 0;
  while (top < height && rowFrac(top) <= threshold) top++; // skip light margin
  while (top < height && rowFrac(top) > threshold) top++; // skip dark border

  let bottom = 0;
  while (bottom < height && rowFrac(height - 1 - bottom) <= threshold) bottom++;
  while (bottom < height && rowFrac(height - 1 - bottom) > threshold) bottom++;

  let left = 0;
  while (left < width && colFrac(left) <= threshold) left++;
  while (left < width && colFrac(left) > threshold) left++;

  let right = 0;
  while (right < width && colFrac(width - 1 - right) <= threshold) right++;
  while (right < width && colFrac(width - 1 - right) > threshold) right++;

  return { top, bottom, left, right };
}

function computeFitCount(totalLength, tileSize, tolerance = 0.03) {
  const rawCount = totalLength / tileSize;
  const count = Math.max(1, Math.round(rawCount));
  const adjustedTileSize = totalLength / count;
  const deviation = Math.abs(adjustedTileSize - tileSize) / tileSize;

  return { count, adjustedTileSize, deviation, withinTolerance: deviation <= tolerance };
}

// Reconciles two independent tile-size signals: the solid-square detection
// (candidateSize — a direct measurement of one actual cell) and the
// autocorrelation period estimate(s) (projectedPeriods — derived from
// periodicity across the whole grid).
//
// IMPORTANT: computeFitCount's "withinTolerance" is only a self-consistency
// check — it confirms a size divides effectiveWidth/effectiveHeight evenly,
// NOT that the size is actually correct. A wrong period (a harmonic, or
// noise from a run of highlighted cells skewing the projection) can still
// pass that check purely by coincidence. So a period is only trusted at
// face value if it's corroborated by agreeing with the independently-
// measured candidateSize — agreement between two unrelated measurement
// methods is real evidence; either one passing its own self-consistency
// check alone is not.
function refineTileSize(effectiveWidth, effectiveHeight, candidateSize, tolerance, projectedPeriods = []) {
  const rawPeriods = [...new Set(projectedPeriods.filter(Boolean))];

  const tryFit = (size) => {
    const colFit = computeFitCount(effectiveWidth, size, tolerance);
    const rowFit = computeFitCount(effectiveHeight, size, tolerance);
    return { size, colFit, rowFit, ok: colFit.withinTolerance && rowFit.withinTolerance };
  };
  const relDiff = (a, b) => Math.abs(a - b) / Math.max(a, b);

  // How close a period must be to candidateSize to count as confirming the
  // same tile rather than a coincidentally-self-consistent peak.
  const agreementTolerance = 0.2;
  const corroboratedPeriods = rawPeriods.filter((p) => relDiff(p, candidateSize) <= agreementTolerance);

  // 1. Best case: a period agrees with the square candidate directly AND
  //    fits both dimensions. Two independent measurements landing on the
  //    same value is the strongest evidence available.
  for (const period of corroboratedPeriods) {
    const fit = tryFit(period);
    if (fit.ok) return { tileSize: period, colFit: fit.colFit, rowFit: fit.rowFit };
  }

  // 2. A period that's approximately candidateSize / k for a small integer
  //    k >= 2 explains a MERGED block: several touching same-color cells
  //    (typically black/blank squares with no visible separator between
  //    them) inflated the solid-square detection to a multiple of the true
  //    tile — merges can only inflate a square measurement, never shrink it
  //    below the true cell size. Since the period is measured independently
  //    of the square detection, landing cleanly on such a submultiple is
  //    real corroboration that the square is inflated, not coincidence, so
  //    it's checked BEFORE ever trusting the raw square value.
  for (const period of rawPeriods) {
    const ratio = candidateSize / period;
    const rounded = Math.round(ratio);
    if (rounded >= 2 && rounded <= 6 && relDiff(ratio, rounded) <= 0.1) {
      const fit = tryFit(period);
      if (fit.ok) return { tileSize: period, colFit: fit.colFit, rowFit: fit.rowFit };
    }
  }

  // 3. No period corroborates a different value (neither directly, nor as
  //    a submultiple) — trust the direct square measurement if it
  //    validates on its own. It's a direct single-cell measurement; don't
  //    let an uncorroborated period override it just because it happens to
  //    be self-consistent.
  const direct = tryFit(candidateSize);
  if (direct.ok) return { tileSize: candidateSize, colFit: direct.colFit, rowFit: direct.rowFit };

  // 4. The square candidate didn't fit either — fall back to an
  //    uncorroborated measured period.
  for (const period of rawPeriods) {
    const fit = tryFit(period);
    if (fit.ok) return { tileSize: period, colFit: fit.colFit, rowFit: fit.rowFit };
  }

  // 5. Two distinct raw periods close to each other (even if neither
  //    relates cleanly to candidateSize) may still average out per-axis
  //    noise.
  if (rawPeriods.length === 2) {
    const [a, b] = rawPeriods;
    if (relDiff(a, b) <= 0.15) {
      const avg = (a + b) / 2;
      const fit = tryFit(avg);
      if (fit.ok) return { tileSize: avg, colFit: fit.colFit, rowFit: fit.rowFit };
    }
  }

  // 6. Last resort: divide down the square-detection candidate
  //    (uncorroborated, but better than nothing if periodicity also failed
  //    to catch an obvious merge).
  for (let divisor = 2; divisor <= 4; divisor++) {
    const size = candidateSize / divisor;
    if (size < 8) break;
    const fit = tryFit(size);
    if (fit.ok) return { tileSize: size, colFit: fit.colFit, rowFit: fit.rowFit };
  }

  return { tileSize: candidateSize, colFit: direct.colFit, rowFit: direct.rowFit };
}

// Original palette - tuned for dark-themed screenshots. Left untouched
// since it already works correctly there.
const DARK_GRID_COLORS = [
  '787886', '171719', '17171a', '000000', '4f4f58', 'babac1', 'a9a9b1', '38383f',
  '595963', '3d3d44', '4d4d55', '52525c', '75757e',
];

/** Exact-match boolean matrix against a fixed hex palette (dark-theme approach). */
function buildExactPaletteMatch(buf, width, height, colors) {
  const targets = colors.map((hex) => ({
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  }));

  const match = new Array(height);
  for (let y = 0; y < height; y++) {
    match[y] = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      match[y][x] = targets.some((t) => r === t.r && g === t.g && b === t.b) ? 1 : 0;
    }
  }
  return match;
}

/**
 * Adaptively derives the light-theme structural-pixel luma threshold from
 * the image itself, instead of a fixed constant.
 *
 * WHY a fixed constant can't work across screenshots: the gap between
 * "background white" and "gridline gray" shifts per image depending on
 * renderer, anti-aliasing, and compression (JPEG vs PNG). A hardcoded 140
 * missed real gridlines on a JPEG screenshot where they sat at luma
 * 150-230; hardcoding 225 to fix that then over-includes on other
 * screenshots with genuinely darker backgrounds or thicker/darker borders,
 * catching things that aren't structural.
 *
 * Instead of guessing a single number, find where THIS image's own
 * background cluster ends:
 *  1. The background is always the dominant luma value in a crossword
 *     screenshot (white/near-white cells cover most of the grid), so the
 *     histogram's tallest bin (the mode) anchors the background.
 *  2. Estimate the background cluster's mean/std using only pixels close
 *     to that mode (a tight +/-10 window) - this avoids the long tail of
 *     gridlines/letters/blocks contaminating the estimate the way a
 *     whole-image mean/std would.
 *  3. Set the threshold `k` standard deviations below the background
 *     mean. A larger k = more conservative (only pixels clearly darker
 *     than background count as structural).
 *  4. Guard against near-zero std (a perfectly flat, noise-free
 *     background) with an absolute minimum margin, so the threshold
 *     always has SOME headroom below the background mean rather than
 *     landing exactly on it.
 *  5. Clamp to a sane range as a final safety net against a pathological
 *     histogram (e.g. this branch running on an image that isn't
 *     actually light-themed).
 *
 * @param {object} buf
 * @param {object} [opts]
 * @param {number} [opts.modeWindow=10] - how far below the histogram's
 *   peak bin to include when estimating background mean/std.
 * @param {number} [opts.stdMultiplier=2] - how many background std-devs
 *   below the mean to set the threshold.
 * @param {number} [opts.minMargin=8] - minimum gap (luma units) below the
 *   background mean, even if std is ~0 (flat/noise-free background).
 * @param {number} [opts.minThreshold=120] - hard floor, in case of a
 *   degenerate/unexpected histogram.
 * @param {number} [opts.maxThreshold=253] - hard ceiling, so it never
 *   classifies the background itself as structural.
 * @returns {number} the computed luma threshold
 */
function computeAdaptiveLumaThreshold(buf, opts = {}) {
  const modeWindow = opts.modeWindow ?? 10;
  const stdMultiplier = opts.stdMultiplier ?? 2;
  const minMargin = opts.minMargin ?? 8;
  const minThreshold = opts.minThreshold ?? 120;
  const maxThreshold = opts.maxThreshold ?? 253;

  const { width, height, data } = buf;
  const hist = new Uint32Array(256);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const luma = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
    hist[luma]++;
  }

  // 1. Background = the histogram's tallest bin (dominant luma value)
  let mode = 0;
  let modeCount = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > modeCount) {
      modeCount = hist[v];
      mode = v;
    }
  }

  // 2. Estimate background mean/std from a tight window around the mode
  const lo = Math.max(0, mode - modeWindow);
  let sum = 0;
  let count = 0;
  for (let v = lo; v <= mode; v++) {
    sum += v * hist[v];
    count += hist[v];
  }
  const bgMean = count > 0 ? sum / count : mode;

  let sqDiffSum = 0;
  for (let v = lo; v <= mode; v++) sqDiffSum += hist[v] * (v - bgMean) * (v - bgMean);
  const bgStd = count > 0 ? Math.sqrt(sqDiffSum / count) : 0;

  // 3-4. k std-devs below the mean, with a minimum absolute margin
  const margin = Math.max(stdMultiplier * bgStd, minMargin);
  let threshold = bgMean - margin;

  // 5. Clamp
  threshold = Math.min(maxThreshold, Math.max(minThreshold, threshold));

  return Math.round(threshold);
}

/**
 * Luminance-threshold boolean matrix — the light-theme approach. A
 * light-themed screenshot has a large luminance gap between the near-white
 * background and the near-black block-squares/border/text, so any pixel
 * darker than `lumaThreshold` is "structural", anything lighter is
 * background.
 */
function buildLumaMatch(buf, width, height, lumaThreshold) {
  const match = new Array(height);
  for (let y = 0; y < height; y++) {
    match[y] = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      match[y][x] = luma < lumaThreshold ? 1 : 0;
    }
  }
  return match;
}

/**
 * Tolerance-based boolean matrix against a single target color — the
 * default dark-theme path (replaces the exact-hex palette above).
 *
 * Block/border pixels in a dark theme are near-black (the SAME near-black
 * used for the outer grid border, which cropLargestBorderRectangle already
 * anchors on: DARK_THEME_BORDER_COLOR (23,23,25)), while every cell-fill
 * state (unselected, selected-word highlight, current-cell highlight) is
 * meaningfully lighter than that — there's a real brightness/color gap to
 * exploit, same as the light-theme luma approach, it's just anchored to a
 * color instead of a luma cutoff so it isn't fooled by a dark theme's
 * already-dark cell backgrounds. Unlike the exact-hex palette, this
 * tolerates anti-aliasing and per-render shade drift without needing to
 * know every exact hex a given app version uses.
 */
function buildNearColorMatch(buf, width, height, target, tolerance) {
  const match = new Array(height);
  for (let y = 0; y < height; y++) {
    match[y] = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      match[y][x] = isNearColor(r, g, b, target, tolerance) ? 1 : 0;
    }
  }
  return match;
}

/**
 * Directly detects grid boundary lines along one axis by finding indices
 * that are matching (structural — border/gridline/block, per whichever
 * match matrix the theme branch built) across nearly the full length of
 * the OTHER axis — i.e. an actual continuous line/border, as opposed to a
 * solid block cell (which only spans one row's or column's worth, not the
 * whole grid).
 *
 * This sidesteps the tileSize-inference machinery (solid-square detection
 * + autocorrelation period) entirely: instead of inferring a uniform pitch
 * and hoping it's right, it locates each real boundary directly from the
 * pixels — immune to a merged multi-cell block inflating the solid-square
 * measurement, or an autocorrelation harmonic lock inflating the projected
 * period, since it never computes a single "tile size" to begin with, only
 * where lines are.
 *
 * @param {Uint8Array[]} match
 * @param {number} width
 * @param {number} height
 * @param {'col'|'row'} axis
 * @param {number} [minRunFraction=0.85] - how much of the cross-axis
 *   length must be matching for an index to count as a real grid line.
 * @returns {number[]} sorted pixel-coordinate centers of every detected
 *   line, INCLUDING the two outer border lines at each end
 */
function findAxisLines(match, width, height, axis, minRunFraction = 0.8) {
  const length = axis === 'row' ? height : width;
  const other = axis === 'row' ? width : height;

  const fractions = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let count = 0;
    if (axis === 'row') {
      const row = match[i];
      for (let x = 0; x < width; x++) if (row[x]) count++;
    } else {
      for (let y = 0; y < height; y++) if (match[y][i]) count++;
    }
    fractions[i] = count / other;
  }

  const centers = [];
  let runStart = null;
  for (let i = 0; i < length; i++) {
    const isLine = fractions[i] >= minRunFraction;
    if (isLine && runStart === null) runStart = i;
    if (!isLine && runStart !== null) {
      centers.push(Math.round((runStart + i - 1) / 2));
      runStart = null;
    }
  }
  if (runStart !== null) centers.push(Math.round((runStart + length - 1) / 2));

  return centers;
}

/**
 * Sanity-checks a set of detected line centers before trusting them: needs
 * at least 3 (i.e. at least 2 cells) and roughly uniform spacing between
 * consecutive lines (gaps within `spacingTolerance` of each other,
 * relative to the smallest gap). Guards against a spurious or partial
 * detection silently producing garbage instead of falling back.
 */
function validateAxisLines(centers, spacingTolerance = 0.2) {
  if (centers.length < 3) return false;
  const diffs = [];
  for (let i = 1; i < centers.length; i++) diffs.push(centers[i] - centers[i - 1]);
  const min = Math.min(...diffs);
  const max = Math.max(...diffs);
  if (min <= 0) return false;
  return (max - min) / min <= spacingTolerance;
}

/**
 * @param {object} buf
 * @param {object} [opts]
 * @param {string[]} [opts.colors] - explicit hex palette override; if
 *   provided, this is used (via exact match) regardless of theme.
 * @param {boolean} [opts.isLightTheme] - skip auto-detection and use this
 *   value instead.
 * @param {number} [opts.lightLumaThreshold] - light-theme only: explicit
 *   override for the structural-pixel luma cutoff. When omitted, this is
 *   derived automatically from the image's own background luma histogram
 *   (see computeAdaptiveLumaThreshold) rather than a fixed constant, since
 *   the true gap between background and gridline luma shifts per image
 *   depending on renderer/anti-aliasing/compression.
 * @param {number} [opts.lumaModeWindow] - forwarded to computeAdaptiveLumaThreshold.
 * @param {number} [opts.lumaStdMultiplier] - forwarded to computeAdaptiveLumaThreshold.
 * @param {number} [opts.lumaMinMargin] - forwarded to computeAdaptiveLumaThreshold.
 * @param {number} [opts.lumaMinThreshold] - forwarded to computeAdaptiveLumaThreshold.
 * @param {number} [opts.lumaMaxThreshold] - forwarded to computeAdaptiveLumaThreshold.
 * @param {number} [opts.darkColorTolerance=40] - dark-theme only: how far
 *   (per RGB channel) a pixel may be from DARK_THEME_BORDER_COLOR
 *   (23,23,25) and still count as structural (block/border).
 * @param {number} [opts.closingRadius=1] - morphological closing radius
 *   applied to the match matrix before line/square detection, to bridge
 *   single-pixel gaps in thin/anti-aliased border/gridlines. 0 disables.
 * @param {number} [opts.lineRunFraction=0.85] - primary detection method:
 *   fraction of the cross-axis length that must be matching for an index
 *   to count as a real grid line (see findAxisLines).
 * @param {number} [opts.lineSpacingTolerance=0.2] - how uniform detected
 *   line spacing must be to trust the direct line-detection result rather
 *   than falling back to solid-square + periodicity estimation.
 * @returns {{rows:number, cols:number, rowLines:number[], colLines:number[], tileSize:number, edgeTrim:object, isLightTheme:boolean}}
 */
function detectGridlines(buf, opts = {}) {
  const { width, height } = buf;

  let isLightTheme;
  if (typeof opts.isLightTheme === 'boolean') {
    isLightTheme = opts.isLightTheme;
  } else {
    ({ isLightTheme } = detectTheme(buf, {
      marginFraction: opts.themeMarginFraction ?? 0.05,
      threshold: opts.themeThreshold ?? 128,
    }));
  }

  // Build the match matrix. An explicit opts.colors override always wins
  // (exact match, legacy semantics). Otherwise branch by theme: dark uses
  // a tolerance-based match against the same fixed near-black border color
  // the crop step uses (robust to theme/anti-aliasing drift); light uses a
  // luminance threshold, derived adaptively from this image's own
  // background histogram unless explicitly overridden.
  let match;
  if (opts.colors) {
    match = buildExactPaletteMatch(buf, width, height, opts.colors);
  } else if (isLightTheme) {
    const lumaThreshold =
      opts.lightLumaThreshold ??
      computeAdaptiveLumaThreshold(buf, {
        modeWindow: opts.lumaModeWindow,
        stdMultiplier: opts.lumaStdMultiplier,
        minMargin: opts.lumaMinMargin,
        minThreshold: opts.lumaMinThreshold,
        maxThreshold: opts.lumaMaxThreshold,
      });
    match = buildLumaMatch(buf, width, height, lumaThreshold);
  } else {
    const darkColorTolerance = opts.darkColorTolerance ?? 40;
    match = buildNearColorMatch(buf, width, height, DARK_THEME_BORDER_COLOR, darkColorTolerance);
  }

  // Bridge single-pixel gaps in thin border/gridlines before any of the
  // downstream measurements (solid-square detection, edge trim, period
  // estimation, direct line detection) run.
  const closingRadius = opts.closingRadius ?? 1;
  match = closeMatchGaps(match, width, height, closingRadius);

  const tolerance = opts.tolerance ?? 0.02;
  const edgeThreshold = opts.edgeThreshold ?? 0.6;

  // PRIMARY: try detecting the actual grid lines directly (see
  // findAxisLines) rather than inferring a tile size indirectly. Immune to
  // the two failure modes that separately break the indirect approach: a
  // merged multi-cell block inflating the solid-square measurement, and an
  // autocorrelation harmonic lock inflating the projected period (both
  // have been observed landing at EXACTLY 2x the true tile size on real
  // screenshots) — findAxisLines never computes a single "tile size" to
  // begin with, so neither failure mode has anything to latch onto.
  const lineRunFraction = opts.lineRunFraction ?? 0.85;
  const lineSpacingTolerance = opts.lineSpacingTolerance ?? 0.2;
  const directColLines = findAxisLines(match, width, height, 'col', lineRunFraction);
  const directRowLines = findAxisLines(match, width, height, 'row', lineRunFraction);
  const useDirectLines =
    validateAxisLines(directColLines, lineSpacingTolerance) && validateAxisLines(directRowLines, lineSpacingTolerance);

  let rows;
  let cols;
  let rowLines;
  let colLines;
  let tileSize;
  let trim;

  if (useDirectLines) {
    cols = directColLines.length - 1;
    rows = directRowLines.length - 1;
    colLines = directColLines.slice(1, -1); // interior dividers only
    rowLines = directRowLines.slice(1, -1);

    const colDiffs = [];
    for (let i = 1; i < directColLines.length; i++) colDiffs.push(directColLines[i] - directColLines[i - 1]);
    const rowDiffs = [];
    for (let i = 1; i < directRowLines.length; i++) rowDiffs.push(directRowLines[i] - directRowLines[i - 1]);
    tileSize = [...colDiffs, ...rowDiffs].reduce((a, b) => a + b, 0) / (colDiffs.length + rowDiffs.length);

    trim = {
      top: directRowLines[0],
      bottom: height - directRowLines[directRowLines.length - 1] - 1,
      left: directColLines[0],
      right: width - directColLines[directColLines.length - 1] - 1,
    };
  } else {
    // FALLBACK: direct line-detection was inconclusive — solid-square +
    // periodicity estimation, reconciled in refineTileSize. The raw
    // autocorrelation period has been observed locking onto a harmonic at
    // exactly 2x the true tile size on real screenshots, so it's halved
    // here before being handed to refineTileSize as a candidate.
    const colProjectedPeriod = estimatePeriodFromProjection(match, width, height, 'col') / 2;
    const rowProjectedPeriod = estimatePeriodFromProjection(match, width, height, 'row') / 2;
    const colCycles = colProjectedPeriod ? width / colProjectedPeriod : 0;
    const rowCycles = rowProjectedPeriod ? height / rowProjectedPeriod : 0;
    const orderedPeriods = colCycles >= rowCycles ? [colProjectedPeriod, rowProjectedPeriod] : [rowProjectedPeriod, colProjectedPeriod];

    const square = findLargestSolidSquare(match, width, height);
    if (!square) {
      throw new Error(`No solid square found in the color-match matrix (${isLightTheme ? 'light' : 'dark'} theme).`);
    }
    const candidateTileSize = square.size;

    trim = computeEdgeTrim(match, width, height, edgeThreshold);
    const effectiveWidth = width - trim.left - trim.right;
    const effectiveHeight = height - trim.top - trim.bottom;
    if (effectiveWidth <= 0 || effectiveHeight <= 0) {
      throw new Error(
        `Edge trimming removed the entire image (${isLightTheme ? 'light' : 'dark'} theme) — check edgeThreshold${
          isLightTheme ? ' or opts.lightLumaThreshold' : ''
        }.`
      );
    }

    const refinedTile = refineTileSize(effectiveWidth, effectiveHeight, candidateTileSize, tolerance, orderedPeriods);
    const colFit = refinedTile.colFit;
    const rowFit = refinedTile.rowFit;

    colLines = [];
    for (let i = 1; i < colFit.count; i++) colLines.push(trim.left + Math.round(i * colFit.adjustedTileSize));
    rowLines = [];
    for (let i = 1; i < rowFit.count; i++) rowLines.push(trim.top + Math.round(i * rowFit.adjustedTileSize));

    rows = rowFit.count;
    cols = colFit.count;
    tileSize = refinedTile.tileSize;
  }

  if (colLines.length === 0 || rowLines.length === 0) {
    throw new Error(
      `Insufficient gridlines detected (found ${rowLines.length} horizontal, ${colLines.length} vertical) - try adjusting tolerance/edgeThreshold`
    );
  }

  return { rows, cols, rowLines, colLines, tileSize, edgeTrim: trim, isLightTheme };
}

/* =========================================================================
 * STEP 3 - per-cell classification + OCR
 * (ported from src/step3_analyze.js)
 * ========================================================================= */

function getBoundaries(lines, totalLength) {
  if (!Array.isArray(lines)) {
    throw new Error(`getBoundaries expected an array, got: ${JSON.stringify(lines)}`);
  }
  const sorted = [...lines].sort((a, b) => a - b);
  const boundaries = [0, ...sorted, totalLength];
  const ranges = [];
  for (let i = 0; i < boundaries.length - 1; i++) ranges.push([boundaries[i], boundaries[i + 1]]);
  return ranges;
}

/**
 * A genuinely filled/marked cell is near-uniformly dark, covering the vast
 * majority of the cell. Border frames and block squares are conventionally
 * dark/black in both themes, so this check itself doesn't need a theme
 * branch.
 */
function isFilledSquare(buf, x, y, w, h, targetHexes = ['171719', '000000'], threshold = 0.9, channelTolerance = 15, inset = 3) {
  const targets = targetHexes.map((hex) => ({
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  }));

  const ix = x + inset;
  const iy = y + inset;
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);

  let matchCount = 0;
  const totalPixels = iw * ih;

  for (let dy = 0; dy < ih; dy++) {
    for (let dx = 0; dx < iw; dx++) {
      const { r, g, b } = getPixelRGBA(buf, ix + dx, iy + dy);
      const matchesAny = targets.some(
        (t) => Math.abs(r - t.r) <= channelTolerance && Math.abs(g - t.g) <= channelTolerance && Math.abs(b - t.b) <= channelTolerance
      );
      if (matchesAny) matchCount++;
    }
  }

  return matchCount / totalPixels >= threshold;
}

/** Bounding box of non-white pixels in a greyscale/binarized buffer. */
function getContentBBox(buf, whiteValue = 255) {
  const { width, height, data } = buf;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[(y * width + x) * 4];
      if (v !== whiteValue) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Labels every connected black-ink component in a binarized buffer
 * (letter=black(0), background=white(255)) via flood fill, returning each
 * component's bbox and pixel-coordinate list.
 */
function findConnectedComponents(buf) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isBlack(x, y)) {
        visited[idx] = 1;
        continue;
      }

      const stack = [[x, y]];
      visited[idx] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const pixels = [];

      while (stack.length) {
        const [cx, cy] = stack.pop();
        pixels.push([cx, cy]);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (visited[nidx]) continue;
          visited[nidx] = 1;
          if (!isBlack(nx, ny)) continue;
          stack.push([nx, ny]);
        }
      }
      components.push({ minX, minY, maxX, maxY, pixels });
    }
  }
  return components;
}

/**
 * Preprocesses a cropped cell buffer for OCR.
 *
 * Two polarities are supported via `opts.theme`:
 *  - falsy/omitted (dark theme): the letter is a LIGHT stroke on a DARK
 *    cell background, so bright pixels are the foreground/text
 *    (v > brightThreshold -> letter).
 *  - `true` (light theme): the letter is a DARK stroke on a LIGHT/white
 *    cell background, so dark pixels are the foreground/text
 *    (v < brightThreshold -> letter).
 * Everything downstream (bbox crop, fill ratio, padding, upscale) is
 * polarity-agnostic once binarized, since both themes end up with the same
 * output convention: letter pixels = black(0), background = white(255).
 *
 * Order of operations:
 *  1. Trim edge margin (drops gridline bleed)
 *  2. Binarize per theme polarity -> letter=black(0), background=white(255)
 *  3. Clue-number masking via connected components, NOT a fixed corner
 *     box. A clue number is reliably a separate, disconnected ink blob
 *     from the letter, but not always positioned inside a fixed
 *     top-left box. First checks whether EVERY component's ink stays
 *     inside a generous top-left corner region — if so, nothing found
 *     is an actual letter yet (font rendering/AA can break one small
 *     digit into several disconnected fragments, and naively crowning
 *     the tallest fragment as "the letter" would keep a piece of the
 *     number instead), so the whole cell is cleared. Otherwise, the
 *     TALLEST component is the real letter (height, not ink area, is
 *     what actually distinguishes a short clue number from the main
 *     glyph — a thin "I" can have less total ink than a bold 2-digit
 *     number, so area-based comparison wrongly favors the number), and
 *     only OTHER components that are both clearly shorter than it, sit
 *     entirely above it, AND stay inside that same corner region get
 *     stripped.
 *  4. Crop tightly to the glyph's bounding box
 *  5. Pad with a white margin
 *  6. Upscale so thin strokes survive OCR
 */
function preprocessForOcr(cellBuf, opts = {}) {
  const isLight = opts.theme === true;
  const edgeMargin = opts.edgeMargin ?? 4;
  const brightThreshold = opts.brightThreshold ?? (isLight ? 128 : 150);
  const padding = opts.padding ?? 10;
  const scale = opts.scale ?? 8;
  const numberMask = opts.numberMask ?? null; // { heightFraction }

  let img = cloneBuffer(cellBuf);
  greyscaleInPlace(img);
  const rawW = img.width;
  const rawH = img.height;

  if (rawW > edgeMargin * 2 + 2 && rawH > edgeMargin * 2 + 2) {
    img = cropBuffer(img, edgeMargin, edgeMargin, rawW - edgeMargin * 2, rawH - edgeMargin * 2);
  }

  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i];
    const isLetterPixel = isLight ? v < brightThreshold : v > brightThreshold;
    const out = isLetterPixel ? 0 : 255;
    img.data[i] = out;
    img.data[i + 1] = out;
    img.data[i + 2] = out;
  }

  if (numberMask) {
    const heightFraction = numberMask.heightFraction ?? 0.6;
    const components = findConnectedComponents(img);

    const { width: imgW, height: imgH } = img;
    const cornerYFraction = 0.35;
    const cornerXFraction = 0.7;
    const inCorner = (c) => c.maxY < imgH * cornerYFraction && c.maxX < imgW * cornerXFraction;

    if (components.length !== 0) {
      // FIRST: does ANY component's ink extend outside the clue-number
      // corner region? If nothing does, every component found — no matter
      // how many, or which one happens to be tallest — is just a fragment
      // of the clue number itself (font rendering/AA can break a single
      // small digit into several disconnected blobs), and there is no
      // actual answer letter in this cell yet. This has to run BEFORE any
      // "tallest = main letter" reasoning, since that reasoning is exactly
      // what breaks here: it would crown one piece of the number as "the
      // letter" and only partially strip the rest.
      const outsideCorner = components.filter((c) => !inCorner(c));

      if (outsideCorner.length === 0) {
        for (const comp of components) {
          for (const [px, py] of comp.pixels) {
            const idx = getPixelIndex(img, px, py);
            img.data[idx] = 255;
            img.data[idx + 1] = 255;
            img.data[idx + 2] = 255;
          }
        }
      } else if (components.length > 1) {
        // Something extends past the corner -> that's real letter content.
        // NOW it's meaningful to pick the tallest component as "the
        // letter" and strip only the short, corner-confined fragments
        // (the actual clue number, sitting alongside a real answer letter).
        let mainComponent = components[0];
        for (const comp of components) {
          const h = comp.maxY - comp.minY + 1;
          const mainH = mainComponent.maxY - mainComponent.minY + 1;
          if (h > mainH) mainComponent = comp;
        }
        const mainHeight = mainComponent.maxY - mainComponent.minY + 1;

        for (const comp of components) {
          if (comp === mainComponent) continue;
          const compHeight = comp.maxY - comp.minY + 1;
          const sitsAbove = comp.maxY <= mainComponent.minY + Math.round(mainHeight * 0.1);
          const isShort = compHeight < mainHeight * heightFraction;
          const cornered = inCorner(comp);
          const shouldStrip = sitsAbove && isShort && cornered;

          if (shouldStrip) {
            for (const [px, py] of comp.pixels) {
              const idx = getPixelIndex(img, px, py);
              img.data[idx] = 255;
              img.data[idx + 1] = 255;
              img.data[idx + 2] = 255;
            }
          }
        }
      }
    }
  }

  const bbox = getContentBBox(img);
  let aspect = null;
  let fill = null;

  if (bbox) {
    img = cropBuffer(img, bbox.x, bbox.y, bbox.w, bbox.h);
    aspect = bbox.w / bbox.h;

    let blackCount = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] === 0) blackCount++;
    }
    fill = blackCount / (bbox.w * bbox.h);
  }

  const glyphBuffer = bbox ? cloneBuffer(img) : null; // tight bbox crop, pre-padding — used for ring/shape detection
  const bboxArea = bbox ? bbox.w * bbox.h : 0;

  const paddedW = img.width + padding * 2;
  const paddedH = img.height + padding * 2;
  const padded = makeBuffer(paddedW, paddedH, [255, 255, 255, 255]);
  compositeBuffer(padded, img, padding, padding);

  const finalBuf = resizeBuffer(padded, paddedW * scale, paddedH * scale);

  return { buffer: finalBuf, aspect, fill, bboxArea, glyphBuffer };
}

async function ocrLetterWithFallback(worker, ocrInput) {
  // Attempt 1: PSM 8 (already set on the worker going in)
  const { data: psm8 } = await worker.recognize(ocrInput);
  const psm8Match = psm8.text.trim().toUpperCase().match(/[A-Z]/);
  if (psm8Match) return psm8Match[0];

  // Attempt 2: PSM 7, still whitelisted
  await worker.setParameters({ tessedit_pageseg_mode: '7' });
  const { data: psm7 } = await worker.recognize(ocrInput);
  const psm7Match = psm7.text.trim().toUpperCase().match(/[A-Z]/);
  if (psm7Match) {
    await worker.setParameters({ tessedit_pageseg_mode: '8' }); // restore
    return psm7Match[0];
  }

  // Attempt 3: PSM 10 (treat image as a single character) — resolves some
  // round-glyph confusions (e.g. D/B) that PSM 8/7 both miss, since PSM 10
  // skips line/word segmentation heuristics entirely.
  await worker.setParameters({ tessedit_pageseg_mode: '10' });
  const { data: psm10 } = await worker.recognize(ocrInput);
  await worker.setParameters({ tessedit_pageseg_mode: '8' }); // restore
  const psm10Match = psm10.text.trim().toUpperCase().match(/[A-Z]/);
  if (psm10Match) return psm10Match[0];

  // Attempt 4: no whitelist, map common digit/symbol look-alikes back to letters
  await worker.setParameters({ tessedit_char_whitelist: '' });
  const { data: raw } = await worker.recognize(ocrInput);
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });

  const rawText = raw.text.trim();
  const confusionMap = { 0: 'O', 1: 'I', '|': 'I', l: 'I', '!': 'I' };

  for (const ch of rawText) {
    const upper = ch.toUpperCase();
    if (/[A-Z]/.test(upper)) return upper;
    if (confusionMap[ch]) return confusionMap[ch];
  }

  return ' ';
}

/** Detects a solid, narrow vertical bar (the "I" glyph) by shape alone. */
function isSolidBarShape(aspect, fill, aspectMax = 0.3, fillMin = 0.9) {
  return aspect !== null && fill !== null && aspect <= aspectMax && fill >= fillMin;
}

/**
 * Flood-fills white pixels reachable from the image border; returns a
 * same-size Uint8Array where 1 = reachable from outside.
 */
function floodFillFromBorder(buf) {
  const { width, height, data } = buf;
  const isWhite = (x, y) => data[(y * width + x) * 4] === 255;
  const visited = new Uint8Array(width * height);
  const stack = [];

  const tryPush = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    if (!isWhite(x, y)) return;
    visited[idx] = 1;
    stack.push([x, y]);
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  return visited;
}

/** Detects a closed ring ("O") by topology plus a corner check to rule out "D". */
function isRingShape(buf, aspect, fill, opts = {}) {
  const aspectMin = opts.aspectMin ?? 0.65;
  const aspectMax = opts.aspectMax ?? 1.35;
  const fillMin = opts.fillMin ?? 0.2;
  const fillMax = opts.fillMax ?? 0.75;
  const cornerFrac = opts.cornerFrac ?? 0.12;
  const cornerFillMax = opts.cornerFillMax ?? 0.3;

  if (aspect === null || fill === null) return false;
  if (aspect < aspectMin || aspect > aspectMax) return false;
  if (fill < fillMin || fill > fillMax) return false;

  const { width, height, data } = buf;
  const visited = floodFillFromBorder(buf);
  const cx0 = Math.floor(width * 0.4);
  const cx1 = Math.ceil(width * 0.6);
  const cy0 = Math.floor(height * 0.4);
  const cy1 = Math.ceil(height * 0.6);

  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      if (visited[y * width + x]) return false; // center reached from outside -> open shape
    }
  }

  const regionFill = (x0, x1, y0, y1) => {
    let black = 0;
    const total = (x1 - x0) * (y1 - y0);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        if (data[(yy * width + xx) * 4] === 0) black++;
      }
    }
    return total > 0 ? black / total : 0;
  };

  const cw = Math.max(1, Math.round(width * cornerFrac));
  const ch = Math.max(1, Math.round(height * cornerFrac));

  if (regionFill(0, cw, 0, ch) > cornerFillMax) return false;
  if (regionFill(width - cw, width, 0, ch) > cornerFillMax) return false;
  if (regionFill(0, cw, height - ch, height) > cornerFillMax) return false;
  if (regionFill(width - cw, width, height - ch, height) > cornerFillMax) return false;

  return true;
}

/**
 * True if the glyph has a crossbar — a wide, continuous horizontal ink run
 * spanning a large fraction of the width — somewhere in the middle band.
 * This is what distinguishes A from V: a hollow wedge's two diagonal
 * strokes can graze close together near their convergence point, but they
 * never form one wide connected run the way a real crossbar does. Only
 * meaningful as a correction when OCR has already returned 'A'.
 */
function hasCrossbar(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const yStart = Math.floor(height * (opts.bandStart ?? 0.25));
  const yEnd = Math.floor(height * (opts.bandEnd ?? 0.75));
  const minRun = Math.round(width * (opts.minRunWidthFraction ?? 0.25));

  for (let y = yStart; y < yEnd; y++) {
    let run = 0;
    let maxRun = 0;
    for (let x = 0; x < width; x++) {
      if (isBlack(x, y)) {
        run++;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
      }
    }
    if (maxRun >= minRun) return true;
  }
  return false;
}

/**
 * True if the glyph has a wide, continuous horizontal ink run near BOTH
 * the very top and the very bottom of its bbox — the signature of "Z"
 * (full-width bars top and bottom, connected by a diagonal). Only
 * meaningful as a correction when OCR/hasCrossbar have already pointed
 * toward A/V, since Z's diagonal doesn't pass hasCrossbar's mid-band
 * check (the bars sit outside the 25-75% band) and would otherwise be
 * silently miscategorized as V.
 */
function hasTopAndBottomBars(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const bandH = Math.max(1, Math.round(height * (opts.bandFraction ?? 0.18)));
  const minRun = Math.round(width * (opts.minRunWidthFraction ?? 0.6));

  const rowHasWideRun = (y) => {
    let run = 0;
    let maxRun = 0;
    for (let x = 0; x < width; x++) {
      if (isBlack(x, y)) {
        run++;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
      }
    }
    return maxRun >= minRun;
  };

  let top = false;
  let bottom = false;
  for (let y = 0; y < bandH; y++) {
    if (rowHasWideRun(y)) {
      top = true;
      break;
    }
  }
  for (let y = Math.max(0, height - bandH); y < height; y++) {
    if (rowHasWideRun(y)) {
      bottom = true;
      break;
    }
  }
  return top && bottom;
}

/**
 * True if the glyph has ink in the top-left band — a vertical stroke
 * starting right at the top, as in U. J's stroke starts further right and
 * only curves left near the bottom, so top-left stays blank. Only
 * meaningful as a correction when OCR has already returned 'J'.
 */
function hasTopLeftStroke(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const yEnd = Math.floor(height * (opts.bandFraction ?? 0.3));
  const xEnd = Math.floor(width * (opts.leftFraction ?? 0.35));
  const minFill = opts.minFillFraction ?? 0.25;

  let black = 0;
  const total = Math.max(1, xEnd * yEnd);
  for (let y = 0; y < yEnd; y++) {
    for (let x = 0; x < xEnd; x++) {
      if (isBlack(x, y)) black++;
    }
  }
  return black / total >= minFill;
}

/**
 * True if the bottom of the glyph's bbox has TWO separate ink runs (two
 * legs, as in M) rather than one (a single converging stem, as in Y).
 * Only meaningful as a correction when OCR has already returned 'Y'.
 */
function hasBothBottomLegs(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const rowsToCheck = opts.rowsToCheck ?? 5;
  const minRunWidth = Math.max(1, Math.round(width * (opts.minRunWidthFraction ?? 0.03)));
  const minGap = Math.max(1, Math.round(width * (opts.minGapFraction ?? 0.05)));

  const countRuns = (y) => {
    const runs = [];
    let inRun = false;
    let start = 0;
    for (let x = 0; x < width; x++) {
      const b = isBlack(x, y);
      if (b && !inRun) {
        inRun = true;
        start = x;
      }
      if (!b && inRun) {
        inRun = false;
        runs.push([start, x - 1]);
      }
    }
    if (inRun) runs.push([start, width - 1]);

    const merged = [];
    for (const run of runs) {
      const last = merged[merged.length - 1];
      if (last && run[0] - last[1] <= minGap) last[1] = run[1];
      else merged.push([...run]);
    }
    return merged.filter(([s, e]) => e - s + 1 >= minRunWidth);
  };

  for (let i = 0; i < rowsToCheck; i++) {
    const y = height - 1 - i;
    if (y < 0) break;
    if (countRuns(y).length >= 2) return true;
  }
  return false;
}

/**
 * True if the glyph's ink stays roughly the SAME width from ~80% down to
 * ~95% down its height — a flat-width stem, as in Y below where its arms
 * meet. V's ink instead keeps narrowing continuously all the way to a
 * point, so the same two sample rows come out with a much smaller ratio.
 * Sampling two fixed, fairly-deep rows (rather than scanning from the top
 * for the first "narrow" row) avoids a stray anti-aliased pixel at the
 * very top being mistaken for the convergence point. Only meaningful as a
 * correction when OCR has already returned 'Y'.
 */
function hasStemBelowConvergence(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const upperFrac = opts.upperFraction ?? 0.8;
  const lowerFrac = opts.lowerFraction ?? 0.95;
  const stemFlatnessRatio = opts.stemFlatnessRatio ?? 0.7;

  const rowSpan = (y) => {
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      if (isBlack(x, y)) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    return minX === -1 ? 0 : maxX - minX + 1;
  };

  const yUpper = Math.min(height - 1, Math.round(height * upperFrac));
  const yLower = Math.min(height - 1, Math.round(height * lowerFrac));
  const spanUpper = rowSpan(yUpper);
  const spanLower = rowSpan(yLower);
  if (spanUpper === 0) return false;

  return spanLower / spanUpper >= stemFlatnessRatio;
}

/**
 * True if the glyph still has substantial width just above its very
 * bottom edge — distinguishes U (rounded/flat bottom, stays wide) from V
 * (bottom converges to a narrow point, width drops off well before the
 * edge). Sampling a small window set back from the very edge (skipping
 * the last ~5% of height) avoids a thin spurious tail the padding/upscale
 * step can leave right at the edge. Only meaningful as a correction when
 * OCR has already returned 'V'.
 */
function hasRoundedBottom(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const skipBottomFraction = opts.skipBottomFraction ?? 0.05;
  const window = opts.window ?? 1;
  const minWidthFraction = opts.minWidthFraction ?? 0.4;

  const yCenter = Math.max(0, height - 1 - Math.round(height * skipBottomFraction));
  let bestSpan = 0;
  for (let dy = -window; dy <= window; dy++) {
    const y = yCenter + dy;
    if (y < 0 || y >= height) continue;
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      if (isBlack(x, y)) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    if (minX !== -1) bestSpan = Math.max(bestSpan, maxX - minX + 1);
  }
  return bestSpan >= width * minWidthFraction;
}

/**
 * True if there's a continuous vertical ink run spanning most of the
 * glyph's height within its leftmost ~15% — a full-height left stroke, as
 * in K (and H, U, etc.). S has no such stroke: its curves never hold a
 * fixed x-position for more than a fraction of the height. Only
 * meaningful as a correction when OCR has already returned 'K'.
 */
function hasFullHeightLeftStroke(buf, opts = {}) {
  const { width, height, data } = buf;
  const isBlack = (x, y) => data[(y * width + x) * 4] === 0;
  const bandFraction = opts.bandFraction ?? 0.15;
  const minRunFraction = opts.minRunFraction ?? 0.6;

  const bandW = Math.max(1, Math.round(width * bandFraction));
  let run = 0;
  let maxRun = 0;
  for (let y = 0; y < height; y++) {
    let hasInk = false;
    for (let x = 0; x < bandW; x++) {
      if (isBlack(x, y)) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) {
      run++;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 0;
    }
  }
  return maxRun / height >= minRunFraction;
}

function isDarkPixel(r, g, b, targets, tolerance) {
  return targets.some((t) => Math.abs(r - t.r) <= tolerance && Math.abs(g - t.g) <= tolerance && Math.abs(b - t.b) <= tolerance);
}

/**
 * Dark-theme edge trimmer: trims rows/cols matching a fixed dark palette
 * from whichever sides are actual grid-boundary edges for this cell.
 */
function trimCellDarkEdges(buf, x1, y1, w, h, sides, opts = {}) {
  const darkColors = opts.darkColors || ['000000', '171719'];
  const threshold = opts.darkThreshold ?? 0.6;
  const tolerance = opts.channelTolerance ?? 20;
  const maxTrimFraction = opts.maxTrimFraction ?? 0.3;

  const targets = darkColors.map((hex) => ({
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  }));

  const rowDarkFraction = (y, xStart, xEnd) => {
    let dark = 0;
    for (let x = xStart; x < xEnd; x++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      if (isDarkPixel(r, g, b, targets, tolerance)) dark++;
    }
    return dark / (xEnd - xStart);
  };

  const colDarkFraction = (x, yStart, yEnd) => {
    let dark = 0;
    for (let y = yStart; y < yEnd; y++) {
      const { r, g, b } = getPixelRGBA(buf, x, y);
      if (isDarkPixel(r, g, b, targets, tolerance)) dark++;
    }
    return dark / (yEnd - yStart);
  };

  const maxTop = Math.floor(h * maxTrimFraction);
  const maxBottom = Math.floor(h * maxTrimFraction);
  const maxLeft = Math.floor(w * maxTrimFraction);
  const maxRight = Math.floor(w * maxTrimFraction);

  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;

  if (sides.top) {
    while (top < maxTop && rowDarkFraction(y1 + top, x1, x1 + w) > threshold) top++;
  }
  if (sides.bottom) {
    while (bottom < maxBottom && rowDarkFraction(y1 + h - 1 - bottom, x1, x1 + w) > threshold) bottom++;
  }
  if (sides.left) {
    while (left < maxLeft && colDarkFraction(x1 + left, y1, y1 + h) > threshold) left++;
  }
  if (sides.right) {
    while (right < maxRight && colDarkFraction(x1 + w - 1 - right, y1, y1 + h) > threshold) right++;
  }

  return { x: x1 + left, y: y1 + top, w: w - left - right, h: h - top - bottom };
}

/**
 * Light-theme edge trimmer. Rather than assuming the border starts right at
 * the raw crop's edge (an edge cell's untrimmed crop is actually
 * [white margin] -> [border] -> [real content]), this scans the entire
 * candidate trim range up front and cuts past the LAST border-like
 * position found anywhere in it. "Border-like" is a generic darkness check
 * (mean RGB below a threshold) rather than a sampled reference color, so
 * it catches the border regardless of its exact shade.
 */
function trimCellBorderAdaptive(buf, x1, y1, w, h, sides, opts = {}) {
  const threshold = opts.matchThreshold ?? 0.6;
  const brightnessThreshold = opts.brightnessThreshold ?? 200;
  const maxTrimFraction = opts.maxTrimFraction ?? 0.15;

  const isBorderlike = (x, y) => {
    const { r, g, b } = getPixelRGBA(buf, x, y);
    return (r + g + b) / 3 < brightnessThreshold;
  };

  const rowBorderFraction = (y, xStart, xEnd) => {
    let count = 0;
    for (let x = xStart; x < xEnd; x++) if (isBorderlike(x, y)) count++;
    return count / (xEnd - xStart);
  };

  const colBorderFraction = (x, yStart, yEnd) => {
    let count = 0;
    for (let y = yStart; y < yEnd; y++) if (isBorderlike(x, y)) count++;
    return count / (yEnd - yStart);
  };

  const scanTrimAmount = (fractionFn, maxTrim) => {
    let trim = 0;
    for (let i = 0; i < maxTrim; i++) {
      if (fractionFn(i) > threshold) trim = i + 1;
    }
    return trim;
  };

  const maxTop = Math.floor(h * maxTrimFraction);
  const maxBottom = Math.floor(h * maxTrimFraction);
  const maxLeft = Math.floor(w * maxTrimFraction);
  const maxRight = Math.floor(w * maxTrimFraction);

  const top = sides.top ? scanTrimAmount((i) => rowBorderFraction(y1 + i, x1, x1 + w), maxTop) : 0;
  const bottom = sides.bottom ? scanTrimAmount((i) => rowBorderFraction(y1 + h - 1 - i, x1, x1 + w), maxBottom) : 0;
  const left = sides.left ? scanTrimAmount((i) => colBorderFraction(x1 + i, y1, y1 + h), maxLeft) : 0;
  const right = sides.right ? scanTrimAmount((i) => colBorderFraction(x1 + w - 1 - i, y1, y1 + h), maxRight) : 0;

  return { x: x1 + left, y: y1 + top, w: w - left - right, h: h - top - bottom };
}

/**
 * Splits the cropped grid buffer along detected gridlines into cells,
 * classifies each as blocked/empty/filled, OCR's filled cells (applying a
 * few geometry-based corrections for OCR-confusable letters), and returns
 * the resulting grid. Each row is logged to the console as it completes.
 *
 * @param {object} buf
 * @param {object} gridlines
 * @param {object} [opts]
 * @param {boolean} [opts.theme] - true for light-theme screenshots (dark
 *   stroke on light background), falsy/omitted for dark theme (default).
 * @returns {Promise<string[][]>}
 */
async function analyzeCells(buf, gridlines, opts = {}) {
  if (!gridlines || !Array.isArray(gridlines.rowLines) || !Array.isArray(gridlines.colLines)) {
    throw new Error('analyzeCells requires gridlines.rowLines and gridlines.colLines as arrays.');
  }

  const theme = opts.theme === true;
  const numberMaskHeightFraction = opts.numberMaskHeightFraction; // undefined unless overridden — preprocessForOcr defaults to 0.6
  const filledChar = opts.filledChar || '■';
  const filledColors = opts.filledColors || ['171719', '000000'];
  const filledThreshold = opts.filledThreshold ?? 0.9;
  const minGlyphArea = opts.minGlyphArea ?? 20;

  const { width, height } = buf;
  const rowRanges = getBoundaries(gridlines.rowLines, height);
  const colRanges = getBoundaries(gridlines.colLines, width);

  const worker = await createWorker('eng', opts.tesseractOem ?? 1, opts.tesseractWorkerOptions || {});
  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    tessedit_pageseg_mode: '8',
    load_system_dawg: '0',
    load_freq_dawg: '0',
  });

  const cells = [];

  try {
    for (let r = 0; r < rowRanges.length; r++) {
      const [y1, y2] = rowRanges[r];
      const rowTexts = [];

      for (let c = 0; c < colRanges.length; c++) {
        const [x1raw, x2raw] = colRanges[c];
        let x1 = x1raw;
        let cellW = x2raw - x1raw;
        let cellY = y1;
        let cellH = y2 - y1;

        const isFirstRow = r === 0;
        const isLastRow = r === rowRanges.length - 1;
        const isFirstCol = c === 0;
        const isLastCol = c === colRanges.length - 1;

        if (isFirstRow || isLastRow || isFirstCol || isLastCol) {
          const sides = { top: isFirstRow, bottom: isLastRow, left: isFirstCol, right: isLastCol };
          const trimmed = theme
            ? trimCellBorderAdaptive(buf, x1, cellY, cellW, cellH, sides, {
                matchThreshold: opts.edgeDarkThreshold,
                brightnessThreshold: opts.edgeBrightnessThreshold,
                maxTrimFraction: opts.edgeDarkMaxTrimFraction,
              })
            : trimCellDarkEdges(buf, x1, cellY, cellW, cellH, sides, {
                darkColors: opts.edgeDarkColors,
                darkThreshold: opts.edgeDarkThreshold,
                channelTolerance: opts.edgeDarkTolerance,
                maxTrimFraction: opts.edgeDarkMaxTrimFraction,
              });
          x1 = trimmed.x;
          cellY = trimmed.y;
          cellW = trimmed.w;
          cellH = trimmed.h;
        }

        let letter;

        if (
          isFilledSquare(buf, x1, cellY, cellW, cellH, filledColors, filledThreshold, opts.filledChannelTolerance ?? 15, opts.filledInset ?? 3)
        ) {
          letter = filledChar;
        } else {
          const cellBuf = cropBuffer(buf, x1, cellY, cellW, cellH);
          const { buffer: processed, aspect, fill, bboxArea, glyphBuffer } = preprocessForOcr(cellBuf, {
            edgeMargin: opts.ocrEdgeMargin,
            brightThreshold: opts.ocrThreshold,
            padding: opts.ocrPadding,
            scale: opts.ocrScale,
            theme,
            numberMask: { heightFraction: numberMaskHeightFraction },
          });

          if (bboxArea < minGlyphArea) {
            letter = ' ';
          } else if (isSolidBarShape(aspect, fill)) {
            letter = 'I';
          } else if (glyphBuffer && isRingShape(glyphBuffer, aspect, fill)) {
            letter = 'O';
          } else {
            const canvas = bufferToCanvas(processed);
            letter = await ocrLetterWithFallback(worker, canvas);

            // Geometry-based corrections for known OCR-confusable letters.
            // Only re-derive via geometry when OCR's specific answer
            // warrants it — an earlier version ran these checks on every
            // member of the A/V/Y/M/Z set unconditionally, which caused
            // false positives on otherwise-correct guesses (hasCrossbar
            // registering on genuine Y/M shapes, hasBothBottomLegs
            // registering on a genuine V's anti-aliased point). Ordinary
            // correct answers must pass through untouched.
            if (letter === 'A' && glyphBuffer && !hasCrossbar(glyphBuffer)) {
              // A hollow wedge without a crossbar is either V, or (if it
              // also has full-width bars top and bottom) actually Z.
              if (hasTopAndBottomBars(glyphBuffer)) {
                letter = 'Z';
              } else {
                letter = hasBothBottomLegs(glyphBuffer) ? 'M' : 'V';
              }
            } else if (letter === 'V' && glyphBuffer && hasTopAndBottomBars(glyphBuffer)) {
              // Z's diagonal is sometimes read as V directly (not via A),
              // so this needs checking even when OCR skipped 'A' entirely.
              letter = 'Z';
            } else if (letter === 'Y' && glyphBuffer) {
              if (hasBothBottomLegs(glyphBuffer)) {
                letter = 'M';
              } else if (!hasStemBelowConvergence(glyphBuffer)) {
                letter = 'V';
              }
            }
            // V/U: V should taper to a point; if width holds up near the
            // bottom edge instead, it's actually U.
            if (letter === 'V' && glyphBuffer && hasRoundedBottom(glyphBuffer)) {
              letter = 'U';
            } else if (letter === 'J' && glyphBuffer && hasTopLeftStroke(glyphBuffer)) {
              letter = 'U';
            } else if (letter === 'K' && glyphBuffer && !hasFullHeightLeftStroke(glyphBuffer)) {
              // K always has a full-height stroke on its left edge; S never
              // does (it's built entirely from curves).
              letter = 'S';
            }
          }
        }

        rowTexts.push(letter);
      }

      cells.push(rowTexts);
      // Log each row as it's recognized, so progress is visible while OCR runs.
      console.log(`[recognizeLetters] row ${r + 1}/${rowRanges.length}:`, rowTexts.join(''));
    }
  } finally {
    await worker.terminate();
  }

  return cells;
}

/* =========================================================================
 * Public API
 * ========================================================================= */

/**
 * Runs the full crossword-grid recognition pipeline on a single image and
 * returns the resulting grid.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|OffscreenCanvas|HTMLVideoElement|ImageBitmap|ImageData|Blob|File|string} image
 * @param {object} [options]
 * @param {number} [options.minSize] - forwarded to STEP 1 (min rectangle width/height, px)
 * @param {object} [options.crop] - forwarded to STEP 1 (cropLargestBorderRectangle opts)
 * @param {object} [options.gridlines] - forwarded to STEP 2 (detectGridlines opts)
 * @param {object} [options.analyze] - forwarded to STEP 3 (analyzeCells opts)
 * @returns {Promise<string[][]>} rows of cell values: 'A'-'Z', ' ' (empty), or '■' (blocked)
 */
export async function recognizeLetters(image, options = {}) {
  let buffer;
  try {
    buffer = await loadImageBuffer(image);
  } catch (err) {
    throw new Error(`STEP 0 - Error: ${err && err.message ? err.message : String(err)}`);
  }

  let crop;
  try {
    crop = cropLargestBorderRectangle(buffer, options.minSize, options.crop);
  } catch (err) {
    throw new Error(`STEP 1 - Error: ${err && err.message ? err.message : String(err)}`);
  }

  let gridlines;
  try {
    // Theme is (re-)detected on the cropped grid image itself here, same as
    // the reference pipeline — this can differ from (and is more reliable
    // than) the theme detected on the full screenshot in STEP 1.
    gridlines = detectGridlines(crop.buffer, options.gridlines);
  } catch (err) {
    throw new Error(`STEP 2 - Error: ${err && err.message ? err.message : String(err)}`);
  }

  try {
    return await analyzeCells(crop.buffer, gridlines, { ...options.analyze, theme: gridlines.isLightTheme });
  } catch (err) {
    throw new Error(`STEP 3 - Error: ${err && err.message ? err.message : String(err)}`);
  }
}

export default recognizeLetters;