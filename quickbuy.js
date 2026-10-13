/* ==========================================================================
   CHEKORGANICS — "Buy Now" on product cards
   Turns each card's "Add" button into "Buy Now": one tap puts the product in
   the bag (qty 1 if it isn't there yet; an existing quantity is kept) and
   opens the site's checkout page (checkout) — the same destination as
   the product page's Buy Now.
   Load after app.js (it renders the cards and owns the bag).
   ========================================================================== */
(function () {
  "use strict";

  const CART_KEY = "chek_cart_v1"; // the bag used by app.js and checkout.html
  const CHECKOUT = "checkout";
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const snapshot = new Map(((window.STORE && window.STORE.products) || []).map(p => [p.handle, p]));

  /* small status toast (shares the wishlist toast styling) */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "wl-toast qb-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  /* replace the card's "Add" with "Buy Now" */
  function convert(root) {
    $$(".card__foot [data-add]", root).forEach(btn => {
      const handle = btn.dataset.add;
      const card = btn.closest(".card");
      const name = ((card && card.querySelector(".card__title")) || {}).textContent || "";
      const p = snapshot.get(handle);
      btn.removeAttribute("data-add"); // app.js's Add-to-bag handler (which opens the bag drawer) must not fire
      btn.dataset.buyNow = handle;
      btn.classList.remove("btn--primary");
      btn.classList.add("btn--gold", "qb-btn");
      const soldOut = p && p.available === false;
      btn.disabled = soldOut;
      btn.innerHTML = '<span class="qb-btn__label">' + (soldOut ? "Sold out" : "Buy Now") + "</span>";
      btn.setAttribute("aria-label", (soldOut ? "Sold out: " : "Buy now: ") + name.trim());
    });
  }

  function setBusy(btn, busy) {
    btn.classList.toggle("is-busy", busy);
    btn.disabled = busy;
    btn.setAttribute("aria-busy", String(busy));
  }

  /* put the product in the bag, then go to checkout */
  function buyNow(btn) {
    const handle = btn.dataset.buyNow;
    if (!handle || btn.classList.contains("is-busy")) return;
    setBusy(btn, true);
    try {
      const bag = JSON.parse(localStorage.getItem(CART_KEY) || "{}") || {};
      if (!(Number(bag[handle]) > 0)) bag[handle] = 1; // tapping Buy Now again never doubles the quantity
      localStorage.setItem(CART_KEY, JSON.stringify(bag));
    } catch (e) {
      setBusy(btn, false);
      toast("Your browser blocked saving the bag. Please allow site data and try again.");
      return;
    }
    window.location.href = CHECKOUT;
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-buy-now]");
    if (!btn) return;
    e.preventDefault();
    buyNow(btn);
  });

  // pre-load the checkout page on hover/touch so it opens instantly
  let prefetched = false;
  const prefetch = e => {
    if (prefetched || !(e.target.closest && e.target.closest("[data-buy-now]"))) return;
    prefetched = true;
    const l = document.createElement("link");
    l.rel = "prefetch";
    l.href = CHECKOUT;
    document.head.appendChild(l);
  };
  document.addEventListener("pointerenter", prefetch, true);
  document.addEventListener("touchstart", prefetch, { passive: true });

  // coming back with the browser's Back button restores the page from cache: un-stick the spinner
  window.addEventListener("pageshow", () => $$(".qb-btn.is-busy").forEach(b => setBusy(b, false)));

  document.addEventListener("DOMContentLoaded", () => {
    convert(document);
    // app.js renders and re-renders cards (skeletons → snapshot → live catalog)
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        convert(document);
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
