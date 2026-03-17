function normalizeText(value) {
  if (Array.isArray(value)) {
    return value.filter((line) => line !== undefined && line !== null && line !== '').join('\n');
  }

  return String(value ?? '');
}

export function textResponse(value) {
  return {
    content: [
      {
        type: 'text',
        text: normalizeText(value),
      },
    ],
  };
}

export function errorResponse(value) {
  return {
    ...textResponse(value),
    isError: true,
  };
}

export function imageResponse(data, mimeType = 'image/png') {
  return {
    content: [
      {
        type: 'image',
        data,
        mimeType,
      },
    ],
  };
}
