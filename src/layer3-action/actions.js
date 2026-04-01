// Layer 3 - Action Layer
// Pointer and keyboard interactions use real CDP mouse/keyboard events to
// minimize anti-bot fingerprints. Targeted nested-container scrolling is the
// one deliberate exception: it may use DOM scrollBy for precision when wheel
// routing to a specific overflow container is unreliable.

/**
 * Find the nearest scrollable ancestor of an element via browser-side evaluation.
 * Returns a unique CSS selector for the scrollable container, or null if none found.
 */
export async function findScrollableAncestor(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;

    let current = el;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isNativeScrollable = current.tagName === 'TEXTAREA' ||
        (current.tagName === 'DIV' && current.contentEditable === 'true');
      const isCSSScrollable =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' ||
        overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
      const hasOverflow = current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth;

      if ((isNativeScrollable || isCSSScrollable) && hasOverflow) {
        if (current.id) return `#${CSS.escape(current.id)}`;
        const graspId = current.getAttribute('data-grasp-id');
        if (graspId) return `[data-grasp-id="${graspId}"]`;
        const classes = [...current.classList].map((cls) => `.${CSS.escape(cls)}`).join('');
        if (classes) {
          const candidateSelector = `${current.tagName.toLowerCase()}${classes}`;
          const matches = document.querySelectorAll(candidateSelector);
          if (matches.length === 1 && matches[0] === current) {
            return candidateSelector;
          }
        }
      }

      current = current.parentElement;
    }

    return null;
  }, selector);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 在元素 boundingBox 内生成随机点击坐标（避免总在正中心）。
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @returns {{ x: number, y: number }}
 */
function randomPointInBox(box) {
  // 极小元素（宽或高 < 10px）直接取中心，避免 margin 使可用区域退化为零
  if (box.width < 10 || box.height < 10) {
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }
  const margin = 0.2;
  const x = box.x + box.width * (margin + Math.random() * (1 - 2 * margin));
  const y = box.y + box.height * (margin + Math.random() * (1 - 2 * margin));
  return { x: Math.round(x), y: Math.round(y) };
}

// 记录每个 page 是否已初始化鼠标位置，避免 session 首次点击从 (0,0) 出发
const _warmedUpPages = new WeakSet();

async function warmupMouseIfNeeded(page) {
  if (_warmedUpPages.has(page)) return;
  _warmedUpPages.add(page);
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  // 随机初始位置：水平 30%~70%，垂直 30%~70%，模拟真人屏幕中央区域习惯
  const x = Math.round(vp.w * (0.3 + Math.random() * 0.4));
  const y = Math.round(vp.h * (0.3 + Math.random() * 0.4));
  await page.mouse.move(x, y);
}

/**
 * Scroll the page or container by a given amount.
 * Page scrolling uses real CDP wheel events; targeted container scrolling uses
 * DOM scrollBy to avoid sending wheel input to the wrong overflow region.
 * @param {import('playwright').Page} page
 * @param {'up'|'down'|'left'|'right'} direction
 * @param {number} [amount=600]
 */
export async function scroll(page, direction, amount = 600, options = {}) {
  const validDirections = ['up', 'down', 'left', 'right'];
  if (!validDirections.includes(direction)) {
    throw new Error(`Invalid scroll direction: "${direction}". Expected one of: ${validDirections.join(', ')}.`);
  }
  if (amount === 0) return;

  const isVertical = direction === 'up' || direction === 'down';
  const delta = (direction === 'down' || direction === 'right') ? amount : -amount;
  const dx = isVertical ? 0 : delta;
  const dy = isVertical ? delta : 0;

  if (options.selector) {
    const scrolled = await page.evaluate(({ selector, dx: scrollX, dy: scrollY }) => {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, reason: 'not_found' };
      el.scrollBy(scrollX, scrollY);
      return { ok: true, tag: el.tagName.toLowerCase() };
    }, { selector: options.selector, dx, dy });

    if (!scrolled.ok) {
      throw new Error(`Scroll target not found: "${options.selector}".`);
    }

    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return;
  }

  const steps = 5;
  const stepDx = dx / steps;
  const stepDy = dy / steps;

  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(stepDx, stepDy);
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
  }

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * Locate an element by hint ID.
 * If the element is not in the viewport, naturally scrolls to bring it into view.
 * @param {import('playwright').Page} page
 * @param {string} hintId
 * @returns {Promise<{ info: { tag: string, label: string }, el: import('playwright').ElementHandle }>}
 */
async function locateElement(page, hintId, options = {}) {
  // 检查元素是否存在以及是否在视口内
  const defaultEvaluateHint = (id) => page.evaluate((targetId) => {
    const el = document.querySelector(`[data-grasp-id="${targetId}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const inView = (
      centerX >= 0 && centerX <= window.innerWidth &&
      centerY >= 0 && centerY <= window.innerHeight
    );
    return {
      inView,
      centerY,
      tag: el.tagName.toLowerCase(),
      label:
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.innerText?.trim() ||
        '',
    };
  }, id);

  const evaluateHint = options.evaluateHint ?? defaultEvaluateHint;
  const fetchHandle = async (id) => page.$(`[data-grasp-id="${id}"]`);
  const ensureActionableHandle = async (id, currentInfo) => {
    let handle = await fetchHandle(id);
    let box = handle && typeof handle.boundingBox === 'function'
      ? await handle.boundingBox()
      : null;

    const actionable = !!(box && box.width > 0 && box.height > 0);
    if (actionable || typeof options.rebuildHints !== 'function') {
      return { handle, reboundId: id, reboundInfo: currentInfo };
    }

    const rebound = await options.rebuildHints(id);
    if (!rebound?.id || rebound.id === id) {
      return { handle, reboundId: id, reboundInfo: currentInfo };
    }

    const reboundInfo = await evaluateHint(rebound.id);
    const reboundHandle = await fetchHandle(rebound.id);
    return { handle: reboundHandle, reboundId: rebound.id, reboundInfo };
  };

  let viewportCheck = await evaluateHint(hintId);
  if (viewportCheck === null && typeof options.rebuildHints === 'function') {
    const rebound = await options.rebuildHints(hintId);
    if (rebound?.id) {
      hintId = rebound.id;
    }
    viewportCheck = await evaluateHint(hintId);
  }

  if (viewportCheck === null) {
    throw new Error(`No element with hint ID "${hintId}". Call get_hint_map first.`);
  }

  // 如果不在视口内，用真实滚动将其带入视野
  if (!viewportCheck.inView) {
    const vh = await page.evaluate(() => window.innerHeight);
    const scrollNeeded = viewportCheck.centerY - vh / 2;
    const direction = scrollNeeded > 0 ? 'down' : 'up';
    const amount = Math.abs(scrollNeeded);
    await scroll(page, direction, amount);
    // 等待滚动动画完成
    await new Promise((r) => setTimeout(r, 300));
  }

  const actionable = await ensureActionableHandle(hintId, viewportCheck);
  hintId = actionable.reboundId;
  viewportCheck = actionable.reboundInfo ?? viewportCheck;
  const el = actionable.handle;
  if (el === null) {
    throw new Error(`Element "${hintId}" disappeared after scrolling.`);
  }

  return {
    info: { tag: viewportCheck.tag, label: viewportCheck.label },
    el,
  };
}

/**
 * Click an element identified by its hint ID.
 * Moves the mouse naturally to the element before clicking.
 * @param {import('playwright').Page} page
 * @param {string} hintId
 * @returns {Promise<{ tag: string, label: string }>}
 */
export async function clickByHintId(page, hintId, options = {}) {
  const { info, el } = await locateElement(page, hintId, options);

  // 获取元素真实坐标
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element "${hintId}" (<${info.tag}> "${info.label}") has no bounding box (may be hidden).`);

  // 在元素内随机取一个点
  const target = randomPointInBox(box);

  // 先把鼠标从当前位置移动过来（分 15 步，模拟自然移动轨迹）
  await warmupMouseIfNeeded(page);
  await page.mouse.move(target.x, target.y, { steps: 15 });

  // 按下 + 随机持续时间 + 抬起，模拟人类按键
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, randomInt(40, 120)));
  await page.mouse.up();

  // 等待页面响应（networkidle 或超时）
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  return info;
}

/**
 * Type text into an element identified by its hint ID.
 * @param {import('playwright').Page} page
 * @param {string} hintId
 * @param {string} text
 * @param {boolean} [pressEnter=false]
 */
export async function typeByHintId(page, hintId, text, pressEnter = false, options = {}) {
  const { el } = await locateElement(page, hintId, options);

  // 三连击全选：优先用真实鼠标坐标事件，兼容 React 受控输入
  const box = await el.boundingBox();
  if (box) {
    const target = randomPointInBox(box);
    await warmupMouseIfNeeded(page);
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await page.mouse.click(target.x, target.y, { clickCount: 3 });
  } else {
    // 极少数情况元素无坐标，回退到 Playwright 高层 API
    await el.click({ clickCount: 3 });
  }

  // 清除已选中文本
  await page.keyboard.press('Backspace');

  // Step 4: type character by character with random human-like delay
  await el.type(text, { delay: randomInt(30, 80) });

  // Step 5: optionally press Enter
  if (pressEnter) {
    await page.keyboard.press('Enter');
  }
}

/**
 * Watch a DOM element for a specific condition using MutationObserver.
 * @param {import('playwright').Page} page
 * @param {string} selector - CSS selector to watch
 * @param {'appears'|'disappears'|'changes'} [condition='appears']
 * @param {number} [timeout=30000]
 * @returns {Promise<{ met?: true, text?: string, timeout?: true }>}
 */
export async function watchElement(page, selector, condition = 'appears', timeout = 30000) {
  return page.evaluate(
    ({ selector: sel, condition: cond, timeout: ms }) => {
      return new Promise((resolve) => {
        let settled = false;
        let observer;
        let timer;
        let initialText;

        function done(result) {
          if (settled) return;
          settled = true;
          observer?.disconnect();
          clearTimeout(timer);
          resolve(result);
        }

        function check() {
          const el = document.querySelector(sel);
          if (cond === 'appears') {
            if (el) {
              done({ met: true, text: el.innerText?.trim() });
              return true;
            }
          } else if (cond === 'disappears') {
            if (!el) {
              done({ met: true });
              return true;
            }
          } else if (cond === 'changes') {
            if (el) {
              initialText = el.innerText?.trim();
            }
          }
          return false;
        }

        const immediatelyMet = check();
        if (immediatelyMet) return;

        timer = setTimeout(() => {
          done({ timeout: true });
        }, ms);

        observer = new MutationObserver(() => {
          const el = document.querySelector(sel);
          if (cond === 'appears') {
            if (el) {
              done({ met: true, text: el.innerText?.trim() });
            }
          } else if (cond === 'disappears') {
            if (!el) {
              done({ met: true });
            }
          } else if (cond === 'changes') {
            if (el) {
              const current = el.innerText?.trim();
              if (current !== initialText) {
                done({ met: true, text: current });
              }
            }
          }
        });

        const target = document.querySelector(sel);
        if (target) {
          observer.observe(target, { childList: true, subtree: true, characterData: true });
        } else {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      });
    },
    { selector, condition, timeout }
  );
}

/**
 * Press a keyboard key or shortcut (e.g. 'Enter', 'Escape', 'Control+Enter').
 * @param {import('playwright').Page} page
 * @param {string} key
 */
export async function pressKey(page, key) {
  await page.keyboard.press(key);
}

/**
 * Hover over an element by its Hint Map ID to trigger dropdowns or tooltips.
 * @param {import('playwright').Page} page
 * @param {string} hintId
 */
export async function hoverByHintId(page, hintId, options = {}) {
  const { info, el } = await locateElement(page, hintId, options);
  await el.hover();
  // Allow hover-triggered animations/menus to settle
  await new Promise((r) => setTimeout(r, 200));
  return info;
}

export { locateElement };
