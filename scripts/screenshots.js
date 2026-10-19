'use strict';
// Renders VRK's window to PNGs in its main states (development aid). Electron
// paints the hidden window itself, so nothing on your screen is captured.
// Run with: VRK_SHOTS=<dir> VRK_CONFIG_DIR=$(mktemp -d) npx electron .

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CAPTURE = { stayHidden: true, stayAwake: true };

module.exports = async function screenshots({ browser, settings, bookmarks, importer, history, themes }) {
  const dir = process.env.VRK_SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  const { win } = browser;
  win.setBounds({ width: 1280, height: 800 });
  // Errors print instead of popping up dialogs.
  process.on('uncaughtException', (err) => console.error('UNCAUGHT', err));
  browser.ui.on('console-message', (e) => e.level === 'error' && console.error('UI', e.message));
  // Example data instead of this Mac's real browsers and history.
  importer.detect = () => [];
  for (const [title, url] of [
    ['GitHub', 'https://github.com/'],
    ['Wikipedia', 'https://en.wikipedia.org/'],
    ['Proton Mail', 'https://mail.proton.me/'],
    ['YouTube', 'https://www.youtube.com/'],
  ]) {
    bookmarks.add({ url, title });
  }
  const now = Date.now();
  [
    ['https://news.ycombinator.com/', 'Hacker News'],
    ['https://github.com/electron/electron', 'electron/electron: Build cross-platform desktop apps'],
    ['https://en.wikipedia.org/wiki/Tor_(network)', 'Tor (network) - Wikipedia'],
    ['https://www.theverge.com/tech', 'Tech - The Verge'],
    ['https://developer.mozilla.org/en-US/docs/Web/CSS', 'CSS: Cascading Style Sheets | MDN'],
    ['https://github.com/', 'GitHub'],
  ].forEach(([url, title], i) => {
    for (let n = 0; n < 3 - (i % 3); n += 1) history.setTitle(history.add(`${url}${n ? `?v=${n}` : ''}`.replace(/\?v=\d$/, ''), title), title);
    void now;
  });

  const snap = async (name, delay = 900, contents = win.webContents) => {
    await wait(delay);
    const image = await contents.capturePage(undefined, CAPTURE);
    fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
  };
  const ui = (code) => browser.ui.executeJavaScript(code);

  try {
    for (let i = 0; i < 100 && !browser.normalPrepared; i += 1) await wait(100);

    // Wait for the UI's first state, then replay the opening animation frozen at three moments.
    for (let i = 0; i < 50 && !(await ui(`Boolean(document.body.dataset.panel)`)); i += 1) await wait(100);
    await ui(`(() => { VRKSplash.replay(); document.getAnimations().forEach((a) => { if (a.effect?.target?.closest?.('#splash')) a.pause(); }); })()`);
    for (const [ms, name] of [[700, '01-splash-draw'], [1250, '02-splash-burst'], [2100, '03-splash-final']]) {
      await ui(`document.getAnimations().forEach((a) => { if (a.effect?.target?.closest?.('#splash')) a.currentTime = ${ms}; })`);
      await snap(name, 150);
    }
    await ui(`document.getElementById('splash').hidden = true`);

    await snap('04-new-tab-classic', 600);

    // Address-bar suggestions (their own floating view, captured separately).
    await ui(`(() => { const a = document.getElementById('address'); a.focus(); a.value = 'git'; a.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); })()`);
    await wait(700);
    await snap('05-suggestions-toolbar', 100);
    await snap('06-suggestions-list', 100, browser.suggestView.webContents).catch(() => console.log('(suggestion view can’t be captured while hidden)'));
    browser.hideSuggestions();
    await ui(`document.getElementById('address').blur()`);

    browser.openInternal('history');
    await snap('07-history', 1000);

    browser.openSettings('privacy');
    await snap('08-settings-privacy-modes', 1000);
    browser.openSettings('appearance');
    await snap('09-settings-appearance', 1000);

    browser.openInternal('themes');
    await wait(700);
    await ui(`[...document.querySelectorAll('#themepanel .te-card')].find((c) => c.textContent.includes('Neon Synthwave')).click()`);
    await snap('10-theme-editor-colors', 900);
    await ui(`[...document.querySelectorAll('#themepanel .te-tabs button')].find((b) => b.textContent === 'Background').click()`);
    await snap('11-theme-editor-background', 700);
    await ui(`[...document.querySelectorAll('#themepanel .te-tabs button')].find((b) => b.textContent.startsWith('Effects')).click()`);
    await snap('12-theme-editor-effects', 700);

    for (const [id, name] of [['synthwave', '13-theme-synthwave'], ['midnight-aurora', '14-theme-aurora'], ['firefly-forest', '15-theme-fireflies'], ['paper', '16-theme-paper']]) {
      settings.set('themeId', id);
      browser.activate(browser.createTab().id);
      await snap(name, 1300);
    }
  } catch (err) {
    console.error(err);
  } finally {
    browser.shutdown();
    app.exit(0);
  }
};
