// Small inline SVG icons, sized to inherit color via currentColor.

export const iconUpload = () => `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 16V4"/>
  <path d="M7 9l5-5 5 5"/>
  <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
</svg>`;

export const iconCloud = () => `
<svg width="40" height="40" viewBox="0 0 24 24" fill="none">
  <path d="M11 4a4 4 0 0 0-3.999 4.102 1 1 0 0 1-.75.992A3.002 3.002 0 0 0 7 15h1a1 1 0 1 1 0 2H7a5 5 0 0 1-1.97-9.596 6 6 0 0 1 11.169-2.4A6 6 0 0 1 16 17a1 1 0 1 1 0-2 4 4 0 1 0-.328-7.987 1 1 0 0 1-.999-.6A4.001 4.001 0 0 0 11 4zm.293 5.293a1 1 0 0 1 1.414 0l2 2a1 1 0 0 1-1.414 1.414L13 12.414V20a1 1 0 1 1-2 0v-7.586l-.293.293a1 1 0 0 1-1.414-1.414l2-2z" fill="currentColor"/>
</svg>`;

export const iconSun = () => `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2"/>
  <path d="M12 20v2"/>
  <path d="M4.93 4.93l1.41 1.41"/>
  <path d="M17.66 17.66l1.41 1.41"/>
  <path d="M2 12h2"/>
  <path d="M20 12h2"/>
  <path d="M6.34 17.66l-1.41 1.41"/>
  <path d="M19.07 4.93l-1.41 1.41"/>
</svg>`;

export const iconMoon = () => `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>
</svg>`;

export const iconAlert = () => `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
  <path d="M12 9v4"/>
  <path d="M12 17h.01"/>
</svg>`;

export const iconCheckCircle = () => `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/>
  <path d="m8.5 12.3 2.4 2.4 4.6-5.4"/>
</svg>`;

// Dev panel icons — one per stage (upload / detecting / recognizing / review).
export const iconImage = () => `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <circle cx="8.5" cy="8.5" r="1.5"/>
  <path d="M21 15l-5-5L5 21"/>
</svg>`;

export const iconTextRecognition = () => `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 3H5a2 2 0 0 0-2 2v2"/>
  <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
  <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
  <path d="M17 21h2a2 2 0 0 0 2-2v-2"/>
  <path d="M9 15l3-8 3 8"/>
  <path d="M9.8 12.5h4.4"/>
</svg>`;

export const iconGrid = () => `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
</svg>`;
