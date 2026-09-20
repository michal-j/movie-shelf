(() => {
  "use strict";
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");

  (async () => {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (session) window.location.href = "/";
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const fd = new FormData(form);
    const email = fd.get("email").trim();
    const password = fd.get("password");

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      errorEl.textContent = "Incorrect email or password.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
      return;
    }
    window.location.href = "/";
  });
})();
