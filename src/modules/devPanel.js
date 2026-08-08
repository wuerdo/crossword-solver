import { stageManager, STAGES } from './stageManager.js';
import { iconUpload, iconImage, iconTextRecognition, iconGrid } from './icons.js';

// One icon per stage, styled as a compact toolbar rather than a labeled
// list — upload / photo / text-recognition / grid, echoing the shape of
// each stage's actual content.
const ICON_FOR_STAGE = {
  [STAGES.UPLOAD]: iconUpload,
  [STAGES.DETECTING]: iconImage,
  [STAGES.RECOGNIZING]: iconTextRecognition,
  [STAGES.REVIEW]: iconGrid,
};

const LABEL_FOR_STAGE = {
  [STAGES.UPLOAD]: 'Upload',
  [STAGES.DETECTING]: 'Detecting',
  [STAGES.RECOGNIZING]: 'Recognizing',
  [STAGES.REVIEW]: 'Review',
};

export function devPanelTemplate(currentStage) {
  const buttons = Object.values(STAGES)
    .map((stage) => {
      const label = LABEL_FOR_STAGE[stage];
      return `
        <button
          class="devpanel__btn ${stage === currentStage ? 'is-active' : ''}"
          data-devstage="${stage}"
          aria-label="${label}"
          title="${label}"
        >${ICON_FOR_STAGE[stage]()}</button>
      `;
    })
    .join('');

  return `<div class="devpanel">${buttons}</div>`;
}

export function wireDevPanel(root) {
  root.querySelectorAll('[data-devstage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // errorMessage cleared too — jumping stages via the dev panel
      // shouldn't drag a stale error along with it.
      stageManager.setStage(btn.dataset.devstage, { fileName: null, errorMessage: null });
    });
  });
}
