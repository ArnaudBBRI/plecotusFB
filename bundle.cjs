// Rebuild the standalone browser file after editing index.html / CSS / JS.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n?/g, '\n');
let html = read('index.html');

for (const name of ['assets/branding/plecotus-bat.css', 'welcome.css', 'assets/branding/header-bat.css', 'import-chart.css', 'best-contacts.css', 'review-actions.css', 'manual-review.css', 'final-summary.css', 'species-tooltip.css', 'timeline.css', 'contact-context.css', 'unresolved-review.css']) {
  let css = read(name);
  if (name === 'assets/branding/header-bat.css') {
    const sprite = fs.readFileSync(path.join(root, 'assets/branding/header-bat.png')).toString('base64');
    css = css.replace('url("header-bat.png")', 'url("data:image/png;base64,' + sprite + '")');
  }
  html = html.replace('<link rel="stylesheet" href="' + name + '">', () => '<style>\n' + css + '\n</style>');
}

const logoPath = 'assets/branding/plecotus-faune-biotopes-v3-black.png';
const logoData = fs.readFileSync(path.join(root, logoPath)).toString('base64');
html = html.replaceAll('src="' + logoPath + '"', 'src="data:image/png;base64,' + logoData + '"');

// Run after the body in dependency order, equivalent to the deferred scripts.
const scriptFiles = ['vendor/sheetjs/xlsx.full.min.js', 'core.js', 'kaleidoscope.js', 'file-import.js', 'species.js', 'species-photos.js', 'species-tooltip.js', 'review-settings.js', 'activity-chart.js', 'activity-export.js', 'import-chart.js', 'timeline-data.js', 'timeline-chart.js', 'timeline-ui.js', 'contact-context-data.js', 'contact-context-ui.js', 'best-contacts.js', 'contact-decisions.js', 'proportional-allocation.js', 'manual-workflow.js', 'manual-review-ui.js', 'unresolved-review-ui.js', 'final-summary-data.js', 'final-summary-visuals.js', 'step-one-species.js', 'step-one-species-ui.js', 'final-summary-ui.js', 'review-settings-ui.js', 'settings-report.js', 'settings-report-ui.js', 'wav-opening.js', 'results-file.js', 'welcome.js'];
const scripts = scriptFiles.map(name => {
  html = html.replace('  <script defer src="' + name + '"></script>', '');
  let source = read(name);
  if (name === 'species-photos.js') {
    const photos = require('./species-photos.js').catalog;
    for (const photo of photos) {
      const extension = path.extname(photo.src).toLowerCase();
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      const data = fs.readFileSync(path.join(root, photo.src)).toString('base64');
      source = source.replaceAll(JSON.stringify(photo.src), () => JSON.stringify('data:' + mime + ';base64,' + data));
    }
  }
  return '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
html = html.replace('</body>', () => scripts.join('\n') + '\n</body>');
fs.writeFileSync(path.join(root, 'Plecotus.html'), html, 'utf8');
console.log('Built Plecotus.html: a standalone browser tool.');
