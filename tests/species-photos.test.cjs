const test = require('node:test');
const assert = require('node:assert/strict');
const Photos = require('../species-photos.js');
const fs = require('node:fs');
const path = require('node:path');
const { SPECIES } = require('../species.js');

test('every catalog species has a locally available, attributed photograph', () => {
  assert.equal(Photos.catalog.length, SPECIES.length);
  for (const species of SPECIES) {
    const photo = Photos.resolve(species.code);
    assert.ok(photo, species.code);
    assert.ok(fs.statSync(path.join(__dirname, '..', photo.src)).size > 1000, species.code);
    assert.ok(photo.author, species.code);
    assert.match(photo.license, /^(CC BY|CC0|Public domain)/);
    assert.match(photo.licenseUrl, /^https?:\/\//);
    assert.match(photo.sourceUrl, /^https:\/\/(commons\.wikimedia\.org\/wiki\/File:|www\.inaturalist\.org\/photos\/)/);
  }
});

test('known species aliases find the same locally bundled, attributed photograph', () => {
  for (const label of ['PIPPIP', 'Pipistrellus pipistrellus', 'Pipistrelle commune']) {
    const photo = Photos.resolve(label);
    assert.ok(photo, label);
    assert.equal(photo.scientificName, 'Pipistrellus pipistrellus');
    assert.match(photo.src, /^assets\/species\/pippip\.(jpg|png|webp)$/);
    assert.ok(photo.author);
    assert.match(photo.license, /^CC/);
    assert.match(photo.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
});

test('NoID, species groups and unknown labels never receive an invented species picture', () => {
  for (const label of ['NoID', 'NoID Pip', 'Myotis sp.', 'Pipistrellus cf. pipistrellus', '', '<script>']) {
    assert.equal(Photos.resolve(label), null);
  }
});
