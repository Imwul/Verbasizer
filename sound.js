(() => {
  'use strict';

  // Rhyme in sung Korean follows the vowel of the last syllable.
  const vowels = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
  // Vowel pairs that are no longer told apart when sung share one rhyme.
  const alike = { 1: 5, 3: 7, 10: 15, 11: 15 };
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function hangul(text) {
    return Array.from(String(text).normalize('NFC')).filter((char) => char >= '가' && char <= '힣');
  }

  function vowelIndex(char) {
    return Math.floor((char.charCodeAt(0) - 0xac00) / 28) % 21;
  }

  // The vowel written as a plain syllable: ㅓ → 어.
  function vowelSound(index) {
    return String.fromCharCode(0xac00 + (11 * 21 + index) * 28);
  }

  function ending(text) {
    const chars = hangul(text);
    if (!chars.length) return null;
    const last = chars.at(-1);
    const index = vowelIndex(last);
    return {
      key: String(alike[index] ?? index),
      open: (last.charCodeAt(0) - 0xac00) % 28 === 0,
      tail: chars.slice(-2).map((char) => vowelSound(vowelIndex(char))).join(''),
      vowel: vowels[index],
    };
  }

  // Letters like a rhyme scheme: lines sharing an end vowel get the same letter.
  function scheme(texts) {
    const ends = texts.map(ending);
    const counts = new Map();
    for (const end of ends) if (end) counts.set(end.key, (counts.get(end.key) ?? 0) + 1);
    const assigned = new Map();
    return ends.map((end) => {
      if (!end) return null;
      let letter = null;
      if (counts.get(end.key) > 1) {
        if (!assigned.has(end.key)) assigned.set(end.key, letters[assigned.size] ?? '*');
        letter = assigned.get(end.key);
      }
      return { ...end, letter };
    });
  }

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let queue = [];
  let done = null;

  function koreanVoice() {
    return synth?.getVoices().find((voice) => /^ko/i.test(voice.lang)) ?? null;
  }

  function stop() {
    queue = [];
    synth?.cancel();
    const finished = done;
    done = null;
    finished?.();
  }

  function next() {
    const text = queue.shift();
    if (text === undefined) {
      const finished = done;
      done = null;
      finished?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.9;
    const voice = koreanVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = next;
    utterance.onerror = next;
    synth.speak(utterance);
  }

  function speak(texts, onDone) {
    if (!synth) return false;
    stop();
    queue = texts.filter((text) => text && text.trim());
    done = onDone ?? null;
    next();
    return true;
  }

  globalThis.VerbasizerSound = Object.freeze({
    ending,
    scheme,
    speak,
    stop,
    canSpeak: () => !!synth && typeof SpeechSynthesisUtterance === 'function',
    speaking: () => !!synth?.speaking || queue.length > 0,
  });
})();
