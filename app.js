(() => {
  'use strict';

  const sample = [
    '불이 꺼진 극장에서 우리는 서로의 발소리를 기다렸다.',
    '새벽의 전광판이 아무도 모르는 이름을 불렀다.',
    '주머니 속에 접어 둔 바다가 천천히 젖어 갔다.',
    '마지막 전철은 창문마다 다른 밤을 싣고 달렸다.',
    '도시는 젖은 성냥처럼 한참 동안 빛나지 않았다.',
    '돌아가는 길에 나는 처음 듣는 노래를 흥얼거렸다.',
  ].join('\n');

  const unitHelp = {
    word: '조사와 어미를 붙인 채로 띄어쓰기 단위로 섞어요.',
    phrase: '한 문장 안에서 이어지는 짧은 구절을 섞어요.',
    line: '줄바꿈으로 나눈 각 줄을 한 조각으로 섞어요.',
  };

  const form = document.querySelector('#studio-form');
  const source = document.querySelector('#source');
  const sourceCount = document.querySelector('#source-count');
  const sampleButton = document.querySelector('#sample-button');
  const clearButton = document.querySelector('#clear-button');
  const mixButton = document.querySelector('#mix-button');
  const copyButton = document.querySelector('#copy-button');
  const help = document.querySelector('#unit-help');
  const emptyResult = document.querySelector('#empty-result');
  const result = document.querySelector('#result');
  const resultCount = document.querySelector('#result-count');
  const notice = document.querySelector('#notice');
  const numberFormat = new Intl.NumberFormat('ko-KR');
  let resultText = '';

  function updateSource() {
    sourceCount.textContent = numberFormat.format(Array.from(source.value).length) + '자';
    clearButton.disabled = source.value.length === 0;
    mixButton.disabled = source.value.trim().length === 0;
    notice.textContent = '';
  }

  function renderResult(lines) {
    resultText = lines.join('\n');
    result.replaceChildren(...lines.map((line) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      return paragraph;
    }));
    result.hidden = lines.length === 0;
    emptyResult.hidden = lines.length > 0;
    copyButton.disabled = lines.length === 0;
    copyButton.textContent = '결과 복사';
    resultCount.textContent = lines.length === 0 ? '' : lines.length + '줄';
  }

  function mixSource(announce = true) {
    const fragments = window.Verbasizer.split(source.value, form.elements.mode.value);
    const lines = window.Verbasizer.mix(fragments, {
      lineCount: Number(form.elements.lineCount.value),
    });
    renderResult(lines);
    if (announce) {
      notice.textContent = fragments.some((fragment) => fragment !== fragments[0])
        ? lines.length + '줄로 섞었어요.'
        : '글을 더 넣거나 자를 단위를 바꾸면 섞을 수 있어요.';
    }
  }

  function legacyCopy(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.className = 'visually-hidden';
    document.body.append(field);
    field.select();
    try {
      return document.execCommand('copy');
    } finally {
      field.remove();
      copyButton.focus({ preventScroll: true });
    }
  }

  async function copyResult() {
    const text = resultText;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      if (resultText !== text) return;
      try {
        copied = legacyCopy(text);
      } catch {
        // Select the result as a final fallback.
      }
    }
    if (resultText !== text) return;
    if (copied) {
      copyButton.textContent = '복사했어요';
      notice.textContent = '섞은 글을 클립보드에 복사했어요.';
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(result);
    selection.removeAllRanges();
    selection.addRange(range);
    notice.textContent = '선택된 글을 복사해 주세요.';
  }

  source.addEventListener('input', updateSource);
  form.addEventListener('change', () => {
    help.textContent = unitHelp[form.elements.mode.value];
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!mixButton.disabled) mixSource();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing && !mixButton.disabled) {
      event.preventDefault();
      mixSource();
    }
  });

  sampleButton.addEventListener('click', () => {
    source.value = sample;
    updateSource();
    mixSource();
  });
  clearButton.addEventListener('click', () => {
    source.value = '';
    updateSource();
    renderResult([]);
    source.focus();
  });
  copyButton.addEventListener('click', copyResult);

  source.value = sample;
  updateSource();
  mixSource(false);
})();
