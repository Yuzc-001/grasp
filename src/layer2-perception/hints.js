/**
 * Layer 2 - 感知层：hints.js
 * 将当前视口内可交互元素转化为极简语义地图（HintMap）
 */

/**
 * 在浏览器页面中采集可交互元素，构建 HintMap。
 * registry 和 counters 由调用方持有，跨调用复用，保证同一元素 ID 稳定。
 * @param {import('playwright').Page} page
 * @param {Map<string, string>} registry  fingerprint → id 映射表
 * @param {{ B: number, I: number, L: number, S: number }} counters  各前缀已用计数
 * @returns {Promise<Array<{id: string, type: string, label: string, x: number, y: number, meta: Record<string, string> }>>}
 */
export async function buildHintMap(page, registry = new Map(), counters = { B: 0, I: 0, L: 0, S: 0 }) {
  // 将 registry 序列化传入 browser context（Map 不可直接传）
  const registryEntries = [...registry.entries()];

  const result = await page.evaluate(({ registryEntries, counters }) => {
    const reg = new Map(registryEntries);
    const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);

    const INTERACTIVE_ROLES = new Set([

      'button', 'link', 'textbox', 'searchbox', 'combobox',

      'checkbox', 'radio', 'menuitem', 'tab', 'option',

      'slider', 'spinbutton', 'switch',

    ]);



    function hasNonStandardInteractiveSignals(el, style) {

      const hasClickHandler = typeof el.onclick === 'function' || el.getAttribute('onclick');

      const hasTabIndex = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';

      const hasActionData = Array.from(el.getAttributeNames?.() ?? []).some((name) =>

        name.startsWith('data-action') || name.startsWith('data-click') || name.startsWith('data-testid')

      );

      const hasAriaAction = ['aria-expanded', 'aria-haspopup', 'aria-controls', 'aria-pressed'].some((name) => el.hasAttribute(name));

      const pointerCursor = style.cursor === 'pointer';

      return hasClickHandler || hasTabIndex || hasActionData || hasAriaAction || pointerCursor;

    }


    const vw = window.innerWidth;
    const vh = window.innerHeight;

    function getCandidatePriority(el, tag, role, isContentEditable) {
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      if (isContentEditable || role === 'textbox' || role === 'searchbox' || role === 'combobox') return 5;
      if (tag === 'textarea') return 4;
      if (tag === 'input') {
        if (['text', 'search', 'email', 'url', 'password', 'number', 'tel', ''].includes(inputType)) return 4;
        if (['file', 'hidden'].includes(inputType)) return 1;
        return 3;
      }
      if (tag === 'button' || role === 'button') return 2;
      if (tag === 'a' || role === 'link') return 1;
      return 0;
    }

    function isSelected(el) {
      const ariaCurrent = (el.getAttribute('aria-current') || '').toLowerCase();
      const classAttr = String(el.getAttribute('class') || '');
      const hasStateClass = classAttr
        .split(/\s+/)
        .some((token) => /(^|[-_])(selected|current)($|[-_])/i.test(token));
      return el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('data-selected') === 'true'
        || ['page', 'step', 'location', 'date', 'time', 'true'].includes(ariaCurrent)
        || hasStateClass
        || el.classList.contains('selected')
        || el.classList.contains('is-selected')
        || el.classList.contains('workspace-item--selected');
    }

    // 1. 遍历 document.body 下所有元素
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
    );

    const candidates = [];
    let node;
    while ((node = walker.nextNode())) {
      const el = /** @type {HTMLElement} */ (node);
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();

      // 2. 只处理 INTERACTIVE_TAGS 或 INTERACTIVE_ROLES 或 contenteditable 或非标准交互信号
      const isContentEditable = el.getAttribute('contenteditable') === 'true' ||
                                el.getAttribute('contenteditable') === '';

      // 3. 过滤不可见元素
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;

      const style = window.getComputedStyle(el);
      const hasNonStandardSignals = hasNonStandardInteractiveSignals(el, style);
      if (!INTERACTIVE_TAGS.has(tag) && !INTERACTIVE_ROLES.has(role) && !isContentEditable && !hasNonStandardSignals) continue;
      if (
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        style.opacity === '0'
      ) continue;

      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);

      candidates.push({
        el,
        tag,
        role,
        cx,
        cy,
        priority: getCandidatePriority(el, tag, role, isContentEditable),
      });
    }

    // 4. 排序：y 优先，x 其次
    candidates.sort((a, b) => {
      if (a.cy !== b.cy) return a.cy - b.cy;
      if (a.cx !== b.cx) return a.cx - b.cx;
      return b.priority - a.priority;
    });

    // 5. 去重：中心坐标差 < 5px 视为同一交互点，保留更可操作的候选
    const filtered = [];
    for (const c of candidates) {
      const dupIndex = filtered.findIndex((s) => Math.abs(s.cx - c.cx) < 5 && Math.abs(s.cy - c.cy) < 5);
      if (dupIndex === -1) {
        filtered.push(c);
        continue;
      }

      const previous = filtered[dupIndex];
      if (c.priority > previous.priority) {
        filtered[dupIndex] = c;
      }
    }

    // 6. 分配 ID 并构建 Hint 列表

    /**
     * 根据元素信息确定 ID 前缀。
     * button → B, input/textarea/textbox/searchbox/combobox → I, link → L, 其他 → S
     */
    function getPrefix(tag, role, el) {
      if (tag === 'button' || role === 'button') return 'B';
      if (
        tag === 'input' || tag === 'textarea' ||
        role === 'textbox' || role === 'searchbox' || role === 'combobox' ||
        el.getAttribute('contenteditable') === 'true' ||
        el.getAttribute('contenteditable') === ''
      ) return 'I';
      if (tag === 'a' || role === 'link') return 'L';
      return 'S';
    }

    /**
     * 从元素上提取最优 label。
     * 优先级：aria-label > placeholder > title > alt > innerText前40字 > name > id > tagName
     */
    function getLabel(el, tag) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.trim().split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean).join(' ');
        if (text) return text;
      }

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim();

      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();

      const text = (el.innerText || '').trim().slice(0, 40);
      if (text) return text;

      const name = el.getAttribute('name');
      if (name && name.trim()) return name.trim();

      const id = el.getAttribute('id');
      if (id && id.trim()) return id.trim();

      return tag;
    }

    /**
     * 生成元素指纹：tag | label前8字（空格转下划线）| 位置取整到20px格
     * 同一元素在多次扫描中指纹相同，用于稳定 ID 复用。
     */
    function fingerprint(tag, label, cx, cy) {
      const gx = Math.round(cx / 20) * 20;
      const gy = Math.round(cy / 20) * 20;
      const text = label.slice(0, 8).replace(/\s+/g, '_');
      return `${tag}|${text}|${gx}|${gy}`;
    }

    const newEntries = [];  // 本次新分配的 [fp, id] 对，用于更新 Node.js 侧 registry
    const results = [];

    for (const { el, tag, role, cx, cy } of filtered) {
      const isContentEditable = el.getAttribute('contenteditable') === 'true' ||
        el.getAttribute('contenteditable') === '';
      // 8. 构建 label（先于指纹计算）
      const label = getLabel(el, tag);
      const type = isContentEditable && !role ? 'textbox' : (role || tag);
      const prefix = getPrefix(tag, role, el);

      // 9. 查指纹注册表，命中则复用 ID，未命中则分配新 ID
      const fp = fingerprint(tag, label, cx, cy);
      let id = reg.get(fp);
      if (!id) {
        counters[prefix] = (counters[prefix] || 0) + 1;
        id = `${prefix}${counters[prefix]}`;
        reg.set(fp, id);
        newEntries.push([fp, id]);
      }

      // 10. 写入 data-grasp-id
      el.setAttribute('data-grasp-id', id);
      const meta = {
        name: el.getAttribute('name') ?? '',
        idAttr: el.getAttribute('id') ?? '',
        ariaLabel: el.getAttribute('aria-label') ?? '',
        ariaCurrent: el.getAttribute('aria-current') ?? '',
        placeholder: el.getAttribute('placeholder') ?? '',
        contenteditable: isContentEditable,
        selected: isSelected(el),
        role,
        tag,
      };
      results.push({ id, type, label, x: cx, y: cy, meta });
    }

    return { hints: results, newEntries, counters };
  }, { registryEntries, counters: { ...counters } });

  // 将新分配的指纹 → ID 写回 Node.js 侧 registry
  for (const [fp, id] of result.newEntries) {
    registry.set(fp, id);
  }
  // 同步更新计数器
  Object.assign(counters, result.counters);

  return result.hints;
}

const INPUT_LIKE_TYPES = new Set(['input', 'textarea', 'textbox', 'searchbox', 'combobox']);

function isInputLikeHint(hint = {}) {
  const type = String(hint.type ?? '').toLowerCase();
  if (INPUT_LIKE_TYPES.has(type)) return true;
  if (hint.meta?.contenteditable === true || hint.meta?.contenteditable === 'true') return true;
  return false;
}

function normalizeHintLabel(hint = {}) {
  const candidates = [
    hint.label,
    hint.meta?.ariaLabel,
    hint.meta?.placeholder,
    hint.meta?.name,
    hint.meta?.idAttr,
  ];
  return candidates
    .map((value) => String(value ?? '').trim().toLowerCase())
    .find(Boolean) ?? '';
}

export function rebindHintCandidate(previous, nextHints) {
  if (!previous) return null;
  const candidates = nextHints.filter(
    (hint) => {
      const sameType = hint.type === previous.type;
      const sameInputFamily = isInputLikeHint(previous) && isInputLikeHint(hint);
      if (!sameType && !sameInputFamily) return false;
      return normalizeHintLabel(hint) === normalizeHintLabel(previous);
    }
  );
  if (candidates.length === 0) return null;

  const distance = (hint) =>
    Math.abs(hint.x - previous.x) + Math.abs(hint.y - previous.y);

  return candidates.reduce((best, current) => {
    if (!best) return current;
    const bestDistance = distance(best);
    const currentDistance = distance(current);
    return currentDistance < bestDistance ? current : best;
  }, null);
}
