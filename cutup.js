(() => {
  'use strict';

  const sentenceSegmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'sentence' })
    : null;

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
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (mode === 'line') return lines;
    const sentences = lines.flatMap(splitSentences);
    return sentences.flatMap(mode === 'word' ? splitWords : splitPhrases);
  }

  function shuffle(fragments, randomness) {
    const shuffled = [...fragments];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(randomness() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }

    if (shuffled.every((fragment, index) => fragment === fragments[index])) {
      const different = shuffled.findIndex((fragment) => fragment !== shuffled[0]);
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
    return line.join(' ');
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
      return randomness() < 0.5 ? interleave(left, right) : interleave(right, left);
    });
  }

  globalThis.Verbasizer = Object.freeze({ split, mix, mixSources });
})();
