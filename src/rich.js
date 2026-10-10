// 글자 꾸미기(굵게·기울임·밑줄·취소선·코드·링크)만 남기고 나머지 HTML은 지운다.
// 공유 폴더로 남이 쓴 내용도 화면에 그리기 전에 반드시 이걸 거친다.
const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT']);
export const FMT_SEL = 'b,strong,i,em,u,s,strike,del,code,a';

// 같은 서식이 붙어 있으면 하나로 합친다: <b>wor</b><b>ld</b> → <b>world</b>
function mergeAdjacent(parent) {
  let node = parent.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === 1 && next && next.nodeType === 1 && node.tagName === next.tagName
      && (node.getAttribute('href') || '') === (next.getAttribute('href') || '')) {
      node.append(...next.childNodes); next.remove();
      continue;
    }
    if (node.nodeType === 1) mergeAdjacent(node);
    node = next;
  }
}

export function sanitize(html) {
  const src = document.createElement('template');
  src.innerHTML = html || '';
  const out = document.createElement('div');
  const walk = (from, to) => {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === 3) { to.append(node.textContent.replace(/\n/g, ' ')); continue; }
      if (node.nodeType !== 1 || DROP.has(node.tagName.toUpperCase())) continue;
      const tag = INLINE[node.tagName.toUpperCase()];
      if (!tag) { walk(node, to); continue; }
      if (!node.textContent) continue;
      const x = document.createElement(tag);
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) { walk(node, to); continue; }
        x.setAttribute('href', href);
      }
      walk(node, x);
      to.append(x);
    }
  };
  walk(src.content, out);
  mergeAdjacent(out);
  return out.innerHTML;
}

// 마크다운 내보내기용
export function toMarkdownInline(html) {
  const div = document.createElement('div');
  div.innerHTML = sanitize(html);
  const conv = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/ /g, ' ');
    const inner = [...n.childNodes].map(conv).join('');
    switch (n.tagName) {
      case 'B': return `**${inner}**`;
      case 'I': return `*${inner}*`;
      case 'S': return `~~${inner}~~`;
      case 'CODE': return `\`${inner}\``;
      case 'A': return `[${inner}](${n.getAttribute('href')})`;
      default: return inner;
    }
  };
  return [...div.childNodes].map(conv).join('');
}
