import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

/**
 * Boots login.js against login.html's markup in jsdom, with a fake
 * supabaseClient instead of the real CDN SDK. Redirects (window.location.href
 * assignment on an existing session or a successful sign-in) are triggered
 * by the real code but deliberately not asserted here — jsdom's Location
 * object doesn't implement navigation, so it's not a meaningful thing to
 * check in this environment. What IS covered: the getSession() gate,
 * signInWithPassword being called with the form's values, and the
 * error/loading states the form shows.
 */
export async function bootLogin({ existingSession = null, signInResult = { error: null } } = {}) {
  const html = readFileSync(resolve(ROOT, "login.html"), "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, "");
  document.body.innerHTML = body;

  const getSession = vi.fn(async () => ({ data: { session: existingSession } }));
  const signInWithPassword = vi.fn(async () => signInResult);
  window.supabaseClient = { auth: { getSession, signInWithPassword } };

  vi.resetModules();
  await import("../../login.js");

  // Let the top-of-file getSession() check resolve before the test proceeds.
  await vi.waitFor(() => {
    if (getSession.mock.calls.length === 0) throw new Error("login.js not yet booted");
  });

  return { document, getSession, signInWithPassword };
}
