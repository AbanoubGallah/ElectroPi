/**
 * Stage 2 of the submission build: docs/ANSWERS.html -> PDF.
 *
 * Uses the Playwright Chromium already installed for the test suite, so the
 * build needs no extra tooling. Chromium's `page.pdf()` also supports a
 * header/footer template, which the plain `--print-to-pdf` CLI does not.
 *
 * Usage: node docs/build-pdf.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'docs', 'ANSWERS.html');
const PDF = join(ROOT, 'docs', 'Abanoub-Gallah-QA-Assessment-ElectroPi.pdf');

const FOOTER = `
<div style="width:100%;font:9pt Georgia,serif;color:#555;text-align:center;">
  <span class="pageNumber"></span>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load' });
// Print CSS drives the layout (@page size/margins, page-break rules).
await page.emulateMedia({ media: 'print' });

await page.pdf({
  path: PDF,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: FOOTER,
  margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
});

await browser.close();
console.log(`wrote docs/${PDF.split('/').pop()} (${Math.round(statSync(PDF).size / 1024)} KB)`);
