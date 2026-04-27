## 2024-04-27 - Added ARIA labels and titles to icon-only buttons
**Learning:** Found that the dynamically generated DOM elements for API Key management lacked accessibility labels.
**Action:** When working with dynamically injected HTML strings for buttons, ensure `aria-label` and `title` attributes are included from the start, especially for icon-only or shortened-text buttons.
