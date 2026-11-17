/**
 * Beat Saber V2 map archive parser (With comfort features for Ragnarock)
 *
 *   const result = await BeatSaberMap.parseMapArchive(arrayBufferOrUint8Array);
 *   result.meta, result.difficultySets, result.cover, result.audio, result.warnings
 */
(function (root) {
  'use strict';

  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const baseName = (p) => p.split('/').pop();

  function sniffMime(bytes, fallbackName) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    const ext = (fallbackName.split('.').pop() || '').toLowerCase();
    return MIME[ext] || 'application/octet-stream';
  }

  /**
   * @param {ArrayBuffer|Uint8Array|Blob} data  the .zip archive
   * @param {object} [JSZipLib]                 optional JSZip constructor
   */
  async function parseMapArchive(data, JSZipLib) {
    JSZipLib = JSZipLib || root.JSZip || (typeof require === 'function' ? require('jszip') : null);
    if (!JSZipLib) throw new Error('JSZip is required (load it or pass it as the 2nd argument).');

    const zip = await JSZipLib.loadAsync(data);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const byPath = new Map(entries.map((f) => [norm(f.name).toLowerCase(), f]));
    const infoEntry = entries
      .filter((f) => baseName(norm(f.name)).toLowerCase() === 'info.dat')
      .sort((a, b) => norm(a.name).split('/').length - norm(b.name).split('/').length)[0];
    if (!infoEntry) throw new Error('No info.dat found in the archive.');

    const infoPath = norm(infoEntry.name);
    const dir = infoPath.slice(0, infoPath.length - 'info.dat'.length);
    const lookup = (name) => (name ? byPath.get((dir + norm(name)).toLowerCase()) : undefined);

    let text = (await infoEntry.async('string')).replace(/^\uFEFF/, '');
    let info;
    try {
      info = JSON.parse(text);
    } catch (e) {
      throw new Error('info.dat is not valid JSON: ' + e.message);
    }

    const warnings = [];
    const version = String(info._version ?? '');
    if (!version.startsWith('2.')) warnings.push(`Expected a V2 info.dat but _version is "${version || 'missing'}".`);

    const meta = {
      version,
      songName: info._songName ?? '',
      songSubName: info._songSubName ?? '',
      songAuthorName: info._songAuthorName ?? '',
      levelAuthorName: info._levelAuthorName ?? '',
      explicit: info._explicit ?? false,
      bpm: info._beatsPerMinute ?? null,
      songTimeOffset: info._songTimeOffset ?? 0,
      shuffle: info._shuffle ?? 0,
      shufflePeriod: info._shufflePeriod ?? 0,
      previewStartTime: info._previewStartTime ?? 0,
      previewDuration: info._previewDuration ?? 0,
      songLength: info._songApproximativeDuration ?? 0,
      environmentName: info._environmentName ?? '',
      allDirectionsEnvironmentName: info._allDirectionsEnvironmentName ?? '',
    };

    // Cover image
    let cover = null;
    if (!info._coverImageFilename) {
      warnings.push('info.dat does not name a cover image.');
    } else {
      const entry = lookup(info._coverImageFilename);
      if (!entry) {
        warnings.push(`Cover "${info._coverImageFilename}" is listed in info.dat but missing from the archive.`);
      } else {
        const bytes = await entry.async('uint8array');
        cover = {
          filename: info._coverImageFilename,
          path: norm(entry.name),
          mimeType: sniffMime(bytes, info._coverImageFilename),
          size: bytes.length,
          bytes,
        };
      }
    }

    // Audio
    const audioEntry = lookup(info._songFilename);
    const audio = { filename: info._songFilename ?? '', exists: !!audioEntry };
    if (!audio.exists) warnings.push(`Audio file "${audio.filename}" not found.`);

    // Difficulty sets
    const difficultySets = (info._difficultyBeatmapSets || []).map((set) => ({
      characteristic: set._beatmapCharacteristicName,
      difficulties: (set._difficultyBeatmaps || []).map((d) => {
        const exists = !!lookup(d._beatmapFilename);
        if (!exists) warnings.push(`Beatmap file "${d._beatmapFilename}" not found.`);
        return {
          difficulty: d._difficulty,
          rank: d._difficultyRank,
          filename: d._beatmapFilename,
          noteJumpSpeed: d._noteJumpMovementSpeed,
          noteJumpStartBeatOffset: d._noteJumpStartBeatOffset,
          exists,
          customData: d._customData ?? null,
        };
      }),
    }));

    return {
      meta,
      cover,
      audio,
      difficultySets,
      customData: info._customData ?? null,
      files: entries.map((f) => norm(f.name)),
      warnings,
      info, // raw parsed JSON
    };
  }

  /** Browser helper: turn the cover bytes into an object URL for <img src>. */
  function coverToObjectURL(result) {
    if (!result.cover) {
        console.warn("Cover art is null!");
        return null;
    } 
    return URL.createObjectURL(new Blob([result.cover.bytes], { type: result.cover.mimeType }));
  }

  const api = { parseMapArchive, coverToObjectURL };
  root.BeatSaberMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
