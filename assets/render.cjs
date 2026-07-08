const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);
const jobs = [
  { name: 'mark', w: 512, h: 512, scale: 2, transparent: true },
  { name: 'logo', w: 760, h: 200, scale: 2, transparent: true },
  { name: 'banner', w: 1280, h: 448, scale: 2, transparent: false },
  { name: 'workflow', w: 1280, h: 360, scale: 2, transparent: false },
];

(async () => {
  const browser = await chromium.launch();
  for (const job of jobs) {
    const svg = fs.readFileSync(path.join(dir, job.name + '.svg'), 'utf8');
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: job.scale });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent}
      svg{display:block}
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const el = await page.$('svg');
    await el.screenshot({ path: path.join(dir, job.name + '.png'), omitBackground: job.transparent });
    await page.close();
    console.log('rendered', job.name + '.png');
  }
  await browser.close();
})();
