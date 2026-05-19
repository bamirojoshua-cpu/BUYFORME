/* =============================================================
   BuyForMe — verify.js
   Handles: KYC document upload for shoppers
   Uses: Supabase Auth + Supabase Storage + Supabase Database
   ============================================================= */

import { supabase } from "./supabase.js";
import { getShopperDashboardHref } from "./app-paths.js";


/* ─────────────────────────────────────────────
   1. STATE
───────────────────────────────────────────── */
const files = {
  passport: null,
  ID:       null,
  permit:   null
};

let currentUser    = null;
let currentProfile = null;


/* ─────────────────────────────────────────────
   2. INIT
───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = "auth.html";
    return;
  }

  currentUser = session.user;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("uid", currentUser.id)
    .maybeSingle();

  if (!profile) {
    window.location.href = "auth.html";
    return;
  }

  currentProfile = profile;

  if (profile.role !== "shopper") {
    window.location.href = "buyers.html";
    return;
  }

  if (profile.verification_status?.toLowerCase() === "approved") {
    window.location.href = getShopperDashboardHref();
    return;
  }

  if (profile.verification_status?.toLowerCase() === "pending") {
    showPendingScreen();
    return;
  }

  initFileUploads();
  initSubmitButton();

});


/* ─────────────────────────────────────────────
   3. FILE UPLOAD LISTENERS
───────────────────────────────────────────── */
function initFileUploads() {
  const inputs = document.querySelectorAll("input[type='file']");

  inputs.forEach((input, index) => {
    input.addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;

      if (index === 0) files.passport = file;
      if (index === 1) files.ID       = file;
      if (index === 2) files.permit   = file;

      const cards = document.querySelectorAll(".upload-card");
      const card  = cards[index];
      if (card) {
        card.style.borderColor = "#1a9e6e";
        card.style.background  = "#e6f7f1";
        const action = card.querySelector(".upload-action");
        if (action) {
          action.innerHTML = `<i class="fas fa-check" style="color:#1a9e6e"></i> ${truncateFilename(file.name)}`;
        }
      }

      updateSubmitButton();
    });
  });
}


/* ─────────────────────────────────────────────
   4. SUBMIT BUTTON STATE
───────────────────────────────────────────── */
function updateSubmitButton() {
  const btn = document.querySelector(".btn-submit");
  if (!btn) return;

  const uploaded  = [files.passport, files.ID, files.permit].filter(Boolean).length;
  const remaining = 3 - uploaded;

  if (remaining === 0) {
    btn.disabled    = false;
    btn.textContent = "Submit Documents for Review";
  } else {
    btn.disabled    = true;
    btn.textContent = `Upload ${remaining} more document${remaining > 1 ? "s" : ""} to continue`;
  }
}


/* ─────────────────────────────────────────────
   5. SUBMIT BUTTON INIT
───────────────────────────────────────────── */
function initSubmitButton() {
  const btn = document.querySelector(".btn-submit");
  if (!btn) return;

  btn.disabled    = true;
  btn.textContent = "Upload 3 more documents to continue";

  btn.addEventListener("click", async () => {
    if (!files.passport || !files.ID || !files.permit) {
      showToast("Please upload all 3 documents first.", "error");
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Uploading documents...";

    try {

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast("Session expired. Please log in again.", "error");
        window.location.href = "auth.html";
        return;
      }

      const uid = session.user.id;

      const uploads = [
        { key: "passport", file: files.passport },
        { key: "ID",       file: files.ID       },
        { key: "permit",   file: files.permit   }
      ];

      const uploadedPaths = {};

      for (const item of uploads) {
        const ext  = item.file.name.split(".").pop();
        const path = `${uid}/${item.key}.${ext}`;

        const { data, error } = await supabase.storage
          .from("kyc-documents")
          .upload(path, item.file, { upsert: true });

        if (error) {
          console.error(`Upload error (${item.key}):`, error);
          throw new Error(`Failed to upload ${item.key}: ${error.message}`);
        }

        uploadedPaths[item.key] = data.path;
      }

      const { error: dbError } = await supabase
        .from("users")
        .update({
          verification_status: "pending",
          kyc_passport:        uploadedPaths.passport,
          kyc_ID:              uploadedPaths.ID,
          kyc_permit:          uploadedPaths.permit,
          submitted_at:        new Date().toISOString()
        })
        .eq("uid", uid);

      if (dbError) {
        console.error("DB update error:", dbError);
        throw dbError;
      }

      showSuccessScreen();

    } catch (err) {
      console.error("Submit error:", err);
      btn.disabled    = false;
      btn.textContent = "Submit Documents for Review";
      showToast(err.message || "Something went wrong. Please try again.", "error");
    }
  });
}


/* ─────────────────────────────────────────────
   6. SCREEN SWITCHERS
───────────────────────────────────────────── */
function showSuccessScreen() {
  const page = document.querySelector(".page");
  if (!page) return;

  page.innerHTML = `
    <div style="text-align:center; padding: 60px 20px;">
      <div style="
        width:72px; height:72px; border-radius:50%;
        background:#e6f7f1; display:flex;
        align-items:center; justify-content:center;
        font-size:2rem; margin: 0 auto 20px;
      ">✅</div>
      <h2 style="font-family:'Sora',sans-serif; font-size:1.5rem; margin-bottom:12px;">
        Documents Submitted!
      </h2>
      <p style="color:#5a7268; font-size:0.95rem; line-height:1.7; max-width:420px; margin:0 auto 8px;">
        Your KYC documents have been submitted for review.<br>
        We'll email <strong>${currentUser?.email || "you"}</strong> once you're approved.
      </p>
      <p style="color:#5a7268; font-size:0.85rem; margin-top:8px;">
        ⏱ Verification usually takes <strong>24–48 hours</strong>.
      </p>
    </div>
  `;
}

function showPendingScreen() {
  const page = document.querySelector(".page");
  if (!page) return;

  page.innerHTML = `
    <div style="text-align:center; padding: 60px 20px;">
      <div style="
        width:72px; height:72px; border-radius:50%;
        background:#fef3c7; display:flex;
        align-items:center; justify-content:center;
        font-size:2rem; margin: 0 auto 20px;
      ">⏳</div>
      <h2 style="font-family:'Sora',sans-serif; font-size:1.5rem; margin-bottom:12px;">
        Verification Pending
      </h2>
      <p style="color:#5a7268; font-size:0.95rem; line-height:1.7; max-width:420px; margin:0 auto 8px;">
        Your documents are under review. We'll email <strong>${currentUser?.email || "you"}</strong> once approved.
      </p>
      <p style="color:#5a7268; font-size:0.85rem; margin-top:8px;">
        ⏱ This usually takes <strong>24–48 hours</strong>.
      </p>
    </div>
  `;
}


/* ─────────────────────────────────────────────
   7. LOGOUT
───────────────────────────────────────────── */
window.handleLogout = async function() {
  await supabase.auth.signOut();
  window.location.href = "auth.html";
};


/* ─────────────────────────────────────────────
   8. HELPERS
───────────────────────────────────────────── */
function truncateFilename(name) {
  return name.length > 22 ? name.substring(0, 19) + "..." : name;
}

function showToast(message, type = "success") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      padding: 12px 20px; border-radius: 8px;
      font-size: 0.88rem; font-family: Inter, sans-serif;
      color: white; z-index: 1000;
      opacity: 0; transform: translateY(-8px);
      transition: all 0.25s; pointer-events: none;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent      = message;
  toast.style.background = type === "error" ? "#ef4444" : "#1a9e6e";
  toast.style.opacity    = "1";
  toast.style.transform  = "translateY(0)";

  setTimeout(() => {
    toast.style.opacity   = "0";
    toast.style.transform = "translateY(-8px)";
  }, 3000);
}