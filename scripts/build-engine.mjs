// Pre-builds the ad/tracker blocking engine (EasyList, EasyPrivacy, uBlock
// Origin filters, annoyances and cookie-banner lists) and fetches the
// ad/telemetry host list and the phishing/malware lists, so VRK blocks from
// the very first request, before its background list refresh has run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FiltersEngine } from '@ghostery/adblocker';

const require = createRequire(import.meta.url);
const { fetchHosts, HOSTS_FILE } = require('../src/hostlists.js');
const { fetchLists, SAFETY_FILE } = require('../src/safety.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets', 'adblock-engine.bin');

const engine = await FiltersEngine.fromPrebuiltFull(fetch);
const bytes = engine.serialize();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);
console.log(`Wrote ${out} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);

const hosts = await fetchHosts(fetch);
fs.writeFileSync(path.join(root, 'assets', HOSTS_FILE), hosts.join('\n'));
console.log(`Wrote assets/${HOSTS_FILE} (${hosts.length} ad, tracking and telemetry domains)`);

const safety = await fetchLists(fetch);
fs.writeFileSync(path.join(root, 'assets', SAFETY_FILE), JSON.stringify(safety));
const total = Object.values(safety.lists).reduce((n, l) => n + l.hosts.length + l.urls.length, 0);
console.log(`Wrote assets/${SAFETY_FILE} (${total} phishing and malware sites)`);
