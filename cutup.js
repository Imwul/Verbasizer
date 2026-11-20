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
    return Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index * fragments.length / count);
      const end = Math.floor((index + 1) * fragments.length / count);
      return fragments.slice(start, end).join(' ');
    });
  }

  function split(text, mode = 'phrase') {
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (mode === 'line') return lines;
    const sentences = lines.flatMap(splitSentences);
    return sentences.flatMap(mode === 'word' ? splitWords : splitPhrases);
  }

  function mix(fragments, { lineCount = 6, randomness = Math.random } = {}) {
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

    const requestedCount = Number(lineCount);
    const count = Number.isFinite(requestedCount) ? Math.max(1, Math.floor(requestedCount)) : 6;
    return groupLines(shuffled, Math.min(shuffled.length, count));
  }

  globalThis.Verbasizer = Object.freeze({ split, mix });
})();
