/**
 * CHEKORGANICS — Authentication Controller (auth.js)
 * Manages Login, Sign-up, Password Reset, and User Profile/Orders modal.
 */

(function () {
  "use strict";

  let currentUser = null;
  let currentView = "login"; // login | signup | forgot | profile

  function $id(id) {
    return document.getElementById(id);
  }

  // Order fields are typed by shoppers (anyone can create an order), so escape before innerHTML
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Toast notification helper
  function showToast(msg) {
    if (window.toast) {
      window.toast(msg);
      return;
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("is-visible"), 10);
    setTimeout(() => {
      t.classList.remove("is-visible");
      setTimeout(() => t.remove(), 300);
    }, 3200);
  }

  // Build and inject Auth Modal into DOM
  function injectAuthModal() {
    if ($id("auth-modal-backdrop")) return;

    const modalHTML = `
      <div class="auth-modal-backdrop" id="auth-modal-backdrop" aria-hidden="true">
        <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
          <button type="button" class="auth-modal__close" id="auth-modal-close" aria-label="Close dialog">✕</button>
          
          <div class="auth-modal__header">
            <span class="auth-modal__badge">Ayurvedic Member Portal</span>
            <h3 class="auth-modal__title" id="auth-modal-title">Welcome to ChekOrganics</h3>
            <p class="auth-modal__desc" id="auth-modal-desc">Access your orders, wishlist, and farm rewards</p>
          </div>

          <div class="auth-modal__body">
            <!-- Alert Banner -->
            <div class="auth-alert auth-alert--error" id="auth-alert-error"></div>
            <div class="auth-alert auth-alert--success" id="auth-alert-success"></div>

            <!-- VIEW 1: LOGIN -->
            <div id="auth-view-login">
              <form id="auth-form-login">
                <div class="auth-form-group">
                  <label for="login-email">Email Address</label>
                  <input type="email" id="login-email" class="auth-input" placeholder="name@example.com" required autocomplete="email">
                </div>
                <div class="auth-form-group">
                  <label for="login-password">Password</label>
                  <div style="position:relative;display:flex;align-items:center">
                    <input type="password" id="login-password" class="auth-input" placeholder="••••••••" required autocomplete="current-password" style="padding-right:2.8rem">
                    <button type="button" class="btn-toggle-pass" data-target="login-password" style="position:absolute;right:0.6rem;background:none;border:none;cursor:pointer;padding:0.4rem;display:flex;align-items:center;color:#64748b" aria-label="Toggle password visibility">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                  </div>
                </div>
                <div class="auth-helper-row">
                  <span></span>
                  <button type="button" class="auth-link-btn" id="btn-to-forgot">Forgot Password?</button>
                </div>
                <button type="submit" class="auth-btn-submit" id="btn-submit-login">
                  <span>Sign In</span>
                </button>
              </form>
              <div class="auth-footer-switch">
                Don't have an account? <button type="button" class="auth-link-btn" id="btn-to-signup">Create one now</button>
              </div>
            </div>

            <!-- VIEW 2: SIGN UP -->
            <div id="auth-view-signup" style="display:none">
              <form id="auth-form-signup">
                <div class="auth-form-group">
                  <label for="signup-name">Full Name</label>
                  <input type="text" id="signup-name" class="auth-input" placeholder="Rahul Sharma" required autocomplete="name">
                </div>
                <div class="auth-form-group">
                  <label for="signup-email">Email Address</label>
                  <input type="email" id="signup-email" class="auth-input" placeholder="name@example.com" required autocomplete="email">
                </div>
                <div class="auth-form-group">
                  <label for="signup-password">Create Password</label>
                  <div style="position:relative;display:flex;align-items:center">
                    <input type="password" id="signup-password" class="auth-input" placeholder="At least 6 characters" required autocomplete="new-password" minlength="6" style="padding-right:2.8rem">
                    <button type="button" class="btn-toggle-pass" data-target="signup-password" style="position:absolute;right:0.6rem;background:none;border:none;cursor:pointer;padding:0.4rem;display:flex;align-items:center;color:#64748b" aria-label="Toggle password visibility">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                  </div>
                </div>
                <button type="submit" class="auth-btn-submit" id="btn-submit-signup">
                  <span>Create Account</span>
                </button>
              </form>
              <div class="auth-footer-switch">
                Already have an account? <button type="button" class="auth-link-btn" id="btn-to-login">Sign In</button>
              </div>
            </div>

            <!-- VIEW 3: FORGOT PASSWORD -->
            <div id="auth-view-forgot" style="display:none">
              <form id="auth-form-forgot">
                <p style="font-size:0.88rem;color:#475569;margin-top:0;margin-bottom:1rem;line-height:1.4">
                  Enter your registered email address. Google Firebase will instantly email you a secure link to reset your password.
                </p>
                <div class="auth-form-group">
                  <label for="forgot-email">Registered Email</label>
                  <input type="email" id="forgot-email" class="auth-input" placeholder="name@example.com" required autocomplete="email">
                </div>
                <button type="submit" class="auth-btn-submit" id="btn-submit-forgot">
                  <span>Send Password Reset Link</span>
                </button>
              </form>
              <div class="auth-footer-switch">
                Remember your password? <button type="button" class="auth-link-btn" id="btn-forgot-back">Back to Sign In</button>
              </div>
            </div>

            <!-- VIEW 4: USER PROFILE / ORDERS -->
            <div id="auth-view-profile" style="display:none">
              <div class="auth-profile-card">
                <div class="auth-avatar-circle" id="profile-avatar">U</div>
                <h4 class="auth-profile-name" id="profile-name">Customer</h4>
                <p class="auth-profile-email" id="profile-email">email@example.com</p>
              </div>

              <div class="auth-orders-section">
                <div class="auth-orders-title">
                  <span>Recent Orders</span>
                  <span id="profile-orders-count" style="font-weight:400;color:#64748b">0 orders</span>
                </div>
                <div class="auth-orders-list" id="profile-orders-list">
                  <div class="auth-order-empty">Loading your orders…</div>
                </div>
              </div>

              <button type="button" class="auth-btn-submit" id="btn-logout" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;margin-top:0.75rem">
                Sign Out
              </button>
            </div>

            <!-- VIEW 5: TRACK ORDER -->
            <div id="auth-view-track" style="display:none">
              <form id="auth-form-track">
                <p style="font-size:0.88rem;color:#475569;margin-top:0;margin-bottom:1rem;line-height:1.4">
                  Enter your <b>Order ID</b> (e.g. CHEK-12345) or <b>10-digit Mobile Number</b> to track live delivery updates.
                </p>
                <div class="auth-form-group">
                  <label for="track-query">Order ID or Mobile Number</label>
                  <input type="text" id="track-query" class="auth-input" placeholder="e.g. CHEK-00123 or 9876543210" required>
                </div>
                <button type="submit" class="auth-btn-submit" id="btn-submit-track">
                  <span>Track Live Order 🚚</span>
                </button>
              </form>

              <!-- Live Tracking Results Box -->
              <div id="track-result-box" style="display:none;margin-top:1.25rem;border-top:1px solid #eee8df;padding-top:1.1rem"></div>

              <div class="auth-footer-switch">
                Need to view all orders? <button type="button" class="auth-link-btn" id="btn-track-to-login">Sign In to Account</button>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHTML);
    bindAuthEvents();
  }

  function setAlert(type, msg) {
    const errEl = $id("auth-alert-error");
    const succEl = $id("auth-alert-success");
    if (!errEl || !succEl) return;

    errEl.style.display = "none";
    succEl.style.display = "none";

    if (!msg) return;

    if (type === "error") {
      errEl.textContent = msg;
      errEl.style.display = "block";
    } else {
      succEl.textContent = msg;
      succEl.style.display = "block";
    }
  }

  function switchView(view) {
    currentView = view;
    setAlert(null, null);

    const vLogin = $id("auth-view-login");
    const vSignup = $id("auth-view-signup");
    const vForgot = $id("auth-view-forgot");
    const vProfile = $id("auth-view-profile");
    const vTrack = $id("auth-view-track");

    const tTitle = $id("auth-modal-title");
    const tDesc = $id("auth-modal-desc");

    if (vLogin) vLogin.style.display = view === "login" ? "block" : "none";
    if (vSignup) vSignup.style.display = view === "signup" ? "block" : "none";
    if (vForgot) vForgot.style.display = view === "forgot" ? "block" : "none";
    if (vProfile) vProfile.style.display = view === "profile" ? "block" : "none";
    if (vTrack) vTrack.style.display = view === "track" ? "block" : "none";

    if (view === "login") {
      if (tTitle) tTitle.textContent = "Welcome Back";
      if (tDesc) tDesc.textContent = "Sign in to manage your orders & preferences";
    } else if (view === "signup") {
      if (tTitle) tTitle.textContent = "Create Account";
      if (tDesc) tDesc.textContent = "Join CHEKORGANICS family for pure Ayurvedic wellness";
    } else if (view === "forgot") {
      if (tTitle) tTitle.textContent = "Reset Password";
      if (tDesc) tDesc.textContent = "Receive an official password reset link by email";
    } else if (view === "profile") {
      if (tTitle) tTitle.textContent = "My Account";
      if (tDesc) tDesc.textContent = "Manage your orders and account details";
      loadProfileOrders();
    } else if (view === "track") {
      if (tTitle) tTitle.textContent = "Track Order";
      if (tDesc) tDesc.textContent = "Live status & dispatch updates from Telangana organic farm";
      const resBox = $id("track-result-box");
      if (resBox) resBox.style.display = "none";
    }
  }

  async function loadProfileOrders() {
    const listEl = $id("profile-orders-list");
    const countEl = $id("profile-orders-count");
    if (!listEl) return;

    if (!currentUser) {
      listEl.innerHTML = '<div class="auth-order-empty">Please sign in to view orders.</div>';
      return;
    }

    try {
      const orders = window.FirebaseDB && window.FirebaseDB.getUserOrders
        ? await window.FirebaseDB.getUserOrders(currentUser.email)
        : [];

      if (countEl) countEl.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"}`;

      if (!orders.length) {
        listEl.innerHTML = '<div class="auth-order-empty">No orders found yet. Start shopping!</div>';
        return;
      }

      listEl.innerHTML = orders.map((o) => {
        const id = o.orderId || (o.id ? o.id.slice(0, 8) : "CHEK-ORDER");
        const total = o.payment && o.payment.total ? "₹" + Number(o.payment.total).toLocaleString("en-IN") : "—";
        const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN") : "Recent";
        return `
          <div class="auth-order-item">
            <div>
              <b>#${esc(id)}</b><br>
              <span style="color:#64748b;font-size:0.75rem">${date} · ${o.items ? o.items.length + " item(s)" : ""}</span>
            </div>
            <div style="text-align:right">
              <span style="font-weight:700;color:#0f2e1d">${total}</span><br>
              <span style="color:#166534;font-size:0.72rem;font-weight:600">● ${esc(o.deliveryStatus || "Confirmed")}</span>
            </div>
          </div>
        `;
      }).join("");
    } catch (e) {
      listEl.innerHTML = '<div class="auth-order-empty">Could not load orders at this moment.</div>';
    }
  }

  function openAuthModal(view) {
    injectAuthModal();
    const bd = $id("auth-modal-backdrop");
    if (bd) {
      bd.classList.add("is-open");
      bd.setAttribute("aria-hidden", "false");
    }
    if (view === "track") {
      switchView("track");
    } else if (currentUser) {
      switchView("profile");
    } else {
      switchView(view || "login");
    }
  }

  function closeAuthModal() {
    const bd = $id("auth-modal-backdrop");
    if (bd) {
      bd.classList.remove("is-open");
      bd.setAttribute("aria-hidden", "true");
    }
  }

  function bindAuthEvents() {
    const bd = $id("auth-modal-backdrop");
    const closeBtn = $id("auth-modal-close");

    if (closeBtn) closeBtn.onclick = closeAuthModal;
    if (bd) {
      bd.onclick = (e) => {
        if (e.target === bd) closeAuthModal();
      };
    }

    // View switch buttons
    const toSignup = $id("btn-to-signup");
    if (toSignup) toSignup.onclick = () => switchView("signup");

    const toLogin = $id("btn-to-login");
    if (toLogin) toLogin.onclick = () => switchView("login");

    const toForgot = $id("btn-to-forgot");
    if (toForgot) toForgot.onclick = () => switchView("forgot");

    const forgotBack = $id("btn-forgot-back");
    if (forgotBack) forgotBack.onclick = () => switchView("login");

    // Eye Toggle Buttons for Password Fields
    document.querySelectorAll(".btn-toggle-pass").forEach((btn) => {
      btn.onclick = () => {
        const inputId = btn.dataset.target;
        const input = $id(inputId);
        if (!input) return;
        const isPass = input.type === "password";
        input.type = isPass ? "text" : "password";
        btn.innerHTML = isPass
          ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0f2e1d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`
          : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
      };
    });

    // Login Form
    const loginForm = $id("auth-form-login");
    if (loginForm) {
      loginForm.onsubmit = async (e) => {
        e.preventDefault();
        setAlert(null, null);
        const email = $id("login-email").value;
        const pass = $id("login-password").value;
        const submitBtn = $id("btn-submit-login");

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "<span>Signing in…</span>";
          }
          if (window.FirebaseDB && window.FirebaseDB.signIn) {
            await window.FirebaseDB.signIn(email, pass);
            showToast("Welcome back!");
            closeAuthModal();
          } else {
            throw new Error("Firebase Auth service is connecting. Please wait.");
          }
        } catch (err) {
          let msg = err.message || "Failed to sign in.";
          if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
            msg = "Invalid email or password. Please verify and try again.";
          } else if (err.code === "auth/invalid-email") {
            msg = "Please enter a valid email address.";
          }
          setAlert("error", msg);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>Sign In</span>";
          }
        }
      };
    }

    // Signup Form
    const signupForm = $id("auth-form-signup");
    if (signupForm) {
      signupForm.onsubmit = async (e) => {
        e.preventDefault();
        setAlert(null, null);
        const name = $id("signup-name").value;
        const email = $id("signup-email").value;
        const pass = $id("signup-password").value;
        const submitBtn = $id("btn-submit-signup");

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "<span>Creating Account…</span>";
          }
          if (window.FirebaseDB && window.FirebaseDB.signUp) {
            await window.FirebaseDB.signUp(name, email, pass);
            showToast("Account created successfully!");
            closeAuthModal();
          } else {
            throw new Error("Firebase Auth service is connecting. Please wait.");
          }
        } catch (err) {
          let msg = err.message || "Failed to create account.";
          if (err.code === "auth/email-already-in-use") {
            msg = "This email is already registered. Try signing in instead.";
          } else if (err.code === "auth/weak-password") {
            msg = "Password should be at least 6 characters long.";
          }
          setAlert("error", msg);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>Create Account</span>";
          }
        }
      };
    }

    // Forgot Password Form
    const forgotForm = $id("auth-form-forgot");
    if (forgotForm) {
      forgotForm.onsubmit = async (e) => {
        e.preventDefault();
        setAlert(null, null);
        const email = $id("forgot-email").value;
        const submitBtn = $id("btn-submit-forgot");

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "<span>Sending Reset Link…</span>";
          }
          if (window.FirebaseDB && window.FirebaseDB.sendPasswordReset) {
            await window.FirebaseDB.sendPasswordReset(email);
            setAlert("success", "Password reset link sent! Check your email inbox & spam folder.");
            forgotForm.reset();
          } else {
            throw new Error("Firebase Auth service is connecting. Please wait.");
          }
        } catch (err) {
          let msg = err.message || "Failed to send reset link.";
          if (err.code === "auth/user-not-found") {
            msg = "No account found with this email.";
          }
          setAlert("error", msg);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>Send Password Reset Link</span>";
          }
        }
      };
    }

    // Track Order Form
    const toTrackLogin = $id("btn-track-to-login");
    if (toTrackLogin) toTrackLogin.onclick = () => switchView("login");

    const trackForm = $id("auth-form-track");
    if (trackForm) {
      trackForm.onsubmit = async (e) => {
        e.preventDefault();
        setAlert(null, null);
        const q = $id("track-query").value;
        const submitBtn = $id("btn-submit-track");
        const resBox = $id("track-result-box");

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "<span>Searching order…</span>";
          }
          if (window.FirebaseDB && window.FirebaseDB.trackOrder) {
            const order = await window.FirebaseDB.trackOrder(q);
            renderTrackingResult(order);
          } else {
            throw new Error("Tracking service is loading. Please try again.");
          }
        } catch (err) {
          setAlert("error", err.message || "Order not found. Please verify details.");
          if (resBox) resBox.style.display = "none";
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>Track Live Order 🚚</span>";
          }
        }
      };
    }

    // Logout Button
    const logoutBtn = $id("btn-logout");
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        try {
          if (window.FirebaseDB && window.FirebaseDB.signOut) {
            await window.FirebaseDB.signOut();
            showToast("Signed out successfully.");
            closeAuthModal();
          }
        } catch (e) {
          showToast("Failed to sign out.");
        }
      };
    }
  }

  function renderTrackingResult(order) {
    const resBox = $id("track-result-box");
    if (!resBox) return;

    const oId = order.orderId || (order.id ? order.id.slice(0, 8) : "CHEK-ORDER");
    const name = order.customer ? order.customer.name : "Customer";
    const dest = order.address ? `${order.address.city}, ${order.address.state} — ${order.address.pincode || ""}` : "Verified Address";
    const eta = order.shipping && order.shipping.eta ? order.shipping.eta : "In 3-4 Days";
    const items = order.items || [];
    const total = order.payment ? ("₹" + Number(order.payment.total).toLocaleString("en-IN")) : "";

    // Timeline follows the deliveryStatus the admin portal sets (admin.html status select)
    const status = order.deliveryStatus || "Confirmed & Batched";
    const cancelled = status.includes("Cancelled");
    const STAGES = ["Order Placed & Confirmed", "Farm Batching (Telangana Herbal Facility)", "Dispatched & In Transit", "Out for Delivery", "Delivered"];
    const stage = status === "Delivered" ? 4 : status.includes("Out for") ? 3 : status.includes("Dispatched") ? 2 : status.includes("Batching") ? 1 : 0;
    const stepHtml = (label, i) => {
      const done = !cancelled && i <= stage;
      const next = !cancelled && i === stage + 1;
      const color = done ? "#166534" : next ? "#c29a45" : "#94a3b8";
      const dot = done
        ? `<span style="background:#166534;color:#fff;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:0.7rem">✓</span>`
        : next
          ? `<span style="background:#c29a45;color:#fff;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:0.7rem">●</span>`
          : `<span style="border:1.5px solid #cbd5e1;color:#94a3b8;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:0.7rem">○</span>`;
      return `<div style="display:flex;align-items:center;gap:0.6rem;color:${color};font-weight:${done || next ? 600 : 400}">${dot}<span>${esc(label)}</span></div>`;
    };
    const badge = cancelled
      ? `<span style="background:#fee2e2;color:#991b1b;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid #fecaca">● Cancelled</span>`
      : `<span style="background:#dcfce7;color:#166534;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid #bbf7d0">● ${esc(STAGES[stage].split(" (")[0])}</span>`;

    resBox.innerHTML = `
      <div style="background:#faf8f5;border:1.5px solid #ded8ce;border-radius:14px;padding:1.1rem;box-shadow:0 4px 14px rgba(15,46,29,0.06)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem">
          <span style="font-family:'Fraunces',serif;font-size:1.15rem;color:#0f2e1d;font-weight:600">#${esc(oId)}</span>
          ${badge}
        </div>

        <div style="font-size:0.82rem;color:#475569;line-height:1.5;margin-bottom:0.9rem">
          Customer: <b>${esc(name)}</b><br>
          Destination: <b>${esc(dest)}</b><br>
          Estimated Delivery: <b style="color:#0f2e1d">${esc(eta)}</b>
        </div>

        <!-- Live Tracker Timeline -->
        <div style="border-top:1px solid #e2dcd1;padding-top:0.9rem;margin-bottom:0.9rem;display:flex;flex-direction:column;gap:0.6rem;font-size:0.82rem">
          ${STAGES.map(stepHtml).join("")}
        </div>

        <!-- Ordered Items Preview -->
        <div style="border-top:1px solid #e2dcd1;padding-top:0.75rem">
          <div style="display:flex;justify-content:space-between;font-size:0.78rem;font-weight:700;color:#0f2e1d;margin-bottom:0.4rem">
            <span>ORDERED ITEMS (${items.length})</span>
            <span>${total}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.4rem">
            ${items.map(it => `
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#334155">
                <span>• ${it.title ? esc(String(it.title).slice(0, 38)) + "…" : "Ayurvedic Product"} × ${Number(it.qty) || 1}</span>
                <b>₹${(Number(it.price) || 0) * (Number(it.qty) || 1)}</b>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    resBox.style.display = "block";
  }

  // Update Navigation UI when user signs in or out
  function updateNavState(user) {
    currentUser = user;

    // Header badge & buttons
    const userBadges = document.querySelectorAll("#auth-user-badge");
    const mobileAuthLabels = document.querySelectorAll("#mobile-auth-label");

    if (user) {
      const displayName = user.displayName || user.email.split("@")[0];
      const initial = displayName.charAt(0).toUpperCase();

      userBadges.forEach((b) => {
        b.textContent = displayName.split(" ")[0];
        b.style.display = "inline-block";
      });

      mobileAuthLabels.forEach((l) => {
        l.textContent = `Hi, ${displayName.split(" ")[0]}`;
      });

      // Update profile view content
      const pName = $id("profile-name");
      const pEmail = $id("profile-email");
      const pAvatar = $id("profile-avatar");
      if (pName) pName.textContent = displayName;
      if (pEmail) pEmail.textContent = user.email;
      if (pAvatar) pAvatar.textContent = initial;

      // Autofill on checkout page if inputs exist
      const checkName = $id("cust-name");
      const checkEmail = $id("cust-email");
      if (checkName && !checkName.value) checkName.value = user.displayName || "";
      if (checkEmail && !checkEmail.value) checkEmail.value = user.email || "";
    } else {
      userBadges.forEach((b) => {
        b.textContent = "";
        b.style.display = "none";
      });
      mobileAuthLabels.forEach((l) => {
        l.textContent = "Sign in / Account";
      });
    }
  }

  // Initialize Auth listeners
  document.addEventListener("DOMContentLoaded", () => {
    injectAuthModal();

    // Listen to all buttons with data-open-auth
    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-open-auth], #login-guest-btn");
      if (target) {
        e.preventDefault();
        openAuthModal();
      }
    });

    // Check Firebase Auth state
    if (window.FirebaseDB && window.FirebaseDB.onAuthStateChanged) {
      window.FirebaseDB.onAuthStateChanged((user) => {
        updateNavState(user);
      });
    }
  });

  // Global helper
  window.openAuth = openAuthModal;
  window.closeAuth = closeAuthModal;
})();
