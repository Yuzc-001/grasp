import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakePage } from '../helpers/fake-page.js';
import { buildHintMap } from '../../src/layer2-perception/hints.js';

function createMockElement({
  tagName = 'a',
  attrs = {},
  textContent = '',
  rect = { left: 80, top: 100, width: 80, height: 20, right: 160, bottom: 120 },
  classNames = [],
} = {}) {
  return {
    tagName: tagName.toUpperCase(),
    innerText: textContent,
    textContent,
    getBoundingClientRect: () => rect,
    getAttribute: (name) => attrs[name] ?? null,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    getAttributeNames: () => Object.keys(attrs),
    setAttribute: () => {},
    classList: {
      contains: (className) => classNames.includes(className),
    },
  };
}

test('buildHintMap captures selected/current metadata for left-rail navigation links', async () => {
  const currentLink = createMockElement({
    tagName: 'a',
    attrs: {
      'aria-current': 'page',
    },
    textContent: '首页',
  });
  const otherLink = createMockElement({
    tagName: 'a',
    textContent: '草稿箱',
    rect: { left: 80, top: 140, width: 80, height: 20, right: 160, bottom: 160 },
  });
  const elements = [currentLink, otherLink];
  const page = createFakePage({
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
        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
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

  const hints = await buildHintMap(page);

  const homeHint = hints.find((hint) => hint.label === '首页');
  const draftsHint = hints.find((hint) => hint.label === '草稿箱');

  assert.equal(homeHint?.meta?.ariaCurrent, 'page');
  assert.equal(homeHint?.meta?.selected, true);
  assert.equal(draftsHint?.meta?.selected, false);
});

test('buildHintMap treats current-like class tokens as selected metadata', async () => {

  const currentLink = createMockElement({

    tagName: 'a',

    attrs: {

      class: 'weui-desktop-menu__link weui-desktop-menu__link_current',

    },

    textContent: '首页',

  });

  const otherLink = createMockElement({

    tagName: 'a',

    textContent: '草稿箱',

    rect: { left: 80, top: 140, width: 80, height: 20, right: 160, bottom: 160 },

  });

  const elements = [currentLink, otherLink];

  const page = createFakePage({

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

        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1', cursor: 'pointer' }),

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



  const hints = await buildHintMap(page);

  const homeHint = hints.find((hint) => hint.label === '首页');



  assert.equal(homeHint?.meta?.selected, true);

  assert.equal(homeHint?.meta?.ariaCurrent, '');

});



test('buildHintMap captures non-standard clickable elements with tabindex and pointer cursor', async () => {

  const customButton = createMockElement({

    tagName: 'div',

    attrs: {

      tabindex: '0',

      role: '',

      'data-action': 'open-details',

    },

    textContent: '展开详情',

  });

  const elements = [customButton];

  const page = createFakePage({

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

        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1', cursor: 'pointer' }),

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



  const hints = await buildHintMap(page);

  const hint = hints.find((entry) => entry.label === '展开详情');



  assert.ok(hint);

  assert.equal(hint.type, 'div');

});

