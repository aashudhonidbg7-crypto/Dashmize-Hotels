(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const cfg = window.DASHMIZE_CONFIG || {};
  const views = [
    "loginView", "signupView", "otpView", "successView",
    "recoveryView", "newPasswordView", "signedView"
  ];

  let client = null;
  let loginMethod = "email";
  let recoveryMethod = "email";
  let pending = null;
  let resendTimer = null;
  let resendSeconds = 0;
  let busy = false;
  let recoveryMode = false;

  $("year").textContent = new Date().getFullYear();

  function message(text, type = "info") {
    const el = $("message");
    el.textContent = text;
    el.className = `message ${type}`;
    el.classList.remove("hidden");
  }

  function clearMessage() {
    $("message").className = "message hidden";
    $("message").textContent = "";
  }

  function showView(id) {
    views.forEach(v => $(v).classList.toggle("hidden", v !== id));
    clearMessage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll("form button[type=submit]").forEach(btn => {
      btn.disabled = value;
    });
  }

  function validPhone(value) {
    return /^\+[1-9]\d{7,14}$/.test(value);
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validPassword(value) {
    return value.length >= 8 &&
      /[A-Z]/.test(value) &&
      /[a-z]/.test(value) &&
      /\d/.test(value) &&
      /[^A-Za-z0-9]/.test(value);
  }

  function readableError(error) {
    const msg = error?.message || "Something went wrong. Please try again.";
    if (/rate limit/i.test(msg)) {
      return "Too many requests. Please wait before requesting another OTP.";
    }
    if (/invalid.*otp|token.*invalid|expired/i.test(msg)) {
      return "The verification code is incorrect or expired. Please request a new code.";
    }
    return msg;
  }

  async function run(action) {
    if (busy) return;
    setBusy(true);
    clearMessage();
    try {
      await action();
    } catch (error) {
      message(readableError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function startTimer(seconds = 60) {
    clearInterval(resendTimer);
    resendSeconds = seconds;
    const btn = $("resendOtpBtn");

    function update() {
      btn.disabled = resendSeconds > 0 || busy;
      btn.textContent = resendSeconds > 0
        ? `Resend OTP (${resendSeconds}s)`
        : "Resend OTP";
    }

    update();
    resendTimer = setInterval(() => {
      resendSeconds = Math.max(0, resendSeconds - 1);
      update();
      if (!resendSeconds) clearInterval(resendTimer);
    }, 1000);
  }

  function openOtp(description) {
    showView("otpView");
    $("otpCode").value = "";
    $("otpDescription").textContent = description;
    startTimer();
  }

  function setMethod(kind, value) {
    const isPhone = value === "phone";
    const attr = kind === "login" ? "data-login-method" : "data-recovery-method";

    document.querySelectorAll(`[${attr}]`).forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute(attr) === value);
    });

    if (kind === "login") {
      loginMethod = value;
      $("loginIdentityLabel").textContent = isPhone ? "Mobile number" : "Email address";
      $("loginIdentity").placeholder = isPhone ? "+919876543210" : "you@hotel.com";
      $("loginIdentity").type = isPhone ? "tel" : "email";
    } else {
      recoveryMethod = value;
      $("recoveryIdentityLabel").textContent = isPhone ? "Mobile number" : "Email address";
      $("recoveryIdentity").placeholder = isPhone ? "+919876543210" : "you@hotel.com";
      $("recoveryIdentity").type = isPhone ? "tel" : "email";
      $("recoverySubmit").textContent = isPhone
        ? "Send Recovery OTP" : "Send Recovery Link";
    }
  }

  async function sendOtp(kind, identity, createUser = false) {
    if (kind === "phone") {
      return client.auth.signInWithOtp({
        phone: identity,
        options: { shouldCreateUser: createUser }
      });
    }
    return client.auth.signInWithOtp({
      email: identity,
      options: { shouldCreateUser: createUser }
    });
  }

  async function verifyOtp() {
    if (!pending) throw new Error("No verification request is active.");

    const token = $("otpCode").value.trim();
    if (!/^\d{6}$/.test(token)) {
      throw new Error("Please enter a valid six-digit OTP.");
    }

    const args = pending.kind === "phone"
      ? { phone: pending.identity, token, type: "sms" }
      : {
          email: pending.identity,
          token,
          type: pending.purpose === "signup" ? "signup" :
                pending.purpose === "recovery" ? "recovery" : "email"
        };

    const { data, error } = await client.auth.verifyOtp(args);
    if (error) throw error;

    if (pending.purpose === "signup") {
      // Email signup verification establishes a session.
      // We sign out so the user can explicitly log in.
      await client.auth.signOut();
      pending = null;
      showView("successView");
      return;
    }

    if (pending.purpose === "recovery") {
      recoveryMode = true;
      pending = null;
      showView("newPasswordView");
      return;
    }

    pending = null;
    await showSignedIn(data.user);
  }

  async function showSignedIn(user) {
    const current = user || (await client.auth.getUser()).data.user;
    if (!current) {
      showView("loginView");
      return;
    }
    $("userLabel").textContent =
      current.email || current.phone || "DashMize user";
    showView("signedView");
  }

  document.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      pending = null;
      showView(btn.dataset.view);
    });
  });

  document.querySelectorAll("[data-login-method]").forEach(btn => {
    btn.addEventListener("click", () => setMethod("login", btn.dataset.loginMethod));
  });

  document.querySelectorAll("[data-recovery-method]").forEach(btn => {
    btn.addEventListener("click", () => setMethod("recovery", btn.dataset.recoveryMethod));
  });

  document.querySelectorAll("[data-toggle-password]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.togglePassword);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      btn.textContent = visible ? "Hide" : "Show";
    });
  });

  $("signupPassword").addEventListener("input", event => {
    const value = event.target.value;
    const tests = [
      value.length >= 8,
      /[A-Z]/.test(value),
      /[a-z]/.test(value),
      /\d/.test(value),
      /[^A-Za-z0-9]/.test(value)
    ];
    const score = tests.filter(Boolean).length;
    $("strengthBar").style.width = `${score * 20}%`;
    $("strengthBar").style.background =
      score <= 2 ? "#d54b4b" : score <= 4 ? "#e3a12d" : "#168153";
    $("strengthText").textContent =
      score === 5 ? "Strong password" :
      "Use 8+ characters, uppercase, lowercase, number and symbol.";
  });

  ["signupPassword", "confirmPassword", "newPassword"].forEach(id => {
    $(id).addEventListener("keyup", event => {
      $("capsWarning").classList.toggle(
        "hidden", !event.getModifierState("CapsLock")
      );
    });
  });

  $("loginForm").addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      const identity = $("loginIdentity").value.trim();
      if (loginMethod === "phone" ? !validPhone(identity) : !validEmail(identity)) {
        throw new Error("Enter a valid email or mobile number with country code.");
      }

      const { error } = await sendOtp(loginMethod, identity, false);
      if (error) throw error;

      pending = { kind: loginMethod, identity, purpose: "login" };
      openOtp(`Enter the OTP sent to ${identity}.`);
      message("If the account is registered, a verification code has been requested.", "info");
    });
  });

  $("signupForm").addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      const name = $("fullName").value.trim();
      const hotel = $("hotelName").value.trim();
      const email = $("signupEmail").value.trim().toLowerCase();
      const phone = $("signupPhone").value.trim();
      const password = $("signupPassword").value;
      const confirm = $("confirmPassword").value;

      if (!name || !hotel || !validEmail(email)) {
        throw new Error("Complete your name, hotel name and valid email.");
      }
      if (phone && !validPhone(phone)) {
        throw new Error("Enter a valid mobile number with country code.");
      }
      if (!validPassword(password)) {
        throw new Error("Password must include 8+ characters, uppercase, lowercase, number and symbol.");
      }
      if (password !== confirm) {
        throw new Error("Passwords do not match.");
      }
      if (!$("acceptTerms").checked) {
        throw new Error("Please accept the Terms and Privacy Policy.");
      }

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            hotel_name: hotel,
            pending_phone: phone
          },
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;

      // Supabase can return an obfuscated successful signup response
      // for an existing account. Do not treat the response as proof
      // that a new account was created.
      if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
        message("If this email is eligible for registration, check your inbox for verification instructions.", "info");
        return;
      }

      pending = { kind: "email", identity: email, purpose: "signup" };
      openOtp(`Enter the signup verification code sent to ${email}.`);
      message("Verification requested. Check your email for the six-digit code.", "info");
    });
  });

  $("otpForm").addEventListener("submit", event => {
    event.preventDefault();
    run(verifyOtp);
  });

  $("resendOtpBtn").addEventListener("click", () => {
    if (!pending || resendSeconds > 0) return;

    run(async () => {
      let result;
      if (pending.purpose === "signup") {
        result = await client.auth.resend({
          type: "signup",
          email: pending.identity
        });
      } else if (pending.purpose === "recovery" && pending.kind === "phone") {
        result = await client.auth.resetPasswordForEmail("");
        throw new Error("Mobile recovery resend requires a new phone recovery OTP request.");
      } else {
        result = await sendOtp(pending.kind, pending.identity, false);
      }

      if (result?.error) throw result.error;
      startTimer();
      message("A new verification code has been requested.", "success");
    });
  });

  $("recoveryForm").addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      const identity = $("recoveryIdentity").value.trim();

      if (recoveryMethod === "email") {
        if (!validEmail(identity)) throw new Error("Enter a valid email.");
        const { error } = await client.auth.resetPasswordForEmail(identity, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        message("If this email is registered, a password recovery link has been requested.", "success");
      } else {
        if (!validPhone(identity)) {
          throw new Error("Enter a valid mobile number with country code.");
        }
        const { error } = await sendOtp("phone", identity, false);
        if (error) throw error;
        pending = { kind: "phone", identity, purpose: "recovery" };
        openOtp(`Enter the recovery code sent to ${identity}.`);
        message("If this number is registered, a recovery code has been requested.", "info");
      }
    });
  });

  $("newPasswordForm").addEventListener("submit", event => {
    event.preventDefault();
    run(async () => {
      const password = $("newPassword").value;
      if (!validPassword(password)) {
        throw new Error("Use 8+ characters, uppercase, lowercase, number and symbol.");
      }
      if (password !== $("newPasswordConfirm").value) {
        throw new Error("Passwords do not match.");
      }
      if (!recoveryMode) {
        throw new Error("Start password recovery before updating your password.");
      }

      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      recoveryMode = false;
      await client.auth.signOut();
      showView("loginView");
      message("Password updated successfully. Kindly log in.", "success");
    });
  });

  $("googleBtn").addEventListener("click", () => {
    run(async () => {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;
    });
  });

  $("logoutBtn").addEventListener("click", () => {
    run(async () => {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      showView("loginView");
      message("You have logged out successfully.", "success");
    });
  });

  async function initialize() {
    if (!window.supabase ||
        !cfg.supabaseUrl ||
        !(cfg.supabasePublishableKey || cfg.supabaseAnonKey)) {
      message("Supabase configuration is missing. Check config.js.", "error");
      return;
    }

    client = window.supabase.createClient(
      cfg.supabaseUrl,
      cfg.supabasePublishableKey || cfg.supabaseAnonKey
    );

    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        showView("newPasswordView");
      }
    });

    // Existing sessions are not automatically treated as fresh OTP
    // verification. This UI does not implement server-enforced MFA.
    const { data } = await client.auth.getSession();
    if (data.session && !recoveryMode) {
      await showSignedIn(data.session.user);
    }
  }

  initialize().catch(error => message(readableError(error), "error"));
})();
