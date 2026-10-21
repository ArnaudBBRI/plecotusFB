(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatKaleidoscope = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const VIEWERS = Object.freeze({
    kaleidoscope: Object.freeze({ id: 'kaleidoscope', name: 'Kaleidoscope', executableHint: 'kaleidoscope.exe' }),
    chirosurf: Object.freeze({ id: 'chirosurf', name: 'ChiroSurf', executableHint: 'ChiroSurf.exe' })
  });

  function viewerInfo(viewer = 'kaleidoscope') {
    if (typeof viewer !== 'string' || !Object.prototype.hasOwnProperty.call(VIEWERS, viewer)) {
      throw new Error('Logiciel non pris en charge. Choisissez Kaleidoscope ou ChiroSurf.');
    }
    return VIEWERS[viewer];
  }

  function cleanInput(value, allowOuterQuotes) {
    if (value == null) return '';
    if (typeof value !== 'string') throw new TypeError('Le chemin doit être un texte.');
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
      throw new Error('Le chemin contient un caractère de contrôle interdit.');
    }
    let input = value.trim();
    // Explorer's “Copier en tant que chemin d’accès” wraps the selected
    // executable in double quotes. Only that one complete outer pair is accepted.
    if (allowOuterQuotes && input.length >= 2 && input.startsWith('"') && input.endsWith('"')) {
      input = input.slice(1, -1).trim();
    }
    if (/"/.test(input)) throw new Error('Saisissez le chemin sans guillemets internes.');
    const path = input.replace(/\//g, '\\');
    if (/^\\\\[?.]\\/.test(path) || /^\\\?\?\\/.test(path)) {
      throw new Error('Les chemins de périphériques Windows ne sont pas pris en charge.');
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:/i.test(path)) {
      throw new Error('Utilisez un chemin de fichier Windows, pas une URL ou un protocole.');
    }
    return path;
  }

  function checkComponent(component) {
    if (/[<>:"|?*]/.test(component) || /[ .]$/.test(component) || DEVICE_NAME.test(component)) {
      throw new Error('Le chemin contient un nom de dossier ou de fichier invalide sous Windows.');
    }
  }

  function absolute(path) {
    return /^[a-z]:\\/i.test(path) || path.startsWith('\\\\');
  }

  function appendParts(result, path) {
    for (const part of path.split('\\')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!result.parts.length) throw new Error('Le chemin sort de la racine du lecteur ou du partage réseau.');
        result.parts.pop();
      } else {
        checkComponent(part);
        result.parts.push(part);
      }
    }
    return result;
  }

  function parseAbsolute(path) {
    const drive = path.match(/^([a-z]):\\/i);
    if (drive) return appendParts({ root: drive[1].toUpperCase() + ':\\', parts: [] }, path.slice(3));
    if (path.startsWith('\\\\')) {
      const components = path.slice(2).split('\\');
      const server = components.shift();
      const share = components.shift();
      if (!server || !share || server === '.' || server === '..' || share === '.' || share === '..') {
        throw new Error('Le chemin réseau doit contenir un serveur et un partage : \\\\serveur\\partage.');
      }
      checkComponent(server);
      checkComponent(share);
      return appendParts({ root: '\\\\' + server + '\\' + share + '\\', parts: [] }, components.join('\\'));
    }
    throw new Error('Un chemin absolu Windows est requis, par exemple C:\\Dossier ou \\\\serveur\\partage.');
  }

  function pathText(parsed) {
    return parsed.root + parsed.parts.join('\\');
  }

  function normalizeExecutable(input, viewer = 'kaleidoscope') {
    const info = viewerInfo(viewer);
    const path = cleanInput(input, true);
    if (!path) return '';
    const parsed = parseAbsolute(path);
    const basename = parsed.parts[parsed.parts.length - 1] || '';
    const allowed = info.id === 'kaleidoscope'
      ? /^kaleidoscope\.exe$/i.test(basename)
      : /^chirosurf(?:[ _-]?\d+(?:\.\d+)*)?\.exe$/i.test(basename);
    if (!allowed) {
      throw new Error('Le chemin doit désigner l’exécutable ' + info.executableHint +
        (info.id === 'chirosurf' ? ' (le nom peut inclure un numéro de version, par exemple ChiroSurf_4.6.exe).' : '.'));
    }
    return pathText(parsed);
  }

  function recordingPath(row) {
    if (!row || typeof row !== 'object') throw new TypeError('Le contact à ouvrir est manquant.');
    const file = cleanInput(row.file);
    if (!file) throw new Error('Nom du fichier WAV manquant dans la colonne IN FILE.');
    let parsed;
    if (absolute(file)) {
      parsed = parseAbsolute(file);
    } else {
      if (file.startsWith('\\') || /^[a-z]:/i.test(file)) {
        throw new Error('Le chemin IN FILE doit être complet ou relatif à INDIR et FOLDER.');
      }
      const folder = cleanInput(row.rawFolder);
      if (absolute(folder)) {
        parsed = parseAbsolute(folder);
      } else {
        if (folder.startsWith('\\') || /^[a-z]:/i.test(folder)) {
          throw new Error('Le chemin FOLDER doit être complet ou relatif à INDIR.');
        }
        const indir = cleanInput(row.indir);
        if (!indir || !absolute(indir)) {
          throw new Error('Le chemin du WAV est incomplet. Complétez la colonne INDIR avec un dossier absolu Windows.');
        }
        parsed = appendParts(parseAbsolute(indir), folder);
      }
      parsed = appendParts(parsed, file);
    }
    const basename = parsed.parts[parsed.parts.length - 1] || '';
    if (!/\.wav$/i.test(basename)) throw new Error('Seuls les fichiers WAV peuvent être ouverts dans le logiciel choisi.');
    return pathText(parsed);
  }

  return Object.freeze({ viewerInfo, normalizeExecutable, recordingPath });
});
