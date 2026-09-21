import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function bodyMarkup() {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, "");
}

function fakeQuery(result) {
  return { select: () => ({ order: async () => result }) };
}

// jsdom doesn't implement matchMedia; app.js tolerates that (falls back to
// non-touch) but stub it anyway for parity with bootApp.js.
function stubMatchMedia(touch) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query) => ({
      matches: query === "(hover: none)" && touch,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

/**
 * Boots app.js in real (non-demo) mode against index.html's markup, with a
 * fake supabaseClient instead of the real SDK/network. Mirrors what a
 * signed-in or signed-out visitor to the real app sees, including
 * index.html's inline visibility:hidden style and the app.js code that
 * reveals it — see the top-of-<head> comment in index.html for why that
 * exists (prevents a flash of the empty app shell before redirecting a
 * signed-out visitor to /login).
 */
export async function bootRealApp({ session = null, movies = [], watchlist = [], touch = false } = {}) {
  document.body.innerHTML = bodyMarkup();
  const style = document.createElement("style");
  style.textContent = "body { visibility: hidden; }";
  document.head.appendChild(style);

  delete window.MOVIE_SHELF_DEMO;
  stubMatchMedia(touch);

  const getSession = vi.fn(async () => ({ data: { session } }));
  const onAuthStateChange = vi.fn();
  const from = vi.fn((table) => {
    if (table === "movies") return fakeQuery({ data: movies, error: null });
    if (table === "watchlist") return fakeQuery({ data: watchlist, error: null });
    throw new Error(`Unexpected table in test: ${table}`);
  });
  window.supabaseClient = { auth: { getSession, onAuthStateChange }, from };

  vi.resetModules();
  await import("../../app.js");

  if (session) {
    await vi.waitFor(() => {
      if (document.getElementById("columns-menu").childElementCount === 0) {
        throw new Error("app not yet booted");
      }
    });
  } else {
    await vi.waitFor(() => {
      if (getSession.mock.calls.length === 0) throw new Error("session check not yet run");
    });
  }

  return { document, getSession };
}
