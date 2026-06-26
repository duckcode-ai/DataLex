// embedded.js — minimal embed shim for the DataLex web-app.
//
// Activated when the URL contains ?embedded=1. Its ONLY job is localStorage
// isolation: namespace keys by the project id from `?project=<id>` so two
// tenants/projects embedding into the same cloud origin can't clobber each
// other's panel layout / theme prefs / last-opened state.
//
// Everything else that used to live here — theme bridge + mode switch, auth
// `x-oss-app` + bearer fetch wrap, capability-driven chrome hiding,
// cloud-context injection, route reporting, the ready handshake — is now driven
// from OUTSIDE the OSS app by the cloud's build-injected adapter
// (governed-analytics-cloud: scripts/embed-adapter.js) plus its cloud-owned
// override CSS. Keeping that integration cloud-side means cloud tweaks no longer
// touch this file and OSS releases flow into the cloud unchanged.

const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get("embedded") === "1";
const projectId = params.get("project") || "shared";

/** Read the cloud embed config the adapter exposes on the window global. */
export function getCloudEmbedConfig() {
  return (typeof window !== "undefined" && window.__DATALEX_CLOUD_EMBED__) || null;
}

if (isEmbedded) {
  // localStorage namespace — isolate per project within a shared cloud origin.
  const namespacedKey = (key) => `dlx:${projectId}:${key}`;
  const realStorage = window.localStorage;
  const storageProxy = {
    getItem: (k) => realStorage.getItem(namespacedKey(k)),
    setItem: (k, v) => realStorage.setItem(namespacedKey(k), v),
    removeItem: (k) => realStorage.removeItem(namespacedKey(k)),
    clear: () => {
      const prefix = `dlx:${projectId}:`;
      for (let i = realStorage.length - 1; i >= 0; i--) {
        const k = realStorage.key(i);
        if (k && k.startsWith(prefix)) realStorage.removeItem(k);
      }
    },
    key: (i) => {
      const prefix = `dlx:${projectId}:`;
      const matched = [];
      for (let j = 0; j < realStorage.length; j++) {
        const k = realStorage.key(j);
        if (k && k.startsWith(prefix)) matched.push(k.slice(prefix.length));
      }
      return matched[i] ?? null;
    },
    get length() {
      const prefix = `dlx:${projectId}:`;
      let n = 0;
      for (let i = 0; i < realStorage.length; i++) {
        const k = realStorage.key(i);
        if (k && k.startsWith(prefix)) n++;
      }
      return n;
    },
  };
  Object.defineProperty(window, "localStorage", { value: storageProxy, configurable: true });
}

export { isEmbedded };
