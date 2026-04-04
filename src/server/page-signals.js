export const WORKSPACE_SIGNAL_DICTIONARY = {
  composerPrompts: [
    '按enter键发送',
    '发送消息',
    '发消息',
    '输入消息',
    'reply',
    'type a message',
    'write a message',
    'send a message',
    'write a reply',
    'type your reply',
  ],
  threadContext: [
    '消息',
    '聊天',
    '对话',
    'message',
    'messages',
    'chat',
    'conversation',
  ],
  loadingShell: [
    '加载中，请稍候',
    '加载中',
    '请稍候',
    '正在加载',
    'loading',
    'please wait',
  ],
  delivered: [
    '已发送',
    '发送成功',
    'delivered',
    'sent',
  ],
  sendActionLabels: [
    '发送',
    'send',
    '回复',
    '提交',
  ],
};

export function containsAnySignal(text, signals = []) {
  const haystack = String(text ?? '').toLowerCase();
  return signals.some((signal) => haystack.includes(String(signal).toLowerCase()));
}

export function countMatchingSignals(text, signals = []) {
  const haystack = String(text ?? '').toLowerCase();
  return signals.reduce((count, signal) => (
    haystack.includes(String(signal).toLowerCase()) ? count + 1 : count
  ), 0);
}

export function signalMatchCount(text, signals = []) {
  return countMatchingSignals(text, signals);
}
