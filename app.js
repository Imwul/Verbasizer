(() => {
  'use strict';

  const samples = window.VerbasizerSamples;
  const cards = window.VerbasizerCards;
  const Store = window.VerbasizerStore;
  const Sound = window.VerbasizerSound;
  const {
    compose, countSyllables, restoreOrigins, split, rerollLine, swapPiece, junctions, sentenceOf,
  } = window.Verbasizer;
  const { smooth, joinPieces } = window.VerbasizerSmoothing;

  const unitHelp = {
    word: '조사와 어미를 붙인 채로 띄어쓰기 단위로 섞어요.',
    phrase: '한 문장 안에서 이어지는 짧은 구절을 섞어요.',
    line: '줄바꿈으로 나눈 각 줄을 한 조각으로 섞어요.',
    manual: '원문에 | 또는 줄바꿈을 넣어 잘라낼 위치를 표시해요.',
  };
  const strategyHelp = {
    default: '켜 둔 칸의 조각을 무작위로 섞어요.',
    alternate: '칸을 하나씩 번갈아 가며 조각을 놓아요.',
    ordered: '원문에 나온 순서를 지키며 골라요.',
    columns: '한 줄 = 1번 칸 조각 + 2번 칸 조각 + … 보위가 쓰던 방식이에요. 한 줄 길이는 적용되지 않아요.',
  };

  // Each slider step maps to a smoothing amount; every step adds one kind of repair.
  const strengthLevels = [
    { amount: 0, name: '끔', help: '섞은 그대로 둡니다.' },
    { amount: 30, name: '부호', help: '문장부호 간격을 다듬고, 줄 가운데 마침표는 쉼표로, 줄 끝에 걸린 쉼표는 지워 한 호흡으로 읽히게 합니다.' },
    { amount: 60, name: '어순', help: '부호 + 문장을 맺는 조각을 줄 끝으로 보내고, 끊긴 말 한 조각을 원문에서 되살립니다.' },
    { amount: 80, name: '맺음', help: '어순 + 끝이 열린 줄을 원문의 다음 말(4어절까지)로 맺고, 구절 순서를 정리합니다.' },
    { amount: 100, name: '복원', help: '맺음 + 원문에서 6어절까지 가져와 맺고, 이어졌던 구절을 더 되살리며 문장 마무리를 제안합니다.' },
  ];

  const byId = (id) => document.getElementById(id);
  const form = byId('studio-form');
  const columnsBox = byId('columns');
  const addColumnButton = byId('add-column');
  const columnCount = byId('column-count');
  const sampleButton = byId('sample-button');
  const sampleDialog = byId('sample-dialog');
  const sampleForm = byId('sample-form');
  const sampleChoices = byId('sample-choices');
  const mixButton = byId('mix-button');
  const copyButton = byId('copy-button');
  const speakAll = byId('speak-all');
  const unitHelpText = byId('unit-help');
  const strategyHelpText = byId('strategy-help');
  const sourcesHelp = byId('sources-help');
  const emptyResult = byId('empty-result');
  const result = byId('result');
  const resultCount = byId('result-count');
  const resultHelp = byId('result-help');
  const notice = byId('notice');
  const strategy = byId('mix-strategy');
  const useWeights = byId('use-weights');
  const targetSyllables = byId('target-syllables');
  const syllableHelp = byId('syllable-help');
  const includeWords = byId('include-words');
  const excludeWords = byId('exclude-words');
  const strength = byId('strength');
  const strengthValue = byId('strength-value');
  const strengthStatus = byId('strength-status');
  const strengthHelp = byId('strength-help');
  const showOrigins = byId('show-origins');
  const showStrange = byId('show-strange');
  const showRhyme = byId('show-rhyme');
  const sourceLegend = byId('source-legend');
  const compareButton = byId('compare-button');
  const compareDialog = byId('compare-dialog');
  const compareCandidates = byId('compare-candidates');
  const collectionItems = byId('collection-items');
  const collectionEmpty = byId('collection-empty');
  const copyCollection = byId('copy-collection');
  const collectionToColumn = byId('collection-to-column');
  const storageStatus = byId('storage-status');
  const undoButton = byId('undo-button');
  const redoButton = byId('redo-button');
  const noteSelect = byId('note-select');
  const noteTitle = byId('note-title');
  const confirmDialog = byId('confirm-dialog');
  const cardDialog = byId('card-dialog');
  const helpDialog = byId('help-dialog');
  const themeButton = byId('theme-button');

  const numberFormat = new Intl.NumberFormat('ko-KR');
  const defaultWeight = 3;

  let book = Store.load();
  let prefs = Store.prefs();
  let columns = [];
  let rows = [];
  let savedLines = [];
  let editDraft = null;
  let selected = null; // { row, id } of the piece picked in an open row
  let saveTimer = null;
  let history = [];
  let historyIndex = -1;
  let speakingRow = null;

  // ---------- small helpers ----------

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

  function say(message) {
    notice.textContent = message;
  }

  function words(input) {
    return input.value.split(/[,，、]/u).map((word) => word.trim()).filter(Boolean);
  }

  function strengthLevel() {
    return strengthLevels[Number(strength.value)] ?? strengthLevels[0];
  }

  function levelForAmount(amount) {
    return Math.max(0, strengthLevels.findLastIndex((level) => level.amount <= amount));
  }

  function currentNote() {
    return book.notes.find((note) => note.id === book.current);
  }

  function columnName(index) {
    return '원문 ' + (index + 1);
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = element('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fileSafe(text) {
    return (text || 'verbasizer').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'verbasizer';
  }

  function today() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
  }

  // A modal alert box. Resolves true only when the named action is chosen.
  function confirmAction(title, detail, label) {
    byId('confirm-title').textContent = title;
    byId('confirm-detail').textContent = detail;
    byId('confirm-ok').textContent = label;
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
    });
  }

  // ---------- source columns ----------

  function sourceTexts() {
    return columns.map((column) => (column.enabled ? column.text : ''));
  }

  function allTexts() {
    return columns.map((column) => column.text);
  }

  function activeColumns() {
    return columns.filter((column) => column.enabled && column.text.trim());
  }

  function renderColumns(focusIndex = -1) {
    columnsBox.replaceChildren(...columns.map((column, index) => {
      const box = element('div', 'source-field');
      box.dataset.column = index;
      box.classList.toggle('is-off', !column.enabled);
      const id = 'source-' + index;

      const head = element('div', 'column-head show-origins');
      const toggle = element('label', 'check-label column-toggle');
      const enabled = element('input');
      enabled.type = 'checkbox';
      enabled.checked = column.enabled;
      enabled.setAttribute('aria-label', columnName(index) + ' 사용');
      enabled.addEventListener('change', () => {
        column.enabled = enabled.checked;
        box.classList.toggle('is-off', !column.enabled);
        updateInputs();
        persist();
      });
      toggle.append(enabled, element('span', 'column-name source-' + (index + 1), columnName(index)));
      head.append(toggle);

      if (useWeights.checked) {
        const weightLabel = element('label', 'column-weight');
        const weight = element('select', 'field');
        weight.setAttribute('aria-label', columnName(index) + ' 비중');
        for (let value = 1; value <= 5; value += 1) {
          const option = element('option', '', '비중 ' + value);
          option.value = value;
          weight.append(option);
        }
        weight.value = column.weight;
        weight.addEventListener('change', () => {
          column.weight = Number(weight.value);
          persist();
        });
        weightLabel.append(weight);
        head.append(weightLabel);
      }

      const label = element('label', 'visually-hidden', columnName(index));
      label.htmlFor = id;
      const field = element('textarea', 'field');
      field.id = id;
      field.rows = 8;
      field.spellcheck = false;
      field.placeholder = index === 0 ? '섞고 싶은 글을 붙여 넣으세요.' : '함께 섞을 글을 붙여 넣으세요.';
      field.value = column.text;
      field.addEventListener('input', () => {
        column.text = field.value;
        updateInputs();
        persist();
      });

      const tools = element('div', 'source-tools');
      const count = element('span', 'column-chars');
      const buttons = element('span', 'row-actions');
      const clear = element('button', 'btn btn-small', '비우기');
      clear.type = 'button';
      clear.setAttribute('aria-label', columnName(index) + ' 비우기');
      clear.addEventListener('click', () => {
        column.text = '';
        field.value = '';
        updateInputs();
        persist();
        field.focus();
      });
      buttons.append(clear);
      if (columns.length > 1) {
        const remove = element('button', 'btn btn-small', '칸 빼기');
        remove.type = 'button';
        remove.setAttribute('aria-label', columnName(index) + ' 빼기');
        remove.addEventListener('click', () => removeColumn(index));
        buttons.append(remove);
      }
      tools.append(count, buttons);

      const credit = element('p', 'source-sample-credit field-help');
      const link = element('a');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      credit.append(link);

      box.append(head, label, field, tools, credit);
      return box;
    }));
    form.classList.toggle('multi-columns', columns.length > 1);
    updateInputs();
    if (focusIndex >= 0) byId('source-' + focusIndex)?.focus();
  }

  function addColumn(text = '') {
    if (columns.length >= Store.maxColumns) {
      say('원문 칸은 ' + Store.maxColumns + '개까지예요.');
      return false;
    }
    columns.push({ text, enabled: true, weight: defaultWeight });
    renderColumns(text ? -1 : columns.length - 1);
    changed();
    return true;
  }

  // Pieces keep their column number inside their id, so later columns are renumbered.
  function shiftPiece(piece, removed) {
    if (piece.source <= removed) return piece;
    const source = piece.source - 1;
    return { ...piece, source, id: source + String(piece.id).slice(String(piece.id).indexOf(':')) };
  }

  async function removeColumn(index) {
    const column = columns[index];
    if (column.text.trim()) {
      const ok = await confirmAction(columnName(index) + ' 칸을 뺄까요?',
        '칸에 넣은 글이 사라지고, 섞은 글에서 이 칸의 조각도 빠집니다. 잠근 줄은 지금 글자 그대로 남아요. [실행 취소]로 섞은 글은 되돌릴 수 있어요.',
        '칸 빼기');
      if (!ok) return;
    }
    const views = viewRows(rows);
    rows = rows.flatMap((row, position) => {
      const touches = row.pieces.some((piece) => piece.source === index);
      if (touches && row.locked) {
        return [{ pieces: [], locked: true, lockedStrength: row.lockedStrength, editedText: views[position].text }];
      }
      const pieces = row.pieces.filter((piece) => piece.source !== index).map((piece) => shiftPiece(piece, index));
      if (!pieces.length && row.editedText === undefined) return [];
      const next = { ...row, pieces };
      if (touches) delete next.arrangedPieces;
      else if (next.arrangedPieces) next.arrangedPieces = next.arrangedPieces.map((piece) => shiftPiece(piece, index));
      return [next];
    });
    columns.splice(index, 1);
    selected = null;
    editDraft = null;
    renderColumns();
    renderResults();
    changed();
    say(columnName(index) + ' 칸을 뺐어요.');
  }

  function updateInputs() {
    columnsBox.querySelectorAll('.source-field').forEach((box) => {
      const column = columns[Number(box.dataset.column)];
      if (!column) return;
      box.querySelector('.column-chars').textContent = numberFormat.format(Array.from(column.text).length) + '자';
      box.querySelector('.btn-small').disabled = column.text.length === 0;
      const credit = box.querySelector('.source-sample-credit');
      const sample = samples.find(({ text }) => text === column.text);
      credit.hidden = !sample;
      if (sample) {
        const link = credit.querySelector('a');
        link.textContent = sample.author + ' · ' + sample.title;
        link.href = sample.sourceUrl;
      }
    });
    const missing = activeColumns().length === 0;
    mixButton.disabled = missing;
    compareButton.disabled = missing;
    sourcesHelp.hidden = !missing;
    addColumnButton.disabled = columns.length >= Store.maxColumns;
    columnCount.textContent = columns.length + ' / ' + Store.maxColumns + '칸';
    unitHelpText.textContent = unitHelp[form.elements.mode.value];
    strategyHelpText.textContent = strategyHelp[strategy.value];
    const bowie = strategy.value === 'columns';
    targetSyllables.disabled = bowie;
    syllableHelp.textContent = bowie
      ? '보위 방식에서는 칸마다 한 조각이라 길이를 맞추지 않아요.'
      : '비우면 모든 조각을 씁니다(줄이 길어져요).';
    collectionToColumn.disabled = savedLines.length === 0 || columns.length >= Store.maxColumns;
  }

  // ---------- mixing ----------

  function mixOptions() {
    return {
      mode: form.elements.mode.value,
      lineCount: Number(form.elements.lineCount.value),
      strategy: strategy.value,
      weights: useWeights.checked ? columns.map((column) => column.weight) : null,
      targetSyllables: targetSyllables.valueAsNumber,
      include: words(includeWords),
      exclude: words(excludeWords),
      previous: rows,
    };
  }

  function makeRows(options) {
    return compose(sourceTexts(), options);
  }

  function missingWords(next) {
    const text = viewRows(next).map((view) => view.text).join(' ');
    return words(includeWords).filter((word) => !text.includes(word));
  }

  function mix() {
    if (mixButton.disabled) return;
    showRows(makeRows(mixOptions()));
  }

  function rerollRow(index) {
    const row = rows[index];
    if (!row || row.locked) {
      say('잠근 줄은 다시 섞지 않아요. 잠금을 먼저 풀어 주세요.');
      return;
    }
    const before = joinPieces(row.pieces);
    const next = rerollLine(sourceTexts(), rows, index, { ...mixOptions(), randomness: Math.random });
    if (!next || joinPieces(next.pieces) === before) {
      say('바꿔 넣을 조각이 없어요. 원문을 더 넣거나 자를 단위를 바꿔 보세요.');
      return;
    }
    rows[index] = next;
    if (selected?.row === index) selected = null;
    if (editDraft?.index === index) editDraft = null;
    refreshRow(index, 'reroll');
    say((index + 1) + '번째 줄만 다시 섞었어요.');
  }

  function swapSelected(index, id) {
    const next = swapPiece(sourceTexts(), rows, index, id, mixOptions());
    if (!next) {
      say('바꿔 넣을 남은 조각이 없어요.');
      return;
    }
    const position = rows[index].pieces.findIndex((piece) => piece.id === id);
    const replacement = next.pieces[position];
    delete next.arrangedPieces;
    next.keepRaw = false;
    rows[index] = next;
    selected = { row: index, id: replacement.id };
    refreshRow(index, 'swap-piece');
    say('‘' + replacement.text + '’ 조각으로 바꿨어요.');
  }

  function toggleRowLock(index) {
    const row = rows[index];
    row.locked = !row.locked;
    row.lockedStrength = row.locked ? strengthLevel().amount : undefined;
    refreshRow(index, 'lock-row');
  }

  function collectRow(index, view) {
    savedLines.push(view.text);
    renderCollection();
    changed();
    say((index + 1) + '번째 줄을 모아 뒀어요.');
  }

  // ---------- views ----------

  function rawText(row) {
    return typeof row.editedText === 'string' ? row.editedText : joinPieces(row.pieces);
  }

  // Smooth lines in order; each sees the finished lines above and the raw lines below,
  // so a phrase restored from the source never appears twice.
  function viewRows(list) {
    const views = [];
    list.forEach((row, index) => {
      const context = [...views.map((view) => view.text), ...list.slice(index + 1).map(rawText)].join(' ');
      views.push(viewRow(row, context));
    });
    return views;
  }

  function viewRow(row, context = '') {
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
    const amount = row.keepRaw ? 0 : row.locked ? row.lockedStrength : strengthLevel().amount;
    const view = smooth(pieces, amount ?? 0, { applySuggestions: row.applySuggestions === true, context });
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
    changed();
  }

  function splitEditedText(text) {
    return split(text, form.elements.mode.value).map((piece, index) => ({
      id: 'edited-' + index, text: piece,
    }));
  }

  // ---------- line editor ----------

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
          event.stopPropagation();
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

  function startEdit(index, view) {
    const pieces = view.pieces.length ? [...view.pieces] : splitEditedText(view.text);
    editDraft = {
      index, text: view.text, pieces, selected: 0,
      mode: pieces.length > 1 ? 'pieces' : 'text',
      usesOrigins: view.pieces.length > 0,
      typed: false, changed: false,
    };
    refreshRow(index, 'edit-field');
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
        renderResults();
        focusRow(index, 'edit-field');
      });
      button.setAttribute('aria-pressed', String(draft.mode === mode));
      modes.append(button);
    }
    const buttons = element('div', 'row-actions');
    const saveButton = element('button', 'row-button', '수정 적용');
    saveButton.type = 'submit';
    buttons.append(saveButton, action('취소', () => {
      editDraft = null;
      renderResults();
      focusRow(index, 'edit');
    }));
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = (draft.mode === 'text' ? field.value : joinPieces(draft.pieces)).trim();
      if (!text) {
        if (draft.mode === 'text') {
          field.setCustomValidity('줄에 넣을 글을 입력해 주세요.');
          field.reportValidity();
        } else {
          say('줄에 넣을 글을 입력해 주세요.');
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
      if (draft.changed) say('줄을 수정했어요.');
    });
    editor.append(modes);
    if (draft.mode === 'text') editor.append(label, field);
    else editor.append(reorderEditor(draft));
    editor.append(buttons);
    return editor;
  }

  // ---------- result rows ----------

  function speakRow(index, view) {
    if (!Sound.canSpeak()) return;
    if (speakingRow === index) {
      Sound.stop();
      return;
    }
    speakingRow = index;
    speakAll.textContent = '읽기 멈춤';
    Sound.speak([view.text], () => {
      speakingRow = null;
      speakAll.textContent = '모두 읽기';
    });
  }

  function rowActions(row, view, index) {
    const controls = element('div', 'row-actions');
    const reroll = action('다시 섞기', () => rerollRow(index), 'reroll');
    reroll.disabled = !!row.locked;
    const lock = action(row.locked ? '줄 잠금 풀기' : '줄 잠그기', () => toggleRowLock(index), 'lock-row');
    lock.setAttribute('aria-pressed', String(!!row.locked));
    const edit = action('편집', () => startEdit(index, view), 'edit');
    controls.append(reroll, lock, edit, action('줄 모으기', () => collectRow(index, view), 'collect'));
    if (Sound.canSpeak()) controls.append(action('읽기', () => speakRow(index, view), 'speak'));

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

  // Pick a piece, then lock it, swap it, or read the sentence it came from.
  function pieceTools(row, view, index) {
    const panel = element('div', 'piece-locks');
    panel.append(element('p', 'edit-notes piece-title', '조각 — 골라서 잠그기 · 바꾸기 · 원래 문장 보기'));
    const group = element('div', 'piece-actions');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', (index + 1) + '번째 줄의 조각');
    const rawPieces = new Map(row.pieces.map((piece, position) => [piece.id, { piece, position }]));
    let picked = null;
    for (const [slot, visible] of view.pieces.entries()) {
      const entry = rawPieces.get(visible.id);
      if (!entry) continue;
      const { piece, position } = entry;
      const isPicked = selected?.row === index && selected.id === piece.id;
      if (isPicked) picked = { piece, visible, slot };
      const name = 'piece-' + position;
      const chip = action(visible.text, () => {
        selected = isPicked ? null : { row: index, id: piece.id };
        renderResults();
        focusRow(index, name);
      }, name);
      chip.classList.add('source-' + (piece.source + 1));
      chip.classList.toggle('is-locked', !!piece.locked);
      chip.setAttribute('aria-pressed', String(isPicked));
      chip.setAttribute('aria-label', visible.text + (piece.locked ? ' (잠김)' : ''));
      group.append(chip);
    }
    panel.append(group);

    if (picked) {
      const { piece, visible, slot } = picked;
      const tools = element('div', 'row-actions piece-tools');
      const lock = action(piece.locked ? '조각 잠금 풀기' : '조각 잠그기', () => {
        piece.locked = !piece.locked;
        piece.pinnedText = piece.locked ? visible.text : undefined;
        piece.pinnedJoin = piece.locked ? !!visible.joinLeft : undefined;
        piece.pinnedSlot = piece.locked ? slot : undefined;
        refreshRow(index, 'lock-piece');
      }, 'lock-piece');
      lock.setAttribute('aria-pressed', String(!!piece.locked));
      const swap = action('다른 조각으로 바꾸기', () => swapSelected(index, piece.id), 'swap-piece');
      swap.disabled = !!piece.locked;
      tools.append(lock, swap);
      panel.append(tools);

      const sentence = sentenceOf(allTexts()[piece.source], piece);
      const quote = element('blockquote', 'source-quote');
      quote.append(element('span', 'quote-label', columnName(piece.source) + ' · 원래 문장'));
      const body = element('p');
      if (sentence) {
        body.append(sentence.before, element('mark', '', sentence.match), sentence.after);
      } else {
        body.textContent = '원문에서 이 조각을 찾을 수 없어요. 원문이 바뀌었을 수 있어요.';
      }
      quote.append(body);
      panel.append(quote);
    }
    return panel;
  }

  function buildRowBody(row, index, view, strange) {
    const body = element('div', 'result-row-body');
    body.append(rowActions(row, view, index));
    if (!row.locked && row.editedText === undefined && row.pieces.length) {
      body.append(pieceTools(row, view, index));
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
    const facts = ['한글 ' + countSyllables(view.text) + '음절'];
    if (showStrange.checked && view.pieces.length > 1) facts.push('낯선 이음 ' + strange.filter((kind) => kind === 'far').length + '곳');
    body.append(element('p', 'edit-notes facts', facts.join(' · ')));
    if (editDraft?.index === index) body.append(editLine(row, index));
    return body;
  }

  function buildRow(row, index, view, open, rhyme) {
    const details = element('details', 'result-row');
    details.open = open || editDraft?.index === index;
    details.classList.toggle('is-locked', !!row.locked);
    const summary = element('summary', 'result-line');
    summary.dataset.row = index;
    const strange = view.pieces.length > 1 ? junctions(view.pieces) : [];
    if (!view.pieces.length) {
      summary.textContent = view.text;
    } else {
      const originals = new Map(row.pieces.map((piece, position) => [piece.id, { piece, position }]));
      view.pieces.forEach((piece, position) => {
        if (position) {
          if (showStrange.checked && strange[position - 1] === 'far') {
            summary.append(' ', element('span', 'cut-mark', '✂'));
          }
          if (!piece.joinLeft) summary.append(' ');
        }
        const span = element('span', 'piece source-' + (piece.source + 1), piece.text);
        const original = originals.get(piece.id);
        const changedPiece = original && (original.position !== position || original.piece.text !== piece.text
          || !!original.piece.joinLeft !== !!piece.joinLeft);
        span.classList.toggle('is-changed', !!changedPiece);
        span.classList.toggle('is-locked', !!piece.locked);
        summary.append(span);
      });
    }
    if (view.suggestions.length) summary.append(' ', element('span', 'suggestion-label', '제안'));
    const tag = row.locked ? '잠금' : row.editedText !== undefined || row.arrangedPieces ? '편집' : row.keepRaw ? '원본' : '';
    if (tag) summary.append(' ', element('span', 'row-tag', tag));
    if (showRhyme.checked && rhyme) {
      const badge = element('span', 'rhyme-badge' + (rhyme.letter ? '' : ' is-alone'), (rhyme.letter ?? '·') + ' ' + rhyme.tail);
      badge.title = '끝 모음 ' + rhyme.vowel + (rhyme.open ? ' · 받침 없음(길게 끌기 좋음)' : ' · 받침 있음');
      summary.append(' ', badge);
    }
    details.append(summary);
    if (details.open) {
      details.append(buildRowBody(row, index, view, strange));
    } else {
      function mountActions() {
        if (!details.open) return;
        details.append(buildRowBody(row, index, view, strange));
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
    const fixed = rows.filter((row) => row.locked || row.keepRaw || row.editedText !== undefined || row.arrangedPieces).length;
    if (fixed) status.push(fixed + '줄은 잠금·편집·원본 상태라 강도를 따르지 않음');
    const description = status.length ? status.join(' / ') + '.' : form.elements.mode.value === 'line'
      ? '줄 단위 조각은 이미 완결된 문장이라 바꿀 곳이 거의 없어요. 어절이나 구절로 잘라 보세요.'
      : '이 강도에서 자동으로 바뀐 줄이 없어요.';
    if (strengthStatus.textContent !== description) strengthStatus.textContent = description;
  }

  function renderLegend() {
    const used = [...new Set(rows.flatMap((row) => row.pieces.map((piece) => piece.source)))].sort((a, b) => a - b);
    sourceLegend.replaceChildren(...used.map((source) => {
      const item = element('li');
      item.append(element('span', 'piece source-' + (source + 1), columnName(source)));
      return item;
    }));
    sourceLegend.hidden = !showOrigins.checked || used.length === 0;
  }

  function renderResults(resetOpen = false) {
    const open = resetOpen ? [] : Array.from(result.children, (row) => row.open);
    const focused = document.activeElement?.closest?.('.result-row');
    const focusIndex = focused ? Array.from(result.children).indexOf(focused) : -1;
    const views = viewRows(rows);
    const rhymes = Sound.scheme(views.map((view) => view.text));
    result.replaceChildren(...rows.map((row, index) => buildRow(row, index, views[index], open[index], rhymes[index])));
    if (focusIndex >= 0 && !result.contains(document.activeElement)) result.children[focusIndex]?.querySelector('summary')?.focus({ preventScroll: true });
    result.hidden = rows.length === 0;
    emptyResult.hidden = rows.length > 0;
    resultHelp.hidden = rows.length === 0;
    copyButton.disabled = rows.length === 0;
    copyButton.textContent = '결과 복사';
    speakAll.disabled = rows.length === 0;
    resultCount.textContent = rows.length ? rows.length + '줄' : '';
    const level = strengthLevel();
    strengthValue.textContent = strength.value + ' ' + level.name;
    strength.setAttribute('aria-valuetext', strength.value + '단계 ' + level.name);
    strengthHelp.textContent = level.help;
    showStrengthStatus(views);
    result.classList.toggle('show-origins', showOrigins.checked);
    renderLegend();
  }

  function showRows(next, announce = true) {
    editDraft = null;
    selected = null;
    rows = next;
    renderResults(true);
    changed();
    if (!announce) return;
    const many = activeColumns().length > 1;
    if (rows.length > Number(form.elements.lineCount.value)) {
      say('잠근 줄을 포함해 ' + rows.length + '줄을 유지했어요.');
    } else if (!rows.length) {
      say('자를 조각을 찾을 수 없어요. 뺄 말이 너무 많거나 원문이 비어 있을 수 있어요.');
    } else if (!many && rows.length === 1 && rows[0].pieces.length === 1) {
      say('글을 더 넣거나 자를 단위를 바꾸면 더 많은 조각을 섞을 수 있어요.');
    } else {
      const missing = missingWords(rows);
      say((many ? activeColumns().length + '칸에서 ' : '') + rows.length + '줄을 만들었어요.'
        + (missing.length ? ' 원문에 없어 못 넣은 말: ' + missing.join(', ') : ''));
    }
  }

  function compare() {
    if (compareButton.disabled) return;
    const options = mixOptions();
    const versions = Array.from({ length: 3 }, () => makeRows(options));
    if (!versions[0].length) {
      say('자를 조각을 찾을 수 없어요.');
      return;
    }
    compareCandidates.replaceChildren(...versions.map((candidate, index) => {
      const card = element('article', 'candidate');
      const heading = element('h3', '', '후보 ' + (index + 1));
      const text = element('div', 'candidate-lines');
      if (candidate.length) {
        text.append(...viewRows(candidate).map((view) => element('p', '', view.text)));
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

  // ---------- collection ----------

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
        changed();
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
        changed();
        say('모은 줄에서 뺐어요. [실행 취소]로 되돌릴 수 있어요.');
      });
      remove.setAttribute('aria-label', (index + 1) + '번째 모은 줄 빼기');
      actions.append(up, down, remove);
      item.append(element('p', '', text), actions);
      return item;
    }));
    collectionEmpty.hidden = savedLines.length > 0;
    copyCollection.disabled = savedLines.length === 0;
    copyCollection.textContent = '모은 글 복사';
    collectionToColumn.disabled = savedLines.length === 0 || columns.length >= Store.maxColumns;
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
    say(copied ? message : '복사할 수 없었어요. 글을 선택해 직접 복사해 주세요.');
  }

  // ---------- history ----------

  function snapshot() {
    return JSON.stringify({ rows, savedLines });
  }

  function updateHistoryButtons() {
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex >= history.length - 1;
  }

  function record() {
    const state = snapshot();
    if (history[historyIndex] === state) return;
    history = history.slice(0, historyIndex + 1);
    history.push(state);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function resetHistory() {
    history = [snapshot()];
    historyIndex = 0;
    updateHistoryButtons();
  }

  function travel(step) {
    const target = historyIndex + step;
    if (target < 0 || target >= history.length) return;
    historyIndex = target;
    const state = JSON.parse(history[target]);
    rows = state.rows;
    savedLines = state.savedLines;
    editDraft = null;
    selected = null;
    renderResults();
    renderCollection();
    updateHistoryButtons();
    persist();
    say(step < 0 ? '실행 취소했어요.' : '다시 실행했어요.');
  }

  // ---------- notes and storage ----------

  function defaultData(text = '') {
    return { columns: [{ text, enabled: true, weight: defaultWeight }], rows: [], savedLines: [] };
  }

  function collectData() {
    return {
      columns: columns.map(({ text, enabled, weight }) => ({ text, enabled, weight })),
      useWeights: useWeights.checked,
      mode: form.elements.mode.value,
      lineCount: form.elements.lineCount.value,
      strategy: strategy.value,
      syllables: targetSyllables.value,
      include: includeWords.value,
      exclude: excludeWords.value,
      strengthLevel: strength.value,
      origins: showOrigins.checked,
      strange: showStrange.checked,
      rhyme: showRhyme.checked,
      rows,
      savedLines,
    };
  }

  function applyData(data = {}) {
    const savedColumns = Array.isArray(data.columns) ? data.columns : [];
    columns = savedColumns
      .filter((column) => typeof column?.text === 'string')
      .slice(0, Store.maxColumns)
      .map((column) => ({
        text: column.text,
        enabled: column.enabled !== false,
        weight: Math.min(5, Math.max(1, Number(column.weight) || defaultWeight)),
      }));
    if (!columns.length) columns = [{ text: '', enabled: true, weight: defaultWeight }];

    useWeights.checked = data.useWeights === true;
    form.elements.mode.value = Object.hasOwn(unitHelp, data.mode) ? data.mode : 'phrase';
    const lineCounts = Array.from(form.elements.lineCount.options, (option) => option.value);
    form.elements.lineCount.value = lineCounts.includes(String(data.lineCount)) ? String(data.lineCount) : '6';
    strategy.value = Object.hasOwn(strategyHelp, data.strategy) ? data.strategy : 'default';
    targetSyllables.value = data.syllables ?? '16';
    includeWords.value = typeof data.include === 'string' ? data.include : '';
    excludeWords.value = typeof data.exclude === 'string' ? data.exclude : '';
    const level = Number(data.strengthLevel);
    strength.value = Number.isInteger(level) && strengthLevels[level] ? level : levelForAmount(Number(data.strength) || 0);
    showOrigins.checked = data.origins === true;
    showStrange.checked = data.strange === true;
    showRhyme.checked = data.rhyme === true;

    const columnTotal = columns.length;
    const savedRows = Array.isArray(data.rows) ? data.rows : [];
    const validRows = savedRows.filter((row) => Array.isArray(row?.pieces) && row.pieces.every((piece) =>
      typeof piece?.id === 'string' && typeof piece.text === 'string'
      && Number.isInteger(piece.source) && piece.source >= 0 && piece.source < columnTotal));
    rows = restoreOrigins(validRows, allTexts(), form.elements.mode.value);
    savedLines = Array.isArray(data.savedLines) ? data.savedLines.filter((text) => typeof text === 'string') : [];
    editDraft = null;
    selected = null;

    renderColumns();
    renderResults(true);
    renderCollection();
    resetHistory();
  }

  function renderNotes() {
    noteSelect.replaceChildren(...book.notes.map((note) => {
      const option = element('option', '', note.title || '제목 없음');
      option.value = note.id;
      return option;
    }));
    noteSelect.value = book.current;
    noteTitle.value = currentNote()?.title ?? '';
    byId('delete-note').disabled = book.notes.length === 0;
  }

  function saveWork() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const note = currentNote();
    if (!note) return;
    note.data = collectData();
    note.updated = new Date().toISOString();
    storageStatus.textContent = Store.save(book) ? '이 브라우저에 자동 저장됨' : '이 브라우저에 저장할 수 없어요. 백업을 저장해 두세요.';
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWork, 200);
  }

  // Any change to the lines or the collection: remember it for undo, then save.
  function changed() {
    record();
    persist();
  }

  function openNote(id) {
    saveWork();
    book.current = id;
    applyData(currentNote()?.data);
    renderNotes();
    Store.save(book);
  }

  function addNote(title, data) {
    saveWork();
    const note = Store.make(title, data);
    book.notes.push(note);
    book.current = note.id;
    applyData(note.data);
    renderNotes();
    Store.save(book);
    return note;
  }

  function nextTitle() {
    let number = book.notes.length + 1;
    while (book.notes.some((note) => note.title === '노트 ' + number)) number += 1;
    return '노트 ' + number;
  }

  function exportText() {
    saveWork();
    const note = currentNote();
    const lines = [note.title || '제목 없음', new Date().toLocaleString('ko-KR'), ''];
    lines.push('[모은 줄]', ...(savedLines.length ? savedLines : ['(없음)']), '');
    lines.push('[섞은 글]', ...(rows.length ? viewRows(rows).map((view) => view.text) : ['(없음)']), '');
    columns.forEach((column, index) => {
      if (column.text.trim()) lines.push('[' + columnName(index) + (column.enabled ? '' : ' · 꺼 둠') + ']', column.text.trim(), '');
    });
    download(fileSafe(note.title) + '.txt', lines.join('\n'), 'text/plain;charset=utf-8');
    say('텍스트 파일로 내보냈어요.');
  }

  function saveBackup() {
    saveWork();
    download('verbasizer-backup-' + today() + '.json', Store.backup(book), 'application/json');
    say('노트 ' + book.notes.length + '개를 백업 파일로 저장했어요.');
  }

  async function loadBackup(file) {
    try {
      const notes = Store.parseBackup(await file.text());
      if (!notes.length) throw new Error('empty');
      saveWork();
      const titles = new Set(book.notes.map((note) => note.title));
      for (const note of notes) {
        const title = titles.has(note.title) ? note.title + ' (불러옴)' : note.title;
        book.notes.push({ ...note, id: Store.newId(), title });
      }
      Store.save(book);
      renderNotes();
      say('노트 ' + notes.length + '개를 불러왔어요. 위의 노트 목록에서 고르세요.');
    } catch {
      say('백업 파일을 읽을 수 없어요. 이 앱에서 저장한 .json 파일인지 확인해 주세요.');
    }
  }

  // ---------- theme ----------

  function systemDark() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  }

  function applyTheme() {
    if (prefs.theme === 'dark' || prefs.theme === 'light') document.documentElement.dataset.theme = prefs.theme;
    else delete document.documentElement.dataset.theme;
    const dark = prefs.theme ? prefs.theme === 'dark' : systemDark();
    themeButton.setAttribute('aria-pressed', String(dark));
    document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#ffffff';
  }

  // ---------- samples dialog ----------

  function openSamples() {
    sampleChoices.replaceChildren(...columns.map((column, index) => {
      const choice = element('div', 'sample-choice');
      const id = 'sample-' + index;
      const label = element('label', '', columnName(index));
      label.htmlFor = id;
      const select = element('select', 'field');
      select.id = id;
      const keep = element('option', '', '(바꾸지 않음)');
      keep.value = '';
      select.append(keep, ...samples.map((sample, position) => {
        const option = element('option', '', sample.author + ' · ' + sample.title);
        option.value = position;
        return option;
      }));
      const match = samples.findIndex(({ text }) => text === column.text);
      select.value = match !== -1 ? String(match) : column.text.trim() ? '' : String(index % samples.length);
      const excerpt = element('p', 'sample-excerpt');
      excerpt.tabIndex = 0;
      excerpt.setAttribute('aria-label', columnName(index) + ' 미리보기');
      const credit = element('p', 'field-help');
      function preview() {
        const sample = samples[Number(select.value)];
        if (select.value === '' || !sample) {
          excerpt.textContent = column.text.trim() || '(빈 칸)';
          credit.textContent = '지금 칸의 글을 그대로 둡니다.';
          return;
        }
        excerpt.textContent = sample.text;
        credit.replaceChildren(sample.credit + ' · ');
        const link = element('a', '', '독일어 원문');
        link.href = sample.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        credit.append(link);
      }
      select.addEventListener('change', preview);
      preview();
      choice.append(label, select, excerpt, credit);
      return choice;
    }));
    sampleDialog.showModal();
  }

  // ---------- cards ----------

  let cardIndex = -1;

  function drawCard() {
    let next = Math.floor(Math.random() * cards.length);
    if (cards.length > 1 && next === cardIndex) next = (next + 1) % cards.length;
    cardIndex = next;
    byId('card-number').textContent = '카드 ' + (next + 1) + ' / ' + cards.length;
    byId('card-text').textContent = cards[next];
  }

  // ---------- events ----------

  addColumnButton.addEventListener('click', () => addColumn());
  useWeights.addEventListener('change', () => {
    renderColumns();
    persist();
  });
  form.addEventListener('change', (event) => {
    if (event.target.closest('#columns')) return;
    updateInputs();
    renderResults();
    persist();
  });
  form.addEventListener('input', (event) => {
    if (event.target === includeWords || event.target === excludeWords || event.target === targetSyllables) persist();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!targetSyllables.disabled && !targetSyllables.checkValidity()) {
      targetSyllables.reportValidity();
      return;
    }
    mix();
  });

  strength.addEventListener('input', () => {
    renderResults();
    persist();
  });
  for (const toggle of [showOrigins, showStrange, showRhyme]) {
    toggle.addEventListener('change', () => {
      renderResults();
      persist();
    });
  }
  compareButton.addEventListener('click', compare);
  undoButton.addEventListener('click', () => travel(-1));
  redoButton.addEventListener('click', () => travel(1));

  if (Sound.canSpeak()) {
    speakAll.hidden = false;
    speakAll.addEventListener('click', () => {
      if (Sound.speaking()) {
        Sound.stop();
        return;
      }
      speakAll.textContent = '읽기 멈춤';
      speakingRow = -1;
      Sound.speak(viewRows(rows).map((view) => view.text), () => {
        speakingRow = null;
        speakAll.textContent = '모두 읽기';
      });
    });
  }

  sampleButton.addEventListener('click', openSamples);
  byId('sample-cancel').addEventListener('click', () => sampleDialog.close());
  sampleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sampleChoices.querySelectorAll('select').forEach((select, index) => {
      if (select.value === '') return;
      columns[index].text = samples[Number(select.value)].text;
      columns[index].enabled = true;
    });
    renderColumns();
    sampleDialog.close();
    mix();
  });

  copyButton.addEventListener('click', () => {
    copyText(viewRows(rows).map((view) => view.text).join('\n'), copyButton, '섞은 글을 복사했어요.');
  });
  copyCollection.addEventListener('click', () => {
    copyText(savedLines.join('\n'), copyCollection, '모은 글을 복사했어요.');
  });
  collectionToColumn.addEventListener('click', () => {
    if (addColumn(savedLines.join('\n'))) say('모은 줄을 ' + columnName(columns.length - 1) + ' 칸에 넣었어요. 이 칸으로 다시 섞어 보세요.');
  });

  noteSelect.addEventListener('change', () => openNote(noteSelect.value));
  noteTitle.addEventListener('input', () => {
    const note = currentNote();
    if (!note) return;
    note.title = noteTitle.value;
    const option = noteSelect.querySelector('option[value="' + CSS.escape(note.id) + '"]');
    if (option) option.textContent = note.title || '제목 없음';
    persist();
  });
  byId('new-note').addEventListener('click', () => {
    addNote(nextTitle(), defaultData());
    noteTitle.select();
    noteTitle.focus();
    say('새 노트를 만들었어요.');
  });
  byId('duplicate-note').addEventListener('click', () => {
    saveWork();
    const note = currentNote();
    addNote((note.title || '제목 없음') + ' 사본', JSON.parse(JSON.stringify(note.data)));
    say('노트를 복제했어요.');
  });
  byId('delete-note').addEventListener('click', async () => {
    const note = currentNote();
    const ok = await confirmAction('‘' + (note.title || '제목 없음') + '’ 노트를 지울까요?',
      '이 노트의 원문, 섞은 글, 모은 줄이 모두 사라지고 되돌릴 수 없어요. 먼저 [백업 저장]을 해 두면 안전해요.',
      '노트 지우기');
    if (!ok) return;
    book.notes = book.notes.filter((entry) => entry.id !== note.id);
    if (!book.notes.length) book.notes.push(Store.make('노트 1', defaultData()));
    book.current = book.notes[0].id;
    applyData(currentNote().data);
    renderNotes();
    Store.save(book);
    say('노트를 지웠어요.');
  });
  byId('export-text').addEventListener('click', exportText);
  byId('backup-save').addEventListener('click', saveBackup);
  byId('backup-load').addEventListener('click', () => byId('backup-file').click());
  byId('backup-file').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) loadBackup(file);
    event.target.value = '';
  });

  byId('card-button').addEventListener('click', () => {
    drawCard();
    cardDialog.showModal();
  });
  byId('card-next').addEventListener('click', drawCard);
  byId('help-button').addEventListener('click', () => helpDialog.showModal());
  themeButton.addEventListener('click', () => {
    const dark = themeButton.getAttribute('aria-pressed') !== 'true';
    prefs = { ...prefs, theme: dark === systemDark() ? undefined : dark ? 'dark' : 'light' };
    Store.savePrefs(prefs);
    applyTheme();
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  // Row shortcuts work on a focused line; codes keep them working with a Korean keyboard layout.
  result.addEventListener('keydown', (event) => {
    const summary = event.target.closest?.('summary.result-line');
    if (!summary || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = Number(summary.dataset.row);
    const summaries = Array.from(result.querySelectorAll('summary.result-line'));
    const views = () => viewRows(rows);
    switch (event.code) {
      case 'ArrowDown':
      case 'ArrowUp':
        summaries[index + (event.code === 'ArrowDown' ? 1 : -1)]?.focus();
        break;
      case 'KeyR': rerollRow(index); break;
      case 'KeyL': toggleRowLock(index); break;
      case 'KeyC': collectRow(index, views()[index]); break;
      case 'KeyE': startEdit(index, views()[index]); break;
      case 'KeyS': speakRow(index, views()[index]); break;
      default: return;
    }
    event.preventDefault();
  });

  function typing(target) {
    return target?.closest?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, [contenteditable="true"]');
  }

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || document.querySelector('dialog[open]')) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key === 'Enter') {
      if (event.target.closest?.('.line-editor') || mixButton.disabled) return;
      event.preventDefault();
      form.requestSubmit();
      return;
    }
    if (typing(event.target)) return;
    if (command && event.code === 'KeyZ') {
      event.preventDefault();
      travel(event.shiftKey ? 1 : -1);
    } else if (command && event.code === 'KeyY') {
      event.preventDefault();
      travel(1);
    } else if (!command && event.key === '?') {
      event.preventDefault();
      helpDialog.showModal();
    }
  });

  window.addEventListener('pagehide', () => {
    if (saveTimer !== null) saveWork();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer !== null) saveWork();
  });

  // Notices behave like a transient alert box: they clear themselves after a few seconds.
  let noticeTimer = null;
  new MutationObserver(() => {
    clearTimeout(noticeTimer);
    if (notice.textContent) noticeTimer = setTimeout(() => { notice.textContent = ''; }, 5000);
  }).observe(notice, { childList: true, characterData: true, subtree: true });

  // ---------- start ----------

  applyTheme();
  if (!book.notes.length) {
    const note = Store.make('첫 노트', defaultData(samples[0].text));
    book.notes.push(note);
    book.current = note.id;
    applyData(note.data);
    rows = makeRows(mixOptions());
    renderResults(true);
    resetHistory();
    saveWork();
  } else {
    applyData(currentNote().data);
    storageStatus.textContent = '이 브라우저의 작업을 불러왔어요.';
  }
  renderNotes();

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
