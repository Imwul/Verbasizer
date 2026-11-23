(() => {
  'use strict';

  const notesKey = 'verbasizer-notes-v2';
  const legacyKey = 'verbasizer-workspace-v1';
  const prefsKey = 'verbasizer-prefs';
  const maxColumns = 6;

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function newId() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function make(title, data) {
    const now = new Date().toISOString();
    return { id: newId(), title, created: now, updated: now, data };
  }

  function isNote(note) {
    return note && typeof note.id === 'string' && typeof note.title === 'string' && note.data && typeof note.data === 'object';
  }

  // The single workspace saved by version 1 becomes the first note.
  function migrateLegacy(saved) {
    const texts = Array.isArray(saved.sources) ? saved.sources.filter((text) => typeof text === 'string') : [];
    const ratio = Number(saved.ratio);
    const share = Number.isFinite(ratio) ? ratio : 50;
    const weightOf = (value) => Math.min(5, Math.max(1, Math.round(value / 20)));
    const columns = [{ text: texts[0] ?? '', enabled: true, weight: weightOf(share) }];
    if (texts[1]?.trim()) columns.push({ text: texts[1], enabled: saved.dual === true, weight: weightOf(100 - share) });
    return {
      columns,
      useWeights: saved.useRatio === true && saved.dual === true,
      mode: saved.mode,
      lineCount: saved.lineCount,
      strategy: saved.strategy,
      syllables: saved.syllables,
      strengthLevel: saved.strengthLevel,
      strength: saved.strength,
      origins: saved.origins,
      rows: saved.rows,
      savedLines: saved.savedLines,
    };
  }

  // The version-1 workspace is moved into a note once, then deleted.
  function dropLegacy() {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // Storage may be unavailable; nothing to clean up then.
    }
  }

  function load() {
    const book = read(notesKey);
    if (book && Array.isArray(book.notes)) {
      book.notes = book.notes.filter(isNote);
      if (book.notes.length) {
        if (!book.notes.some((note) => note.id === book.current)) book.current = book.notes[0].id;
        dropLegacy();
        return book;
      }
    }
    const fresh = { version: 2, current: null, notes: [] };
    const legacy = read(legacyKey);
    if (legacy && Array.isArray(legacy.sources)) {
      const note = make('첫 노트', migrateLegacy(legacy));
      fresh.notes.push(note);
      fresh.current = note.id;
      if (save(fresh)) dropLegacy();
    }
    return fresh;
  }

  function save(book) {
    return write(notesKey, book);
  }

  function prefs() {
    return read(prefsKey) ?? {};
  }

  function savePrefs(value) {
    return write(prefsKey, value);
  }

  function backup(book) {
    return JSON.stringify({ app: 'verbasizer-ko', version: 2, exported: new Date().toISOString(), notes: book.notes }, null, 2);
  }

  // Accepts a backup file, or a single version-1 workspace.
  function parseBackup(text) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.notes)) return parsed.notes.filter(isNote);
    if (Array.isArray(parsed?.sources)) return [make('불러온 작업', migrateLegacy(parsed))];
    throw new Error('not a backup');
  }

  globalThis.VerbasizerStore = Object.freeze({
    load, save, make, newId, prefs, savePrefs, backup, parseBackup, maxColumns,
  });
})();
