// ---------------------------------------------------------------------------
// logoAnimation.js
//
// Drives the "ransom note" title effect: each letter of the logo is a
// <span> with a randomly-picked torn-paper sprite behind it, nudged along
// a slight curved baseline with small random rotation/scale/skew so the
// letters read as individually cut-and-pasted rather than a single
// mechanically laid-out word.
//
// Ported from a standalone prototype; adapted to run against a given root
// element (applyLogoJitter(root)) rather than the whole document, since
// this app replaces app.innerHTML wholesale on every render — the header's
// <span> elements are fresh DOM nodes each time and need this re-applied,
// same as wireUploadControls/wireThemeToggle/wireDevPanel already do for
// their own event listeners.
// ---------------------------------------------------------------------------

// Tweak these to change how "ransom note" the title looks. All units are px
// unless noted otherwise.
const CONFIG = {
  // how far the outermost letters dip below the center, like a horizon
  // curving away at the edges. 0 = perfectly flat baseline.
  CURVE_DEPTH_PX: 14,

  // the approximate total width (in px) the letters span. Used only to work
  // out how steep the curve's tangent is at each letter, so its rotation can
  // stay parallel to the horizon line. Doesn't need to be exact — adjust if
  // the rotation looks too flat or too steep for your actual title width.
  CURVE_WIDTH_PX: 640,

  // small extra random rotation added on top of the curve-tangent angle,
  // so letters don't look mechanically perfect. Range is +/- this value.
  ROTATION_JITTER_DEG: 2,

  // random up/down jitter added on top of the curve position.
  RISE_JITTER_PX: 3,

  // random uniform scale applied per letter (1 = no change).
  SCALE_MIN: 0.97,
  SCALE_MAX: 1.05,

  // random horizontal skew per letter, +/- this value.
  SKEW_JITTER_DEG: 1.2,

  // random font-size offset per letter, +/- this value. Average size is
  // unaffected since this is centered on 0.
  FONT_SIZE_VARIANCE_PX: 7,

  // horizontal margin (px) applied to both sides of each letter. Negative
  // values overlap the paper pieces; less negative / positive spaces them
  // out. Range is [MARGIN_MIN_PX, MARGIN_MAX_PX].
  MARGIN_MIN_PX: -1,
  MARGIN_MAX_PX: -1,

  // random stacking order per letter, so overlapping edges interleave.
  Z_INDEX_MAX: 100,
};

const SPRITE_COUNT = 20;
const spritePaths = Array.from(
  { length: SPRITE_COUNT },
  (_, i) => `/sprites/paper_${String(i).padStart(2, '0')}.png`
);

// simple mulberry32 PRNG so the "randomness" is stable per call but easy to
// reseed for a different note each time.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.min(Math.imul(seed ^ (seed >>> 15), 1 | seed));
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rand, min, max) {
  return min + rand() * (max - min);
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Applies the paper-cutout jitter to every `.logo span` found within root.
 * Safe to call on every render — no-ops if there's no .logo present.
 */
export function applyLogoJitter(root) {
  const logo = root.querySelector('.logo');
  if (!logo) return;
  const spans = Array.from(logo.querySelectorAll('span'));
  if (spans.length === 0) return;

  const seed = Date.now() % 100000;
  const rand = mulberry32(seed);

  // shuffle the sprite deck so neighbouring letters rarely share the same
  // piece of paper, then cycle through it
  const deck = shuffle(spritePaths, rand);

  const count = spans.length;

  spans.forEach((span, i) => {
    const sprite = deck[i % deck.length];

    // -1 (left edge) .. 0 (center) .. 1 (right edge)
    const pos = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;

    // y = depth * pos^2  ->  vertical offset along the horizon curve
    const curveY = CONFIG.CURVE_DEPTH_PX * pos * pos;

    // dy/dx of the curve above, converted from "pos" units into real px
    // using CURVE_WIDTH_PX, then turned into a tangent angle so the
    // letter's bottom edge stays parallel to the horizon line at that point
    const dyDx = (2 * CONFIG.CURVE_DEPTH_PX * pos) / (CONFIG.CURVE_WIDTH_PX / 2);
    const curveAngleDeg = Math.atan(dyDx) * (180 / Math.PI);

    const rotationJitter = randRange(rand, -CONFIG.ROTATION_JITTER_DEG, CONFIG.ROTATION_JITTER_DEG);
    const rotation = (curveAngleDeg + rotationJitter).toFixed(2);

    const scale = randRange(rand, CONFIG.SCALE_MIN, CONFIG.SCALE_MAX).toFixed(3);
    const skew = randRange(rand, -CONFIG.SKEW_JITTER_DEG, CONFIG.SKEW_JITTER_DEG).toFixed(2);
    const fontDelta = randRange(rand, -CONFIG.FONT_SIZE_VARIANCE_PX, CONFIG.FONT_SIZE_VARIANCE_PX).toFixed(1);

    const riseJitter = randRange(rand, -CONFIG.RISE_JITTER_PX, CONFIG.RISE_JITTER_PX);
    const rise = (curveY + riseJitter).toFixed(1);

    const marginLeft = randRange(rand, CONFIG.MARGIN_MIN_PX, CONFIG.MARGIN_MAX_PX).toFixed(1);
    const marginRight = randRange(rand, CONFIG.MARGIN_MIN_PX, CONFIG.MARGIN_MAX_PX).toFixed(1);

    span.style.setProperty('--sprite', `url(${sprite})`);
    span.style.setProperty('--rot', `${rotation}deg`);
    span.style.setProperty('--scale', scale);
    span.style.setProperty('--rise', `${rise}px`);
    span.style.setProperty('--skew', `${skew}deg`);
    span.style.setProperty('--fs-delta', `${fontDelta}px`);
    span.style.marginLeft = `${marginLeft}px`;
    span.style.marginRight = `${marginRight}px`;
    span.style.zIndex = Math.floor(randRange(rand, 1, CONFIG.Z_INDEX_MAX));
  });
}
