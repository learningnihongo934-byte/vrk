'use strict';
// Renders VRK's app icon to assets/icon.icns. Run with: npm run icon

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ICON_HTML = `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1b33"/><stop offset="1" stop-color="#07080c"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".38" r=".55">
      <stop offset="0" stop-color="#8b7bff" stop-opacity=".45"/><stop offset="1" stop-color="#8b7bff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" x1="300" y1="220" x2="724" y2="820" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#e2dcff"/><stop offset=".55" stop-color="#8b7bff"/><stop offset="1" stop-color="#2ee6c4"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#glow)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="3"/>
  <path d="M512 232l224 82v184c0 143-97 255-224 306-127-51-224-163-224-306V314l224-82z"
        fill="#8b7bff" fill-opacity=".1" stroke="url(#mark)" stroke-width="30" stroke-linejoin="round"/>
  <path d="M404 404l108 216 108-216" fill="none" stroke="url(#mark)" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
</svg></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ICON_HTML)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });

  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'vrk-icon-')) + '/VRK.iconset';
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), image.resize({ width: size, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), image.resize({ width: size * 2, quality: 'best' }).toPNG());
  }
  const assets = path.join(__dirname, '..', 'assets');
  fs.writeFileSync(path.join(assets, 'icon.png'), image.resize({ width: 1024 }).toPNG());
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
  console.log('Wrote assets/icon.icns');
  app.quit();
});
