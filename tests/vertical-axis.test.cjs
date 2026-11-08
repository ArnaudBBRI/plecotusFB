const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Chart = require('../activity-chart.js');

// SVG presentation attributes have lower precedence than author CSS. Evaluate
// the axis-specific fill rules against the actual rendered element so this
// catches a shared text/path class painting an implicitly closed axis triangle.
function axisFill(element, css) {
  const tag = element.match(/^<(\w+)/)[1];
  const classes = (element.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/);
  let fill = element.match(/\bfill="([^"]*)"/)?.[1] || 'black';
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const value = rule[2].match(/\bfill\s*:\s*([^;]+)/)?.[1].trim();
    if (!value) continue;
    for (const selector of rule[1].split(',')) {
      const target = selector.trim().split(/\s+/).at(-1);
      if (!target.includes('.activity-column-axis')) continue;
      const requiredTag = target.match(/^[a-z]+/i)?.[0];
      const requiredClasses = [...target.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
      if ((!requiredTag || requiredTag === tag) && requiredClasses.every(name => classes.includes(name))) fill = value;
    }
  }
  return fill;
}

test('vertical SVG axes stay unfilled under the application stylesheet while their labels remain colored', () => {
  const html = Chart.render([{ scientificName: 'Pipistrellus pipistrellus', contacts: 3 },
    { scientificName: 'Myotis daubentonii', contacts: 1 }], 'vertical');
  const css = fs.readFileSync(path.join(__dirname, '..', 'import-chart.css'), 'utf8');
  const axis = html.match(/<path\b[^>]*class="activity-column-axis"[^>]*>/)?.[0];
  const label = html.match(/<text\b[^>]*class="activity-column-axis"[^>]*>/)?.[0];
  assert.ok(axis, 'the rendered chart includes its vertical and horizontal axes');
  assert.ok(label, 'the axis retains a readable Contacts label');
  assert.match(axis, /d="M [\d.]+ [\d.]+ V [\d.]+ H [\d.]+"/);
  assert.equal(axisFill(axis, css), 'none', 'author CSS must not fill and implicitly close the open L-shaped axis');
  assert.equal(axisFill(label, css), '#535a4c', 'axis text keeps the existing visual style');
});
