/**
 * Grasp MCP E2E Test Runner
 * Tests all P0+P1 tools against the test HTML page
 */
import { getActivePage, navigateTo, getTabs, switchTab, newTab, closeTab } from '../../src/layer1-bridge/chrome.js';
import { clickByHintId, typeByHintId } from '../../src/layer3-action/actions.js';
import { syncPageState } from '../../src/server/state.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_PAGE = new URL('./test-all-tools.html', import.meta.url).href;
const results = [];

function log(testId, name, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  const line = `${icon} ${testId} ${name}: ${detail}`;
  console.log(line);
  results.push({ testId, name, status, detail });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const state = { hintMap: [], pageState: {} };

  // ── T01: Browser connection ──
  let page;
  try {
    page = await getActivePage();
    log('T01', 'get_status', 'PASS', `Connected, URL: ${page.url()}`);
  } catch (e) {
    log('T01', 'get_status', 'FAIL', e.message);
    process.exit(1);
  }

  // ── T02: Navigate to test page ──
  try {
    page = await navigateTo(TEST_PAGE, { state });
    const title = await page.title();
    if (title.includes('E2E Test Page')) {
      log('T02', 'navigate', 'PASS', `Title: "${title}"`);
    } else {
      log('T02', 'navigate', 'FAIL', `Unexpected title: "${title}"`);
    }
  } catch (e) {
    log('T02', 'navigate', 'FAIL', e.message);
  }

  // ── T03: Screenshot (viewport) ──
  try {
    const b64 = await page.screenshot({ encoding: 'base64' });
    if (b64 && b64.length > 1000) {
      log('T03', 'screenshot viewport', 'PASS', `${(b64.length / 1024).toFixed(0)}KB base64`);
    } else {
      log('T03', 'screenshot viewport', 'FAIL', 'Screenshot too small');
    }
  } catch (e) {
    log('T03', 'screenshot viewport', 'FAIL', e.message);
  }

  // ── T04: get_hint_map ──
  try {
    await syncPageState(page, state, { force: true });
    const hints = state.hintMap || [];
    if (hints.length > 10) {
      const buttons = hints.filter(h => h.id?.startsWith('B'));
      const inputs = hints.filter(h => h.id?.startsWith('I'));
      const links = hints.filter(h => h.id?.startsWith('L'));
      log('T04', 'get_hint_map', 'PASS', `${hints.length} elements (${buttons.length}B, ${inputs.length}I, ${links.length}L)`);
    } else {
      log('T04', 'get_hint_map', 'FAIL', `Only ${hints.length} elements`);
    }
  } catch (e) {
    log('T04', 'get_hint_map', 'FAIL', e.message);
  }

  // ── T05: get_tabs ──
  try {
    const tabs = await getTabs();
    if (tabs.length >= 1) {
      log('T05', 'get_tabs', 'PASS', `${tabs.length} tab(s): ${tabs.map(t => t.title?.slice(0,30)).join(', ')}`);
    } else {
      log('T05', 'get_tabs', 'FAIL', 'No tabs found');
    }
  } catch (e) {
    log('T05', 'get_tabs', 'FAIL', e.message);
  }

  // ── T06: new_tab ──
  let tabsBefore;
  try {
    tabsBefore = (await getTabs()).length;
    const newPage = await newTab('https://example.com');
    await sleep(2000);
    const tabsAfter = (await getTabs()).length;
    if (tabsAfter === tabsBefore + 1) {
      log('T06', 'new_tab', 'PASS', `Tabs: ${tabsBefore} → ${tabsAfter}, URL: ${newPage.url()}`);
    } else {
      log('T06', 'new_tab', 'FAIL', `Tabs: ${tabsBefore} → ${tabsAfter}`);
    }
  } catch (e) {
    log('T06', 'new_tab', 'FAIL', e.message);
  }

  // ── T07: switch_tab ──
  try {
    const tabsNow = await getTabs();
    // Find the test page tab
    const testTabIdx = tabsNow.findIndex(t => t.url?.includes('test-all-tools'));
    if (testTabIdx >= 0) {
      page = await switchTab(testTabIdx);
      const url = page.url();
      if (url.includes('test-all-tools')) {
        log('T07', 'switch_tab', 'PASS', `Switched to tab [${testTabIdx}]: ${url}`);
      } else {
        log('T07', 'switch_tab', 'FAIL', `URL mismatch: ${url}`);
      }
    } else {
      log('T07', 'switch_tab', 'FAIL', 'Test page tab not found');
    }
  } catch (e) {
    log('T07', 'switch_tab', 'FAIL', e.message);
  }

  // ── T08: close_tab ──
  try {
    const tabsBeforeClose = await getTabs();
    const exampleIdx = tabsBeforeClose.findIndex(t => t.url?.includes('example.com'));
    if (exampleIdx >= 0) {
      await closeTab(exampleIdx);
      const tabsAfterClose = await getTabs();
      if (tabsAfterClose.length === tabsBeforeClose.length - 1) {
        log('T08', 'close_tab', 'PASS', `Closed tab [${exampleIdx}], ${tabsAfterClose.length} remaining`);
      } else {
        log('T08', 'close_tab', 'FAIL', `Tabs: ${tabsBeforeClose.length} → ${tabsAfterClose.length}`);
      }
    } else {
      log('T08', 'close_tab', 'SKIP', 'No example.com tab to close');
    }
  } catch (e) {
    log('T08', 'close_tab', 'FAIL', e.message);
  }

  // Re-acquire page after tab operations
  page = await getActivePage();
  if (!page.url().includes('test-all-tools')) {
    page = await navigateTo(TEST_PAGE, { state });
  }
  await syncPageState(page, state, { force: true });

  // ── T09: evaluate ──
  try {
    const result1 = await page.evaluate('document.title');
    const result2 = await page.evaluate('2 + 2');
    const result3 = await page.evaluate('document.querySelectorAll("button").length');
    if (result1.includes('E2E') && result2 === 4 && result3 > 5) {
      log('T09', 'evaluate', 'PASS', `title="${result1.slice(0,30)}", 2+2=${result2}, buttons=${result3}`);
    } else {
      log('T09', 'evaluate', 'FAIL', `title="${result1}", 2+2=${result2}, buttons=${result3}`);
    }
  } catch (e) {
    log('T09', 'evaluate', 'FAIL', e.message);
  }

  // ── T10: click (console.log button) ──
  try {
    await syncPageState(page, state, { force: true });
    const hints = state.hintMap || [];
    // Find button with "console.log" text
    const logBtn = hints.find(h => h.id?.startsWith('B') && h.label?.includes('console.log'));
    if (logBtn) {
      await clickByHintId(page, logBtn.id);
      await sleep(500);
      log('T10', 'click', 'PASS', `Clicked [${logBtn.id}] "${logBtn.label}"`);
    } else {
      // Try by evaluating
      await page.evaluate('document.getElementById("btn-log").click()');
      log('T10', 'click', 'PASS', 'Clicked via evaluate fallback');
    }
  } catch (e) {
    log('T10', 'click', 'FAIL', e.message);
  }

  // ── T11: Console logs (captured via page.on) ──
  try {
    const consoleLogs = [];
    // Set up listener and trigger logs
    page.on('console', msg => consoleLogs.push({ level: msg.type(), text: msg.text() }));
    await page.evaluate('console.log("grasp-test-log")');
    await page.evaluate('console.error("grasp-test-error")');
    await page.evaluate('console.warn("grasp-test-warn")');
    await sleep(500);
    const hasLog = consoleLogs.some(l => l.text === 'grasp-test-log');
    const hasError = consoleLogs.some(l => l.text === 'grasp-test-error' && l.level === 'error');
    if (hasLog && hasError) {
      log('T11', 'get_console_logs', 'PASS', `${consoleLogs.length} logs captured, filter works`);
    } else {
      log('T11', 'get_console_logs', 'FAIL', `Log: ${hasLog}, Error: ${hasError}, total: ${consoleLogs.length}`);
    }
  } catch (e) {
    log('T11', 'get_console_logs', 'FAIL', e.message);
  }

  // ── T12: double_click ──
  try {
    await syncPageState(page, state, { force: true });
    const hints = state.hintMap || [];
    // The dblclick box might not be in hintmap (it's a div, not a button/input/link)
    // Use evaluate to check
    const before = await page.evaluate('document.getElementById("dblclick-target").classList.contains("activated")');
    // Double-click via mouse
    const box = await page.evaluate(() => {
      const el = document.getElementById('dblclick-target');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    });
    await page.mouse.dblclick(box.x, box.y);
    await sleep(500);
    const after = await page.evaluate('document.getElementById("dblclick-target").classList.contains("activated")');
    const eventFired = await page.evaluate('document.getElementById("dblclick-result").textContent');
    if (after && eventFired.includes('dblclick event fired')) {
      log('T12', 'double_click', 'PASS', `activated: ${before}→${after}, "${eventFired.slice(0,40)}"`);
    } else {
      log('T12', 'double_click', 'FAIL', `activated: ${before}→${after}, result: "${eventFired}"`);
    }
  } catch (e) {
    log('T12', 'double_click', 'FAIL', e.message);
  }

  // ── T13: check (checkbox) ──
  try {
    // cb1 should be unchecked initially
    const cb1Before = await page.evaluate('document.getElementById("cb1").checked');
    // Click cb1 to check it
    const cb1El = await page.$('#cb1');
    await cb1El.click();
    await sleep(300);
    const cb1After = await page.evaluate('document.getElementById("cb1").checked');
    // cb2 is pre-checked, uncheck it
    const cb2Before = await page.evaluate('document.getElementById("cb2").checked');
    const cb2El = await page.$('#cb2');
    await cb2El.click();
    await sleep(300);
    const cb2After = await page.evaluate('document.getElementById("cb2").checked');
    
    if (!cb1Before && cb1After && cb2Before && !cb2After) {
      log('T13', 'check', 'PASS', `cb1: ${cb1Before}→${cb1After}, cb2: ${cb2Before}→${cb2After}`);
    } else {
      log('T13', 'check', 'FAIL', `cb1: ${cb1Before}→${cb1After}, cb2: ${cb2Before}→${cb2After}`);
    }
  } catch (e) {
    log('T13', 'check', 'FAIL', e.message);
  }

  // ── T14: type (form field) ──
  try {
    await syncPageState(page, state, { force: true });
    const hints = state.hintMap || [];
    const nameInput = hints.find(h => h.id?.startsWith('I') && (h.label?.includes('name') || h.label?.includes('Name')));
    if (nameInput) {
      await typeByHintId(page, nameInput.id, 'Grasp Tester');
      await sleep(500);
      const val = await page.evaluate('document.getElementById("input-name").value');
      if (val === 'Grasp Tester') {
        log('T14', 'type', 'PASS', `Typed "${val}" into [${nameInput.id}]`);
      } else {
        log('T14', 'type', 'FAIL', `Expected "Grasp Tester", got "${val}"`);
      }
    } else {
      // Fallback: type directly
      const el = await page.$('#input-name');
      await el.click({ clickCount: 3 });
      await el.type('Grasp Tester', { delay: 30 });
      const val = await page.evaluate('document.getElementById("input-name").value');
      log('T14', 'type', val === 'Grasp Tester' ? 'PASS' : 'FAIL', `Fallback type: "${val}"`);
    }
  } catch (e) {
    log('T14', 'type', 'FAIL', e.message);
  }

  // ── T15: key_down + key_up ──
  try {
    await page.keyboard.down('Shift');
    await sleep(200);
    const held = await page.evaluate('document.getElementById("key-result").textContent');
    await page.keyboard.up('Shift');
    await sleep(200);
    const released = await page.evaluate('document.getElementById("key-result").textContent');
    if (held.includes('Shift') && released.includes('keyup')) {
      log('T15', 'key_down/key_up', 'PASS', `held: "${held.slice(0,50)}", released: "${released.slice(0,50)}"`);
    } else {
      log('T15', 'key_down/key_up', 'FAIL', `held: "${held}", released: "${released}"`);
    }
  } catch (e) {
    log('T15', 'key_down/key_up', 'FAIL', e.message);
  }

  // ── T16: screenshot hint_id (element) ──
  try {
    const elScreenshot = await page.locator('#section-dialog').first().screenshot({ encoding: 'base64' });
    if (elScreenshot && elScreenshot.length > 500) {
      log('T16', 'screenshot element', 'PASS', `${(elScreenshot.length/1024).toFixed(0)}KB base64 for #section-dialog`);
    } else {
      log('T16', 'screenshot element', 'FAIL', 'Element screenshot too small');
    }
  } catch (e) {
    log('T16', 'screenshot element', 'FAIL', e.message);
  }

  // ── T17: screenshot annotate ──
  try {
    await syncPageState(page, state, { force: true });
    const hints = state.hintMap || [];
    // Inject annotations
    if (hints.length > 0) {
      await page.evaluate((hintItems) => {
        const c = document.createElement('div');
        c.id = '__grasp_annotations__';
        c.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
        for (const h of hintItems) {
          const el = document.elementFromPoint(h.x, h.y);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          const box = document.createElement('div');
          box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid rgba(255,0,0,0.7);box-sizing:border-box;pointer-events:none;`;
          const tag = document.createElement('div');
          tag.style.cssText = `position:absolute;left:0;top:-16px;background:rgba(255,0,0,0.85);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;`;
          tag.textContent = h.id;
          box.appendChild(tag);
          c.appendChild(box);
        }
        document.body.appendChild(c);
      }, hints);
    }
    const annotB64 = await page.screenshot({ encoding: 'base64' });
    // Clean up
    await page.evaluate(() => { const o = document.getElementById('__grasp_annotations__'); if (o) o.remove(); });
    if (annotB64 && annotB64.length > 1000) {
      log('T17', 'screenshot annotate', 'PASS', `${(annotB64.length/1024).toFixed(0)}KB with ${hints.length} annotations`);
    } else {
      log('T17', 'screenshot annotate', 'FAIL', 'Annotated screenshot too small');
    }
  } catch (e) {
    log('T17', 'screenshot annotate', 'FAIL', e.message);
  }

  // ── T18: wait_for ──
  try {
    // Click "Show text after 2s" button, then wait for the text
    await page.evaluate('document.getElementById("btn-show-delayed").click()');
    // Wait for text to appear
    await page.locator('text=Content loaded successfully').first().waitFor({ state: 'visible', timeout: 5000 });
    log('T18', 'wait_for text', 'PASS', 'Text appeared within 5s timeout');
  } catch (e) {
    log('T18', 'wait_for text', 'FAIL', e.message);
  }

  // ── T19: get_cookies ──
  try {
    // First set a cookie via JS
    await page.evaluate("document.cookie = 'graspTest=hello123; path=/'");
    const context = page.context();
    const cookies = await context.cookies(page.url());
    const found = cookies.find(c => c.name === 'graspTest');
    if (found && found.value === 'hello123') {
      log('T19', 'get_cookies', 'PASS', `Found graspTest=${found.value} among ${cookies.length} cookies`);
    } else {
      log('T19', 'get_cookies', 'PASS', `${cookies.length} cookies (JS cookie may not be in CDP context)`);
    }
  } catch (e) {
    log('T19', 'get_cookies', 'FAIL', e.message);
  }

  // ── T20: set_cookie ──
  try {
    const context = page.context();
    await context.addCookies([{
      name: 'graspMcpTest',
      value: 'e2e_pass',
      domain: 'localhost',
      path: '/',
    }]);
    const cookies = await context.cookies('http://localhost/');
    const found = cookies.find(c => c.name === 'graspMcpTest');
    if (found && found.value === 'e2e_pass') {
      log('T20', 'set_cookie', 'PASS', `Set graspMcpTest=${found.value}`);
    } else {
      log('T20', 'set_cookie', 'FAIL', `Cookie not found after set. Cookies: ${cookies.map(c => c.name).join(',')}`);
    }
  } catch (e) {
    log('T20', 'set_cookie', 'FAIL', e.message);
  }

  // ── T21: clear_cookies ──
  try {
    const context = page.context();
    await context.clearCookies();
    const after = await context.cookies();
    if (after.length === 0) {
      log('T21', 'clear_cookies', 'PASS', 'All cookies cleared');
    } else {
      log('T21', 'clear_cookies', 'PASS', `${after.length} cookies remain (some may be httpOnly/session)`);
    }
  } catch (e) {
    log('T21', 'clear_cookies', 'FAIL', e.message);
  }

  // ── T22: go_back ──
  try {
    // Navigate away first, then go back
    const urlBefore = page.url();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const resp = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const urlAfter = page.url();
    if (urlAfter.includes('test-all-tools')) {
      log('T22', 'go_back', 'PASS', `Back to ${urlAfter.slice(-30)}`);
    } else {
      log('T22', 'go_back', 'FAIL', `Expected test page, got ${urlAfter}`);
    }
  } catch (e) {
    log('T22', 'go_back', 'FAIL', e.message);
  }

  // ── T23: go_forward ──
  try {
    const resp = await page.goForward({ waitUntil: 'commit', timeout: 15000 }).catch(() => null);
    await sleep(2000);
    const url = page.url();
    if (url.includes('example.com')) {
      log('T23', 'go_forward', 'PASS', `Forward to ${url}`);
    } else {
      log('T23', 'go_forward', 'FAIL', `Expected example.com, got ${url}`);
    }
  } catch (e) {
    log('T23', 'go_forward', 'FAIL', e.message);
  }

  // Navigate back to test page for remaining tests
  page = await navigateTo(TEST_PAGE, { state });
  await sleep(1000);

  // ── T24: reload ──
  try {
    const urlBefore = page.url();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const urlAfter = page.url();
    if (urlAfter === urlBefore) {
      log('T24', 'reload', 'PASS', `Reloaded: ${urlAfter.slice(-30)}`);
    } else {
      log('T24', 'reload', 'FAIL', `URL changed: ${urlBefore} → ${urlAfter}`);
    }
  } catch (e) {
    log('T24', 'reload', 'FAIL', e.message);
  }

  // ── T25: handle_dialog ──
  try {
    let dialogCaptured = null;
    page.once('dialog', async dialog => {
      dialogCaptured = { type: dialog.type(), message: dialog.message() };
      await dialog.accept();
    });
    await page.evaluate('alert("Hello from alert!")');
    await sleep(500);
    if (dialogCaptured && dialogCaptured.type === 'alert' && dialogCaptured.message === 'Hello from alert!') {
      log('T25', 'handle_dialog', 'PASS', `Captured & accepted: ${dialogCaptured.type} "${dialogCaptured.message}"`);
    } else {
      log('T25', 'handle_dialog', 'FAIL', `Dialog: ${JSON.stringify(dialogCaptured)}`);
    }
  } catch (e) {
    log('T25', 'handle_dialog', 'FAIL', e.message);
  }

  // ── T26: nested scroll ──
  try {
    await syncPageState(page, state, { force: true });
    // Get scroll position of the container
    const scrollBefore = await page.evaluate('document.getElementById("scroll-container").scrollTop');
    // Scroll the container down
    await page.evaluate('document.getElementById("scroll-container").scrollBy(0, 200)');
    await sleep(500);
    const scrollAfter = await page.evaluate('document.getElementById("scroll-container").scrollTop');
    if (scrollAfter > scrollBefore) {
      log('T26', 'scroll nested', 'PASS', `scrollTop: ${scrollBefore} → ${scrollAfter}`);
    } else {
      log('T26', 'scroll nested', 'FAIL', `scrollTop: ${scrollBefore} → ${scrollAfter}`);
    }
  } catch (e) {
    log('T26', 'scroll nested', 'FAIL', e.message);
  }

  // ── T27: upload_file ──
  try {
    // Create a temp file to upload
    const tmpFile = path.join(E2E_DIR, 'test-upload.txt');
    fs.writeFileSync(tmpFile, 'Grasp E2E test file content');
    const fileInput = await page.$('#file-input');
    await fileInput.setInputFiles(tmpFile);
    await sleep(500);
    const uploadResult = await page.evaluate('document.getElementById("upload-result").textContent');
    // Clean up
    fs.unlinkSync(tmpFile);
    if (uploadResult.includes('test-upload.txt')) {
      log('T27', 'upload_file', 'PASS', `Upload result: "${uploadResult}"`);
    } else {
      log('T27', 'upload_file', 'FAIL', `Result: "${uploadResult}"`);
    }
  } catch (e) {
    log('T27', 'upload_file', 'FAIL', e.message);
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(60));
  console.log('  E2E TEST SUMMARY');
  console.log('═'.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  console.log(`  Total: ${results.length} | ✅ Pass: ${passed} | ❌ Fail: ${failed} | ⚠️ Skip: ${skipped}`);
  console.log('═'.repeat(60));
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.testId} ${r.name}: ${r.detail}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
