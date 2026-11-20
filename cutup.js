(() => {
  'use strict';

  const sentenceSegmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'sentence' })
    : null;
  const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;

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

  function split(text, mode = 'phrase') {
    const lines = text.split(lineBreak)
      .flatMap((line) => mode === 'manual' ? line.split('|') : [line])
      .map((line) => line.trim())
      .filter(Boolean);

    if (mode === 'line' || mode === 'manual') return lines;
    const sentences = lines.flatMap(splitSentences);
    return sentences.flatMap(mode === 'word' ? splitWords : splitPhrases);
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

  function sourcePieces(text, source, mode) {
    const occurrences = new Map();
    return split(text, mode).map((fragment) => {
      const occurrence = occurrences.get(fragment) ?? 0;
      occurrences.set(fragment, occurrence + 1);
      return { id: source + ':' + occurrence + ':' + fragment, text: fragment, source };
    });
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

  function getSampleCounts(capacities, required, ratio) {
    if (ratio === null || !Number.isFinite(ratio)) return capacities;
    if (ratio <= 0) return [0, capacities[1]];
    if (ratio >= 100) return [capacities[0], 0];

    if (!capacities[0] || !capacities[1]) return capacities;
    const source = capacities[0] <= capacities[1] ? 0 : 1;
    const firstCount = Math.max(1, required[source]);
    const firstOtherCount = Math.max(1, required[1 - source]);
    const limit = capacities[source];
    const otherLimit = capacities[1 - source];
    const share = source === 0 ? ratio : 100 - ratio;
    let best = [1, 1];
    let bestError = Infinity;
    let bestTotal = 0;
    for (let count = firstCount; count <= limit; count += 1) {
      const idealOtherCount = count * (100 - share) / share;
      for (const nearest of [Math.floor(idealOtherCount), Math.ceil(idealOtherCount)]) {
        const other = Math.max(firstOtherCount, Math.min(otherLimit, nearest));
        const total = count + other;
        const error = Math.abs(count * (100 - share) - other * share) / total;
        if (error < bestError || (error === bestError && total > bestTotal)) {
          best = [count, other];
          bestError = error;
          bestTotal = total;
        }
      }
    }
    return source === 0 ? best : best.reverse();
  }

  function sample(pieces, count, ordered, randomness) {
    if (ordered && count === pieces.length) return pieces;
    const selected = shuffle(pieces, randomness, (piece) => piece.text).slice(0, count);
    if (!ordered) return selected;

    const selectedIds = new Set(selected.map((piece) => piece.id));
    return pieces.filter((piece) => selectedIds.has(piece.id));
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

  function arrange([first, second], count, strategy, rhythm, randomness) {
    if (count === 0) return [];
    if (!first.length || !second.length) {
      return partition(first.length ? first : second, count, rhythm);
    }
    if (strategy === 'alternate' || count > Math.max(first.length, second.length)) {
      const pieces = randomness() < 0.5 ? interleave(first, second) : interleave(second, first);
      return partition(pieces, count, rhythm);
    }

    const left = partition(first, count, rhythm);
    const right = partition(second, count, rhythm);
    const order = Array.from({ length: count }, (_, index) => strategy === 'ordered' ? index : count - 1 - index);
    if (rhythm && strategy === 'default') {
      // Pair longer groups with shorter ones while keeping a crossover on the first line.
      left.sort((a, b) => syllablesIn(b) - syllablesIn(a));
      right.sort((a, b) => syllablesIn(a) - syllablesIn(b));
      const crossover = order.findIndex((position) => left[position].length && right[position].length);
      if (crossover > 0) [order[0], order[crossover]] = [order[crossover], order[0]];
    }
    return order.map((position) => {
      return randomness() < 0.5
        ? interleave(left[position], right[position])
        : interleave(right[position], left[position]);
    });
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
    ratio = null,
    targetSyllables = null,
    previous = [],
    randomness = Math.random,
  } = {}) {
    const pins = collectPins(previous);
    const pinned = pins.flatMap((pin) => pin.pieces.map(({ piece }) => piece));
    const bySource = [0, 1].map((source) => pinned.filter((piece) => piece.source === source));
    const required = bySource.map((pieces) => pieces.length);
    const pools = bySource.map((pieces, source) => removePinned(
      sourcePieces(sources[source] ?? '', source, mode), pieces,
    ));
    const capacities = pools.map((pieces, source) => pieces.length + required[source]);
    const sampleCounts = getSampleCounts(capacities, required, sources.length > 1 ? ratio : null);
    const selected = pools.map((pieces, source) => sample(
      pieces, Math.max(0, sampleCounts[source] - required[source]), strategy === 'ordered', randomness,
    ));
    const totals = selected.map((pieces, source) => pieces.length + required[source]);
    const remaining = selected[0].length + selected[1].length;
    const preferredSyllables = Number(targetSyllables);
    const rhythm = Number.isFinite(preferredSyllables) && preferredSyllables > 0;
    const lengths = rhythm ? syllablesIn(selected[0]) + syllablesIn(selected[1]) + syllablesIn(pinned) : 0;
    const preferred = lengths ? Math.max(1, Math.round(lengths / preferredSyllables)) : Math.max(...totals);
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
    const drafts = arrange(selected, targets.length, strategy, rhythm, randomness);
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

  globalThis.Verbasizer = Object.freeze({ split, mix, mixSources, compose, countSyllables });
})();
