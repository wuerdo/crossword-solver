import { iconUpload, iconCloud, iconAlert, iconCheckCircle, iconSun, iconMoon } from './icons.js';
import { PHOTO_SRC } from './placeholderImage.js';

// ---------------------------------------------------------------------------
// Theme toggle — fixed icon button, top-right corner. Shows the icon for
// the mode a click will switch *to*.
// ---------------------------------------------------------------------------
export function themeToggleTemplate(theme) {
  const isLight = theme === 'light';
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';
  return `
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="${label}" title="${label}">
      ${isLight ? iconMoon() : iconSun()}
    </button>
  `;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
export function headerTemplate(dateLabel) {
  const title = 'CROSSEXAMINE.IT';
  const letters = title
    .split('')
    .map((ch) => `<span>${ch}</span>`)
    .join('');

  return `
    <header class="header">
      <h1 class="logo" aria-label="${title}">${letters}</h1>
      <div class="header__meta">
        <p class="strip strip--white">Keep your streak</p>
        <p class="strip strip--black">${dateLabel}</p>
      </div>
    </header>
  `;
}

// ---------------------------------------------------------------------------
// Banner (status row)
// ---------------------------------------------------------------------------
export function bannerTemplate({ variant, icon, spin = false, html, actionHtml = '' }) {
  const iconMarkup = spin ? '<span class="spinner"></span>' : icon;
  return `
    <div class="banner banner--${variant}">
      <span class="banner__icon">${iconMarkup}</span>
      <span class="banner__text">${html}</span>
      ${actionHtml ? `<span class="banner__action">${actionHtml}</span>` : ''}
    </div>
  `;
}

export function loadingDots() {
  return `<span class="banner__dots"><span></span><span></span><span></span></span>`;
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------
export function dropzoneTemplate() {
  return `
    <div class="dropzone" data-dropzone>
      <span class="dropzone__icon">${iconCloud()}</span>
      <p class="dropzone__title">Drag &amp; drop your screenshot here</p>
      <span class="dropzone__or">or</span>
      <label class="btn btn--primary" for="file-input">Choose File</label>
      <input class="dropzone__input" type="file" id="file-input" accept="image/png,image/jpeg,image/webp" data-file-input />
      <span class="dropzone__hint">png, jpg or webp</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Uploaded photo — shown plain, uncropped, in place of the grid whenever
// there's no recognized structure to render yet/at all (detecting stage:
// briefly, before any grid exists; error stage: recognition failed, so
// there's nothing to crop to). Uses the real uploaded file's preview URL
// when there is one (fileStore.js), falling back to a placeholder for
// direct stage jumps (dev panel / `?stage=`) where nothing's actually been
// uploaded.
// ---------------------------------------------------------------------------
export function uploadedPhotoTemplate(src) {
  return `
    <div class="uploaded-photo">
      <img src="${src || PHOTO_SRC}" alt="Uploaded crossword screenshot" />
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Stat cards — one shared component for every stage. Each stat (Correct /
// Wrong / Missing) is always its own bordered card with a ring + percentage;
// pre-recognition stages just pass zeros.
// ---------------------------------------------------------------------------
function statCard({ percent, variant, label }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent / 100);
  return `
    <div class="stat-card">
      <svg class="stat-card__ring" viewBox="0 0 48 48">
        <circle class="stat-card__track" cx="24" cy="24" r="${r}" />
        <circle class="stat-card__value stat-card__value--${variant}" cx="24" cy="24" r="${r}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" />
      </svg>
      <div class="stat-card__meta">
        <span class="stat-card__percent stat-card__percent--${variant}">${percent}%</span>
        <span class="stat-card__label">${label}</span>
      </div>
    </div>
  `;
}

export function statCardsTemplate({ solved, wrong, missing }) {
  return `
    <div class="stat-cards">
      ${statCard({ percent: solved, variant: 'success', label: 'Correct' })}
      ${statCard({ percent: wrong, variant: 'error', label: 'Wrong' })}
      ${statCard({ percent: missing, variant: 'warning', label: 'Missing' })}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
export function legendTemplate() {
  return `
    <div class="legend">
      <span class="legend__item"><span class="legend__swatch legend__swatch--success"></span>Correct</span>
      <span class="legend__item"><span class="legend__swatch legend__swatch--error"></span>Wrong</span>
      <span class="legend__item"><span class="legend__swatch legend__swatch--warning"></span>Missing</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Crossword grid — a plain panel (no photo backdrop). Renders whatever grid
// it's handed as-is: a cell's `letter`/`status` (or lack of either) is all
// that decides what's drawn, so the exact same renderer works for the
// structure-only layout grid, the partially-recognized grid, and the fully
// compared grid. Cell numbers and clues are never recognized/shown.
// ---------------------------------------------------------------------------
// Stagger step (ms) between each revealed cell's reveal animation delay,
// and a cap so a big grid doesn't take forever for the last cell to appear.
const REVEAL_STEP_MS = 14;
const REVEAL_MAX_DELAY_MS = 500;

function gridCells(grid, { reveal = false } = {}) {
  let revealIndex = 0;
  return grid
    .map((row) =>
      row
        .map((cell) => {
          const classes = ['cell'];
          if (cell.black) classes.push('is-black');
          if (cell.status) classes.push(`cell--${cell.status}`);

          let styleAttr = '';
          if (reveal) {
            classes.push('cell--reveal');
            const delay = Math.min(revealIndex * REVEAL_STEP_MS, REVEAL_MAX_DELAY_MS);
            styleAttr = ` style="animation-delay:${delay}ms"`;
            revealIndex += 1;
          }

          const letter = cell.black ? '' : cell.letter || '';
          return `<div class="${classes.join(' ')}"${styleAttr}>${letter}</div>`;
        })
        .join('')
    )
    .join('');
}

export function gridPanelTemplate(grid, { legend = false, reveal = false } = {}) {
  const rows = grid.length;
  const cols = grid[0] ? grid[0].length : 0;
  // Both axes get explicit equal-fr tracks (not just columns) so cells stay
  // perfectly square by construction — with only grid-template-columns set,
  // rows fall back to implicit `auto` sizing, which can drift from the
  // container's own aspect-ratio at some viewport sizes and narrow the
  // squares into rectangles.
  const gridStyle = `style="grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr);"`;

  return `
    <div class="grid-panel">
      <div class="crossword" ${gridStyle}>${gridCells(grid, { reveal })}</div>
      ${legend ? legendTemplate() : ''}
    </div>
  `;
}

import { EXAMPLE_COMPARED_GRID, EXAMPLE_STATS } from './explainerExample.js';

export { iconUpload, iconAlert, iconCheckCircle };

// ---------------------------------------------------------------------------
// Explainer sidebar — shown beside the upload screen, illustrating what a
// reviewed result looks like using a baked-in example (never today's real
// puzzle, which would spoil it). Sits directly on its own white background,
// not inside a card.
// ---------------------------------------------------------------------------
export function explainerTemplate() {
  return `
    <div class="explainer">
      <p class="explainer__label">What is it for?</p>
      <p class="explainer__description">
        Crossexamine.it compares your answers with the official NYT crossword
        solution so it's easier for you to find any mistakes you made and not
        lose your streak.
      </p>

      <div class="workspace">${gridPanelTemplate(EXAMPLE_COMPARED_GRID, { legend: true })}</div>
      <div class="workspace section-gap">${statCardsTemplate(EXAMPLE_STATS)}</div>
    </div>
  `;
}
