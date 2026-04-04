import { WORKSPACE_SIGNAL_DICTIONARY, containsAnySignal, signalMatchCount } from '../../server/page-signals.js';




export function createPageGraspState() {

  return {
    lastUrl: null,
    domRevision: 0,
    lastSnapshotHash: null,
    pageIdentity: null,
    currentRole: 'unknown', // unknown | content | form | auth | docs | search | workspace | navigation-heavy | checkpoint
    workspaceSurface: null, // null | list | detail | thread | composer | loading_shell
    workspaceSignals: [],
    graspConfidence: 'unknown', // unknown | low | medium | high
    reacquired: false,
    riskGateDetected: false,
    checkpointSignals: [],
    checkpointKind: null,
    suggestedNextAction: null,
  };
}

function detectCheckpointSignals({ url, title = '', bodyText = '', headings = [], nodes = 0 }) {
  const text = bodyText.toLowerCase();
  const titleText = String(title).toLowerCase();
  const headingText = headings.join(' ').toLowerCase();
  const signals = [];
  const solvedCloudflareChallenge = text.includes('you bypassed the cloudflare challenge');

  if (titleText.includes('just a moment') || text.includes('just a moment')) {
    signals.push('title_or_text_just_a_moment');
  }
  if (text.includes('checking your browser')) signals.push('checking_your_browser');
  if (text.includes('verify you are human')) signals.push('verify_you_are_human');
  if (text.includes('security check')) signals.push('security_check');
  if (!solvedCloudflareChallenge && (text.includes('cf-challenge') || text.includes('cloudflare'))) signals.push('cloudflare_challenge');
  if (headingText.includes('just a moment')) signals.push('heading_just_a_moment');
  if (nodes <= 0 && text.length <= 24) signals.push('low_interaction_sparse_page');

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const search = parsed.search.toLowerCase();
    const fullUrl = parsed.toString().toLowerCase();

    if (search.includes('__cf_chl') || fullUrl.includes('cf_chl')) {
      signals.push('cloudflare_challenge_url');
    }

    if ((host.includes('chatgpt.com') || host.includes('openai.com')) && signals.length > 0) {
      signals.push('high_risk_target_with_gate_signals');
    }
  } catch {}

  return [...new Set(signals)];
}

function classifyCheckpointKind(signals = []) {
  if (signals.includes('cloudflare_challenge') || signals.includes('cloudflare_challenge_url') || signals.includes('checking_your_browser')) {
    return 'challenge';
  }
  if (signals.includes('title_or_text_just_a_moment')) {
    return 'waiting_room';
  }
  if (signals.includes('security_check') || signals.includes('verify_you_are_human')) {
    return 'verification';
  }
  if (signals.length > 0) {
    return 'unknown';
  }
  return null;
}

function classifySuggestedNextAction({ riskGateDetected, checkpointKind, nodes = 0 }) {
  if (!riskGateDetected) return null;
  if (checkpointKind === 'waiting_room' && nodes <= 0) return 'wait_then_recheck';
  return 'handoff_required';
}

function getUrlPath(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function getUrlHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getUrlPathSegments(url) {
  return getUrlPath(url).split('/').filter(Boolean);
}

function hasWorkspacePathEvidence(url) {
  const segments = getUrlPathSegments(url);
  const workspaceSegments = ['chat', 'thread', 'conversation', 'inbox', 'message', 'messages', 'msg'];
  return segments.some((segment) => workspaceSegments.includes(segment));
}

function detectWorkspaceSignals({ url, title = '', bodyText = '', headings = [], navs = 0 }) {

  const text = bodyText.toLowerCase();

  const signals = [];



  if (hasWorkspacePathEvidence(url)) {

    signals.push('workspace_path');

  }

  if (containsAnySignal(text, WORKSPACE_SIGNAL_DICTIONARY.composerPrompts)) {

    signals.push('workspace_composer_text');

  }

  if (containsAnySignal(text, WORKSPACE_SIGNAL_DICTIONARY.threadContext)) {

    signals.push('workspace_thread_text');

  }

  if (navs >= 6) {

    signals.push('workspace_navigation');

  }



  return [...new Set(signals)];

}



function scoreWorkspaceSurface({ url, bodyText = '' }) {

  const text = bodyText.toLowerCase();
  const composerMatches = signalMatchCount(text, WORKSPACE_SIGNAL_DICTIONARY.composerPrompts);
  const threadMatches = signalMatchCount(text, WORKSPACE_SIGNAL_DICTIONARY.threadContext);

  let threadScore = hasWorkspacePathEvidence(url) ? 2 : 0;
  let composerScore = composerMatches * 2;
  let loadingScore = 0;

  threadScore += threadMatches;

  if (containsAnySignal(text, WORKSPACE_SIGNAL_DICTIONARY.loadingShell)) {
    loadingScore += 2;
  }

  return { threadScore, composerScore, loadingScore };

}


function classifyWorkspaceSurface(scores = {}) {
  const { threadScore = 0, composerScore = 0, loadingScore = 0 } = scores;

  if (loadingScore > 0) {
    return 'loading_shell';
  }
  if (composerScore >= 3 && composerScore > threadScore) {
    return 'composer';
  }
  if (threadScore >= 2) {
    return 'thread';
  }
  return null;
}

function classifyWorkspaceRole({ url, bodyText = '', headings = [] }) {
  if (!hasWorkspacePathEvidence(url)) {
    return null;
  }
  const scores = scoreWorkspaceSurface({ url, bodyText, headings });
  return Math.max(scores.threadScore, scores.composerScore) >= 2 ? scores : null;
}

function isWeChatPublicPlatformLanding({ url, title = '', bodyText = '', headings = [], forms = 0 }) {
  if (getUrlHostname(url) !== 'mp.weixin.qq.com') return false;
  if (getUrlPath(url) !== '/') return false;
  if (forms <= 0) return false;

  const text = bodyText.toLowerCase();
  const titleText = String(title).toLowerCase();
  const headingText = headings.join(' ').toLowerCase();
  const signals = [
    text.includes('微信扫一扫'),
    text.includes('使用账号登录') || text.includes('账号登录'),
    text.includes('立即注册'),
    text.includes('服务号') || text.includes('公众号') || text.includes('小程序'),
  ];

  return (titleText.includes('微信公众平台') || headingText.includes('微信公众平台'))
    && signals.filter(Boolean).length >= 2;
}

function classifyPageRole({ url, title = '', bodyText = '', nodes = 0, forms = 0, navs = 0, headings = [] }) {
  const text = bodyText.toLowerCase();
  const path = getUrlPath(url);
  const titleText = String(title).toLowerCase();

  const searchHints = ['search results', 'no results', 'filter results'];
  const formHints = ['submit', 'required'];
  const headingText = headings.join(' ').toLowerCase();
  const checkpointSignals = detectCheckpointSignals({ url, title, bodyText, headings, nodes });
  const workspaceScores = classifyWorkspaceRole({ url, bodyText, headings });

  if (checkpointSignals.length > 0) {
    return 'checkpoint';
  }

  if (workspaceScores) {
    return 'workspace';
  }

  if (isWeChatPublicPlatformLanding({ url, title, bodyText, headings, forms })) {
    return 'content';
  }

  const authHeadingPresent = ['sign in', 'log in', 'login'].some((hint) => titleText.includes(hint) || headingText.includes(hint));
  const credentialCopyPresent = text.includes('password')
    && ['username', 'email', 'email address', 'phone'].some((hint) => text.includes(hint));
  const dominantAuthSurface = authHeadingPresent && (credentialCopyPresent || forms >= 1);
  if (credentialCopyPresent || dominantAuthSurface || /\/login\b|\/signin\b|\/sign-in\b/.test(path)) {
    return 'auth';
  }

  const docsByPath = /\/docs\b|\/guide\b|\/reference\b|\/manual\b/.test(path);
  const docsByHeadings = /installation|getting started|api reference|documentation/.test(headingText);
  const docsByLayout = text.includes('on this page') || text.includes("what's next");
  if (docsByPath || docsByHeadings || docsByLayout) {
    return 'docs';
  }

  if (searchHints.some((hint) => text.includes(hint))) {
    return 'search';
  }
  const hasFormText = formHints.some((hint) => text.includes(hint));
  const hasStrongFormSignals = forms >= 1 && hasFormText;
  const hasDenseStandaloneForm = forms >= 3 && navs < 6 && nodes <= 120;
  if (hasStrongFormSignals || hasDenseStandaloneForm) {
    return 'form';
  }
  if (navs >= 6) {
    return 'navigation-heavy';
  }
  return 'content';
}

function classifyConfidence({ nodes = 0, bodyText = '', urlChanged, domRevisionChanged }) {
  if (!bodyText) return 'low';
  if (nodes <= 0) return 'low';
  if (urlChanged || domRevisionChanged) return 'medium';
  if (nodes >= 1 && bodyText.length >= 40) return 'high';
  return 'medium';
}

export function applySnapshotToPageGraspState(
  state,
  { url, snapshotHash, title = '', bodyText = '', nodes = 0, forms = 0, navs = 0, headings = [] }
) {
  const next = {
    ...state,
    lastUrl: url,
    lastSnapshotHash: snapshotHash,
  };

  const sameUrl = state.lastUrl === url;
  const urlChanged = !sameUrl;
  const domRevisionChanged = !!(sameUrl && state.lastSnapshotHash && state.lastSnapshotHash !== snapshotHash);

  if (!sameUrl) {
    next.domRevision = 0;
  } else if (domRevisionChanged) {
    next.domRevision = state.domRevision + 1;
  } else {
    next.domRevision = state.domRevision;
  }

  next.reacquired = urlChanged || domRevisionChanged;
  next.pageIdentity = `${url}#${next.domRevision}`;
  next.checkpointSignals = detectCheckpointSignals({ url, title, bodyText, headings, nodes });
  next.riskGateDetected = next.checkpointSignals.length > 0;
  next.checkpointKind = classifyCheckpointKind(next.checkpointSignals);
  next.suggestedNextAction = classifySuggestedNextAction({
    riskGateDetected: next.riskGateDetected,
    checkpointKind: next.checkpointKind,
    nodes,
  });
  next.workspaceSignals = detectWorkspaceSignals({ url, title, bodyText, headings, navs });
  next.currentRole = classifyPageRole({ url, title, bodyText, nodes, forms, navs, headings });
  next.workspaceSurface = next.currentRole === 'workspace'
    ? classifyWorkspaceSurface(scoreWorkspaceSurface({ url, bodyText }))
    : next.currentRole === 'navigation-heavy'
      ? 'list'
      : null;
  next.graspConfidence = classifyConfidence({ bodyText, nodes, urlChanged, domRevisionChanged });

  return next;
}
