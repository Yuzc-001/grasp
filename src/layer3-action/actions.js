// Layer 3 - Action Layer
// All browser operations use real CDP mouse/keyboard events (not JS events)
// to bypass anti-bot detection.

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
 * Scroll the page up or down by a given amount using real CDP wheel events.
 * @param {import('playwright').Page} page
 * @param {'up'|'down'} direction
 * @param {number} [amount=600]
 */
export async function scroll(page, direction, amount = 600) {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Invalid scroll direction: "${direction}". Expected "up" or "down".`);
  }
  if (amount === 0) return;
  const delta = direction === 'down' ? amount : -amount;

  // 分多步发送真实 wheel 事件，模拟人类滚轮节奏
  const steps = 5;
  const stepDelta = delta / steps;

  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepDelta);
    // 步骤间随机间隔 20~60ms
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
  }

  // 等待两帧渲染稳定
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * Locate an element by hint ID.
 * If the element is not in the viewport, naturally scrolls to bring it into view.
 * @param {import('playwright').Page} page
 * @param {string} hintId
 * @returns {Promise<{ info: { tag: string, label: string }, el: import('playwright').ElementHandle }>}
 */
async function locateElement(page, hintId) {
  // 检查元素是否存在以及是否在视口内
  const viewportCheck = await page.evaluate((id) => {
    const el = document.querySelector(`[data-grasp-id="${id}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // 使用元素中心点判断是否在视口内，与下方滚动公式保持语义一致
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
  }, hintId);

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

  const el = await page.$(`[data-grasp-id="${hintId}"]`);
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
export async function clickByHintId(page, hintId) {
  const { info, el } = await locateElement(page, hintId);

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
export async function typeByHintId(page, hintId, text, pressEnter = false) {
  const { el } = await locateElement(page, hintId);

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
    (sel, cond, ms) => {
      return new Promise((resolve) => {
        let settled = false;

        function done(result) {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          resolve(result);
        }

        // Immediate check before setting up observer
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
            // For 'changes', we need a baseline; initial check just records state
            if (el) {
              initialText = el.innerText?.trim();
            }
          }
          return false;
        }

        let initialText;

        // Run immediate check
        const immediatelyMet = check();
        if (immediatelyMet) return;

        // Timeout handler
        const timer = setTimeout(() => {
          done({ timeout: true });
        }, ms);

        // MutationObserver callback
        const observer = new MutationObserver(() => {
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
    selector,
    condition,
    timeout
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
export async function hoverByHintId(page, hintId) {
  const { info, el } = await locateElement(page, hintId);
  await el.hover();
  // Allow hover-triggered animations/menus to settle
  await new Promise((r) => setTimeout(r, 200));
  return info;
}
