// Rebuild the standalone browser file after editing index.html / CSS / JS.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let html = read('index.html');

for (const name of ['assets/branding/plecotus-bat.css', 'welcome.css']) {
  html = html.replace('<link rel="stylesheet" href="' + name + '">', () => '<style>\n' + read(name) + '\n</style>');
}

const logoPath = 'assets/branding/plecotus-bat-v1.png';
const logoData = fs.readFileSync(path.join(root, logoPath)).toString('base64');
html = html.replaceAll('src="' + logoPath + '"', 'src="data:image/png;base64,' + logoData + '"');

// Run after the body in dependency order, equivalent to the deferred scripts.
const scriptFiles = ['vendor/sheetjs/xlsx.full.min.js', 'core.js', 'file-import.js', 'welcome.js'];
const scripts = scriptFiles.map(name => {
  html = html.replace('  <script defer src="' + name + '"></script>', '');
  return '<script>\n' + read(name).replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
html = html.replace('</body>', () => scripts.join('\n') + '\n</body>');
fs.writeFileSync(path.join(root, 'Plecotus.html'), html, 'utf8');
console.log('Built Plecotus.html: a standalone browser tool.');
