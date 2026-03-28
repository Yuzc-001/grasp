function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function getFieldLabel(field) {
  return compactText(
    field?.ariaLabelledByText
      || field?.ariaLabel
      || field?.labelForText
      || field?.placeholder
      || field?.name
      || field?.tag
      || 'unknown'
  );
}

function deriveRiskLevel(label, field) {
  const text = compactText(label).toLowerCase();
  const tag = compactText(field?.tag).toLowerCase();
  const type = compactText(field?.type).toLowerCase();

  if (
    includesAny(text, ['证件', '身份证', '手机号', '电话', '邮箱', '账号', '账户', '密码', '上传', '提交', '确认', '验证码', '姓名'])
    || includesAny(tag, ['file'])
    || includesAny(type, ['file', 'password'])
  ) {
    return 'sensitive';
  }

  if (
    includesAny(text, ['城市', '部门', '日期', '时间', '时长', '天数', '学校', '专业', '学历', '年级', '地区', '岗位', '语言', '接受', '调配'])
    || tag === 'select'
    || type === 'select'
  ) {
    return 'review';
  }

  if (
    includesAny(text, ['研究', '项目', '技能', '经历', '简介', '自我介绍', '主页', 'description', 'bio', 'homepage', 'project', 'research', 'skill'])
    || tag === 'textarea'
    || type === 'textarea'
  ) {
    return 'safe';
  }

  return 'safe';
}

function deriveCurrentState(field) {
  if (field?.current_state) return field.current_state;
  const type = compactText(field?.type).toLowerCase();
  const tag = compactText(field?.tag).toLowerCase();
  const isCheckable = type === 'checkbox' || type === 'radio' || tag === 'checkbox' || tag === 'radio';
  if (field?.checked === true) return 'filled';
  if (field?.checked === false && isCheckable) return 'missing';
  if (isCheckable) return 'missing';
  if (Array.isArray(field?.value)) return field.value.length > 0 ? 'filled' : 'missing';
  if (field?.value === null || field?.value === undefined) return 'missing';
  return compactText(field.value) ? 'filled' : 'missing';
}

export function normalizeFormField(field) {
  const label = compactText(field?.label) || getFieldLabel(field);
  const normalized_label = compactText(label);

  return {
    ...field,
    label,
    normalized_label,
    disabled: field?.disabled === true,
    readOnly: field?.readOnly === true || field?.readonly === true,
    current_state: deriveCurrentState(field),
    risk_level: field?.risk_level ?? deriveRiskLevel(label, field),
  };
}

export function summarizeFormFields(fields) {
  const normalizedFields = fields.map((field) => normalizeFormField(field));
  const counts = normalizedFields.reduce((acc, field) => {
    acc[field.risk_level] += 1;
    return acc;
  }, { safe: 0, review: 0, sensitive: 0 });

  return {
    total: normalizedFields.length,
    safe: counts.safe,
    review: counts.review,
    sensitive: counts.sensitive,
    labels: normalizedFields.map((field) => field.label),
    fields: normalizedFields,
    lines: [
      `Total fields: ${normalizedFields.length}`,
      `Safe: ${counts.safe}`,
      `Review: ${counts.review}`,
      `Sensitive: ${counts.sensitive}`,
      `Labels: ${normalizedFields.map((field) => field.label).join(', ') || 'none'}`,
    ],
  };
}

export function buildFormVerification(fields) {
  const normalizedFields = fields.map((field) => normalizeFormField(field));
  const missingRequired = normalizedFields.filter((field) => field.required && field.current_state !== 'filled').length;
  const riskyPending = normalizedFields.filter((field) => field.risk_level !== 'safe' && field.current_state !== 'filled').length;
  const unresolved = normalizedFields.filter((field) => field.current_state === 'unresolved').length;

  return {
    completion_status: missingRequired > 0 || riskyPending > 0 || unresolved > 0 ? 'review_required' : 'ready',
    summary: {
      missing_required: missingRequired,
      risky_pending: riskyPending,
      unresolved,
    },
    fields: normalizedFields,
  };
}

export function finalizeFormSnapshot({ fields = [], sections = [], submit_controls = [] } = {}) {
  const normalizedFields = fields.map((field) => normalizeFormField(field));
  const summary = summarizeFormFields(normalizedFields);
  const verification = buildFormVerification(normalizedFields);
  const counts = normalizedFields.reduce((acc, field) => {
    acc[field.normalized_label] = (acc[field.normalized_label] ?? 0) + 1;
    return acc;
  }, {});

  return {
    sections,
    fields: normalizedFields,
    submit_controls: submit_controls.map((control) => ({
      ...control,
      label: compactText(control?.label) || 'submit',
      risk_level: control?.risk_level ?? 'sensitive',
    })),
    ambiguous_labels: Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
    summary,
    completion_status: verification.completion_status,
    verification: verification.summary,
  };
}

export async function collectVisibleFormSnapshot(page) {
  const rawSnapshot = await page.evaluate(() => {
    function compactText(value) {
      return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function getHintId(el) {
      return el.getAttribute('data-grasp-id') || null;
    }

    function getLabelForText(el) {
      const id = el.getAttribute('id');
      if (!id) return '';
      const label = document.querySelector(`label[for="${id}"]`);
      return label?.textContent?.trim() ?? '';
    }

    function getAriaLabelledByText(el) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (!labelledBy) return '';
      return labelledBy.trim().split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
    }

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function getSectionName(el) {
      const fieldset = el.closest('fieldset');
      const legend = fieldset?.querySelector('legend');
      const legendText = compactText(legend?.textContent);
      if (legendText) return legendText;

      const group = el.closest('section, form, [role="group"], .form-section, .resume-section');
      const heading = group?.querySelector('h1, h2, h3, h4, h5, h6, .section-title, [data-section-title]');
      const headingText = compactText(heading?.textContent);
      return headingText || 'General';
    }

    function describeField(el) {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : tag);
      return {
        hint_id: getHintId(el),
        tag,
        type,
        id: el.getAttribute('id')?.trim() ?? '',
        name: el.getAttribute('name')?.trim() ?? '',
        required: el.required || el.getAttribute('required') !== null,
        disabled: el.disabled === true,
        readOnly: 'readOnly' in el ? el.readOnly === true : false,
        value: 'value' in el ? el.value : null,
        checked: 'checked' in el ? el.checked : null,
        ariaLabelledByText: getAriaLabelledByText(el),
        ariaLabel: el.getAttribute('aria-label')?.trim() ?? '',
        labelForText: getLabelForText(el),
        placeholder: el.getAttribute('placeholder')?.trim() ?? '',
        section_name: getSectionName(el),
      };
    }

    const fieldElements = [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => {
        const type = el.getAttribute('type') || '';
        return type !== 'hidden' && isVisible(el);
      });

    const fields = fieldElements.map(describeField);
    const sections = [...new Set(fields.map((field) => field.section_name))].map((name) => ({
      name,
      field_labels: fields
        .filter((field) => field.section_name === name)
        .map((field) => compactText(
          field.ariaLabelledByText
            || field.ariaLabel
            || field.labelForText
            || field.placeholder
            || field.name
            || field.tag
            || 'unknown'
        )),
    }));

    const submit_controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"]')]
      .filter((el) => isVisible(el))
      .map((el) => ({
        hint_id: getHintId(el),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || el.tagName.toLowerCase(),
        label: compactText(
          el.getAttribute('aria-label')
            || el.textContent
            || el.getAttribute('value')
            || 'submit'
        ),
        risk_level: 'sensitive',
      }));

    return { fields, sections, submit_controls };
  });

  return finalizeFormSnapshot(rawSnapshot);
}
