async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isExecutionContextTransient(error) {
  const message = error?.message ?? '';
  return message.includes('Execution context was destroyed') || message.includes('Cannot find context with specified id');
}

export async function capturePageSnapshot(page, { attempts = 3, delayMs = 120 } = {}) {
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await page.evaluate(() => {
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 1200) ?? '';
        const nodes = document.querySelectorAll('button,a,input,textarea,select,[role],[contenteditable]').length;
        const forms = document.querySelectorAll('form,input,textarea,select').length;
        const navs = document.querySelectorAll('nav,header,[role="navigation"],aside a').length;
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 8);
        const title = document.title || null;
        const visibilityFingerprint = Array.from(document.querySelectorAll('body *'))
          .slice(0, 120)
          .map((el) => {
            const style = window.getComputedStyle(el);
            const id = el.getAttribute('id') || el.getAttribute('data-grasp-id') || el.tagName;
            return `${id}:${style.display}:${style.visibility}:${style.opacity}`;
          })
          .join('|');
        const styleFingerprint = visibilityFingerprint;
        return { bodyText, nodes, forms, navs, headings, title, styleFingerprint };
      });
    } catch (error) {
      lastError = error;
      if (!isExecutionContextTransient(error) || i === attempts - 1) {
        throw error;
      }
      await sleep(delayMs * (i + 1));
    }
  }

  throw lastError;
}
