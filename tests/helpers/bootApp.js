import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function bodyMarkup(htmlFileName) {
  const html = readFileSync(resolve(ROOT, htmlFileName), "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  // Scripts are executed manually (below) instead of by jsdom, so the app's
  // own bootstrapping is under the test's control (fetch mocking, fresh
  // module state per test, no dependency on a real Supabase SDK download).
  return body.replace(/<script[\s\S]*?<\/script>/gi, "");
}

/**
 * Boots app.js against demo.html's markup in jsdom, the same way demo.html
 * does in a real browser: MOVIE_SHELF_DEMO set before load, fetch serving
 * the two demo JSON files, no Supabase involved. Returns once the initial
 * render has completed.
 */
export async function bootDemoApp({ movies = [], watchlist = [] } = {}) {
  document.body.innerHTML = bodyMarkup("demo.html");
  window.MOVIE_SHELF_DEMO = true;
  localStorage.clear();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("movies-demo.json")) {
        return { json: async () => movies };
      }
      if (String(url).includes("watchlist-demo.json")) {
        return { json: async () => watchlist };
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    })
  );

  vi.resetModules();
  await import("../../app.js");

  // init() awaits two fetches (movies, then watchlist) before doing any
  // rendering, so wait for something render-independent of the fixture data:
  // the columns menu is built unconditionally from a static column list once
  // init() reaches bindEvents().
  await vi.waitFor(() => {
    if (document.getElementById("columns-menu").childElementCount === 0) {
      throw new Error("app not yet booted");
    }
  });

  return { document };
}
