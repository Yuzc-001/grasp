import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';
import { buildHintMap } from '../../src/layer2-perception/hints.js';

function createMockElement({
  tagName = 'div',
  attrs = {},
  textContent = '',
  rect = { left: 80, top: 100, width: 80, height: 20, right: 160, bottom: 120 },
  style = { visibility: 'visible', display: 'block', opacity: '1', cursor: 'auto' },
} = {}) {
  return {
    tagName: tagName.toUpperCase(),
    innerText: textContent,
    textContent,
    onclick: attrs.onclick ?? null,
    getBoundingClientRect: () => rect,
    getAttribute: (name) => attrs[name] ?? null,
    getAttributeNames: () => Object.keys(attrs),
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    setAttribute: () => {},
    classList: { contains: () => false },
    __style: style,
  };
}

function createMockPage(elements) {
  return createFakePage({
    evaluate: async (fn, ...args) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      const previousNodeFilter = globalThis.NodeFilter;
      globalThis.NodeFilter = { SHOW_ELEMENT: 1 };
      globalThis.document = {
        body: {},
        getElementById: () => null,
        createTreeWalker: () => {
          let index = -1;
          return {
            nextNode() {
              index += 1;
              return elements[index] ?? null;
            },
          };
        },
      };
      globalThis.window = {
        innerWidth: 1440,
        innerHeight: 900,
        getComputedStyle: (el) => el.__style,
      };
      try {
        return await fn(...args);
      } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
        globalThis.NodeFilter = previousNodeFilter;
      }
    },
  });
}

test('buildHintMap discovers non-standard clickable elements via tabindex and pointer cursor', async () => {
  const customButton = createMockElement({
    tagName: 'div',
    attrs: { tabindex: '0', role: '', onclick: 'handler()' },
    textContent: '自定义按钮',
    style: { visibility: 'visible', display: 'block', opacity: '1', cursor: 'pointer' },
  });

  const hints = await buildHintMap(createMockPage([customButton]));
  assert.equal(hints.length, 1);
  assert.equal(hints[0].label, '自定义按钮');
});
