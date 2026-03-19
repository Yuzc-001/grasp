const SEARCH_KEYWORDS = /search|搜索|提问|ask|query/i;
const INPUT_TYPES = new Set(['searchbox', 'textbox', 'combobox', 'input', 'textarea']);

function isInputLikeHint(hint = {}) {
  if (INPUT_TYPES.has(hint.type)) return true;
  if (hint.meta?.contenteditable === true || hint.meta?.contenteditable === 'true') return true;
  if (hint.meta?.tag === 'input' || hint.meta?.tag === 'textarea') return true;
  return false;
}

function gatherHintText(hint) {
  return [
    hint.label,
    hint.meta?.name,
    hint.meta?.ariaLabel,
    hint.meta?.placeholder,
  ]
    .filter(Boolean)
    .join(' ');
}

function scoreSearchInput(hint) {
  if (!isInputLikeHint(hint)) return 0;
  let score = 0;
  if (isInputLikeHint(hint)) score += 5;
  if (SEARCH_KEYWORDS.test(hint.label ?? '')) score += 5;
  if (SEARCH_KEYWORDS.test(gatherHintText(hint))) score += 3;
  return score;
}

export function rankAffordances(snapshot = {}) {
  const hints = (snapshot.hints ?? []).map((hint) => ({ ...hint }));
  const scored = hints.map((hint) => ({ ...hint, score: scoreSearchInput(hint) }));

  const search_input = scored
    .filter((hint) => hint.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.label ?? '').localeCompare(b.label ?? '');
    });

  const command_button = scored
    .filter((hint) => hint.type === 'button')
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));

  return { search_input, command_button };
}
