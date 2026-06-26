// embedded.js — Datalex-Cloud embed shim. Brought to parity with the DQL
// notebook embed (apps/dql-notebook/src/embedded.ts) so the cloud shell can
// drive DataLex the same way over postMessage.
//
// Activated when the URL contains ?embedded=1. Responsibilities:
//
//   1. Storage isolation — namespace localStorage by project id.
//   2. Theme bridge — apply `datalex.theme` tokens to Luna CSS variables.
//   3. Context injection — accept `datalex.cloud.context` { config } and expose
//      it on window.__DATALEX_CLOUD_EMBED__ (tenant / project / role /
//      capabilities / repo_context / warehouse_context).
//   4. Capability-driven chrome hiding — when capabilities.hide_activity_bar /
//      hide_sidebar are set, the cloud rail is the only nav, so we hide
//      DataLex's own topbar / activity rail / layer spine via injected CSS.
//   5. Auth pass-through — add `Authorization: Bearer <token>` to /api/* and
//      /projects/* calls. Token arrives via `datalex.auth.token` or #token=.
//   6. Route reporting — post `datalex.route.changed` on hash change so the
//      cloud can keep its outer URL in sync for deep links.
//
// Self-installs only when the embed flag is present; standalone DataLex is
// unaffected.

const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get("embedded") === "1";
const projectId = params.get("project") || "shared";

/** Read the injected cloud embed config (set via postMessage or boot global). */
export function getCloudEmbedConfig() {
  return (typeof window !== "undefined" && window.__DATALEX_CLOUD_EMBED__) || null;
}

// Token via hash so it never enters server logs / browser history.
function readAndStripToken() {
  const hash = window.location.hash;
  if (!hash) return null;
  const m = hash.match(/(?:^|[#&])token=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const next = hash.replace(/(?:^|[#&])token=[^&]+/, "").replace(/^[#&]/, "").trim();
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`);
  return token;
}

// Inject (once) the CSS that hides DataLex's own chrome when the cloud shell
// already provides the rail/topbar. Keyed off a <html> data attribute so it
// only applies in capability-restricted embeds.
function installChromeHidingStyles() {
  if (document.getElementById("datalex-embed-chrome-css")) return;
  const style = document.createElement("style");
  style.id = "datalex-embed-chrome-css";
  style.textContent = `
    html[data-datalex-embed="minimal"] .topbar,
    html[data-datalex-embed="minimal"] .project-tabs,
    html[data-datalex-embed="minimal"] .activity-rail { display: none !important; }
    html[data-datalex-embed="no-sidebar"] .activity-rail,
    html[data-datalex-embed="no-sidebar"] .layer-spine { display: none !important; }
  `;
  document.head.appendChild(style);
}

function applyCapabilities(config) {
  const caps = (config && config.capabilities) || {};
  const root = document.documentElement;
  installChromeHidingStyles();
  if (caps.hide_activity_bar && caps.hide_sidebar) {
    root.dataset.datalexEmbed = "minimal";
  } else if (caps.hide_sidebar) {
    root.dataset.datalexEmbed = "no-sidebar";
  }
  root.dataset.datalexCloudKind = config && config.kind ? String(config.kind) : "datalex";
  root.dataset.datalexCloudSurface = config && config.surface ? String(config.surface) : "";
}

function applyTheme(tokens) {
  const root = document.documentElement;
  const map = {
    brand: "--lux-color-accent",
    ink900: "--lux-color-text",
    bg: "--lux-color-bg",
    surface: "--lux-color-surface",
    border: "--lux-color-border",
  };
  for (const [k, cssVar] of Object.entries(map)) {
    if (tokens && tokens[k]) root.style.setProperty(cssVar, tokens[k]);
  }
}

if (isEmbedded) {
  // 1. localStorage namespace.
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

  // 5. Auth pass-through.
  let bearerToken = readAndStripToken();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isApi =
      url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`) ||
      url.startsWith("/projects/") || url.startsWith(`${window.location.origin}/projects/`);
    if (!isApi) return realFetch(input, init);
    const headers = new Headers((init && init.headers) || {});
    // Identify this app to the cloud gateway so it routes to the DataLex backend.
    headers.set("x-oss-app", "datalex");
    if (bearerToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${bearerToken}`);
    return realFetch(input, { ...init, headers });
  };

  // 2/3. Message bridge — theme, context, auth token.
  window.addEventListener("message", (ev) => {
    const data = ev.data || {};
    if (data.type === "datalex.theme") {
      applyTheme(data.tokens || {});
      // Switch DataLex's own theme MODE to match the cloud (paper/white). The
      // Shell listens for this event + persists it; this is what flips light/dark.
      if (data.mode) {
        window.dispatchEvent(new CustomEvent("datalex:theme-change", { detail: { theme: data.mode } }));
      }
      return;
    }
    if ((data.type === "datalex.cloud.context" || data.type === "dql.cloud.context") && data.config) {
      window.__DATALEX_CLOUD_EMBED__ = data.config;
      applyCapabilities(data.config);
      window.dispatchEvent(new CustomEvent("datalex:cloud-context", { detail: data.config }));
      return;
    }
    if (data.type === "datalex.auth.token" && typeof data.token === "string") {
      bearerToken = data.token;
    }
  });

  // Boot-time global (if the host injected it before scripts ran).
  if (window.__DATALEX_CLOUD_EMBED__) applyCapabilities(window.__DATALEX_CLOUD_EMBED__);

  // 6. Route reporting — keep the parent's outer hash in sync for deep links.
  let lastHash = window.location.hash;
  window.addEventListener("hashchange", () => {
    if (window.location.hash === lastHash) return;
    lastHash = window.location.hash;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "datalex.route.changed", path: lastHash, projectId }, "*");
    }
  });

  // Tell the parent we're ready — it responds with context + theme + token.
  if (window.parent !== window) {
    window.parent.postMessage({ type: "datalex.embedded.ready", projectId }, "*");
  }
}

export { isEmbedded };
