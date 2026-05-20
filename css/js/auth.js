/* =============================================================
   BuyForMe — auth.js
   Handles: login, signup, tab switching,
            role selection, validation, routing
   Uses: Supabase Auth + Supabase Database
   ============================================================= */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";


/* ─────────────────────────────────────────────
   1. STATE
───────────────────────────────────────────── */
let mode         = "login";  // "login" or "signup"
let selectedRole = "buyer";  // "buyer" or "shopper"


/* ─────────────────────────────────────────────
   2. INIT
───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initRoleSelector();
  initForm();
  await redirectIfAlreadyLoggedIn();
});

async function fetchUserProfile(uid) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    console.error("Profile fetch error:", error);
    throw new Error(error.message || "Could not load your account profile.");
  }
  return data;
}

async function redirectIfAlreadyLoggedIn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("logged_out") === "1") {
    try {
      await supabase.auth.signOut({ scope: "global" });
      Object.keys(localStorage).forEach(key => {
        if (key === "bfm-auth" || key.startsWith("bfm-auth")) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      /* ignore */
    }
    if (window.history.replaceState) {
      window.history.replaceState({}, "", "auth.html");
    }
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  try {
    const profile = await fetchUserProfile(session.user.id);
    if (profile) routeUser(profile.role, profile.verification_status);
  } catch (err) {
    console.warn("Session exists but profile unavailable:", err);
  }
}


/* ─────────────────────────────────────────────
   3. TAB SWITCHING
───────────────────────────────────────────── */
function initTabs() {
  const loginTab  = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  if (!loginTab || !signupTab) return;

  loginTab.addEventListener("click",  () => switchTab("login"));
  signupTab.addEventListener("click", () => switchTab("signup"));

  // footer links
  const toSignup = document.getElementById("switchToSignup");
  const toLogin  = document.getElementById("switchToLogin");
  if (toSignup) toSignup.addEventListener("click", e => { e.preventDefault(); switchTab("signup"); });
  if (toLogin)  toLogin.addEventListener("click",  e => { e.preventDefault(); switchTab("login");  });
}

function switchTab(tab) {
  mode = tab;

  document.getElementById("loginTab").classList.toggle("active",  tab === "login");
  document.getElementById("signupTab").classList.toggle("active", tab === "signup");

  const roleSection = document.getElementById("roleSection");
  const nameSection = document.getElementById("nameSection");
  if (roleSection) roleSection.classList.toggle("show", tab === "signup");
  if (nameSection) nameSection.classList.toggle("show", tab === "signup");

  const titleEl    = document.getElementById("authTitle");
  const subtitleEl = document.getElementById("authSubtitle");
  const btnEl      = document.getElementById("authBtn");
  const footerEl   = document.getElementById("authFooter");

  if (titleEl)    titleEl.textContent    = tab === "login" ? "Welcome back" : "Create your account";
  if (subtitleEl) subtitleEl.textContent = tab === "login"
    ? "Log in to your BuyForMe account"
    : "Join thousands of buyers and shoppers";
  if (btnEl)      btnEl.textContent      = tab === "login" ? "Login" : "Create Account";
  if (footerEl)   footerEl.innerHTML     = tab === "login"
    ? `Don't have an account? <a href="#" id="switchToSignup">Sign up free</a>`
    : `Already have an account? <a href="#" id="switchToLogin">Login</a>`;

  // re-attach footer link listeners after innerHTML change
  const toSignup = document.getElementById("switchToSignup");
  const toLogin  = document.getElementById("switchToLogin");
  if (toSignup) toSignup.addEventListener("click", e => { e.preventDefault(); switchTab("signup"); });
  if (toLogin)  toLogin.addEventListener("click",  e => { e.preventDefault(); switchTab("login");  });

  hideError();
}


/* ─────────────────────────────────────────────
   4. ROLE SELECTOR
───────────────────────────────────────────── */
function initRoleSelector() {
  const options = document.querySelectorAll(".role-option");
  options.forEach(option => {
    option.addEventListener("click", () => {
      options.forEach(o => o.classList.remove("selected"));
      option.classList.add("selected");
      selectedRole = option.dataset.role;
    });
  });
}


/* ─────────────────────────────────────────────
   5. FORM SETUP
───────────────────────────────────────────── */
function initForm() {
  const form = document.getElementById("authForm");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    handleAuth();
  });
}


/* ─────────────────────────────────────────────
   6. VALIDATION
───────────────────────────────────────────── */
function validate() {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const nameEl   = document.getElementById("fullName");
  const name     = nameEl ? nameEl.value.trim() : "";

  if (!email || !email.includes("@")) {
    showError("Please enter a valid email address.");
    return false;
  }
  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return false;
  }
  if (mode === "signup" && !name) {
    showError("Please enter your full name.");
    return false;
  }
  return true;
}


/* ─────────────────────────────────────────────
   7. MAIN AUTH HANDLER
───────────────────────────────────────────── */
async function handleAuth() {
  hideError();
  if (!validate()) return;

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const nameEl   = document.getElementById("fullName");
  const name     = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : "User";
  const btn      = document.getElementById("authBtn");

  btn.disabled    = true;
  btn.textContent = "Please wait...";

  try {

    if (mode === "signup") {
      // ── SIGNUP ──

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      const uid = data.user?.id;
      if (!uid) {
        showError("Signup failed. Please try again.");
        btn.disabled    = false;
        btn.textContent = "Create Account";
        return;
      }

      // Avoid duplicate inserts
      const { data: existing } = await supabase
        .from("users")
        .select("uid")
        .eq("uid", uid)
        .maybeSingle();

      if (!existing) {
        const { error: dbError } = await supabase.from("users").insert({
          uid:                 uid,
          name:                name,
          email:               email,
          role:                selectedRole,
          verification_status: selectedRole === "shopper" ? "none" : "n/a",
          joined_at:           Date.now()
        });
        if (dbError) throw dbError;
      }

      // If email confirmation is ON, session will be null
      if (!data.session) {
        showError("✅ Account created! Check your email to confirm, then log in.");
        btn.disabled    = false;
        btn.textContent = "Create Account";
        return;
      }

      // Email confirmation OFF → route immediately
      routeUser(selectedRole, "none");

    } else {
      // ── LOGIN ──

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const profile = await fetchUserProfile(data.user.id);

      if (!profile) {
        showError("Account not found. Please sign up first.");
        btn.disabled    = false;
        btn.textContent = "Login";
        return;
      }

      routeUser(profile.role, profile.verification_status);
    }

  } catch (err) {
    console.error("Auth error:", err);
    let msg = err.message || "Something went wrong. Please try again.";
    if (/fetch|network|failed to load/i.test(msg)) {
      msg = "Network error — check your connection. For local dev, use http://localhost:5173/auth.html (not /BUYFORME/).";
    }
    showError(msg);
    btn.disabled    = false;
    btn.textContent = mode === "login" ? "Login" : "Create Account";
  }
}


/* ─────────────────────────────────────────────
   8. ROUTING — admin goes to admin.html
───────────────────────────────────────────── */
function routeUser(role, verificationStatus) {
  const r = String(role || "").toLowerCase();

  if (r === "admin") {
    window.location.assign("admin.html");
  } else if (r === "shopper") {
    if (verificationStatus?.toLowerCase() === "approved") {
      window.location.assign(getShopperDashboardHref());
    } else {
      window.location.assign("verify.html");
    }
  } else {
    window.location.assign("buyers.html");
  }
}


/* ─────────────────────────────────────────────
   9. ERROR HELPERS
───────────────────────────────────────────── */
function showError(message) {
  const el = document.getElementById("errorMsg");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
}

function hideError() {
  const el = document.getElementById("errorMsg");
  if (el) el.classList.remove("show");
}