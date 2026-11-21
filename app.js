(() => {
  'use strict';

  const samples = window.VerbasizerSamples;

  const unitHelp = {
    word: '조사와 어미를 붙인 채로 띄어쓰기 단위로 섞어요.',
    phrase: '한 문장 안에서 이어지는 짧은 구절을 섞어요.',
    line: '줄바꿈으로 나눈 각 줄을 한 조각으로 섞어요.',
    manual: '원문에 | 또는 줄바꿈을 넣어 잘라낼 위치를 표시해요.',
  };

  const byId = (id) => document.getElementById(id);
  const form = byId('studio-form');
  const editors = [
    { field: byId('source'), count: byId('source-count'), clear: byId('clear-button') },
    { field: byId('second-source'), count: byId('second-source-count'), clear: byId('clear-second-button') },
  ];
  const [first, second] = editors;
  const sourceLabel = byId('source-label');
  const secondGroup = byId('second-source-group');
  const toggleSource = byId('toggle-source');
  const sampleButton = byId('sample-button');
  const sampleDialog = byId('sample-dialog');
  const sampleForm = byId('sample-form');
  const sampleChoices = Array.from(sampleForm.querySelectorAll('.sample-choice'));
  const mixButton = byId('mix-button');
  const copyButton = byId('copy-button');
  const help = byId('unit-help');
  const sourcesHelp = byId('sources-help');
  const emptyResult = byId('empty-result');
  const result = byId('result');
  const resultCount = byId('result-count');
  const resultHelp = byId('result-help');
  const notice = byId('notice');

  const strategy = byId('mix-strategy');
  const ratioSettings = byId('ratio-settings');
  const ratioEnabled = byId('ratio-enabled');
  const ratioControls = byId('ratio-controls');
  const ratioSlider = byId('source-ratio');
  const ratioValue = byId('ratio-value');
  const targetSyllables = byId('target-syllables');
  const strength = byId('strength');
  const strengthValue = byId('strength-value');
  const strengthStatus = byId('strength-status');
  const showOrigins = byId('show-origins');
  const sourceLegend = byId('source-legend');
  const compareButton = byId('compare-button');
  const compareDialog = byId('compare-dialog');
  const compareCandidates = byId('compare-candidates');
  const collectionItems = byId('collection-items');
  const collectionEmpty = byId('collection-empty');
  const copyCollection = byId('copy-collection');
  const storageStatus = byId('storage-status');

  const { compose, countSyllables, restoreOrigins, split } = window.Verbasizer;
  const { smooth, joinPieces } = window.VerbasizerSmoothing;
  const numberFormat = new Intl.NumberFormat('ko-KR');
  const storageKey = 'verbasizer-workspace-v1';
  let rows = [];
  let savedLines = [];
  let editDraft = null;
  let saveTimer = null;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function action(label, handler, name) {
    const button = element('button', 'row-button', label);
    button.type = 'button';
    if (name) button.dataset.action = name;
    button.addEventListener('click', handler);
    return button;
  }

  function updateInputs() {
    for (const { field, count, clear } of editors) {
      count.textContent = numberFormat.format(Array.from(field.value).length) + '자';
      clear.disabled = field.value.length === 0;
      const credit = field.closest('.source-field').querySelector('.source-sample-credit');
      const sample = samples.find(({ text }) => text === field.value);
      credit.hidden = !sample;
      if (sample) {
        const link = credit.querySelector('a');
        link.textContent = sample.author + ' · ' + sample.title;
        link.href = sample.sourceUrl;
      }
    }
    const dualSources = !secondGroup.hidden;
    const sourcesMissing = !first.field.value.trim() || (dualSources && !second.field.value.trim());
    mixButton.disabled = sourcesMissing;
    compareButton.disabled = sourcesMissing;
    sourcesHelp.hidden = !dualSources || !sourcesMissing;
    ratioSettings.hidden = !dualSources;
    ratioControls.hidden = !ratioEnabled.checked;
    help.textContent = unitHelp[form.elements.mode.value];

    const firstShare = Number(ratioSlider.value);
    ratioValue.textContent = firstShare + ' : ' + (100 - firstShare);
    ratioSlider.setAttribute('aria-valuetext', '첫 번째 ' + firstShare + '%, 두 번째 ' + (100 - firstShare) + '%');
  }

  function setDualSources(expanded) {
    secondGroup.hidden = !expanded;
    form.classList.toggle('dual-sources', expanded);
    sourceLabel.classList.toggle('visually-hidden', !expanded);
    sourceLabel.textContent = expanded ? '첫 번째 원문' : '원문';
    toggleSource.setAttribute('aria-expanded', String(expanded));
    toggleSource.textContent = expanded ? '한 글 섞기' : '두 글 섞기';
    updateInputs();
  }

  function mixOptions() {
    return {
      mode: form.elements.mode.value,
      lineCount: Number(form.elements.lineCount.value),
      strategy: strategy.value,
      ratio: !secondGroup.hidden && ratioEnabled.checked ? Number(ratioSlider.value) : null,
      targetSyllables: targetSyllables.valueAsNumber,
      previous: rows,
    };
  }

  function makeRows(options) {
    const sources = secondGroup.hidden ? [first.field.value] : [first.field.value, second.field.value];
    return compose(sources, options);
  }

  function viewRow(row) {
    if (typeof row.editedText === 'string') {
      return { text: row.editedText, pieces: [], edits: [], suggestions: [] };
    }
    if (Array.isArray(row.arrangedPieces)) {
      const locked = new Set(row.pieces.filter((piece) => piece.locked).map((piece) => piece.id));
      const pieces = row.arrangedPieces.map((piece) => ({ ...piece, locked: locked.has(piece.id) }));
      return { text: joinPieces(pieces), pieces, edits: [], suggestions: [] };
    }
    const positioned = row.pieces.filter((piece) => piece.locked && Number.isInteger(piece.pinnedSlot));
    const positionedIds = new Set(positioned.map((piece) => piece.id));
    const ordered = row.pieces.filter((piece) => !positionedIds.has(piece.id));
    for (const piece of positioned.sort((a, b) => a.pinnedSlot - b.pinnedSlot)) {
      ordered.splice(Math.min(ordered.length, piece.pinnedSlot), 0, piece);
    }
    const pieces = ordered.map((piece) => piece.locked
      ? { ...piece, text: piece.pinnedText ?? piece.text, joinLeft: piece.pinnedJoin ?? piece.joinLeft }
      : piece);
    const amount = row.keepRaw ? 0 : row.locked ? row.lockedStrength : Number(strength.value);
    const view = smooth(pieces, amount ?? 0, { applySuggestions: row.applySuggestions === true });
    return { ...view, text: joinPieces(view.pieces) };
  }

  function focusRow(index, name) {
    const row = result.children[index];
    if (!row) return;
    const named = Array.from(row.querySelectorAll('[data-action]')).find((node) => node.dataset.action === name);
    (named ?? row.querySelector('summary')).focus({ preventScroll: true });
  }

  function refreshRow(index, name) {
    renderResults();
    focusRow(index, name);
    scheduleSave();
  }

  function splitEditedText(text) {
    return split(text, form.elements.mode.value).map((piece, index) => ({
      id: 'edited-' + index, text: piece,
    }));
  }

  function reorderEditor(draft) {
    const panel = element('div', 'reorder-editor');
    const hint = draft.pieces.length > 1
      ? '조각을 드래그하거나 선택한 뒤 앞·뒤로 옮기세요.'
      : draft.pieces.length
        ? '이 줄에는 옮길 조각이 하나뿐이에요.'
        : '직접 쓰기에 글을 입력한 뒤 조각을 옮길 수 있어요.';
    const list = element('div', 'reorder-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', '옮길 조각');
    const controls = element('div', 'row-actions');
    const announcement = element('p', 'visually-hidden');
    announcement.setAttribute('role', 'status');
    let dragging = null;

    function pick(position, focus = false) {
      draft.selected = position;
      Array.from(list.children).forEach((chip, index) => {
        chip.setAttribute('aria-pressed', String(index === position));
      });
      earlier.disabled = position <= 0;
      later.disabled = position >= draft.pieces.length - 1;
      if (focus) list.children[position]?.focus({ preventScroll: true });
    }

    function move(from, to) {
      if (to < 0 || to >= draft.pieces.length || from === to) return;
      const [piece] = draft.pieces.splice(from, 1);
      draft.pieces.splice(to, 0, piece);
      draft.changed = true;
      draft.text = joinPieces(draft.pieces);
      draft.selected = to;
      render();
      pick(to, true);
      announcement.textContent = (to + 1) + '번째 위치로 옮겼어요.';
    }

    function clearTarget() {
      dragging?.target?.classList.remove('drop-before', 'drop-after');
    }

    function clearDrag() {
      clearTarget();
      dragging?.chip.classList.remove('is-dragging');
      dragging = null;
    }

    function attachDrag(chip, position) {
      chip.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || draft.pieces.length < 2) return;
        chip.setPointerCapture(event.pointerId);
        dragging = {
          chip, position, pointer: event.pointerId, x: event.clientX, y: event.clientY,
          active: false, target: null,
        };
      });
      chip.addEventListener('pointermove', (event) => {
        if (dragging?.pointer !== event.pointerId) return;
        if (!dragging.active && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 5) return;
        dragging.active = true;
        chip.classList.add('is-dragging');
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.reorder-piece');
        const target = hit && hit !== chip && list.contains(hit) ? hit : null;
        if (target === dragging.target) return;
        clearTarget();
        dragging.target = target;
        if (target) {
          target.classList.add(position < Number(target.dataset.position) ? 'drop-after' : 'drop-before');
        }
      });
      chip.addEventListener('pointerup', (event) => {
        if (dragging?.pointer !== event.pointerId) return;
        const target = dragging.target;
        const active = dragging.active;
        clearDrag();
        if (!active) return;
        event.preventDefault();
        if (target) move(position, Number(target.dataset.position));
      });
      chip.addEventListener('pointercancel', clearDrag);
      chip.addEventListener('lostpointercapture', clearDrag);
    }

    function render() {
      list.replaceChildren(...draft.pieces.map((piece, position) => {
        const chip = action(piece.text, () => pick(position));
        chip.classList.add('reorder-piece');
        if (piece.source !== undefined) chip.classList.add('source-' + (piece.source + 1));
        chip.dataset.position = position;
        if (position === draft.selected) chip.dataset.action = 'edit-field';
        chip.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          move(position, position + (event.key === 'ArrowLeft' ? -1 : 1));
        });
        attachDrag(chip, position);
        return chip;
      }));
      pick(draft.selected);
    }

    const earlier = action('앞으로', () => move(draft.selected, draft.selected - 1));
    const later = action('뒤로', () => move(draft.selected, draft.selected + 1));
    controls.append(earlier, later);
    if (draft.pieces.length > 1) panel.append(controls);
    panel.prepend(element('p', 'edit-notes', hint), list);
    panel.append(announcement);
    render();
    return panel;
  }

  function editLine(row, index) {
    const draft = editDraft;
    const editor = element('form', 'line-editor');
    const field = element('textarea');
    const id = 'edit-line-' + index;
    field.id = id;
    field.dataset.action = 'edit-field';
    field.rows = 3;
    field.required = true;
    field.value = draft.text;
    const label = element('label', 'visually-hidden', (index + 1) + '번째 결과 줄 편집');
    label.htmlFor = id;
    field.addEventListener('input', () => {
      draft.text = field.value;
      draft.typed = true;
      draft.changed = true;
      field.setCustomValidity('');
    });
    const modes = element('div', 'editor-modes row-actions');
    for (const [mode, title] of [['pieces', '조각 옮기기'], ['text', '직접 쓰기']]) {
      const button = action(title, () => {
        if (draft.mode === mode) return;
        if (mode === 'pieces' && draft.typed) {
          draft.pieces = splitEditedText(draft.text);
          draft.usesOrigins = false;
          draft.selected = 0;
          draft.typed = false;
        }
        draft.mode = mode;
        refreshRow(index, 'edit-field');
      });
      button.setAttribute('aria-pressed', String(draft.mode === mode));
      modes.append(button);
    }
    const buttons = element('div', 'row-actions');
    const saveButton = element('button', 'row-button', '수정 적용');
    saveButton.type = 'submit';
    buttons.append(saveButton, action('취소', () => {
      editDraft = null;
      refreshRow(index, 'edit');
    }));
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = (draft.mode === 'text' ? field.value : joinPieces(draft.pieces)).trim();
      if (!text) {
        if (draft.mode === 'text') {
          field.setCustomValidity('줄에 넣을 글을 입력해 주세요.');
          field.reportValidity();
        } else {
          notice.textContent = '줄에 넣을 글을 입력해 주세요.';
        }
        return;
      }
      if (draft.changed) {
        if (draft.usesOrigins && !draft.typed) {
          delete row.editedText;
          row.arrangedPieces = draft.pieces;
          const positions = new Map(draft.pieces.map((piece, position) => [piece.id, position]));
          for (const piece of row.pieces) {
            if (piece.locked) piece.pinnedSlot = positions.get(piece.id);
          }
        } else {
          delete row.arrangedPieces;
          row.editedText = text.replace(/\r?\n+/g, ' ');
        }
        row.keepRaw = false;
      }
      editDraft = null;
      refreshRow(index, 'edit');
      if (draft.changed) notice.textContent = '줄을 수정했어요.';
    });
    editor.append(modes);
    if (draft.mode === 'text') editor.append(label, field);
    else editor.append(reorderEditor(draft));
    editor.append(buttons);
    return editor;
  }

  function rowActions(row, view, index) {
    const controls = element('div', 'row-actions');
    const lock = action(row.locked ? '줄 잠금 풀기' : '줄 잠그기', () => {
      row.locked = !row.locked;
      row.lockedStrength = row.locked ? Number(strength.value) : undefined;
      refreshRow(index, 'lock-row');
    }, 'lock-row');
    lock.setAttribute('aria-pressed', String(!!row.locked));
    const edit = action('편집', () => {
      const pieces = view.pieces.length ? [...view.pieces] : splitEditedText(view.text);
      editDraft = {
        index, text: view.text, pieces, selected: 0,
        mode: pieces.length > 1 ? 'pieces' : 'text',
        usesOrigins: view.pieces.length > 0,
        typed: false, changed: false,
      };
      refreshRow(index, 'edit-field');
    }, 'edit');
    controls.append(lock, edit, action('줄 모으기', () => {
      savedLines.push(view.text);
      renderCollection();
      scheduleSave();
      notice.textContent = '고른 줄을 모아 뒀어요.';
    }));

    if (row.keepRaw) {
      controls.append(action('다시 보정', () => {
        row.keepRaw = false;
        refreshRow(index, 'restore');
      }, 'restore'));
    } else if (row.editedText !== undefined || row.arrangedPieces || view.edits.length) {
      controls.append(action('섞은 글로 되돌리기', () => {
        delete row.editedText;
        delete row.arrangedPieces;
        row.keepRaw = true;
        row.applySuggestions = false;
        editDraft = null;
        refreshRow(index, 'restore');
      }, 'restore'));
    }
    return controls;
  }

  function pieceActions(row, view, index) {
    const group = element('div', 'piece-actions');
    const rawPieces = new Map(row.pieces.map((piece, position) => [piece.id, { piece, position }]));
    for (const [slot, visible] of view.pieces.entries()) {
      const { piece, position } = rawPieces.get(visible.id);
      const name = 'lock-piece-' + position;
      const button = action(visible.text, () => {
        piece.locked = !piece.locked;
        piece.pinnedText = piece.locked ? visible.text : undefined;
        piece.pinnedJoin = piece.locked ? !!visible.joinLeft : undefined;
        piece.pinnedSlot = piece.locked ? slot : undefined;
        refreshRow(index, name);
      }, name);
      button.setAttribute('aria-label', visible.text + (piece.locked ? ' 조각 잠금 풀기' : ' 조각 잠그기'));
      button.setAttribute('aria-pressed', String(!!piece.locked));
      button.classList.add('source-' + (piece.source + 1));
      group.append(button);
    }
    return group;
  }

  function buildRowBody(row, index, view) {
    const body = element('div', 'result-row-body');
    body.append(rowActions(row, view, index));
    if (!row.locked && row.editedText === undefined && row.pieces.length) {
      const fragments = element('div', 'piece-locks');
      fragments.append(element('p', 'edit-notes', '조각 잠그기'), pieceActions(row, view, index));
      body.append(fragments);
    }
    if (view.edits.length) body.append(element('p', 'edit-notes', view.edits.join(' · ')));
    if (view.suggestions.length) {
      const suggestions = element('div', 'edit-notes');
      suggestions.append(element('p', '', view.suggestions.join(' · ')),
        action('보정 제안 적용', () => {
          row.applySuggestions = true;
          refreshRow(index, 'restore');
        }, 'apply-suggestions'));
      body.append(suggestions);
    }
    if (targetSyllables.valueAsNumber > 0) {
      body.append(element('p', 'edit-notes', '한글 ' + countSyllables(view.text) + '음절'));
    }
    if (editDraft?.index === index) body.append(editLine(row, index));
    return body;
  }

  function buildRow(row, index, view, open) {
    const details = element('details', 'result-row');
    details.open = open || editDraft?.index === index;
    details.classList.toggle('is-locked', !!row.locked);
    const summary = element('summary', 'result-line');
    if (!view.pieces.length) {
      summary.textContent = view.text;
    } else {
      const originals = new Map(row.pieces.map((piece, position) => [piece.id, { piece, position }]));
      view.pieces.forEach((piece, position) => {
        if (position && !piece.joinLeft) summary.append(' ');
        const span = element('span', 'piece source-' + (piece.source + 1), piece.text);
        const original = originals.get(piece.id);
        const changed = original && (original.position !== position || original.piece.text !== piece.text
          || !!original.piece.joinLeft !== !!piece.joinLeft);
        span.classList.toggle('is-changed', !!changed);
        span.classList.toggle('is-locked', !!piece.locked);
        summary.append(span);
      });
    }
    if (view.suggestions.length) {
      summary.append(' ', element('span', 'suggestion-label', '보정 제안'));
    }
    details.append(summary);
    if (details.open) {
      details.append(buildRowBody(row, index, view));
    } else {
      function mountActions() {
        if (!details.open) return;
        details.append(buildRowBody(row, index, view));
        details.removeEventListener('toggle', mountActions);
      }
      details.addEventListener('toggle', mountActions);
    }
    return details;
  }

  function showStrengthStatus(views) {
    const edited = views.filter((view) => view.edits.length > 0).length;
    const suggested = views.filter((view) => view.suggestions.length > 0).length;
    const status = [];
    if (edited) status.push(edited + '줄 보정');
    if (suggested) status.push('제안 ' + suggested + '줄');
    strengthStatus.hidden = !views.length || Number(strength.value) === 0;
    const fixed = rows.every((row) => row.locked || row.keepRaw || row.editedText !== undefined || row.arrangedPieces);
    const description = status.join(', ') || (fixed
      ? '지금 결과는 잠금·직접 편집·되돌리기 상태를 유지하고 있어요.'
      : '이 강도에서 자동으로 바뀐 줄이 없어요.');
    if (strengthStatus.textContent !== description) strengthStatus.textContent = description;
  }

  function renderResults(resetOpen = false) {
    const open = resetOpen ? [] : Array.from(result.children, (row) => row.open);
    const views = rows.map(viewRow);
    result.replaceChildren(...rows.map((row, index) => buildRow(row, index, views[index], open[index])));
    result.hidden = rows.length === 0;
    emptyResult.hidden = rows.length > 0;
    resultHelp.hidden = rows.length === 0;
    copyButton.disabled = rows.length === 0;
    copyButton.textContent = '결과 복사';
    resultCount.textContent = rows.length ? rows.length + '줄' : '';
    strengthValue.textContent = strength.value + '%';
    strength.setAttribute('aria-valuetext', strength.value + '퍼센트');
    showStrengthStatus(views);
    result.classList.toggle('show-origins', showOrigins.checked);
    sourceLegend.hidden = !showOrigins.checked || rows.length === 0;
    const fromSecond = rows.some((row) => row.pieces.some((piece) => piece.source === 1));
    const secondLegend = sourceLegend.querySelector('.source-2');
    if (secondLegend) secondLegend.hidden = !fromSecond;
  }

  function showRows(next, announce = true) {
    editDraft = null;
    rows = next;
    renderResults(true);
    if (!announce) return;
    const hasTwoSources = !secondGroup.hidden;
    if (rows.length > Number(form.elements.lineCount.value)) {
      notice.textContent = '잠근 줄을 포함해 ' + rows.length + '줄을 유지했어요.';
    } else if (!rows.length) {
      notice.textContent = '자를 조각을 찾을 수 없어요.';
    } else if (!hasTwoSources && rows.length === 1 && rows[0].pieces.length === 1) {
      notice.textContent = '글을 더 넣거나 자를 단위를 바꾸면 더 많은 조각을 섞을 수 있어요.';
    } else {
      notice.textContent = (hasTwoSources ? '두 글에서 ' : '') + rows.length + '줄을 만들었어요.';
    }
    scheduleSave();
  }

  function compare() {
    if (compareButton.disabled || !form.reportValidity()) return;
    const options = mixOptions();
    const versions = Array.from({ length: 3 }, () => makeRows(options));
    if (!versions[0].length) {
      notice.textContent = '자를 조각을 찾을 수 없어요.';
      return;
    }
    compareCandidates.replaceChildren(...versions.map((candidate, index) => {
      const card = element('article', 'candidate');
      const heading = element('h3', '', '후보 ' + (index + 1));
      const text = element('div', 'candidate-lines');
      if (candidate.length) {
        text.append(...candidate.map((row) => element('p', '', viewRow(row).text)));
      } else {
        text.append(element('p', '', '자를 조각을 찾을 수 없어요.'));
      }
      card.append(heading, text, action('이 조합 사용', () => {
        showRows(candidate);
        compareDialog.close();
      }));
      return card;
    }));
    compareDialog.showModal();
  }

  function renderCollection() {
    collectionItems.replaceChildren(...savedLines.map((text, index) => {
      const item = element('li', 'collected-line');
      const actions = element('div', 'row-actions');
      function move(offset) {
        const destination = index + offset;
        [savedLines[index], savedLines[destination]] = [savedLines[destination], savedLines[index]];
        renderCollection();
        const keys = collectionItems.children[destination].querySelectorAll('button');
        (keys[offset < 0 ? 0 : 1].disabled ? keys[2] : keys[offset < 0 ? 0 : 1]).focus();
        scheduleSave();
      }
      const up = action('위로', () => move(-1));
      const down = action('아래로', () => move(1));
      up.disabled = index === 0;
      down.disabled = index === savedLines.length - 1;
      up.setAttribute('aria-label', (index + 1) + '번째 모은 줄을 위로');
      down.setAttribute('aria-label', (index + 1) + '번째 모은 줄을 아래로');
      const remove = action('빼기', () => {
        savedLines.splice(index, 1);
        renderCollection();
        const next = collectionItems.children[Math.min(index, savedLines.length - 1)];
        if (next) next.querySelector('button:last-child').focus();
        scheduleSave();
      });
      remove.setAttribute('aria-label', (index + 1) + '번째 모은 줄 빼기');
      actions.append(up, down, remove);
      item.append(element('p', '', text), actions);
      return item;
    }));
    collectionEmpty.hidden = savedLines.length > 0;
    copyCollection.disabled = savedLines.length === 0;
    copyCollection.textContent = '모은 글 복사';
  }

  async function copyText(text, button, message) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const field = element('textarea', 'visually-hidden');
      field.value = text;
      field.readOnly = true;
      document.body.append(field);
      field.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        field.remove();
        button.focus({ preventScroll: true });
      }
    }
    if (copied) button.textContent = '복사했어요';
    notice.textContent = copied ? message : '복사할 수 없었어요. 글을 선택해 직접 복사해 주세요.';
  }

  function saveWork() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        sources: editors.map(({ field }) => field.value),
        dual: !secondGroup.hidden,
        mode: form.elements.mode.value,
        lineCount: form.elements.lineCount.value,
        strategy: strategy.value,
        useRatio: ratioEnabled.checked,
        ratio: ratioSlider.value,
        syllables: targetSyllables.value,
        strength: strength.value,
        origins: showOrigins.checked,
        rows,
        savedLines,
      }));
      storageStatus.textContent = '이 브라우저에 자동 저장됨';
    } catch {
      storageStatus.textContent = '이 브라우저에 저장할 수 없어요.';
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWork, 180);
  }

  function restoreWork() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!Array.isArray(saved?.sources) || typeof saved.sources[0] !== 'string') return false;
      const restoredRows = Array.isArray(saved.rows) ? saved.rows : [];
      const validRows = restoredRows.filter((row) => Array.isArray(row?.pieces) && row.pieces.every((piece) =>
        typeof piece?.id === 'string' && typeof piece.text === 'string' && [0, 1].includes(piece.source)));
      savedLines = Array.isArray(saved.savedLines) ? saved.savedLines.filter((text) => typeof text === 'string') : [];

      first.field.value = saved.sources[0];
      second.field.value = typeof saved.sources[1] === 'string' ? saved.sources[1] : '';
      rows = restoreOrigins(validRows, editors.map(({ field }) => field.value), saved.mode);
      if (Object.hasOwn(unitHelp, saved.mode)) form.elements.mode.value = saved.mode;
      if (Array.from(form.elements.lineCount.options, (option) => option.value).includes(saved.lineCount)) {
        form.elements.lineCount.value = saved.lineCount;
      }
      if (['default', 'alternate', 'ordered'].includes(saved.strategy)) strategy.value = saved.strategy;
      ratioEnabled.checked = saved.useRatio === true;
      ratioSlider.value = saved.ratio ?? 50;
      targetSyllables.value = saved.syllables ?? '';
      strength.value = saved.strength ?? 0;
      showOrigins.checked = saved.origins === true;
      setDualSources(saved.dual === true);
      storageStatus.textContent = '이 브라우저의 작업을 불러왔어요.';
      return true;
    } catch {
      return false;
    }
  }

  for (const { field, clear } of editors) {
    field.addEventListener('input', () => {
      updateInputs();
      notice.textContent = '';
      scheduleSave();
    });
    clear.addEventListener('click', () => {
      field.value = '';
      updateInputs();
      notice.textContent = '';
      if (!rows.some((row) => row.locked || row.pieces.some((piece) => piece.locked))) {
        showRows([], false);
      }
      field.focus();
      scheduleSave();
    });
  }

  form.addEventListener('change', () => {
    updateInputs();
    scheduleSave();
  });
  ratioSlider.addEventListener('input', () => {
    updateInputs();
    scheduleSave();
  });
  targetSyllables.addEventListener('invalid', () => {
    targetSyllables.closest('details').open = true;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!mixButton.disabled) showRows(makeRows(mixOptions()));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing
      || compareDialog.open || sampleDialog.open
      || event.target.closest?.('.line-editor') || mixButton.disabled) return;
    event.preventDefault();
    form.requestSubmit();
  });

  strength.addEventListener('input', () => {
    renderResults();
    scheduleSave();
  });
  showOrigins.addEventListener('change', () => {
    renderResults();
    scheduleSave();
  });
  compareButton.addEventListener('click', compare);

  toggleSource.addEventListener('click', () => {
    const expanded = secondGroup.hidden;
    setDualSources(expanded);
    notice.textContent = '';
    if (expanded) second.field.focus();
    scheduleSave();
  });
  function previewSample(choice) {
    const sample = samples[Number(choice.querySelector('select').value)];
    choice.querySelector('.sample-excerpt').textContent = sample.text;
    choice.querySelector('.sample-credit').textContent = sample.credit;
    choice.querySelector('.sample-source').href = sample.sourceUrl;
  }

  sampleChoices.forEach((choice, index) => {
    const select = choice.querySelector('select');
    select.append(...samples.map((sample, position) => {
      const option = element('option', '', sample.author + ' · ' + sample.title);
      option.value = position;
      return option;
    }));
    select.selectedIndex = index;
    select.addEventListener('change', () => previewSample(choice));
  });
  sampleButton.addEventListener('click', () => {
    sampleChoices[1].hidden = secondGroup.hidden;
    for (const [index, choice] of sampleChoices.entries()) {
      const match = samples.findIndex(({ text }) => text === editors[index].field.value);
      if (match !== -1) choice.querySelector('select').selectedIndex = match;
      previewSample(choice);
    }
    sampleDialog.showModal();
  });
  sampleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const [index, choice] of sampleChoices.entries()) {
      if (!choice.hidden) editors[index].field.value = samples[Number(choice.querySelector('select').value)].text;
    }
    updateInputs();
    sampleDialog.close();
    showRows(makeRows(mixOptions()));
  });
  copyButton.addEventListener('click', () => {
    copyText(rows.map((row) => viewRow(row).text).join('\n'), copyButton, '섞은 글을 복사했어요.');
  });
  copyCollection.addEventListener('click', () => {
    copyText(savedLines.join('\n'), copyCollection, '모은 글을 복사했어요.');
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer !== null) saveWork();
  });

  if (!restoreWork()) {
    first.field.value = samples[0].text;
    updateInputs();
    rows = makeRows(mixOptions());
  }
  renderResults();
  renderCollection();
})();
