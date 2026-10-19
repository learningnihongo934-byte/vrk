# VRK

A private, ad-blocking browser for macOS, Windows and Linux on the latest Chromium engine (152). It blocks ads, trackers, telemetry and known phishing and malware sites, randomizes your fingerprint, and has Tor tabs, a built-in WireGuard VPN, Chrome/Edge/Firefox extensions, a password manager with passkeys, import from other browsers, encrypted history and a theme editor with image, video and animated backgrounds. A short animation plays when it opens.

**VRKOS:** VRK menu → **VRKOS Desktop** (⌥⌘O) turns VRK into a full-screen desktop with its own apps, running on your Mac's hardware. See [VRKOS](#vrkos).

**Download:** [vrkweb.web.app](https://vrkweb.web.app), or paste one command:

```bash
curl -fsSL https://vrkweb.web.app/install | bash          # macOS (Apple chip) and Linux
```

```powershell
irm https://vrkweb.web.app/install-windows | iex           # Windows 10/11, in PowerShell
```

**Search:** the button at the left of the address bar switches between Google (the default) and Bing, like Firefox's "Search with" menu. More engines are in Settings → Search.

To make VRK your default browser: Settings → General → **Make Default** (your system asks you to confirm).

**See everything VRK does** (and how it compares with Chrome, Safari, Edge, Firefox, Samsung Internet, Opera, Brave, Vivaldi, Tor Browser and UC Browser): VRK menu → **VRK Features & Comparison**, or open `vrk://features`.

## Run it

```bash
npm run install-app       # copy the latest build to /Applications (quit VRK first)
npm start                 # or run from source
```

Build the app yourself (`./build.sh` does all of this):

```bash
npm install
npm run fetch-binaries    # downloads Tor + wireproxy, verifies SHA-256, ad-hoc signs
npm run dist              # → dist.noindex/mac-arm64/VRK.app (".noindex" keeps Spotlight from listing a second VRK)
./build.sh win            # → Windows installer (.exe) and portable .zip
./build.sh linux          # → Linux AppImage and .deb
./build.sh site           # publish the download site (vrkweb.web.app, in website/)
```

### Keep macOS permissions across updates (free, no Apple Developer account)

```bash
npm run setup-signing
```

Makes a personal code-signing certificate that only your Mac trusts (macOS asks for your password once). From then on every build, including automatic updates, is signed with it, so macOS keeps Full Disk Access and other permissions instead of asking again. After the first signed build, remove VRK from Full Disk Access and add it back once.

### Windows and Linux

The same VRK, with these differences:

- **Window:** the minimize, maximize and close buttons sit at the right of the tab strip.
- **App lock and Touch ID:** macOS only for now.
- **Automatic updates:** macOS only (VRK rebuilds itself from this project); on Windows and Linux, run the install command again.
- **Importing:** Chrome, Edge, Brave, Opera, Vivaldi and Firefox are found in their usual folders. Newer Chrome and Edge on Windows lock saved passwords to themselves ("app-bound encryption"); export those as a CSV from the browser and import the file.
- **VRKOS:** full screen over the taskbar; "Mac Apps" lists your Start menu apps (Windows) or desktop apps (Linux); "Windows Apps" runs programs directly on Windows and through Wine on Linux. Volume control is in the menu bar on Linux (PulseAudio/PipeWire) and in the taskbar on Windows.
- **Unsigned on Windows:** SmartScreen warns about apps without a paid certificate; the PowerShell command avoids that, or click **More info → Run anyway**.

## Privacy model

VRK has three browsing modes (Settings → Privacy). **Standard** is the default.

| Mode | History | Sign-ins & site data | On disk |
|---|---|---|---|
| **Standard** | Saved, encrypted | Kept between launches | Settings, profile, encrypted history |
| **Private** | Never recorded | Erased on quit, except sites you choose to **stay signed in** to | Settings and profile only |
| **Memory-only** | Never recorded | Reset every launch | Nothing from browsing |

- **History** is stored in an SQLite database where every entry (URL and title) is encrypted with AES-256-GCM using a key kept in your Mac's Keychain. It's kept for 30, 90 (default) or 365 days, or forever. It powers address-bar suggestions, the most-visited tiles and the History page (⌘Y), where you can search, delete entries, or clear the last hour, day, week or all of it. Turning history off in Settings works in any mode.
- **Burn** (🔥, ⇧⌘⌫) erases history, cookies, site storage and cache right now, closes every tab and forgets recently closed tabs. Kept sign-ins survive in Private mode.
- Extensions keep their settings except in Memory-only mode.
- **Tor tabs** are always memory-only, and never get extensions or the password manager.
- Engine caches go to a temp folder that a watchdog deletes the moment VRK exits, even after a crash.

## What it does

| | |
|---|---|
| **Google sign-in works** | VRK presents one consistent Chrome identity (user agent, client-hint headers, `navigator.userAgentData`, `window.chrome`). Google rejects browsers whose signals disagree as “not secure”. |
| **Ad & tracker blocking** | Ghostery's engine with EasyList, EasyPrivacy, uBlock Origin, annoyance and cookie-banner lists, including cosmetic filtering, plus HaGeZi's Multi PRO list of ~190,000 ad, tracking and telemetry servers (what DNS blockers like NextDNS use). Lists refresh daily. Turn blocking off per site from the shield menu. |
| **Aggressive blocking** (optional) | Also blocks the decoy "ads" that anti-adblock scripts look for. It scores 100% on ad-block tests such as adblock.turtlecute.org (Standard scores 98%: the 3 decoys are left alone on purpose, as EasyList does, so fewer sites ask you to turn your blocker off). |
| **Dangerous-site blocking** | Known phishing and malware sites (OpenPhish, PhishTank, IPThreat, abuse.ch URLhaus; ~75,000 entries, refreshed every 12 hours) are stopped with a red warning page. Checked on your Mac: unlike Safe Browsing, nothing about where you browse is sent anywhere. |
| **Fingerprint randomizing** | Like Brave: canvas, WebGL and audio readings get tiny per-site changes and the CPU core count varies per site, so sites can't recognize your device across the web. Consistent within a site (and its iframes) until you quit or Burn; hidden from tamper checks. Turn shields off for a site if it misbehaves. |
| **HTTPS-only** | `http://` is upgraded to `https://`. If a site has no HTTPS, VRK asks before loading it insecurely (once per site per session). |
| **Third-party cookies blocked** | Both inside Chromium and at the network layer, so embedded trackers can't keep cookies through headers or JavaScript. |
| **Tracking links cleaned** | `utm_*`, `fbclid`, `gclid`, `msclkid` and similar parameters are stripped before navigation. |
| **Encrypted DNS** | Always DNS over HTTPS, never unencrypted: Quad9 (default), Cloudflare, Mullvad, AdGuard, NextDNS or your own (Settings → Tor & VPN). Encrypted Client Hello hides which site you visit, where sites support it. |
| **Lookalike sites** | Sites dressed up as popular ones (paypa1.com, аpple.com in another alphabet, amazom.com, apple-id-verify.com) are stopped, with a button to the real site. |
| **“Paste into Terminal” scams** | When a page copies a Terminal command (curl … \| bash, osascript, base64 payloads), VRK warns you and offers to clear the clipboard: the trick fake “verify you’re human” pages use to install Mac malware. |
| **Download protection** | Downloads get macOS's quarantine flag (so Gatekeeper/XProtect check them), files matching new malware (abuse.ch MalwareBazaar, checked locally) are deleted, and installers and scripts are never downloaded over plain HTTP. |
| **HTTPS inspection warning** | Tells you when a school/work network filter or software on your Mac decrypts your HTTPS with its own certificate. |
| **Clean links** | Click-tracking redirects (google.com/url, l.facebook.com, affiliate links) are skipped, and other sites only learn which site you came from, never the page. |
| **Cookie banners** | VRK clicks “Reject all” on cookie banners from the big consent platforms and obvious ones elsewhere. |
| **Leak guards** | WebRTC can't expose your IP; DNS prefetching is off; `<a ping>` is ignored; Privacy Sandbox ad APIs are disabled. |
| **Lockdown mode** (optional) | Like Safari's: no JavaScript JIT compiler (the target of most browser exploits), WebAssembly, WebGL, WebGPU or web fonts (Settings → Security). |
| **App lock** (optional) | Touch ID when VRK opens, after sleep or screen lock, and after you've been away; pages, tab titles and history stay hidden. |
| **JavaScript per site** | Off for a site from the shield menu, or blocked everywhere except sites you allow. |
| **Locked down** | Sandboxed, context-isolated tabs, with VRK's protections in every iframe; deny-by-default permissions; popups need a click; Global Privacy Control; client certificates never volunteered. Pages can't load VRK's own pages or local files, and VRK's private controls refuse anything but VRK's interface (both tested). The packaged app has Electron's fuses hardened and refuses remote debugging. Shipped dependencies have no known vulnerabilities (`npm audit`). |

## Extensions

Extensions run in normal tabs only.

- **Chrome Web Store**: browse it in VRK; “Add to Chrome” installs into VRK.
- **Microsoft Edge Add-ons**: on an add-on's page VRK offers **Add to VRK**. Edge extensions are Chromium extensions; VRK verifies the package signature.
- **Firefox Add-ons (experimental)**: VRK converts the add-on to Chromium's format with Mozilla's `browser.*` compatibility layer. Simple add-ons work; ones that rely on Firefox-only features won't.
- **From a file**: `.crx`, `.zip`, `.xpi`, or an unpacked folder (Settings → Extensions).

**Safety check:** once a day VRK asks each store whether your extensions are still listed. One that was taken down (often for malware) is turned off and marked "Removed from store" in Settings → Extensions.

Extension buttons appear in the toolbar (right-click for options). Each install asks first and lists what the extension can access. Extension support covers the commonly used `chrome.*` APIs (tabs, storage, messaging, popups, context menus, cookies, notifications); some extensions use APIs Electron lacks and may only partly work. Dark Reader, for example, installs but doesn't theme pages yet.

## Passwords, bookmarks & import

- **Passwords**: VRK offers to save logins when you sign in, and fills them only when you pick one (click or ↓ + Enter), only on the site they were saved for. They're encrypted with a key in your Mac's Keychain; showing one in Settings asks for Touch ID. On sign-up forms VRK suggests a strong password (like `kX7qz-mP3wd-R9tLc-v2NhJ`) and fills both fields.
- **Passkeys**: sites that support passkeys can save one in VRK; signing in asks for Touch ID. Passkeys are standard WebAuthn (ES256) credentials, encrypted with your Keychain like passwords, and offered in the autofill list. Hardware security keys still go through Chromium. Passkeys stay on this Mac (no sync).
- **2FA codes**: add a site's authenticator secret (scan its QR code on the page, or paste the key or `otpauth://` link) and VRK fills the 6-digit code into verification fields, even split digit boxes.
- **Encrypted backup**: passwords (with 2FA secrets), passkeys and bookmarks in one file locked with your passphrase (scrypt + AES-256-GCM); restoring adds to what's there.
- **Password reuse alerts**: typing a saved password into a different site warns you (often a phishing page).
- **Breach alerts**: when you save a password, VRK checks it against Have I Been Pwned using k-anonymity: only the first 5 characters of the password's SHA-1 hash are sent. **Check Passwords** (Settings → Passwords) finds breached, reused and weak passwords.
- **Bookmarks**: ⌘D or the ☆ in the address bar; bookmarks bar (⇧⌘B) and new-tab tiles.
- **Import** (Settings → Import): passwords, sign-ins and bookmarks from Chrome, Edge, Brave, Opera, Opera GX, Vivaldi, Arc, Chromium and Firefox; bookmarks from Safari. Chromium-based browsers keep passwords and cookies encrypted with your Keychain, so macOS asks you to allow access. Sign-ins import only the sites you're actually signed in to (tracker cookies are skipped), and VRK keeps you signed in to them. Password CSVs (Chrome, Safari/Passwords app, Firefox, Bitwarden, 1Password) and bookmark HTML files from any browser work too. macOS guards other browsers' data folders: if it blocks VRK, the browser is marked **Needs permission** and **Choose Profile Folder…** lets you pick the folder (which gives VRK access to just that folder).

## Container tabs

Right-click **+** (or a link, or File → New Container Tab) to open a tab in a container: **School**, **Shopping**, or any you create in Settings → General. Each container has its own cookies, sign-ins and fingerprint, so sites can't connect them and you can be signed in to two accounts at once. Containers go through the VPN, are erased on quit (Private mode) or Burn like normal tabs, and are marked by color in the tab strip and address bar. Extensions run in normal tabs only.

**Extension site access:** extensions never read or change protected sites (banks and money apps to start; add the site you're on from the shield menu), and Settings → Extensions can limit any extension to sites you choose. **Forget sites on close** (Settings → Privacy) erases a site's data when its last tab closes.

## Themes & customization

Settings (⌘,) → Appearance has nine ready-made themes: VRK Classic (dark/light/system, eight accents, compact density), Midnight Aurora, Neon Synthwave, Deep Ocean, Firefly Forest, Starfield, Matrix, Paper and Sakura. You can also choose which toolbar buttons show, the bookmarks bar and the search engine (DuckDuckGo, Brave, Startpage, Google, Bing, Ecosia). Every privacy protection can be switched on or off.

**Use an Image or Video as Background…** makes a theme from any PNG, JPEG, GIF, WebP, AVIF, MP4, MOV or WebM (up to 1 GB). Videos loop silently. VRK copies the file into its own folder, so moving the original later doesn't matter.

The **Theme Editor** (Settings → Appearance, or the menu) builds full themes:

- **Colors**: dark or light base; background, tab strip, surfaces, fields, text, muted text, lines, accent and second accent. It can build a palette from the accent, roll a random one, or pick one from your background image.
- **Background**: solid color, gradient (any angle, 2–5 color stops), image or video (cover, contain or tile; dim; blur), or **keyframes**: your own animation of up to 8 gradient frames, each with its own colors and angle, with duration and easing.
- **Effects & animation**: animated layers over the background: Aurora, Constellation, Starfield, Waves, Matrix rain, Bubbles, Snow & petals, Fireflies, Synthwave grid and Confetti, each with speed, amount and up to 6 colors. Interface animations: tabs slide in, accent glow, breathing logo.
- **Interface**: glass toolbar (see-through and blurred), gradient toolbar, tab style (classic, pill, underline), corner roundness, font (system, rounded, serif, mono, condensed) and density.
- **Advanced**: your own CSS, applied only to VRK's interface, never to websites.

The editor has a live preview, undo/redo, and **Preview on browser** to try a theme on the real window before saving. Built-in themes are copied when you edit them. Themes export to and import from `.vrktheme` files, including their media. Animations pause when VRK is in the background and respect macOS's Reduce Motion setting.

**Opening animation**: particles stream in, the VRK shield draws itself and the wordmark rises (about two seconds). Click or press any key to skip it. Turn it off or replay it in Settings → Appearance → Startup.

## Tor tabs

Press ⇧⌘N (or the onion button) for a **Tor tab**. VRK runs its own Tor client with a fresh identity every launch. Tor tabs have their own memory-only cookie jar, search over DuckDuckGo's onion service, open `.onion` sites, and **fail closed**: nothing loads until Tor is connected. **New Tor Identity** (⇧⌘U) closes all Tor tabs, erases their data and builds new circuits. On networks that block Tor, choose a bridge (Snowflake, obfs4 or meek).

Every site gets its own Tor circuit (no exit relay sees two of your sites). Like Tor Browser, Tor tabs are **letterboxed** (the page size snaps to steps of 200×100 so your window size can't identify you), report **UTC** time and US English, always randomize fingerprints, and have **security levels**: Safer turns off JavaScript on sites without HTTPS, and WebGL; Safest turns JavaScript off everywhere.

> Tor tabs are not Tor Browser. Chromium is easier to fingerprint than Tor Browser, and Tor tabs share circuits instead of isolating each site. If your safety depends on staying anonymous, use [Tor Browser](https://www.torproject.org).

## Built-in VPN

VRK runs a WireGuard tunnel inside the app (no admin rights, no system settings), routing all normal tabs through your VPN server. A VPN needs a server, so bring a **WireGuard config** from any provider: Proton VPN (has a free plan), Mullvad, IVPN, and so on.

1. Download a WireGuard `.conf` from your provider.
2. Click **VPN** → **Import WireGuard Config…**. VRK encrypts it with your macOS Keychain.
3. The pill turns green when connected. Import several configs to switch between servers.

**Kill switch:** while the VPN is connecting or down, VRK blocks all traffic from normal tabs instead of falling back to your real connection. Pages wait and load once the tunnel is back, or when you turn the VPN off. When the VPN is on, Tor also connects through it (Tor over VPN). The VPN covers VRK only, not other apps.

## VRKOS

A desktop mode inside VRK: VRK menu → **VRKOS Desktop** (⌥⌘O), or Settings → General → **Open VRKOS** (you can also start VRK in it). It runs as part of VRK, not as a separate operating system, on your Mac's own chip, memory and disks.

- **Full screen for real:** while you're in VRKOS, macOS's Dock and menu bar are hidden, ⌘Tab is off and your other apps are hidden, so everything happens in VRKOS until you leave. (Force Quit, ⌥⌘⎋, still works.)
- **Desktop:** menu bar, dock, Launchpad search (⌥Space, from any VRKOS app) for apps, files and the web, your Desktop folder's files, and your VRK theme as the wallpaper. The desktop always stays behind your windows.
- **Menu bar:** sound (click for levels and mute, or scroll over it), Wi-Fi (connection, IP address, speed, turn Wi-Fi on or off), battery (charge, time left) and the clock (date, upcoming events, 24-hour clock). It makes room for the camera notch.
- **VRK Browser** is VRKOS's browser. Closing it in VRKOS hides it; links from any VRKOS app open in it.
- **Apps:** Files, Terminal (your real zsh), Notes, Text Editor, System Monitor, Calculator, Calendar, Viewer and Settings. Notes and calendar events are encrypted with your Keychain. Deleting in Files moves to the Trash.
- **Mac apps:** launch any app on your Mac; it opens on the VRKOS desktop, and every running Mac app shows in the VRKOS dock (click to switch, right-click to hide or quit). While a Mac app is in front, macOS shows its menu bar so you can use its menus. You can also mirror an app's window into a VRKOS window (a live view; macOS asks for Screen Recording once).
- **Windows apps:** `.exe` and `.msi` programs run through [Wine](https://www.winehq.org) (`brew install --cask wine-stable`) in VRK's own C: drive (`~/Library/Application Support/VRK/Wine`). Many programs work; games with anti-cheat, drivers and some installers don't. VRK stops Wine from making Mac launcher apps (macOS blocks that with "VRK was prevented from modifying apps").
- **Windows:** drag by the title bar, double-click to maximize, ⌃⌥← / ⌃⌥→ to snap, ⌃⌥↩ to maximize, ⌘W to close.
- **Leaving:** the VRKOS menu (top left) → **Exit VRKOS**, or VRK menu → **Leave VRKOS**. While VRKOS is open, ⌥⌘O shows the desktop.
- **All your files:** VRKOS menu → **Privacy & File Access** links to System Settings → Privacy & Security → Full Disk Access; turn on VRK there (macOS doesn't let apps turn it on themselves) and reopen VRK. Without it, macOS asks once per private folder.
- **Security:** VRKOS pages can't reach the internet, web pages can't reach VRKOS, and app lock covers VRKOS too (the lock screen covers Mac apps as well).
- **The macOS helper:** full screen, the always-at-the-back desktop, the dock's running apps and fast icons come from a small native module (`src/os/native/vrkos.m`), built by `npm run build-native` with Apple's command line tools (`xcode-select --install`). Without it VRKOS still works, just not in full screen.

## Keyboard shortcuts

| | |
|---|---|
| ⌘T / ⇧⌘N | New tab / new Tor tab |
| ⌘W / ⇧⌘T | Close tab (closing the last one quits) / reopen closed tab |
| ⌘Y | History |
| ⌘L | Address bar |
| ⌘D / ⇧⌘B | Bookmark page / show bookmarks bar |
| ⌘, | Settings |
| ⌘F, ⌘G | Find in page |
| ⌘[ / ⌘] | Back / forward |
| ⌃⇥, ⌘1–9 | Switch tabs |
| ⇧⌘V | VPN on/off |
| ⇧⌘U | New Tor identity |
| ⇧⌘⌫ | Burn browsing data |
| ⌥⌘O | VRKOS desktop |

## Keeping the engine current

```bash
npm run upgrade-chromium   # latest Electron (Chromium) + rebuild
npm run fetch-binaries     # latest pinned Tor / wireproxy
```

Electron ships Chromium security fixes a few days to weeks after Chrome does. The installed app does this for you: every few hours it checks for a newer Electron, installs it in this project, runs the self-test, rebuilds, and swaps the new build in when you quit (or click **Restart Now**). If any check fails, the project is put back and VRK keeps the version it has (Settings → General → Security updates).

## Good to know

- **What's on disk:** `~/Library/Application Support/VRK` holds settings, filter lists, extensions, themes and their media, encrypted passwords/bookmarks/VPN configs, encrypted history (Standard mode), and your main profile (cookies encrypted with the Keychain).
- **Dangerous sites without Google:** Safe Browsing isn't available outside Google's browsers, so VRK uses open phishing and malware lists checked on your Mac, plus Quad9 DNS. They catch fewer brand-new scam sites than Google's service, but tell nobody where you browse.
- **Updates:** automatic and test-gated (see above). It needs this project folder and Node.js on your Mac, since VRK rebuilds itself from source.
- **Signing:** the app is ad-hoc signed, which is fine on this Mac. To share it with others you'd need an Apple Developer ID and notarization.
- **License:** extension support uses electron-chrome-extensions under GPL-3.0, so if you distribute VRK, its source must be available under the GPL too. Personal use has no obligations.
- **Self-test:** `npm run selftest` runs about 170 end-to-end checks (Firefox import when macOS blocks access, download quarantine, lookalike and scam warnings, lockdown and app lock, containers, 2FA against the RFC test vectors, encrypted backups, identity and Google sign-in page, blocking, telemetry servers, aggressive mode, dangerous-site warnings, fingerprint randomizing, Tor hardening, passkeys verified with SimpleWebAuthn, strong passwords, breach checks, extension safety check, isolation from web pages, cookies, popups, password manager, bookmarks, settings UI, extensions from all three stores, HTTPS-only, Tor, VPN kill switch, browsing modes, encrypted history, themes, erase-on-quit, Burn, VRKOS in a scratch home folder, clean shutdown). `VRK_SELFTEST_SKIP=net,tor,vpn,ext` skips the slower parts.

## Layout

```
src/main.js            app setup, throwaway engine profile, Chromium hardening, app menu
src/browser.js         window, tabs, Tor/VPN routing and kill switches
src/browser-menus.js   toolbar menus, bookmarks, install dialogs
src/browser-ipc.js     UI and web-page bridges (password manager, settings, import, history, themes)
src/browser-security.js app lock, passkeys, 2FA, backups, password health, download and scam guards, site permissions
src/passkeys.js        the WebAuthn authenticator (key pairs, CBOR, signatures)
src/safety.js          phishing and malware lists
src/hostlists.js       ad, tracking and telemetry server list (HaGeZi)
src/updater.js         automatic, test-gated security updates
src/browser-containers.js container tabs
src/downloads.js       download quarantine and the malware hash list
src/lookalike.js       lookalike-domain detection
src/redirects.js       click-tracking redirect skipping
src/totp.js            2FA (TOTP) codes
src/backup.js          passphrase-encrypted backups
src/ui/features.js     the Features & comparison page (vrk://features)
website/               vrkweb.web.app: the download site and the install commands
build.sh               one-command build (mac, win, linux, all, site)
scripts/setup-signing.sh  free personal signing so macOS permissions survive updates
src/os/                VRKOS: the desktop and app windows (index.js), files, system stats, Wine; ui/ holds the desktop and apps
src/browser-features.js history recording, address-bar suggestions, theme media, opening animation
src/history.js         encrypted history (SQLite, AES-256-GCM, Keychain key)
src/themes.js          theme validation, built-in themes, saved themes and their media
src/shield.js          privacy core: sessions, request pipeline, blocking, permissions, erase-on-quit
src/identity.js        the consistent Chrome identity (UA, client hints)
src/extensions.js      Chrome Web Store / Edge / Firefox / file extension installs
src/vault.js           Keychain-encrypted passwords, passkeys and bookmarks
src/import/            importers for Chromium browsers, Firefox (incl. NSS decryption), Safari, files
src/tor.js, vpn.js     bundled Tor client and WireGuard (wireproxy) managers
src/settings.js        validated preferences
src/content-preload.js identity, fingerprint randomizing, GPC, popup guard, passwords and passkeys inside web pages
src/ui/                browser UI, settings, history, theme editor, effects, opening animation (vrk://ui)
scripts/               binary fetcher, filter-list builder, icon, self-test, screenshots
vendor/                Tor expert bundle + wireproxy (fetched, not committed)
```
