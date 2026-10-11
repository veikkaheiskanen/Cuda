'use strict';
const crypto = require('node:crypto');
const os = require('node:os');
const {createBridge} = require('../scripts/ios-bridge');

// Playback has its own short-lived, read-only key. Never expose the Shelf key
// or the private desktop service capability on the local streaming connection.
class MobileCompanion {
  constructor({upstream, serviceToken}) { this.upstream = upstream; this.serviceToken = serviceToken; this.server = null; this.token = ''; this.error = ''; }
  acceptsHost(host) {
    const name = host.toLowerCase().replace(/\.$/, '');
    if (name === 'localhost' || name === '127.0.0.1' || name.endsWith('.local')) return true;
    return Object.values(os.networkInterfaces()).flat().some(item => item && item.family === 'IPv4' && item.address === name);
  }
  async configure(enabled, reset = false) {
    if (!enabled || reset) await this.close();
    if (!enabled || this.server) return;
    this.token = crypto.randomBytes(32).toString('hex'); this.error = '';
    const server = createBridge({token: this.token, upstream: this.upstream,
      allowedHosts: host => this.acceptsHost(host), upstreamHeaders: {'X-Cuda-Native-Token': this.serviceToken}});
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
      this.server = server;
    } catch { server.close(); this.token = ''; this.error = 'Streaming companion could not start. Reopen Cuda and allow local network access.'; }
  }
  status() { return {service: 'cuda-ios-companion', version: 1, port: this.server?.address()?.port || 0, token: this.server ? this.token : '', error: this.error}; }
  async close() {
    const server = this.server; this.server = null; this.token = '';
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
module.exports = {MobileCompanion};
