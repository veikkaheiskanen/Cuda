'use strict';
const SERVICES = ['spotify', 'youtube', 'ytmusic', 'soundcloud', 'audius'];
// Missing preferences preserve existing providers. Newly added services are opt-in.
const DEFAULTS = SERVICES.filter(s => s !== 'audius');
function enabledServices(value, host = SERVICES) {
  if (typeof value === 'string') value = value.split(',');
  const requested = Array.isArray(value) ? value : DEFAULTS;
  return SERVICES.filter(s => requested.includes(s) && host.includes(s));
}
module.exports = { SERVICES, DEFAULTS, enabledServices };
