import { describe, it, expect, vi } from "vitest";
import { bootLogin } from "./helpers/bootLogin.js";

async function submit({ email = "me@example.com", password = "hunter2" } = {}) {
  document.querySelector('input[name="email"]').value = email;
  document.querySelector('input[name="password"]').value = password;
  document.getElementById("login-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
}

describe("login page structure", () => {
  it("has a Sign in card with the fields login.js binds to", async () => {
    await bootLogin();
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(document.querySelector('input[name="password"]')).not.toBeNull();
    expect(document.getElementById("login-error").textContent).toBe("");
    expect(document.querySelector("#login-form button[type=submit]").textContent).toBe("Sign in");
  });

  it("has a Try the demo card linking to demo.html", async () => {
    await bootLogin();
    const cta = document.querySelector(".login-demo-cta");
    expect(cta.getAttribute("href")).toBe("demo.html");
  });

  it("checks for an existing session on load", async () => {
    const { getSession } = await bootLogin();
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});

describe("login form submission", () => {
  it("shows an error and re-enables the button when sign-in fails", async () => {
    const { signInWithPassword } = await bootLogin({
      signInResult: { error: { message: "Invalid login credentials" } },
    });

    await submit({ email: "me@example.com", password: "wrong" });
    await vi.waitFor(() => {
      if (signInWithPassword.mock.calls.length === 0) throw new Error("not called yet");
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "wrong" });
    expect(document.getElementById("login-error").textContent).toBe("Incorrect email or password.");
    const submitBtn = document.querySelector("#login-form button[type=submit]");
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe("Sign in");
  });

  it("calls signInWithPassword with the form's values on submit", async () => {
    // Redirect-on-success isn't asserted here: jsdom's Location object
    // doesn't implement navigation, so window.location.href assignment
    // isn't meaningfully observable in this environment.
    const { signInWithPassword } = await bootLogin({ signInResult: { error: null } });

    await submit({ email: "me@example.com", password: "hunter2" });
    await vi.waitFor(() => {
      if (signInWithPassword.mock.calls.length === 0) throw new Error("not called yet");
    });

    expect(signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "hunter2" });
  });
});
