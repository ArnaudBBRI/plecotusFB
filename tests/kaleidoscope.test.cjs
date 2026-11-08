const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const K = require('../kaleidoscope.js');

test('provides immutable viewer metadata with Kaleidoscope as the backward-compatible default', () => {
  assert.deepEqual(K.viewerInfo(), { id: 'kaleidoscope', name: 'Kaleidoscope', executableHint: 'kaleidoscope.exe' });
  assert.deepEqual(K.viewerInfo('chirosurf'), { id: 'chirosurf', name: 'ChiroSurf', executableHint: 'ChiroSurf.exe' });
  assert.equal(K.viewerInfo(), K.viewerInfo('kaleidoscope'));
  assert.equal(Object.isFrozen(K.viewerInfo()), true);
  assert.equal(Object.isFrozen(K.viewerInfo('chirosurf')), true);
  assert.equal(Object.isFrozen(K), true);
});

test('accepts only supported viewer identifiers, including when no executable has been configured', () => {
  for (const viewer of [null, 3, {}, ['kaleidoscope'], '', 'ChiroSurf', 'KALEIDOSCOPE', 'other', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => K.viewerInfo(viewer), /Logiciel non pris en charge.*Kaleidoscope ou ChiroSurf/, String(viewer));
    assert.throws(() => K.normalizeExecutable('', viewer), /Logiciel non pris en charge/, String(viewer));
  }
});

test('normalizes the configured executable without requiring a filesystem or changing filename case', () => {
  assert.equal(K.normalizeExecutable('  c:/Program Files/Wildlife Acoustics/Kaleidoscope.EXE  '), 'C:\\Program Files\\Wildlife Acoustics\\Kaleidoscope.EXE');
  assert.equal(K.normalizeExecutable('\\\\serveur\\logiciels\\kaleidoscope.exe'), '\\\\serveur\\logiciels\\kaleidoscope.exe');
  assert.equal(K.normalizeExecutable('C:\\Applis\\ancienne\\..\\.\\kaleidoscope.exe'), 'C:\\Applis\\kaleidoscope.exe');
  assert.equal(K.normalizeExecutable('  "C:\\Program Files\\Wildlife Acoustics\\kaleidoscope.exe"  '), 'C:\\Program Files\\Wildlife Acoustics\\kaleidoscope.exe');
  assert.equal(K.normalizeExecutable("C:\\Applications de l'équipe\\kaleidoscope.exe"), "C:\\Applications de l'équipe\\kaleidoscope.exe");
  assert.equal(K.normalizeExecutable(''), '');
  assert.equal(K.normalizeExecutable(null), '');
  assert.equal(K.normalizeExecutable('C:\\Applis\\kaleidoscope.exe', 'kaleidoscope'), 'C:\\Applis\\kaleidoscope.exe');
});

test('accepts ChiroSurf executable names with a strictly numeric optional version', () => {
  for (const filename of ['ChiroSurf.exe', 'CHIROSURF.EXE', 'ChiroSurf4.6.exe', 'ChiroSurf_4.6.exe', 'ChiroSurf-4.6.1.exe', 'ChiroSurf 4.6.exe', 'ChiroSurf4.exe']) {
    assert.equal(K.normalizeExecutable('  "c:/Applications/ChiroSurf/' + filename + '"  ', 'chirosurf'), 'C:\\Applications\\ChiroSurf\\' + filename);
  }
  assert.equal(K.normalizeExecutable('\\\\serveur\\logiciels\\ChiroSurf_4.6.exe', 'chirosurf'), '\\\\serveur\\logiciels\\ChiroSurf_4.6.exe');
  assert.equal(K.normalizeExecutable('C:\\Applis\\ancienne\\..\\ChiroSurf.exe', 'chirosurf'), 'C:\\Applis\\ChiroSurf.exe');
  assert.equal(K.normalizeExecutable('', 'chirosurf'), '');
  assert.equal(K.normalizeExecutable(null, 'chirosurf'), '');
});

test('rejects executable names that do not match the selected viewer', () => {
  assert.throws(() => K.normalizeExecutable('C:\\Applis\\ChiroSurf.exe'), /kaleidoscope\.exe/);
  assert.throws(() => K.normalizeExecutable('C:\\Applis\\ChiroSurf.exe', 'kaleidoscope'), /kaleidoscope\.exe/);
  assert.throws(() => K.normalizeExecutable('C:\\Applis\\kaleidoscope.exe', 'chirosurf'), /ChiroSurf\.exe/);
  assert.throws(() => K.normalizeExecutable('C:\\Applis\\kaleidoscope_5.4.exe'), /kaleidoscope\.exe/);
});

test('ChiroSurf allowlist rejects arbitrary suffixes and malformed version names', () => {
  for (const filename of ['ChiroSurf.exe.bat', 'ChiroSurf.com', 'ChiroSurf-helper.exe', 'ChiroSurf_4.6_beta.exe', 'ChiroSurf4.6b.exe', 'ChiroSurf_4..6.exe', 'ChiroSurf_4.6..exe', 'ChiroSurf_.exe', 'ChiroSurf_4.6 .exe', 'ChiroSurf__4.6.exe', 'ChiroSurf  4.6.exe', 'ChiroSurf-v4.6.exe', 'ChiroSurf4.6.exe.exe', 'OtherChiroSurf.exe']) {
    assert.throws(() => K.normalizeExecutable('C:\\Applis\\' + filename, 'chirosurf'), /exécutable ChiroSurf\.exe/, filename);
  }
});

test('ChiroSurf uses the same strict Windows path and injection checks', () => {
  for (const input of ['ChiroSurf.exe', 'C:ChiroSurf.exe', '\\Apps\\ChiroSurf.exe', 'file:///C:/Apps/ChiroSurf.exe', 'https://host/ChiroSurf.exe', '\\\\?\\C:\\Apps\\ChiroSurf.exe', '\\\\.\\C:\\Apps\\ChiroSurf.exe', 'C:\\Apps\\ChiroSurf.exe\n', 'C:\\App"s\\ChiroSurf.exe', 'C:\\Apps\\ChiroSurf.exe:stream', 'C:\\NUL\\ChiroSurf.exe', 'C:\\Apps\\ChiroSurf.exe --open']) {
    assert.throws(() => K.normalizeExecutable(input, 'chirosurf'), /chemin|exécutable|protocole|périphérique|contrôle|guillemets/i, JSON.stringify(input));
  }
});

test('accepts only a complete Windows path to kaleidoscope.exe', () => {
  for (const input of ['kaleidoscope.exe', 'C:kaleidoscope.exe', '\\Applications\\kaleidoscope.exe', 'C:\\Applications\\other.exe', 'C:\\Applications\\kaleidoscope.exe.bat', 'C:\\Applications', '/usr/bin/kaleidoscope.exe']) {
    assert.throws(() => K.normalizeExecutable(input), /chemin|exécutable/i, input);
  }
  assert.throws(() => K.normalizeExecutable(3), /texte/);
});

test('rejects protocols, device namespaces, control characters and internal or unmatched quotes', () => {
  for (const input of ['file:///C:/Apps/kaleidoscope.exe', 'https://host/kaleidoscope.exe', 'javascript:alert(1)', '\\\\?\\C:\\Apps\\kaleidoscope.exe', '\\\\.\\C:\\Apps\\kaleidoscope.exe', '\\??\\C:\\Apps\\kaleidoscope.exe', '""C:\\Apps\\kaleidoscope.exe""', '"C:\\Apps\\kaleidoscope.exe', 'C:\\App"s\\kaleidoscope.exe', 'C:\\Apps\\kaleidoscope.exe\n', 'C:\\Apps\u0000\\kaleidoscope.exe']) {
    assert.throws(() => K.normalizeExecutable(input), /protocole|périphérique|guillemets|contrôle/, JSON.stringify(input));
  }
  assert.throws(() => K.normalizeExecutable("'C:\\Apps\\kaleidoscope.exe'"), /chemin absolu Windows/);
});

test('resolves INDIR, FOLDER and a relative IN FILE, preserving spaces and accents', () => {
  const row = { indir: 'D:/Étude de terrain', rawFolder: 'Station 3/Nuit 1', file: 'séquence 001.WAV' };
  const before = JSON.stringify(row);
  assert.equal(K.recordingPath(row), 'D:\\Étude de terrain\\Station 3\\Nuit 1\\séquence 001.WAV');
  assert.equal(JSON.stringify(row), before);
  assert.equal(K.recordingPath({ indir: 'C:\\Sons\\', rawFolder: '', file: 'son.wav' }), 'C:\\Sons\\son.wav');
  assert.equal(K.recordingPath({ indir: "C:\\Étude de l'étang", rawFolder: "Près de l'île", file: "cri d'une pipistrelle.wav" }), "C:\\Étude de l'étang\\Près de l'île\\cri d'une pipistrelle.wav");
});

test('an absolute IN FILE takes precedence over CSV directories without duplicating them', () => {
  assert.equal(K.recordingPath({ indir: 'C:\\Sons', rawFolder: 'C:\\Sons\\Station', file: 'C:\\Sons\\Station\\son.wav' }), 'C:\\Sons\\Station\\son.wav');
  assert.equal(K.recordingPath({ indir: 'ignored', rawFolder: 'ignored', file: '\\\\serveur\\partage\\son.wav' }), '\\\\serveur\\partage\\son.wav');
});

test('an absolute FOLDER takes precedence over INDIR', () => {
  assert.equal(K.recordingPath({ indir: 'C:\\Base', rawFolder: 'D:\\Station', file: 'son.wav' }), 'D:\\Station\\son.wav');
  assert.equal(K.recordingPath({ rawFolder: '\\\\serveur\\partage\\Station', file: 'son.wav' }), '\\\\serveur\\partage\\Station\\son.wav');
});

test('preserves UNC roots and resolves traversal within the drive or share', () => {
  assert.equal(K.recordingPath({ indir: '\\\\serveur\\partage\\Base', rawFolder: '..\\Station\\.', file: 'sous-dossier\\..\\son.wav' }), '\\\\serveur\\partage\\Station\\son.wav');
  assert.equal(K.recordingPath({ indir: 'C:\\Base\\Station', rawFolder: '..', file: '..\\son.wav' }), 'C:\\son.wav');
  assert.throws(() => K.recordingPath({ indir: 'C:\\Base', rawFolder: '..\\..', file: 'son.wav' }), /sort de la racine/);
  assert.throws(() => K.recordingPath({ indir: '\\\\serveur\\partage', rawFolder: '..', file: 'son.wav' }), /sort de la racine/);
  assert.throws(() => K.recordingPath({ file: 'C:\\..\\son.wav' }), /sort de la racine/);
});

test('reports incomplete source paths and partial UNC paths in French', () => {
  assert.throws(() => K.recordingPath({ rawFolder: 'Station', file: 'son.wav' }), /Complétez la colonne INDIR/);
  assert.throws(() => K.recordingPath({ indir: 'Base', file: 'son.wav' }), /dossier absolu Windows/);
  assert.throws(() => K.recordingPath({ file: 'C:son.wav' }), /complet ou relatif/);
  assert.throws(() => K.recordingPath({ file: '\\Station\\son.wav' }), /complet ou relatif/);
  assert.throws(() => K.recordingPath({ indir: '\\\\serveur', file: 'son.wav' }), /serveur et un partage/);
  assert.throws(() => K.recordingPath({ file: '' }), /IN FILE/);
  assert.throws(() => K.recordingPath(null), /contact/);
});

test('rejects non-WAV files, injected protocols and invalid Windows filenames', () => {
  for (const file of ['son.mp3', 'son.wav.exe', 'https://host/son.wav', 'file:///C:/son.wav', 'son.wav:stream', 'son?.wav', 'son.wav\n', '"son.wav"', 'NUL.wav']) {
    assert.throws(() => K.recordingPath({ indir: 'C:\\Sons', file }), /WAV|protocole|invalide|contrôle|guillemets/, JSON.stringify(file));
  }
  assert.throws(() => K.recordingPath({ indir: 'C:\\Sons', rawFolder: 'Station.\\', file: 'son.wav' }), /invalide/);
  assert.throws(() => K.recordingPath({ indir: 'C:\\Sons', rawFolder: 'Station \\', file: 'son.wav' }), /invalide/);
  assert.throws(() => K.recordingPath({ file: '\\\\?\\C:\\Sons\\son.wav' }), /périphérique/);
});

test('keeps shell metacharacters as literal Windows path characters', () => {
  assert.equal(K.recordingPath({ indir: 'C:\\Étude & suivi; $terrain`', file: 'son (1).wav' }), 'C:\\Étude & suivi; $terrain`\\son (1).wav');
});

test('exposes the same pure viewer and path functions in the standalone browser bundle', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../kaleidoscope.js'), 'utf8'), context);
  assert.equal(typeof context.BatKaleidoscope.normalizeExecutable, 'function');
  assert.equal(context.BatKaleidoscope.viewerInfo().name, 'Kaleidoscope');
  assert.equal(context.BatKaleidoscope.viewerInfo('chirosurf').name, 'ChiroSurf');
  assert.equal(Object.isFrozen(context.BatKaleidoscope.viewerInfo('chirosurf')), true);
  assert.equal(context.BatKaleidoscope.normalizeExecutable('C:\\Applis\\ChiroSurf_4.6.exe', 'chirosurf'), 'C:\\Applis\\ChiroSurf_4.6.exe');
  assert.equal(context.BatKaleidoscope.recordingPath({ file: 'C:\\Sons\\son.wav' }), 'C:\\Sons\\son.wav');
  assert.equal(context.BatKaleidoscope.normalizeFolder('"C:\\Sons de terrain"'), 'C:\\Sons de terrain');
  assert.deepEqual(Object.keys(context.BatKaleidoscope).sort(), ['normalizeExecutable', 'normalizeFolder', 'recordingPath', 'viewerInfo']);
});
