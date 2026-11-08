// Fetch small, attributed photographs for the offline species tooltips.
// Re-run explicitly when updating the photo catalog; the app never calls this.
const fs = require('node:fs');
const path = require('node:path');
const { SPECIES } = require('../species.js');
const overrides = require('./species-photo-overrides.json');
const directory = path.join(__dirname, '..', 'assets', 'species');
const manifestPath = path.join(directory, 'photos.json');
const headers = { 'User-Agent': 'Plecotus/22 (local bat identification review; Wikimedia Commons photo credits retained)' };
const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number))).trim();
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response;
    if ([429, 503].includes(response.status) && attempt < 3) { await pause(2000 * (attempt + 1)); continue; }
    throw new Error(response.status + ' ' + response.statusText + ': ' + url);
  }
}

async function find(species) {
  const override = overrides[species.code];
  if (override?.provider === 'inaturalist') {
    const observationUrl = 'https://www.inaturalist.org/observations/' + override.observationId;
    const result = await (await request('https://api.inaturalist.org/v1/observations/' + override.observationId)).json();
    const observation = result.results?.[0];
    const photo = observation?.photos?.find(item => item.id === override.photoId);
    if (observation?.taxon?.name !== species.scientificName || observation.quality_grade !== 'research'
      || !photo || !['cc-by', 'cc-by-sa', 'cc0'].includes(photo.license_code)) {
      throw new Error('iNaturalist species identification or reusable photo license not confirmed');
    }
    const author = photo.attribution.match(/^\(c\) (.*?), (?:some|all) rights reserved/)?.[1]
      || observation.user?.name || observation.user?.login;
    const licenses = { 'cc-by': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
      'cc-by-sa': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
      cc0: ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'] };
    return [{ code: species.code, scientificName: species.scientificName,
      fileTitle: species.scientificName + ' — iNaturalist photo ' + photo.id,
      sourceUrl: 'https://www.inaturalist.org/photos/' + photo.id, observationUrl,
      imageUrl: photo.url.replace('/square.', '/medium.'), originalUrl: photo.url.replace('/square.', '/original.'),
      author, license: licenses[photo.license_code][0], licenseUrl: licenses[photo.license_code][1],
      description: 'Living bats; research-grade observation of ' + species.scientificName }];
  }
  const search = 'filetype:bitmap intitle:"' + species.scientificName + '" -intitle:map -intitle:skull -intitle:skeleton -intitle:skin';
  const parameters = new URLSearchParams({ action: 'query',
    ...(overrides[species.code] ? { titles: overrides[species.code] }
      : { generator: 'search', gsrsearch: search, gsrnamespace: '6', gsrlimit: '10' }),
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '360', format: 'json' });
  const result = await (await request('https://commons.wikimedia.org/w/api.php?' + parameters)).json();
  const candidates = Object.values(result.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0], metadata = info?.extmetadata || {};
    const license = clean(metadata.LicenseShortName?.value);
    const photoTitle = page.title.replace(/^File:/, '');
    const description = clean(metadata.ImageDescription?.value);
    if (!info || !info.thumburl || !/\.(?:jpe?g|png|webp)$/i.test(photoTitle)
      || !/^(?:CC BY|CC0|Public domain)/i.test(license)
      || /map|distribution|skull|skeleton|museum|naturalis|illustration|drawing|sketch|specimen|stamp|skin|figure|icon|logo/i.test(photoTitle)
      || /illustrat(?:ion|ed)|drawing|sketch|lithograph|engraving|aquarelle|watercolou?r|painting|Schreber/i.test(description)) return null;
    const exact = photoTitle.toLowerCase() === species.scientificName.toLowerCase() + '.jpg';
    return { code: species.code, scientificName: species.scientificName, fileTitle: page.title,
      sourceUrl: info.descriptionurl, imageUrl: info.thumburl, originalUrl: info.url,
      author: clean(metadata.Artist?.value), license, licenseUrl: clean(metadata.LicenseUrl?.value),
      description, score: exact ? 100 : 10 - Number(page.index || 0) / 100 };
  }).filter(Boolean).sort((left, right) => right.score - left.score);
  return candidates;
}

(async () => {
  fs.mkdirSync(directory, { recursive: true });
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const catalog = new Map(previous.map(item => [item.code, item]));
  const selected = process.argv.slice(2);
  for (const species of SPECIES.filter(item => !selected.length || selected.includes(item.code))) {
    const existing = catalog.get(species.code);
    if (existing && fs.existsSync(path.join(directory, existing.fileName))
      && (!overrides[species.code] || existing.fileTitle === overrides[species.code]
        || (overrides[species.code].provider === 'inaturalist'
          && existing.sourceUrl === 'https://www.inaturalist.org/photos/' + overrides[species.code].photoId))) {
      console.log(species.code + ': already present'); continue;
    }
    try {
      const candidates = await find(species);
      if (!candidates.length) { console.log(species.code + ': NO LICENSED PHOTO'); continue; }
      const chosen = candidates[0];
      const response = await request(chosen.imageUrl);
      const mimeType = response.headers.get('content-type')?.split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Unexpected photo type: ' + mimeType);
      const bytes = Buffer.from(await response.arrayBuffer());
      const fileName = species.code.toLowerCase() + (mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg');
      fs.writeFileSync(path.join(directory, fileName), bytes);
      delete chosen.score;
      catalog.set(species.code, { ...chosen, fileName, mimeType, bytes: bytes.length, retrieved: '2026-11-08' });
      fs.writeFileSync(manifestPath, JSON.stringify([...catalog.values()], null, 2) + '\n');
      console.log(species.code + ': ' + chosen.fileTitle + ' | ' + chosen.license + ' | ' + bytes.length + ' bytes');
      await pause(350);
    } catch (error) { console.log(species.code + ': ERROR ' + error.message); }
  }
  console.log('Catalog: ' + catalog.size + '/' + SPECIES.length + ' species');
  if (!catalog.size) process.exitCode = 1;
})();
