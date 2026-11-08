const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Chart = require('../activity-chart.js');
const Images = require('../activity-export.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const columns = html => [...html.matchAll(/<rect\b[^>]*class="activity-column"[^>]*>/g)].map(match => attributes(match[0]));
const rows = values => values.map((contacts, index) => ({ scientificName: 'Species ' + index, frenchName: 'Espèce ' + index, contacts }));

// Evaluate the SVG viewport dimensions used by the existing full-width CSS,
// then the standard SVG meet scale. This catches the original 360×340 viewBox
// expanding to more than 1100px high in a 1200px card without browser automation.
function renderedMetrics(html, stylesheet, containerWidth) {
  const svg = attributes(html.match(/<svg\b[^>]*class="activity-columns-svg"[^>]*>/)[0]);
  const [, , viewWidth, viewHeight] = svg.viewBox.split(' ').map(Number);
  let cssHeight = 'auto';
  for (const rule of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1].trim().split(/\s+/).at(-1).includes('.activity-columns-svg')) continue;
    const height = rule[2].match(/(?:^|;)\s*height\s*:\s*([^;]+)/)?.[1].trim();
    if (height) cssHeight = height;
  }
  const minimum = Number(svg.style.match(/min-width:([\d.]+)px/)?.[1] || 0);
  const width = Math.max(containerWidth, minimum);
  const height = cssHeight === 'auto' ? width / viewWidth * viewHeight : Number(cssHeight.replace('px', ''));
  const scale = Math.min(width / viewWidth, height / viewHeight);
  return { width, height, scale, viewWidth, viewHeight, svg };
}

test('one or two low-count species keep the vertical chart at a bounded height in import and final cards', () => {
  for (const stylesheet of [read('import-chart.css'), read('import-chart.css') + '\n' + read('final-summary.css')]) {
    for (const values of [[1], [1, 1], [2, 1]]) {
      const html = Chart.render(rows(values), 'vertical', { interactive: true });
      for (const cardWidth of [1200, 2000, 480, 280]) {
        const rendered = renderedMetrics(html, stylesheet, cardWidth);
        assert.ok(rendered.height <= 340 && rendered.height >= 300,
          values.length + ' species in ' + cardWidth + 'px card must not amplify the chart height: ' + rendered.height);
        assert.equal(rendered.scale, 1, 'axis labels and stroke widths retain their authored pixel size');
        assert.ok(columns(html).every(column => Number(column.width) * rendered.scale <= 64),
          'sparse species charts do not contain oversized columns');
      }
    }
  }
});

test('sparse columns are centered in their slots with the same zero baseline and integer ticks at one contact', () => {
  const html = Chart.render(rows([1]), 'vertical');
  const column = columns(html)[0];
  const axis = html.match(/d="M ([\d.]+) ([\d.]+) V ([\d.]+) H ([\d.]+)" fill="none"/);
  const left = Number(axis[1]), baseline = Number(axis[3]), right = Number(axis[4]);
  assert.ok(Number(column.width) <= 64);
  assert.equal(Number(column.x) + Number(column.width) / 2, (left + right) / 2);
  assert.equal(Number(column.y) + Number(column.height), baseline);
  const ticks = [...html.matchAll(/<text class="activity-column-tick"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  assert.deepEqual(ticks, ['0', '1']);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('31 species retain every category and horizontal scrolling, including when filters leave just one', () => {
  const source = rows(Array.from({ length: 31 }, (_, index) => index + 1));
  const full = Chart.render(source, 'vertical', { interactive: true });
  assert.equal(columns(full).length, 31);
  assert.equal((full.match(/data-chart-key=/g) || []).length, 31);
  const wide = renderedMetrics(full, read('import-chart.css'), 320);
  assert.ok(wide.width > 320, 'the authored minimum width keeps all narrow species slots scrollable');
  assert.equal(wide.height, 340);
  assert.ok(columns(full).every(column => Number(column.width) > 0 && Number(column.width) <= 64));
  const prepared = Chart.prepare(source);
  const hidden = new Set(prepared.rows.slice(0, -1).map(Chart.rowKey));
  const filtered = Chart.render(source, 'vertical', { interactive: true, hiddenKeys: hidden });
  assert.equal(columns(filtered).length, 1);
  assert.equal((filtered.match(/data-chart-key=/g) || []).length, 31, 'hidden categories remain available for restoration');
  assert.ok(Number(columns(filtered)[0].width) <= 64);
  assert.match(filtered, /100 %/);
});

test('downloaded vertical SVGs retain their existing bounded column widths and count scale', () => {
  const output = Images.svg(rows([2, 1]), 'vertical');
  const bars = [...output.svg.matchAll(/<rect\b[^>]*data-series="\d+"[^>]*>/g)].map(match => attributes(match[0]));
  assert.equal(bars.length, 2);
  assert.ok(bars.every(column => Number(column.width) <= 64));
  assert.equal(Number(bars[0].height), Number(bars[1].height) * 2);
  assert.doesNotMatch(output.svg, /NaN|Infinity/);
});
