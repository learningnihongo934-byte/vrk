'use strict';
// Live system information for VRKOS (System Monitor and the menu bar): your
// Mac's real CPU, memory, disk, battery, network and processes.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const readText = (file) => fs.promises.readFile(file, 'utf8').catch(() => '');
const powershell = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

const run = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout))));

let lastCpu = null;
let lastNet = null;

function cpuUsage() {
  const now = os.cpus().map((c) => ({ ...c.times }));
  const prev = lastCpu || now;
  lastCpu = now;
  const perCore = now.map((t, i) => {
    const p = prev[i] || t;
    const busy = t.user + t.nice + t.sys + t.irq - (p.user + p.nice + p.sys + p.irq);
    const total = busy + (t.idle - p.idle);
    return total > 0 ? Math.round((busy / total) * 100) : 0;
  });
  return { total: Math.round(perCore.reduce((a, b) => a + b, 0) / (perCore.length || 1)), perCore };
}

async function memory() {
  const total = os.totalmem();
  if (!MAC) {
    // Linux: what's really in use (not counting the disk cache). Windows: total minus free.
    const available = Number(/MemAvailable:\s+(\d+)/.exec(WIN ? '' : await readText('/proc/meminfo'))?.[1] || 0) * 1024;
    return { total, used: total - (available || os.freemem()) };
  }
  const text = await run('/usr/bin/vm_stat', []);
  const pageSize = Number(/page size of (\d+)/.exec(text)?.[1] || 16384);
  const pages = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] || 0) * pageSize;
  // What Activity Monitor calls "Memory Used": app memory + wired + compressed.
  const used = pages('Anonymous pages') - pages('Pages purgeable') + pages('Pages wired down') + pages('Pages occupied by compressor');
  return { total, used: used > 0 && used < total ? used : total - os.freemem() };
}

async function disk() {
  if (!MAC) {
    const s = await fs.promises.statfs(WIN ? `${process.env.SystemDrive || 'C:'}\\` : '/').catch(() => null);
    return s ? { total: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize, free: s.bavail * s.bsize } : null;
  }
  const line = (await run('/bin/df', ['-k', '/System/Volumes/Data'])).trim().split('\n')[1] || '';
  const [, size, used, free] = line.split(/\s+/).map(Number);
  return size ? { total: size * 1024, used: (size - free) * 1024, free: free * 1024 } : null;
}

async function battery() {
  if (WIN) {
    const out = (await powershell('$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining) $($b.BatteryStatus) $($b.EstimatedRunTime)" }')).trim();
    if (!out) return null;
    const [percent, status, minutes] = out.split(/\s+/).map(Number);
    const charging = [2, 6, 7, 8, 9].includes(status);
    return { percent, charging, remaining: !charging && minutes > 0 && minutes < 10000 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : null };
  }
  if (!MAC) {
    const dir = (await fs.promises.readdir('/sys/class/power_supply').catch(() => [])).find((d) => /^BAT/.test(d));
    if (!dir) return null;
    const base = path.join('/sys/class/power_supply', dir);
    const percent = Number((await readText(path.join(base, 'capacity'))).trim());
    const status = (await readText(path.join(base, 'status'))).trim();
    return Number.isFinite(percent) ? { percent, charging: /Charging|Full/.test(status), remaining: null } : null;
  }
  const text = await run('/usr/bin/pmset', ['-g', 'batt']);
  const percent = /(\d+)%/.exec(text);
  if (!percent) return null;
  return { percent: Number(percent[1]), charging: /AC Power/.test(text) && !/discharging/.test(text), remaining: /(\d+:\d+) remaining/.exec(text)?.[1] || null };
}

async function network() {
  let rx = 0;
  let tx = 0;
  if (WIN) {
    const out = await powershell('$s = Get-NetAdapterStatistics -ErrorAction SilentlyContinue; "$(($s | Measure-Object ReceivedBytes -Sum).Sum) $(($s | Measure-Object SentBytes -Sum).Sum)"');
    [rx, tx] = out.trim().split(/\s+/).map((n) => Number(n) || 0);
  } else if (!MAC) {
    for (const line of (await readText('/proc/net/dev')).split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const cols = rest.trim().split(/\s+/).map(Number);
      rx += cols[0] || 0;
      tx += cols[8] || 0;
    }
  }
  const text = MAC ? await run('/usr/sbin/netstat', ['-ibn']) : '';
  const seen = new Set();
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10 || !/^en\d|^utun\d/.test(cols[0]) || seen.has(cols[0]) || !cols[2]?.startsWith('<Link')) continue;
    seen.add(cols[0]);
    rx += Number(cols[cols.length - 5]) || 0; // Ibytes
    tx += Number(cols[cols.length - 2]) || 0; // Obytes
  }
  const now = Date.now();
  const prev = lastNet;
  lastNet = { rx, tx, at: now };
  if (!prev || now === prev.at) return { rxRate: 0, txRate: 0 };
  const seconds = (now - prev.at) / 1000;
  return { rxRate: Math.max(0, (rx - prev.rx) / seconds), txRate: Math.max(0, (tx - prev.tx) / seconds) };
}

async function processes(limit = 15) {
  if (WIN) {
    // Windows: the busiest processes by total CPU time.
    const out = await powershell('Get-Process | Sort-Object CPU -Descending | Select-Object -First ' + limit + ' | ForEach-Object { "$($_.Id)|$([math]::Round($_.CPU))|$($_.WorkingSet64)|$($_.ProcessName)" }');
    return out
      .split(/\r?\n/)
      .map((l) => l.split('|'))
      .filter((c) => c.length === 4)
      .map(([pid, cpu, mem, name]) => ({ pid: Number(pid), cpu: Number(cpu) || 0, memory: Number(mem) || 0, mine: true, name }));
  }
  if (!MAC) {
    const me = os.userInfo().username;
    const out = await run('ps', ['-eo', 'pid=,pcpu=,rss=,user=,comm=', '--sort=-pcpu']);
    return out
      .split('\n')
      .map((line) => /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line))
      .filter(Boolean)
      .slice(0, limit)
      .map(([, pid, cpu, rss, user, command]) => ({ pid: Number(pid), cpu: Number(cpu), memory: Number(rss) * 1024, mine: user === me, name: command }));
  }
  const text = await run('/bin/ps', ['-Ao', 'pid=,pcpu=,rss=,user=,comm=', '-r']);
  const me = os.userInfo().username;
  return text
    .split('\n')
    .map((line) => /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line))
    .filter(Boolean)
    .slice(0, limit)
    .map(([, pid, cpu, rss, user, command]) => ({ pid: Number(pid), cpu: Number(cpu), memory: Number(rss) * 1024, mine: user === me, name: command.split('/').pop() }));
}

async function hardware() {
  if (!MAC) {
    const pretty = WIN ? '' : /PRETTY_NAME="?([^"\n]+)/.exec(await readText('/etc/os-release'))?.[1];
    const model = WIN ? (await powershell('(Get-CimInstance Win32_ComputerSystem).Model')).trim() : (await readText('/sys/class/dmi/id/product_name')).trim();
    return {
      chip: os.cpus()[0]?.model?.trim() || 'Unknown',
      model,
      cores: os.cpus().length,
      performanceCores: null,
      efficiencyCores: null,
      memory: os.totalmem(),
      system: WIN ? `Windows ${os.release()}` : pretty || `Linux ${os.release()}`,
      host: os.hostname(),
      user: os.userInfo().username,
    };
  }
  const sysctl = async (name) => (await run('/usr/sbin/sysctl', ['-n', name])).trim();
  const [chip, model, performance, efficiency, product, version] = await Promise.all([
    sysctl('machdep.cpu.brand_string'),
    sysctl('hw.model'),
    sysctl('hw.perflevel0.logicalcpu'),
    sysctl('hw.perflevel1.logicalcpu'),
    run('/usr/bin/sw_vers', ['-productName']),
    run('/usr/bin/sw_vers', ['-productVersion']),
  ]);
  return {
    chip: chip || os.cpus()[0]?.model || 'Unknown',
    model,
    cores: os.cpus().length,
    performanceCores: Number(performance) || null,
    efficiencyCores: Number(efficiency) || null,
    memory: os.totalmem(),
    system: `${product.trim()} ${version.trim()}`.trim(),
    host: os.hostname(),
    user: os.userInfo().username,
  };
}

async function stats({ withProcesses = false } = {}) {
  const [mem, dsk, batt, net, procs] = await Promise.all([memory(), disk(), battery(), network(), withProcesses ? processes() : null]);
  return { at: Date.now(), cpu: cpuUsage(), memory: mem, disk: dsk, battery: batt, network: net, uptime: os.uptime(), load: os.loadavg(), processes: procs };
}

// ── Menu bar: network and sound ──

async function wifiDevice() {
  if (!MAC) return null;
  const ports = await run('/usr/sbin/networksetup', ['-listallhardwareports']);
  return /Hardware Port: Wi-Fi\nDevice: (\S+)/.exec(ports)?.[1] || 'en0';
}

// macOS keeps the Wi-Fi network's name private (it needs Location access), so
// this reports whether you're connected and how, not the network's name.
async function networkInfo() {
  const device = await wifiDevice();
  let power = true;
  if (MAC) power = /:\s*On/i.test(await run('/usr/sbin/networksetup', ['-getairportpower', device]));
  else if (!WIN) power = !/disabled/i.test(await run('nmcli', ['radio', 'wifi'])); // NetworkManager
  const addresses = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4' || (MAC && !/^(en|bridge|utun)/.test(name))) continue;
      if (!MAC && !WIN && /^(lo|docker|veth|br-|virbr)/.test(name)) continue;
      const wifi = MAC ? name === device : /^(wl|wlan|Wi-?Fi)/i.test(name);
      addresses.push({ name, address: a.address, kind: wifi ? 'Wi-Fi' : /^(utun|tun|wg)/.test(name) ? 'VPN' : 'Ethernet' });
    }
  }
  const rates = await network();
  return { device, canToggleWifi: !WIN, wifiPower: power, wifiConnected: addresses.some((a) => a.kind === 'Wi-Fi'), addresses, rxRate: rates.rxRate, txRate: rates.txRate };
}

async function setWifiPower(on) {
  if (WIN) throw new Error('Turn Wi-Fi on or off in Windows’ quick settings.');
  const device = await wifiDevice();
  const [cmd, args] = MAC ? ['/usr/sbin/networksetup', ['-setairportpower', device, on ? 'on' : 'off']] : ['nmcli', ['radio', 'wifi', on ? 'on' : 'off']];
  await new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 8000 }, (err) => (err ? reject(new Error('VRK couldn’t change Wi-Fi.')) : resolve())),
  );
  return true;
}

async function volume() {
  if (WIN) return null; // Windows has no command for it; use the taskbar's speaker
  if (!MAC) {
    const out = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    const muted = /yes/.test(await run('pactl', ['get-sink-mute', '@DEFAULT_SINK@']));
    const level = Number(/(\d+)%/.exec(out)?.[1]);
    return Number.isFinite(level) ? { level: Math.min(100, level), muted } : null;
  }
  const text = await run('/usr/bin/osascript', ['-e', 'get volume settings']);
  return { level: Number(/output volume:(\d+)/.exec(text)?.[1] ?? 0), muted: /output muted:true/.test(text) };
}

async function setVolume({ level, muted }) {
  if (WIN) return null;
  if (!MAC) {
    if (Number.isFinite(Number(level))) await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.max(0, Math.min(100, Math.round(Number(level))))}%`]);
    if (typeof muted === 'boolean') await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']);
    return volume();
  }
  const script = [];
  if (Number.isFinite(Number(level))) script.push(`set volume output volume ${Math.max(0, Math.min(100, Math.round(Number(level))))}`);
  if (typeof muted === 'boolean') script.push(`set volume output muted ${muted}`);
  if (script.length) await run('/usr/bin/osascript', script.flatMap((line) => ['-e', line]));
  return volume();
}

module.exports = { stats, hardware, battery, networkInfo, setWifiPower, volume, setVolume };
