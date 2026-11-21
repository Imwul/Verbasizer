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
  const relativeParticles = ['에서는', '에는', '에서', '에', '으로', '로'];
  const negativeAuxiliary = /^(?:않(?:[가-힣]*[다요고면며지게아어죠]|[은을])|못(?:하|했)[가-힣]+|말(?:았[가-힣]+|[자다고게라])|마(?:라|세요|십시오)?)[.!?…。！？]*$/u;
  const aspectAuxiliary = /^(?:있다|있었다|갔다|왔다|놓았다|두었다|버렸다)[.!?…。！？]*$/u;
  const connective = /^(?:[가-힣]+[아어여]|해)$/u;
  const durationWords = /^(?:한참|잠깐|잠시|오랜|얼마|며칠|반나절|하루|이틀|사흘|나흘|한나절|종일|\d+(?:초|분|시간|일|개월|달|년|주))$/u;
  const durationUnit = /^(?:초|분|시간|일|개월|달|년|주일|주)$/u;
  const durationCount = /^(?:\d+|몇|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무)$/u;
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

  function wordsIn(text) {
    return text.match(/\S+/gu) ?? [];
  }

  function durationEnding(words) {
    const last = words.at(-1);
    if (durationWords.test(last)) return [last];
    const count = words.at(-2);
    return durationUnit.test(last) && durationCount.test(count) ? [count, last] : [];
  }

  function sourceConnections(piece, strength) {
    const before = piece.origin?.before ?? [];
    const after = piece.origin?.after ?? [];
    const words = wordsIn(piece.text);
    const last = words.at(-1);
    const connections = [];
    if (/^[가-힣]+지$/u.test(last) && negativeAuxiliary.test(after[0])) {
      connections.push({ words: [after[0]], side: 1, priority: 0, accept: (tokens) => negativeAuxiliary.test(tokens[0]) });
    } else if (strength >= 80 && connective.test(last) && aspectAuxiliary.test(after[0])) {
      connections.push({ words: [after[0]], side: 1, priority: 3, accept: (tokens) => aspectAuxiliary.test(tokens[0]) });
    }
    if (words[0] === '동안') {
      const duration = durationEnding(before);
      if (duration.length) connections.push({ words: duration, side: -1, priority: 1, accept: (tokens) => durationEnding(tokens).length > 0 });
    }
    if (strength >= 75 && /^[가-힣]{2,}$/u.test(last) && !isModifier(last)
      && nounWithParticle(after[0] ?? '', relativePlaces, relativeParticles)) {
      connections.push({
        words: [after[0]],
        side: 1,
        priority: 2,
        accept: (tokens) => !!nounWithParticle(tokens[0] ?? '', relativePlaces, relativeParticles),
      });
    }
    return connections;
  }

  function indexConnections(pieces) {
    const positions = new Map();
    const owners = new Map();
    for (const [index, piece] of pieces.entries()) {
      positions.set(piece, index);
      const words = wordsIn(piece.text);
      for (const [position, word] of words.entries()) {
        const twoWords = words[position + 1] ? word + ' ' + words[position + 1] : null;
        for (const text of twoWords ? [word, twoWords] : [word]) {
          if (!owners.has(text)) owners.set(text, piece);
          else if (owners.get(text) !== piece) owners.set(text, null);
        }
      }
    }
    return { positions, owners };
  }

  function reconnect(pieces, piece, connection, index) {
    const { words, side, accept } = connection;
    const originIndex = index.positions.get(piece);
    const nearbyPieces = side === 1 ? pieces.slice(originIndex + 1, originIndex + 1 + words.length)
      : pieces.slice(Math.max(0, originIndex - words.length), originIndex);
    const nearby = nearbyPieces.flatMap((part) => wordsIn(part.text));
    if (accept(nearby)) return null;

    const text = words.join(' ');
    const donor = index.owners.get(text);
    const completesSentence = side === 1 && sentenceMark.test(text);
    if (donor && donor !== piece && donor.source === piece.source && donor.text === text) {
      const donorIndex = index.positions.get(donor);
      const connected = pieces[donorIndex - side];
      const existing = side === 1 ? connected?.origin?.after?.slice(0, words.length)
        : connected?.origin?.before?.slice(-words.length);
      if (connected !== piece && existing?.join(' ') === text) return null;
      const span = pieces.slice(Math.min(originIndex, donorIndex), Math.max(originIndex, donorIndex) + 1);
      if (span.some((part) => part.locked || part.joinLeft)
        || span.slice(1, -1).some(isTerminal)) return null;
      pieces.splice(donorIndex, 1);
      pieces.splice(pieces.indexOf(piece) + Number(side === 1), 0, donor);
      return {
        note: `원문을 참고해 ‘${text}’ 조각을 이어 붙였어요.`,
        end: completesSentence ? [piece, donor] : null,
      };
    }
    if (index.owners.has(text)) return null;
    // Require a concrete source continuation and avoid adding a fragment next to a lock.
    if (pieces[originIndex + side]?.locked || piece.joinLeft) return null;
    piece.text = side === 1 ? `${piece.text} ${text}` : `${text} ${piece.text}`;
    return { note: `원문을 참고해 ‘${text}’ 조각을 복원했어요.`, end: completesSentence ? [piece] : null };
  }

  function isTerminal(piece) {
    return wordsIn(piece.text).some((word) => sentenceMark.test(word) || completedPredicate.test(word + '.'));
  }

  function completeAtEnd(pieces, end) {
    const index = pieces.indexOf(end[0]);
    if (index + end.length === pieces.length || pieces.some((piece) => !end.includes(piece) && isTerminal(piece))) return false;
    if (pieces.slice(index).some((piece) => piece.locked || piece.joinLeft)) return false;
    if (end.some((piece, offset) => pieces[index + offset] !== piece)) return false;
    if (end.flatMap((piece) => wordsIn(piece.text)).slice(0, -1).some((word) => sentenceMark.test(word))) return false;
    pieces.push(...pieces.splice(index, end.length));
    return true;
  }

  function reorderSourceLocation(pieces) {
    for (let index = 1; index < pieces.length; index += 1) {
      const action = pieces[index - 1];
      const location = pieces[index];
      if (action.locked || location.locked || action.joinLeft || location.joinLeft || pieces[index + 1]?.joinLeft) continue;
      const expected = action.origin?.before?.at(-1);
      const following = location.origin?.after ?? [];
      if (!expected || !nounWithParticle(expected, relativePlaces, relativeParticles)) continue;
      if (wordsIn(location.text).at(-1) !== expected || location.source !== action.source) continue;
      if (!connective.test(action.text) || !following.slice(0, 2).includes(action.text)) continue;
      [pieces[index - 1], pieces[index]] = [location, action];
      return true;
    }
    return false;
  }

  function sourceAligned(left, right) {
    const after = left?.origin?.after ?? [];
    const before = right?.origin?.before ?? [];
    if (left?.source !== right?.source || !after.length || !before.length) return false;
    const head = wordsIn(right.text).slice(0, after.length);
    const tail = wordsIn(left.text).slice(-before.length);
    return head.length > 0 && tail.length > 0
      && head.every((word, index) => word === after[index])
      && tail.every((word, index) => word === before[before.length - tail.length + index]);
  }

  function reorderSourcePair(pieces) {
    for (let index = 1; index < pieces.length; index += 1) {
      const left = pieces[index - 1];
      const right = pieces[index];
      if (left.locked || right.locked || left.joinLeft || right.joinLeft || pieces[index + 1]?.joinLeft) continue;
      if (!sourceAligned(right, left) || isTerminal(right)) continue;
      if (sourceAligned(pieces[index - 2], left) || sourceAligned(right, pieces[index + 1])) continue;
      [pieces[index - 1], pieces[index]] = [right, left];
      return true;
    }
    return false;
  }

  function restoreConnections(pieces, strength, edits) {
    let remaining = strength >= 85 ? 3 : strength >= 75 ? 2 : 1;
    const candidates = pieces.filter((piece) => !piece.locked && piece.origin)
      .flatMap((piece) => sourceConnections(piece, strength).map((connection) => ({ piece, connection })))
      .sort((first, second) => first.connection.priority - second.connection.priority);
    let end = null;
    let index = null;
    for (const { piece, connection } of candidates) {
      index ??= indexConnections(pieces);
      const repair = reconnect(pieces, piece, connection, index);
      if (!repair) continue;
      index = null;
      edits.push(repair.note);
      end = repair.end ?? end;
      remaining -= 1;
      if (!remaining) break;
    }
    if (strength >= 85 && end && completeAtEnd(pieces, end)) edits.push('복원한 서술어를 문장 끝에 놓았어요.');
    if (strength >= 85 && reorderSourceLocation(pieces)) edits.push('원문에서 이어진 장소와 동작을 차례로 놓았어요.');
    if (strength >= 85 && reorderSourcePair(pieces)) edits.push('원문에서 맞닿았던 구절을 이어 놓았어요.');
  }

  function clippedSourceClause(pieces) {
    if (pieces.length < 2) return null;
    let originals;
    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const piece = pieces[index];
      const nextPiece = pieces[index + 1];
      const following = piece.origin?.after ?? [];
      const last = following.findIndex((word) => sentenceMark.test(word));
      if (piece.locked || piece.joinLeft || nextPiece?.joinLeft || last === -1 || !/^[가-힣]+[다요까자][.!?。！？]$/u.test(following[last])) continue;
      if (sourceAligned(piece, nextPiece)) continue;
      const head = wordsIn(piece.text);
      if (head.length < 2 || head.length > 4 || head.some((word) => !/^[가-힣]+$/u.test(word))) continue;
      if (!/^(?:아무도|[가-힣]+(?:은|는|이|가|을|를|인|른|한|진|린|던|하며|내며|마치|처럼|마다|에|에서|까지))$/u.test(head.at(-1))) continue;
      originals ??= new Set(pieces.flatMap((part) => wordsIn(part.text)));
      if (originals.has(following[0])) continue;
      return { piece, continuation: following.slice(0, last + 1).join(' ') };
    }
    return null;
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
    if (strength >= 60) restoreConnections(result, strength, edits);

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

    if (strength >= 85) {
      const clause = clippedSourceClause(result);
      if (clause) {
        if (applySuggestions) {
          clause.piece.text += ' ' + clause.continuation;
          edits.push(`원문의 ‘${clause.continuation}’ 구절로 문장을 마무리했어요.`);
        } else {
          suggestions.push(`원문의 ‘${clause.continuation}’ 구절을 이어 문장 마무리`);
        }
      }
    }

    if (joinPunctuation(result) || spacesTidied) edits.unshift('문장부호 주변의 간격을 정리했어요.');
    return { pieces: result, edits, suggestions };
  }

  globalThis.VerbasizerSmoothing = Object.freeze({ smooth, joinPieces });
})();
