'use strict';
// Container tabs (mixed into Browser). Each container (School, Shopping, …)
// has its own cookie jar and storage, so sites can't connect what you do in
// one with another, and you can be signed in to two accounts at once. A
// container also gets its own fingerprint, goes through the VPN like normal
// tabs, and is erased on quit or Burn the same way. Extensions run in normal
// tabs only.

const path = require('node:path');
const { siteOf } = require('./shield');

const COLORS = { blue: '#4c8dff', turquoise: '#2ed3c6', green: '#45c46b', yellow: '#f2c230', orange: '#ff8a3d', red: '#ff5370', pink: '#ff6fb5', purple: '#a57bff' };

module.exports = {
  containers() {
    return this.settings.get('containers');
  },

  containerInfo(id) {
    const c = this.containers().find((x) => x.id === id);
    return c ? { id: c.id, name: c.name, color: COLORS[c.color] || COLORS.blue } : null;
  },

  // The container's profile, created the first time one of its tabs opens.
  containerProfile(id) {
    if (!this.containerInfo(id)) return null;
    this.containerProfiles ||= new Map();
    if (!this.containerProfiles.has(id)) {
      const memoryOnly = this.settings.launched.memoryOnly;
      const profile = this.newProfile('container', memoryOnly ? null : path.join(this.configDir, 'Containers', id));
      profile.container = id;
      profile.prepared = false;
      this.containerProfiles.set(id, profile);
      // Like the main profile: erase last session's data first if VRK didn't quit cleanly.
      const ready = profile.persistent && this.settings.get('clearOnQuit') ? this.clearProfile(profile) : Promise.resolve();
      ready.finally(() => {
        profile.prepared = true;
        this.applyNetwork();
      });
      this.applyNetwork();
    }
    return this.containerProfiles.get(id);
  },

  containerProfileList() {
    return [...(this.containerProfiles?.values() || [])];
  },

  // The main profile and every container: the sessions web pages (not Tor) use.
  isWebSession(ses) {
    return ses === this.normal.session || this.containerProfileList().some((p) => p.session === ses);
  },

  clearProfile(profile) {
    const keepSites = this.settings.get('keepSites');
    const keptOrigins = [...this.sessionOrigins].filter((origin) => keepSites.includes(siteOf(origin)));
    return this.shield.clearSiteData(profile, { keepSites, keepOrigins: keptOrigins });
  },

  addContainer(name, color) {
    const list = this.containers();
    const clean = String(name || '').trim().slice(0, 30) || 'Container';
    let id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'container';
    for (let n = 2; list.some((c) => c.id === id); n += 1) id = `${id.replace(/-\d+$/, '')}-${n}`;
    this.settings.set('containers', [...list, { id, name: clean, color: COLORS[color] ? color : 'blue' }]);
    return id;
  },

  updateContainer(id, { name, color }) {
    this.settings.set(
      'containers',
      this.containers().map((c) => (c.id === id ? { ...c, name: String(name ?? c.name).trim().slice(0, 30) || c.name, color: COLORS[color] ? color : c.color } : c)),
    );
    this.queueState();
  },

  // Closes its tabs and erases everything it stored.
  async removeContainer(id) {
    for (const tab of [...this.tabs.values()]) if (tab.container === id) this.closeTab(tab.id);
    const profile = this.containerProfiles?.get(id);
    if (profile) {
      this.containerProfiles.delete(id);
      await this.shield.destroyProfile(profile);
    }
    this.settings.set('containers', this.containers().filter((c) => c.id !== id));
  },

  // Menu items that open a URL (or a new tab) in each container.
  containerMenuItems(open) {
    return this.containers().map((c) => ({ label: c.name, click: () => open(c.id) }));
  },

  showNewTabMenu(x, y) {
    this.popup(
      [
        { label: 'New Tab', click: () => this.createTab() },
        this.tor.available && { label: 'New Tor Tab', click: () => this.createTab(null, { tor: true }) },
        { type: 'separator' },
        { label: 'New Container Tab', enabled: false },
        ...this.containerMenuItems((container) => this.createTab(null, { container })),
        { type: 'separator' },
        { label: 'Manage Containers…', click: () => this.openSettings('general') },
      ],
      x,
      y,
    );
  },
};
