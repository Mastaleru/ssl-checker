// DOM helpers. Everything is built with createElement/textContent: certificate
// fields and notary answers are untrusted text and never touch innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const ICONS = {
  refresh: [['path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6' }]],
  sliders: [
    ['path', { d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }],
    ['circle', { cx: 15, cy: 7, r: 2 }],
    ['circle', { cx: 9, cy: 17, r: 2 }],
  ],
  shieldCheck: [
    ['path', { d: 'M12 3.2 19.5 6v5.6c0 4.3-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.9-7.5-9.2V6Z' }],
    ['path', { d: 'm8.6 12.2 2.4 2.4 4.4-4.8' }],
  ],
  shieldX: [
    ['path', { d: 'M12 3.2 19.5 6v5.6c0 4.3-3.1 7.9-7.5 9.2-4.4-1.3-7.5-4.9-7.5-9.2V6Z' }],
    ['path', { d: 'm9.5 9.5 5 5m0-5-5 5' }],
  ],
  alert: [
    ['path', { d: 'M12 4.2 20.5 19H3.5Z' }],
    ['path', { d: 'M12 10v4.2M12 16.8v.1' }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M12 11v5.2M12 8v.1' }],
  ],
  circleDash: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M8.5 12h7' }],
  ],
  copy: [
    ['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 1.8 }],
    ['path', { d: 'M15.5 8.5V5.8A1.3 1.3 0 0 0 14.2 4.5H5.8a1.3 1.3 0 0 0-1.3 1.3v8.4a1.3 1.3 0 0 0 1.3 1.3h2.7' }],
  ],
  download: [['path', { d: 'M12 4.5v10.5M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14' }]],
};

export function icon(name) {
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const [tag, attrs] of ICONS[name] || []) el.append(svg(tag, attrs));
  return el;
}

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MAX = 20;

/**
 * Renders the 32 bytes of a SHA-256 fingerprint as bars. Identical certificates
 * give identical barcodes, which makes a mismatch visible at a glance.
 */
export function barcode(sha256Hex, { animate = false, label = '' } = {}) {
  const bytes = sha256Hex.match(/../g).map((b) => parseInt(b, 16));
  const width = bytes.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const el = svg('svg', {
    class: animate ? 'barcode animate' : 'barcode',
    viewBox: `0 0 ${width} ${BAR_MAX}`,
    width,
    height: BAR_MAX,
    role: 'img',
    'aria-label': label,
  });
  bytes.forEach((byte, i) => {
    const height = 3 + Math.round((byte / 255) * (BAR_MAX - 3));
    const rect = svg('rect', { x: i * (BAR_WIDTH + BAR_GAP), y: BAR_MAX - height, width: BAR_WIDTH, height, rx: 0.8 });
    rect.style.setProperty('--i', String(i));
    el.append(rect);
  });
  return el;
}

/** A barcode-shaped placeholder shown while a check runs. */
export function barcodeSkeleton() {
  const el = svg('svg', { class: 'barcode skeleton', viewBox: '0 0 158 20', width: 158, height: 20, 'aria-hidden': 'true' });
  for (let i = 0; i < 32; i++) {
    const height = 6 + ((i * 7) % 11);
    el.append(svg('rect', { x: i * 5, y: 20 - height, width: 3, height, rx: 0.8 }));
  }
  return el;
}
