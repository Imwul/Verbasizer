(() => {
  'use strict';

  const sentenceSegmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'sentence' })
    : null;
  const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;
  const sentenceEnd = /[.!?…。！？]["'”’」』〉》】)\]]*$/u;

  function splitWords(text) {
    return text.match(/\S+/gu) ?? [];
  }

  function splitSentences(line) {
    const text = line.replace(/\s+([,.!?…。！？:;”’」』〉》】)\]])/gu, '$1')
      .replace(/([“‘「『〈《【(\[])\s+/gu, '$1');
    return sentenceSegmenter
      ? Array.from(sentenceSegmenter.segment(text), ({ segment }) => segment)
      : text.match(/.+?(?:[.!?…。！？]+["'”’」』〉》】)\]]*(?=\s|\p{Script=Hangul}|$)|$)/gu) ?? [];
  }

  function splitPhrases(sentence) {
    const words = splitWords(sentence);
    if (words.length === 0) return [];
    return groupLines(words, Math.max(1, Math.round(words.length / 3)));
  }

  function groupLines(fragments, count) {
    return Array.from({ length: count }, (_, index) => takeLine(fragments, count, index).join(' '));
  }

  function takeLine(fragments, count, index) {
    const start = Math.floor(index * fragments.length / count);
    const end = Math.floor((index + 1) * fragments.length / count);
    return fragments.slice(start, end);
  }

  function fragmentGroups(text, mode) {
    const lines = text.split(lineBreak).map((line) => line.trim()).filter(Boolean);
    if (mode === 'line') return lines.map((line) => [line]);
    if (mode === 'manual') {
      return lines.map((line) => line.split('|').map((part) => part.trim()).filter(Boolean));
    }
    const sentences = lines.flatMap(splitSentences);
    return sentences.map(mode === 'word' ? splitWords : splitPhrases);
  }

  function split(text, mode = 'phrase') {
    return fragmentGroups(text, mode).flat();
  }

  function shuffle(fragments, randomness, getText = (fragment) => fragment) {
    const shuffled = [...fragments];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(randomness() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }

    if (shuffled.every((fragment, index) => getText(fragment) === getText(fragments[index]))) {
      const different = shuffled.findIndex((fragment) => getText(fragment) !== getText(shuffled[0]));
      if (different > 0) {
        [shuffled[0], shuffled[different]] = [shuffled[different], shuffled[0]];
      }
    }

    return shuffled;
  }

  function normalizeLineCount(lineCount) {
    const count = Number(lineCount);
    return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 6;
  }

  function mix(fragments, { lineCount = 6, randomness = Math.random } = {}) {
    const shuffled = shuffle(fragments, randomness);
    return groupLines(shuffled, Math.min(shuffled.length, normalizeLineCount(lineCount)));
  }

  function interleave(first, second) {
    const line = [];
    const length = Math.max(first.length, second.length);
    for (let index = 0; index < length; index += 1) {
      if (index < first.length) line.push(first[index]);
      if (index < second.length) line.push(second[index]);
    }
    return line;
  }

  function mixSources(firstFragments, secondFragments, { lineCount = 6, randomness = Math.random } = {}) {
    if (!firstFragments.length || !secondFragments.length) {
      return mix(firstFragments.length ? firstFragments : secondFragments, { lineCount, randomness });
    }

    const first = shuffle(firstFragments, randomness);
    const second = shuffle(secondFragments, randomness);
    const count = Math.min(Math.max(first.length, second.length), normalizeLineCount(lineCount));

    return Array.from({ length: count }, (_, index) => {
      // The last group has fragments from both sources even when one source is very short.
      const lineIndex = count - 1 - index;
      const left = takeLine(first, count, lineIndex);
      const right = takeLine(second, count, lineIndex);
      return (randomness() < 0.5 ? interleave(left, right) : interleave(right, left)).join(' ');
    });
  }

  function countSyllables(text) {
    return text.normalize('NFC').match(/[가-힣]/gu)?.length ?? 0;
  }

  function surroundingWords(words, start, end, manual) {
    let contextStart = Math.max(0, start - 3);
    let contextEnd = Math.min(words.length, end + 6);
    if (manual) {
      // Manual fragments can span sentences on the same physical line.
      for (let index = contextStart; index < start; index += 1) {
        if (sentenceEnd.test(words[index])) contextStart = index + 1;
      }
      for (let index = end - 1; index < contextEnd; index += 1) {
        if (!sentenceEnd.test(words[index])) continue;
        contextEnd = index + 1;
        break;
      }
    }
    return { before: words.slice(contextStart, start), after: words.slice(end, contextEnd) };
  }

  // Every piece remembers where it came from: its neighbours in the source (origin),
  // the index of its first word in the whole source (pos), and its sentence (group).
  function sourcePieces(text, source, mode) {
    const occurrences = new Map();
    let offset = 0;
    return fragmentGroups(text ?? '', mode).flatMap((fragments, group) => {
      const wordGroups = fragments.map(splitWords);
      const words = wordGroups.flat();
      let start = 0;
      const pieces = fragments.map((fragment, index) => {
        const occurrence = occurrences.get(fragment) ?? 0;
        occurrences.set(fragment, occurrence + 1);
        const end = start + wordGroups[index].length;
        const origin = surroundingWords(words, start, end, mode === 'manual');
        const piece = { id: source + ':' + occurrence + ':' + fragment, text: fragment, source, origin, pos: offset + start, group };
        start = end;
        return piece;
      });
      offset += words.length;
      return pieces;
    });
  }

  function restoreOrigins(rows, sources, mode = 'phrase') {
    const caches = sources.map((text) => typeof text === 'string' ? new Map() : null);
    const modes = [...new Set([mode, 'phrase', 'word', 'manual', 'line'])];

    function indexSource(source, splitMode) {
      const cache = caches[source];
      if (!cache.has(splitMode)) {
        const byId = new Map();
        const uniqueText = new Map();
        for (const piece of sourcePieces(sources[source], source, splitMode)) {
          byId.set(piece.id, piece);
          uniqueText.set(piece.text, uniqueText.has(piece.text) ? null : piece);
        }
        cache.set(splitMode, { byId, uniqueText });
      }
      return cache.get(splitMode);
    }

    function findPiece(piece) {
      if (!caches[piece.source]) return null;
      let unique = null;
      for (const splitMode of modes) {
        const { byId, uniqueText } = indexSource(piece.source, splitMode);
        const exact = byId.get(piece.id);
        if (exact?.text === piece.text) return exact;
        unique ??= uniqueText.get(piece.text);
      }
      return unique;
    }

    let changed = false;
    const restored = rows.map((row) => {
      let pieces;
      for (const [index, piece] of row.pieces.entries()) {
        if (piece.origin && Number.isInteger(piece.pos)) continue;
        const found = findPiece(piece);
        if (!found) continue;
        pieces ??= [...row.pieces];
        pieces[index] = { ...piece, origin: piece.origin ?? found.origin, pos: found.pos, group: found.group };
      }
      if (!pieces) return row;
      changed = true;
      return { ...row, pieces };
    });
    return changed ? restored : rows;
  }

  function collectPins(previous) {
    const pins = [];
    for (const [index, row] of previous.entries()) {
      const pieces = [];
      for (const [slot, piece] of row.pieces.entries()) {
        if (row.locked || piece.locked) {
          const pinnedSlot = Number.isInteger(piece.pinnedSlot) && piece.pinnedSlot >= 0 ? piece.pinnedSlot : slot;
          pieces.push({ slot: pinnedSlot, piece });
        }
      }
      pieces.sort((a, b) => a.slot - b.slot);
      if (row.locked || pieces.length) pins.push({ index, row, pieces });
    }
    return pins;
  }

  function removePinned(pool, pinned) {
    if (pinned.length === 0) return pool;
    const available = new Map(pool.map((piece) => [piece.id, piece]));
    const unclaimed = new Map();
    for (const piece of pinned) {
      if (!available.delete(piece.id)) {
        unclaimed.set(piece.text, (unclaimed.get(piece.text) ?? 0) + 1);
      }
    }
    return Array.from(available.values()).filter((piece) => {
      const count = unclaimed.get(piece.text) ?? 0;
      if (count === 0) return true;
      unclaimed.set(piece.text, count - 1);
      return false;
    });
  }

  function wordList(words) {
    return (words ?? []).map((word) => String(word).trim()).filter(Boolean);
  }

  function excludePieces(pieces, exclude) {
    const banned = wordList(exclude);
    return banned.length ? pieces.filter((piece) => !banned.some((word) => piece.text.includes(word))) : pieces;
  }

  // With weights, each column contributes in proportion; without, every piece is available.
  function getSampleCounts(capacities, required, weights) {
    if (!Array.isArray(weights)) return capacities;
    const shares = capacities.map((capacity, source) => (capacity > 0 ? Math.max(0, Number(weights[source]) || 0) : 0));
    const scales = shares.map((share, source) => (share > 0 ? capacities[source] / share : Infinity));
    const scale = Math.min(...scales);
    if (!Number.isFinite(scale)) return capacities;
    return capacities.map((capacity, source) => Math.min(capacity, Math.max(required[source], Math.round(scale * shares[source]))));
  }

  // Pick `count` pieces; one piece for every must-include word comes first.
  function sample(pieces, count, ordered, randomness, include = []) {
    if (count <= 0) return [];
    const priority = [];
    for (const word of wordList(include)) {
      const matches = pieces.filter((piece) => piece.text.includes(word) && !priority.includes(piece));
      if (matches.length) priority.push(matches[Math.floor(randomness() * matches.length)]);
    }
    if (!priority.length && ordered && count >= pieces.length) return pieces;
    const rest = shuffle(pieces.filter((piece) => !priority.includes(piece)), randomness, (piece) => piece.text);
    const selected = [...priority, ...rest].slice(0, count);
    if (!ordered) return shuffle(selected, randomness, (piece) => piece.text);
    const selectedIds = new Set(selected.map((piece) => piece.id));
    return pieces.filter((piece) => selectedIds.has(piece.id));
  }

  function trimToBudget(pieces, budget, randomness, keep) {
    if (!pieces.length) return pieces;
    const kept = new Set();
    let total = 0;
    const order = [...pieces.filter((piece) => keep.has(piece.id)), ...shuffle(pieces.filter((piece) => !keep.has(piece.id)), randomness)];
    for (const piece of order) {
      if (kept.size && !keep.has(piece.id) && total + countSyllables(piece.text) / 2 > budget) continue;
      kept.add(piece);
      total += countSyllables(piece.text);
    }
    return pieces.filter((piece) => kept.has(piece));
  }

  function syllablesIn(pieces) {
    return pieces.reduce((sum, piece) => sum + countSyllables(piece.pinnedText ?? piece.text), 0);
  }

  function partition(pieces, count, rhythm) {
    if (!rhythm || pieces.length <= count) {
      return Array.from({ length: count }, (_, index) => takeLine(pieces, count, index));
    }

    const lengths = pieces.map((piece) => Math.max(1, countSyllables(piece.text)));
    let remainingLength = lengths.reduce((sum, length) => sum + length, 0);
    let start = 0;
    return Array.from({ length: count }, (_, index) => {
      const remainingGroups = count - index;
      const target = remainingLength / remainingGroups;
      const maxEnd = pieces.length - remainingGroups + 1;
      let end = start + 1;
      let length = lengths[start];
      while (end < maxEnd && (remainingGroups === 1 || length + lengths[end] / 2 <= target)) {
        length += lengths[end];
        end += 1;
      }
      const group = pieces.slice(start, end);
      remainingLength -= length;
      start = end;
      return group;
    });
  }

  function interleaveMany(lists) {
    const line = [];
    const length = Math.max(0, ...lists.map((list) => list.length));
    for (let index = 0; index < length; index += 1) {
      for (const list of lists) if (index < list.length) line.push(list[index]);
    }
    return line;
  }

  function arrange(lists, count, strategy, rhythm, randomness) {
    if (count === 0) return [];
    const filled = lists.filter((list) => list.length);
    if (filled.length <= 1) return partition(filled[0] ?? [], count, rhythm);
    const sourceOrder = () => (strategy === 'ordered' ? filled : shuffle(filled, randomness));
    if (strategy === 'alternate' || count > Math.max(...filled.map((list) => list.length))) {
      return partition(interleaveMany(sourceOrder()), count, rhythm);
    }

    const groups = filled.map((list) => partition(list, count, rhythm));
    if (rhythm && strategy === 'default') {
      // Pair longer groups from one column with shorter groups from the next.
      groups.forEach((list, source) => list.sort((a, b) => (source % 2 ? syllablesIn(a) - syllablesIn(b) : syllablesIn(b) - syllablesIn(a))));
    }
    return Array.from({ length: count }, (_, line) => {
      const position = strategy === 'ordered' ? line : count - 1 - line;
      const parts = groups.map((list) => list[position]);
      return interleaveMany(strategy === 'ordered' ? parts : shuffle(parts, randomness, (part) => part.map((piece) => piece.id).join()));
    });
  }

  // Bowie's own layout: every line takes one fragment from each column, left to right.
  function arrangeColumns(lists, count) {
    return Array.from({ length: count }, (_, line) => lists.map((list) => list[line]).filter(Boolean));
  }

  function placePins(pins, count) {
    const slots = Array(count).fill(null);
    for (const [index, pin] of pins.entries()) {
      // Keep the relative order even if the new line limit pushes late pins forward.
      const latestSlot = count - (pins.length - index);
      slots[Math.min(pin.index, latestSlot)] = pin;
    }
    return slots;
  }

  function compose(sources, {
    mode = 'phrase',
    lineCount = 6,
    strategy = 'default',
    weights = null,
    ratio = null,
    targetSyllables = null,
    include = [],
    exclude = [],
    previous = [],
    randomness = Math.random,
  } = {}) {
    const columns = sources.length;
    // Older callers pass a two-column ratio (0–100) instead of weights.
    const shares = weights ?? (ratio === null || !Number.isFinite(Number(ratio)) || columns < 2 ? null : [Number(ratio), 100 - Number(ratio)]);
    const pins = collectPins(previous);
    const pinned = pins.flatMap((pin) => pin.pieces.map(({ piece }) => piece));
    const bySource = sources.map((_, source) => pinned.filter((piece) => piece.source === source));
    const required = bySource.map((pieces) => pieces.length);
    const pools = bySource.map((pieces, source) => removePinned(
      excludePieces(sourcePieces(sources[source] ?? '', source, mode), exclude), pieces,
    ));
    const capacities = pools.map((pieces, source) => pieces.length + required[source]);
    const ordered = strategy === 'ordered';
    const freeRows = Math.max(0, normalizeLineCount(lineCount) - pins.filter((pin) => pin.row.locked).length);

    let selected;
    if (strategy === 'columns') {
      selected = pools.map((pieces) => sample(pieces, Math.min(pieces.length, freeRows), false, randomness, include));
    } else {
      const sampleCounts = getSampleCounts(capacities, required, columns > 1 ? shares : null);
      selected = pools.map((pieces, source) => sample(
        pieces, Math.max(0, sampleCounts[source] - required[source]), ordered, randomness, include,
      ));
    }

    const preferredSyllables = Number(targetSyllables);
    const rhythm = strategy !== 'columns' && Number.isFinite(preferredSyllables) && preferredSyllables > 0;
    if (rhythm) {
      // Use only as many fragments as the requested lines can hold.
      const budget = preferredSyllables * normalizeLineCount(lineCount) - syllablesIn(pinned);
      const available = selected.reduce((sum, pieces) => sum + syllablesIn(pieces), 0);
      if (available > budget) {
        const keep = new Set(sample(selected.flat(), wordList(include).length, false, randomness, include).map((piece) => piece.id));
        selected = selected.map((pieces) => {
          const share = available ? syllablesIn(pieces) / available : 0;
          return trimToBudget(pieces, Math.max(0, budget) * share, randomness, keep);
        });
      }
    }

    const totals = selected.map((pieces, source) => pieces.length + required[source]);
    const remaining = selected.reduce((sum, pieces) => sum + pieces.length, 0);
    const lengths = rhythm ? selected.reduce((sum, pieces) => sum + syllablesIn(pieces), 0) + syllablesIn(pinned) : 0;
    const preferred = strategy === 'columns'
      ? Math.max(0, ...selected.map((pieces) => pieces.length)) + pins.length
      : lengths ? Math.max(1, Math.round(lengths / preferredSyllables)) : Math.max(0, ...totals);
    const needsFreeLine = remaining > 0 && pins.every((pin) => pin.row.locked);
    const minimum = Math.max((pins.at(-1)?.index ?? -1) + 1, pins.length + Number(needsFreeLine));
    const count = Math.min(
      Math.max(normalizeLineCount(lineCount), pins.length + Number(needsFreeLine)),
      pins.length + remaining,
      Math.max(preferred, minimum),
    );
    const slots = placePins(pins, count);
    const vacancies = [];
    const partial = [];
    slots.forEach((pin, index) => {
      if (!pin) vacancies.push(index);
      else if (!pin.row.locked) partial.push(index);
    });
    const targets = [...vacancies, ...partial].slice(0, remaining).sort((a, b) => a - b);
    const drafts = strategy === 'columns'
      ? arrangeColumns(selected, targets.length)
      : arrange(selected, targets.length, strategy, rhythm, randomness);
    const draftBySlot = new Map(targets.map((slot, index) => [slot, drafts[index]]));

    return slots.map((pin, index) => {
      if (pin?.row.locked) return pin.row;
      const pieces = draftBySlot.get(index) ?? [];
      let nextSlot = 0;
      for (const { slot, piece } of pin?.pieces ?? []) {
        const position = Math.min(Math.max(slot, nextSlot), pieces.length);
        pieces.splice(position, 0, piece);
        nextSlot = position + 1;
      }
      return { pieces, locked: false };
    });
  }

  // Pieces not used by any line, optionally only from one column.
  function unusedPieces(sources, rows, { mode = 'phrase', exclude = [], source = null, keepRow = -1 } = {}) {
    const used = rows.flatMap((row, index) => (index === keepRow ? row.pieces.filter((piece) => piece.locked) : row.pieces));
    const all = sources.flatMap((text, column) => (source === null || source === column
      ? excludePieces(sourcePieces(text ?? '', column, mode), exclude)
      : []));
    return removePinned(all, used);
  }

  // A new draw for one line; the other lines and this line's locked pieces stay.
  function rerollLine(sources, rows, index, {
    mode = 'phrase', strategy = 'default', targetSyllables = null, include = [], exclude = [], randomness = Math.random,
  } = {}) {
    const row = rows[index];
    if (!row || row.locked) return row;
    const keep = row.pieces.filter((piece) => piece.locked);
    let pool = unusedPieces(sources, rows, { mode, exclude, keepRow: index });
    if (!pool.length) pool = removePinned(sources.flatMap((text, column) => sourcePieces(text ?? '', column, mode)), keep);
    if (!pool.length) return row;
    let fresh;
    if (strategy === 'columns') {
      fresh = sources.map((_, column) => pool.filter((piece) => piece.source === column))
        .map((pieces) => pieces[Math.floor(randomness() * pieces.length)]).filter(Boolean);
    } else {
      const shuffled = sample(pool, pool.length, false, randomness, include);
      const target = Number(targetSyllables);
      const wanted = Math.max(1, row.pieces.length - keep.length);
      fresh = [];
      let total = syllablesIn(keep);
      for (const piece of shuffled) {
        if (Number.isFinite(target) && target > 0) {
          if (fresh.length && total + countSyllables(piece.text) / 2 > target) continue;
        } else if (fresh.length >= wanted) break;
        fresh.push(piece);
        total += countSyllables(piece.text);
      }
    }
    const pieces = [...fresh];
    let nextSlot = 0;
    for (const piece of keep.sort((a, b) => (a.pinnedSlot ?? 0) - (b.pinnedSlot ?? 0))) {
      const position = Math.min(Math.max(piece.pinnedSlot ?? 0, nextSlot), pieces.length);
      pieces.splice(position, 0, piece);
      nextSlot = position + 1;
    }
    return { pieces, locked: false };
  }

  // Swap one piece for an unused one of similar length, preferably from the same column.
  function swapPiece(sources, rows, index, pieceId, { mode = 'phrase', exclude = [], randomness = Math.random } = {}) {
    const row = rows[index];
    const position = row?.pieces.findIndex((piece) => piece.id === pieceId) ?? -1;
    if (position === -1) return null;
    const current = row.pieces[position];
    let pool = unusedPieces(sources, rows, { mode, exclude, source: current.source });
    if (!pool.length) pool = unusedPieces(sources, rows, { mode, exclude });
    if (!pool.length) return null;
    const length = countSyllables(current.text);
    const near = shuffle(pool, randomness)
      .sort((a, b) => Math.abs(countSyllables(a.text) - length) - Math.abs(countSyllables(b.text) - length))
      .slice(0, 4);
    const replacement = near[Math.floor(randomness() * near.length)];
    const pieces = [...row.pieces];
    pieces[position] = replacement;
    return { ...row, pieces };
  }

  // Junctions between neighbouring pieces: 'far' when they came from different columns
  // or from far apart in one text, 'seam' when they were already neighbours in the source.
  function junctions(pieces) {
    return pieces.slice(1).map((piece, index) => {
      const before = pieces[index];
      if (before.source !== piece.source) return 'far';
      if (!Number.isInteger(before.pos) || !Number.isInteger(piece.pos)) return 'near';
      const length = splitWords(before.text).length;
      if (piece.pos === before.pos + length) return 'seam';
      return Math.abs(piece.pos - before.pos) > 12 || before.group !== piece.group ? 'far' : 'near';
    });
  }

  // The sentence of the source a piece was cut from.
  function sentenceOf(text, piece) {
    if (typeof text !== 'string' || !piece?.text) return null;
    const occurrence = Number(String(piece.id).split(':')[1]) || 0;
    let at = -1;
    for (let count = 0; count <= occurrence; count += 1) {
      const next = text.indexOf(piece.text, at + 1);
      if (next === -1) break;
      at = next;
    }
    if (at === -1) return null;
    const head = text.slice(0, at);
    const start = Math.max(head.search(/[^.!?…。！？\n]*$/u), 0);
    const tailMatch = /[.!?…。！？]["'”’」』)\]]*|\n/u.exec(text.slice(at + piece.text.length));
    const end = tailMatch ? at + piece.text.length + tailMatch.index + tailMatch[0].length : text.length;
    return {
      before: text.slice(start, at).trimStart(),
      match: piece.text,
      after: text.slice(at + piece.text.length, end).trimEnd(),
    };
  }

  globalThis.Verbasizer = Object.freeze({
    split, mix, mixSources, compose, countSyllables, restoreOrigins,
    rerollLine, swapPiece, junctions, sentenceOf, unusedPieces,
  });
})();
