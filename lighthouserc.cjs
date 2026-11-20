/**
 * Lighthouse CI: the budgets of ARCHITECTURE.md 9 on every public page, phone and desktop, both
 * themes. One `lhci autorun` covers one form factor and one theme (LHCI_FORM_FACTOR, LHCI_THEME);
 * `npm run lighthouse` runs all four after `npm run build`, and only it checks each page's theme (in
 * Chrome before collect, and from each run's sky still after; scripts/lighthouse-ci.mjs). The
 * configuration and what each setting means are in scripts/lighthouse-config.cjs.
 */
'use strict';

module.exports = require('./scripts/lighthouse-config.cjs').lighthouseConfig(process.env);
