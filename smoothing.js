(() => {
  'use strict';

  const times = new Set(['새벽', '새벽녘', '아침', '오전', '정오', '오후', '저녁', '한낮', '자정', '한밤중', '밤']);
  const places = new Set(['항구', '역', '골목', '길모퉁이', '공원', '광장', '극장', '교실', '정류장', '방', '집', '거리', '옥상', '바다', '해안']);
  const actors = new Set(['배', '어선', '기차', '전철', '자동차', '버스', '아이', '사람', '남자', '여자', '친구', '나', '내', '너', '네', '우리', '그', '그녀', '새', '고양이', '개', '관측소']);
  const objects = new Set(['우산', '편지', '지도', '책', '종이', '손', '문서', '문', '창문', '불', '등불', '발소리', '목소리', '노래', '기록', '이름', '배', '철문', '파도', '물건']);
  const otherNouns = ['길', '서랍', '바람', '갈대', '모래', '하늘', '등대', '주머니', '전광판', '풍향', '바닷물'];
  const objectOrPlace = new Set([...places, ...objects]);
  const nouns = new Set([...times, ...places, ...actors, ...objects, ...otherNouns]);
  // Avoid reading common words such as 나이 or 내과 as a pronoun and particle.
  for (const pronoun of ['나', '내', '너', '네', '우리', '그', '그녀']) nouns.delete(pronoun);
  const modifiers = new Set(['한', '그', '저', '첫', '작은', '큰', '이른', '늦은', '낡은', '긴', '짧은', '젖은', '먼', '가까운', '어두운', '좁은', '마지막', '희미한', '조용한', '느린', '하얀', '붉은', '푸른', '검은']);
  const movement = new Set(['떠났다', '건넜다', '지나갔다', '달렸다', '갔다', '왔다', '멈췄다', '움직였다', '걸었다', '도착했다']);
  const actions = new Set(['펼쳤다', '닫았다', '열었다', '기다렸다', '찾았다', '쥐었다', '잡았다', '기록했다', '보았다', '봤다', '읽었다', '적었다', '놓았다', '담았다', '들었다', '불렀다']);
  const openingMark = /[([{「『“‘]$/u;
  const closingMark = /^[,.;:!?…。！？)\]}」』”’]/u;
  const sentenceMark = /[.!?…。！？]["'”’」』)\]]*$/u;
  const completedPredicate = /^(?:[가-힣]*(?:았|었|였|했|됐|났|왔|갔|렀|렸|췄|쳤|켰|웠|혔|뒀|겼)다|있다|없다|된다|같다)[.。]$/u;
  const relativePlaces = new Set(['속', '안', '앞', '뒤', '밖', '옆', '곁', '위', '아래', '사이', '근처', '길', '동쪽', '서쪽', '남쪽', '북쪽', '칸']);
  const particlePairs = [
    ['으로', '로'], ['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'],
  ];

  function nounWithParticle(word, vocabulary, particles) {
    for (const particle of particles) {
      if (!word.endsWith(particle)) continue;
      const noun = word.slice(0, -particle.length);
      if (vocabulary.has(noun)) return noun;
    }
    return null;
  }

  function correctParticle(word) {
    for (const pair of particlePairs) {
      const noun = nounWithParticle(word, nouns, pair);
      if (!noun) continue;
      const jongseong = (noun.charCodeAt(noun.length - 1) - 0xac00) % 28;
      const useShortForm = jongseong === 0 || (pair[0] === '으로' && jongseong === 8);
      return noun + pair[Number(useShortForm)];
    }
    return word;
  }

  function particleMessage(before, after) {
    return `조사 보정 ‘${before}’ → ‘${after}’`;
  }

  function tidyPieces(pieces, strength, edits) {
    let tidied = false;
    for (const piece of pieces) {
      if (piece.locked) continue;
      const spacing = piece.text
        .replace(/[^\S\n]+([,.;:!?…。！？)\]}」』”’])/gu, '$1')
        .replace(/([([{「『“‘])[^\S\n]+/gu, '$1');
      tidied ||= spacing !== piece.text;
      piece.text = spacing;
      if (strength < 30) continue;
      piece.text = piece.text.replace(/\S+/gu, (token) => {
        const match = /^([가-힣]+)([,.!?…]*)$/u.exec(token);
        if (!match) return token;
        const [, word, punctuation] = match;
        const replacement = correctParticle(word);
        if (replacement !== word) edits.push(particleMessage(word, replacement));
        return replacement + punctuation;
      });
    }
    return tidied;
  }

  function joinPunctuation(pieces) {
    let tidied = false;
    for (let index = 1; index < pieces.length; index += 1) {
      const previous = pieces[index - 1];
      const current = pieces[index];
      if (previous.locked || current.locked || current.joinLeft) continue;
      if (openingMark.test(previous.text) || closingMark.test(current.text)) {
        current.joinLeft = true;
        tidied = true;
      }
    }
    return tidied;
  }

  function tokenize(pieces) {
    return pieces.flatMap((piece, index) => [...piece.text.matchAll(/\S+/gu)].map((match) => ({
      index,
      start: match.index,
      end: match.index + match[0].length,
      word: match[0],
    })));
  }

  function findWords(pieces) {
    const words = tokenize(pieces);
    if (words.length < 3) return null;
    const predicate = words.at(-1).word.replace(/[.!?…。！？]+$/u, '');
    if (!movement.has(predicate) && !actions.has(predicate)) return null;
    const head = words.slice(0, -1);
    if (head.some(({ word }) => !/^[가-힣]+$/u.test(word))) return null;
    return { head, predicate };
  }

  function caseProposal({ head, predicate }, pieces) {
    const unlocked = head.filter(({ index }) => !pieces[index].locked);
    const actorSubjects = head.filter(({ word }) => nounWithParticle(word, actors, ['이', '가', '은', '는']));
    const timesAsSubject = unlocked.filter(({ word }) => nounWithParticle(word, times, ['이', '가']));
    const existingTime = head.some(({ word }) => nounWithParticle(word, times, ['에']));
    if (actorSubjects.length === 1 && timesAsSubject.length === 1 && !existingTime) {
      const token = timesAsSubject[0];
      return {
        token,
        replacement: nounWithParticle(token.word, times, ['이', '가']) + '에',
        uncertain: token.word === '밤이',
      };
    }

    const where = unlocked.filter(({ word }) => nounWithParticle(word, places, ['을', '를']));
    if (where.length !== 1) return null;
    if (predicate === '펼쳤다' && head.some(({ word }) => nounWithParticle(word, objects, ['을', '를']))) {
      const token = where[0];
      return { token, replacement: nounWithParticle(token.word, places, ['을', '를']) + '에서', uncertain: true };
    }
    const actorObjects = unlocked.filter(({ word }) => nounWithParticle(word, actors, ['을', '를']));
    if (predicate === '떠났다' && actorObjects.length === 1 && actorSubjects.length === 0) {
      const token = actorObjects[0];
      const noun = nounWithParticle(token.word, actors, ['을', '를']);
      return { token, replacement: correctParticle(noun + '이'), uncertain: true };
    }
    return null;
  }

  function reorderPhrases(pieces, head) {
    const groups = [];
    let start = 0;
    for (let index = 0; index < head.length; index += 1) {
      const word = head[index].word;
      const order = [
        nounWithParticle(word, times, ['에']),
        nounWithParticle(word, actors, ['이', '가', '은', '는']),
        nounWithParticle(word, places, ['에서', '에']),
        nounWithParticle(word, objectOrPlace, ['을', '를']),
      ].findIndex(Boolean);

      if (order === -1 && modifiers.has(word)) continue;
      if (order === -1 || groups.some((group) => group.order === order)) return false;
      groups.push({ order, first: head[start], last: head[index] });
      start = index + 1;
    }
    if (start !== head.length || groups.length < 2) return false;
    const sorted = [...groups].sort((left, right) => left.order - right.order);
    const from = groups.findIndex((group, index) => group !== sorted[index]);
    if (from === -1) return false;
    let to = groups.length - 1;
    while (groups[to] === sorted[to]) to -= 1;

    const first = groups[from].first;
    const last = groups[to].last;
    if (pieces.slice(first.index, last.index + 1).some((piece) => piece.locked)) return false;
    if (first.index === last.index) {
      const piece = pieces[first.index];
      const reordered = sorted.slice(from, to + 1).map((group) => piece.text.slice(group.first.start, group.last.end));
      piece.text = piece.text.slice(0, first.start) + reordered.join(' ') + piece.text.slice(last.end);
      return true;
    }

    const moving = sorted.slice(from, to + 1);
    if (moving.some((group) => group.first.start !== 0 || group.last.end !== pieces[group.last.index].text.length)) return false;
    const reordered = moving.flatMap((group) => pieces.slice(group.first.index, group.last.index + 1));
    pieces.splice(first.index, last.index - first.index + 1, ...reordered);
    return true;
  }

  function isModifier(word) {
    return modifiers.has(word) || /[가-힣](?:의|은|는|던|진|린|한|힌|된|른|울|질|길)$/u.test(word);
  }

  function danglingTail(pieces) {
    const words = tokenize(pieces);
    const end = words.findLastIndex(({ word }) => sentenceMark.test(word));
    const tail = words.slice(end + 1);
    if (end < 1 || tail.length === 0 || tail.length > 5) return null;
    if (!completedPredicate.test(words[end].word) || tail.some(({ word }) => !/^[가-힣\d]+$/u.test(word))) return null;

    const lastWord = tail.at(-1).word;
    const locationParticles = ['에서는', '에는', '에서', '에', '으로', '로'];
    const relative = nounWithParticle(lastWord, relativePlaces, locationParticles);
    const known = relative || nounWithParticle(lastWord, places, locationParticles)
      || nounWithParticle(lastWord, times, ['에는', '에']);
    if (!known && !/^[가-힣]{2,}에서$/u.test(lastWord)) return null;
    const head = tail.slice(0, -1);
    if (head.some(({ word }, index) => {
      if (isModifier(word) || times.has(word) || /^(?:첫|한|두|세|네|\d+)$/u.test(word)) return false;
      if (/[이가]$/u.test(word)) return !head[index + 1] || !isModifier(head[index + 1].word);
      return !relative || index !== head.length - 1 || /[을를]$/u.test(word);
    })) return null;

    const before = words.slice(0, end).findLastIndex(({ word }) => sentenceMark.test(word));
    const first = words[before + 1];
    const tailStart = tail[0];
    const last = tail.at(-1);
    if (end - before < 2 || pieces.slice(first.index, last.index + 1).some((piece) => piece.locked)) return null;
    const samePiece = first.index === last.index;
    if (!samePiece && (first.start !== 0 || tailStart.start !== 0)) return null;
    const label = tail.map(({ word }) => word).join(' ');
    return { first, tailStart, last, samePiece, label, uncertain: !known || tail.length > 3 };
  }

  function attachTail(pieces, { first, tailStart, last, samePiece }) {
    if (samePiece) {
      const piece = pieces[first.index];
      const prefix = piece.text.slice(0, first.start);
      const sentence = piece.text.slice(first.start, tailStart.start).trimEnd();
      const tail = piece.text.slice(tailStart.start, last.end);
      piece.text = prefix + tail + ' ' + sentence + piece.text.slice(last.end);
      return;
    }
    const sentence = pieces.slice(first.index, tailStart.index);
    const tail = pieces.slice(tailStart.index, last.index + 1);
    pieces.splice(first.index, last.index - first.index + 1, ...tail, ...sentence);
  }

  function joinPieces(pieces) {
    return pieces.map((piece, index) => (index && !piece.joinLeft ? ' ' : '') + piece.text).join('');
  }

  function smooth(pieces, strength, { applySuggestions = false } = {}) {
    if (!(strength >= 15)) return { pieces, edits: [], suggestions: [] };
    const result = pieces.map((piece) => ({ ...piece }));
    const edits = [];
    const suggestions = [];
    const spacesTidied = tidyPieces(result, strength, edits);

    if (strength >= 45) {
      const words = findWords(result);
      const proposal = words && caseProposal(words, result);
      if (proposal) {
        const { token, replacement, uncertain } = proposal;
        if (uncertain && !applySuggestions) {
          suggestions.push(`‘${token.word}’ → ‘${replacement}’`);
        } else {
          const piece = result[token.index];
          piece.text = piece.text.slice(0, token.start) + replacement + piece.text.slice(token.end);
          edits.push(particleMessage(token.word, replacement));
        }
      }
      if (strength >= 80) {
        const current = findWords(result);
        if (current && reorderPhrases(result, current.head)) edits.push('구절의 어순을 정리했어요.');

        const tail = danglingTail(result);
        if (tail?.uncertain && !applySuggestions) {
          suggestions.push(`‘${tail.label}’ 구절을 앞 문장에 잇기`);
        } else if (tail) {
          attachTail(result, tail);
          edits.push(`‘${tail.label}’ 구절을 문장 앞으로 옮겼어요.`);
        }
      }
    }

    if (joinPunctuation(result) || spacesTidied) edits.unshift('문장부호 주변의 간격을 정리했어요.');
    return { pieces: result, edits, suggestions };
  }

  globalThis.VerbasizerSmoothing = Object.freeze({ smooth, joinPieces });
})();
