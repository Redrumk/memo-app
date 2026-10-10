// 작은 DOM 헬퍼, 시트/토스트, 아이콘, 날짜 포맷

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const ICONS = {
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l1.6 2h8.9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  notes: '<path d="M6 3.5h9l3 3v14H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  shared: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l1.6 2h8.9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="12.3" r="1.7"/><path d="M8.9 16.6c.6-1.3 1.7-2 3.1-2s2.5.7 3.1 2"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function openOverlay(content, { onClose } = {}) {
  const overlay = el('div', { class: 'overlay' });
  overlay.append(el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content));
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.getElementById('overlay-root').append(overlay);
  return close;
}

// 선택지를 보여주고 고른 value(또는 null)를 돌려준다
export function actionSheet(title, actions) {
  return new Promise((resolve) => {
    let picked = null;
    let close = () => {};
    const box = el('div', {},
      title ? el('h4', {}, title) : null,
      actions.map((a) => el('button', {
        class: 'sheet-btn' + (a.danger ? ' danger' : ''), type: 'button',
        onclick: () => { picked = a.value ?? a.label; close(); },
      }, a.label)),
      el('button', { class: 'sheet-btn cancel', type: 'button', onclick: () => close() }, '취소'),
    );
    close = openOverlay(box, { onClose: () => resolve(picked) });
  });
}

let toastTimer = null;
export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

export function formatDate(iso) {
  const d = new Date(iso);
  const n = new Date();
  if (d.toDateString() === n.toDateString()) {
    return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function formatFull(iso) {
  return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 앱 안에서 띄우는 확인/입력 창 (브라우저 기본 팝업 대신)
export function confirmDialog(message, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    let close = () => {};
    const box = el('div', { class: 'dialog' },
      el('p', { class: 'dialog-msg' }, message),
      el('div', { class: 'row end' },
        cancel ? el('button', { class: 'btn', type: 'button', onclick: () => close() }, cancel) : null,
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { result = true; close(); } }, ok)));
    close = openOverlay(box, { onClose: () => resolve(result) });
  });
}
export const alertDialog = (message) => confirmDialog(message, { cancel: null });

export function promptDialog(title, value = '', { ok = '확인', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let close = () => {};
    const input = el('input', { type: 'text', id: 'dialog-input', value, placeholder, autocomplete: 'off', enterkeyhint: 'done' });
    const form = el('form', { class: 'form dialog' },
      el('h4', {}, title), input,
      el('div', { class: 'row end' },
        el('button', { class: 'btn', type: 'button', onclick: () => close() }, '취소'),
        el('button', { class: 'btn primary', type: 'submit' }, ok)));
    form.addEventListener('submit', (e) => { e.preventDefault(); result = input.value; close(); });
    close = openOverlay(form, { onClose: () => resolve(result) });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}
