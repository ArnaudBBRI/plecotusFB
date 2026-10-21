// Rebuild the standalone browser file after editing index.html / CSS / JS.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const script = name => '<script>\n'+read(name).replace(/<\/script/gi,'<\\/script')+'\n</script>';
const scriptFiles = ['core.js','automation.js','species.js','review-plan.js','activity-chart.js','activity-export.js','import-summary.js','bulk-confirmation.js','kaleidoscope.js','app.js'];
let html=read('index.html');
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>\n'+read('styles.css')+'\n</style>');
// Inline scripts execute after the body, equivalent to the source's defer.
for(const name of scriptFiles)html=html.replace('  <script defer src="'+name+'"></script>\n','');
html=html.replace('</body>',scriptFiles.map(script).join('\n')+'\n</body>');
html=html.replace('href="index.html"','href="#"');
fs.writeFileSync(path.join(root,'Plecotus.html'),html,'utf8');
console.log('Built Plecotus.html: a standalone browser tool.');
