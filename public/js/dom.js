// Small DOM helpers shared by every screen.

export const $ = (id) => document.getElementById(id);

/** Creates an element: h('div', { class: 'x', onclick }, child, 'text') */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      // setProperty is required for custom properties (--foo); plain assignment ignores them.
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v);
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const show = (el, visible) => {
  el.hidden = !visible;
};

export const setText = (el, text) => {
  const value = String(text ?? '');
  if (el.textContent !== value) el.textContent = value;
};

/**
 * Keyed list rendering: reuses existing nodes (keeps animations and focus),
 * creates missing ones, removes stale ones and fixes the order.
 */
export function renderList(container, items, { key, create, update }) {
  const existing = new Map();
  for (const child of container.children) existing.set(child.dataset.key, child);

  let cursor = container.firstElementChild;
  for (const [index, item] of items.entries()) {
    const k = String(key(item));
    let node = existing.get(k);
    if (node) existing.delete(k);
    else {
      node = create(item);
      node.dataset.key = k;
    }
    if (update) update(node, item, index);
    if (node !== cursor) container.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const node of existing.values()) node.remove();
}
