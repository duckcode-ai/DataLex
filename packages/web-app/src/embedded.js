// embedded.js — minimal embed marker for the DataLex web-app.
//
// All cloud<->OSS integration (theme via [data-theme]/`dm_theme`, fit,
// x-oss-app, auth bearer, embed context, chrome-hiding, route sync, ready
// handshake) is driven from OUTSIDE the OSS app by the cloud's build-injected
// adapter (governed-analytics-cloud: scripts/embed-adapter.js). This module only
// exposes the embed flag + a reader for the cloud context the adapter publishes.
// Standalone DataLex is unaffected (no-op without ?embedded=1).
//
// NOTE: localStorage is intentionally NOT namespaced here. The cloud owns the
// embedded app's persisted UI state — including the theme, which the uiStore
// reads from the `dm_theme` key. Namespacing hid the adapter's pre-boot writes
// behind a project-scoped key the store never reads, so the theme never applied.

const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get("embedded") === "1";

/** Read the cloud embed config the adapter publishes on the window global. */
export function getCloudEmbedConfig() {
  return (typeof window !== "undefined" && window.__DATALEX_CLOUD_EMBED__) || null;
}

export { isEmbedded };
