/**
 * CHEKORGANICS — order emails (Google Apps Script, free)
 *
 * Every 5 minutes this script reads the orders that changed since its last run from
 * Firestore and emails the customer:
 *   • "Order received"  — as soon as an order is placed
 *   • status updates    — Farm Batching → Dispatched → Out for Delivery → Delivered / Cancelled
 *   • payment updates   — UPI payment received, COD order confirmed
 *   • tracking details  — courier, AWB number and tracking link (set in the admin portal)
 *
 * The site marks a change by stamping `emailQueueAt` (server time) on the order; this
 * script only reads orders with a newer `emailQueueAt`, and records what it already
 * sent in `emailLog`, so every email goes out once. It runs as the Gmail account that
 * owns the Firebase project and sends from that account (free Gmail: 100 emails/day).
 *
 * Setup: see email/README.md. Run `setup` once; nothing on the website can trigger it.
 */

const PROJECT_ID = "chekorganics-live";
const STORE_URL = "https://shivdutt44.github.io/chekorganics/";
const BRAND = "CHEKORGANICS";
const REPLY_TO = "shivduttchauhan2@gmail.com";
const BATCH = 40; // orders per run; the rest are picked up next run

const API = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";

/* ------------------------------------------------------------------ setup */

/** Run once from the editor: authorises the script and installs the 5-minute trigger. */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "processOrderEmails")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("processOrderEmails").timeBased().everyMinutes(5).create();
  // start from now: older orders are not emailed retroactively
  PropertiesService.getScriptProperties().setProperty("lastSeen", new Date().toISOString());
  Logger.log("Order emails are on. Remaining Gmail quota today: " + MailApp.getRemainingDailyQuota());
}

/** Optional: run from the editor to email the newest order again (to check the design). */
function sendTestForLatestOrder() {
  const rows = runQuery_("1970-01-01T00:00:00Z", 1, "DESCENDING");
  if (!rows.length) { Logger.log("No orders with emailQueueAt yet."); return; }
  const order = decode_(rows[0].document.fields);
  const mail = buildEmail_(order, "placed");
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: "[TEST] " + mail.subject, htmlBody: mail.html, name: BRAND });
  Logger.log("Sent a test of order " + order.orderId + " to you.");
}

/* ------------------------------------------------------------- main loop */

/** Trigger target: email every order changed since the last run. */
function processOrderEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // a previous run is still going
  try {
    const props = PropertiesService.getScriptProperties();
    let lastSeen = props.getProperty("lastSeen") || new Date().toISOString();
    const rows = runQuery_(lastSeen, BATCH, "ASCENDING");
    for (const row of rows) {
      const doc = row.document;
      try {
        handleOrder_(doc.name, decode_(doc.fields));
      } catch (err) {
        // stop here (e.g. Gmail quota reached) and retry this order on the next run
        console.error("Order email failed for " + doc.name + ": " + err);
        break;
      }
      lastSeen = doc.fields.emailQueueAt.timestampValue;
      props.setProperty("lastSeen", lastSeen);
    }
  } finally {
    lock.releaseLock();
  }
}

/** Decide which email (if any) the order needs, send it, and record it on the order. */
function handleOrder_(docName, order) {
  const kind = pendingEmail_(order);
  if (!kind) return;
  const to = String((order.customer && order.customer.email) || order.userEmail || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const mail = buildEmail_(order, kind);
    MailApp.sendEmail({ to: to, subject: mail.subject, htmlBody: mail.html, name: BRAND, replyTo: REPLY_TO });
  }
  patchEmailLog_(docName, snapshot_(order, kind));
}

/** What changed since the last email: "placed" | "status" | "payment" | "tracking" | null */
function pendingEmail_(order) {
  const log = order.emailLog || {};
  const now = snapshot_(order, "");
  if (!log.placedAt) return "placed";
  if (now.status !== (log.status || "")) return "status";
  if (now.payment !== (log.payment || "")) return "payment";
  if (now.ship !== (log.ship || "")) return "tracking";
  return null;
}

function snapshot_(order, kind) {
  const log = order.emailLog || {};
  const s = order.shipping || {};
  return {
    placedAt: log.placedAt || new Date().toISOString(),
    status: order.deliveryStatus || "",
    payment: (order.payment && order.payment.status) || "",
    ship: [s.courier || "", s.awb || "", s.trackingUrl || ""].join("|"),
    lastKind: kind,
    lastSentAt: new Date().toISOString()
  };
}

/* ---------------------------------------------------------------- emails */

const STAGES = ["Order Placed", "Farm Batching", "Dispatched & In Transit", "Out for Delivery", "Delivered"];

function stageOf_(status) {
  const s = String(status || "");
  if (s === "Delivered") return 4;
  if (s.indexOf("Out for") >= 0) return 3;
  if (s.indexOf("Dispatched") >= 0) return 2;
  if (s.indexOf("Batching") >= 0) return 1;
  return 0;
}

function buildEmail_(order, kind) {
  const id = order.orderId || "";
  const name = String((order.customer && order.customer.name) || "there").split(" ")[0];
  const status = order.deliveryStatus || "";
  const cancelled = status.indexOf("Cancelled") >= 0;
  const stage = stageOf_(status);
  const pay = order.payment || {};
  const ship = order.shipping || {};

  let subject, headline, message;
  if (kind === "placed") {
    subject = "Order received — #" + id;
    headline = "Thank you for your order, " + name + "!";
    message = pay.method === "cod"
      ? "We've received your Cash on Delivery order. We'll confirm it with you and email you at every step until it reaches you."
      : "We've received your order. Once we match your UPI payment (UTR " + esc_(pay.utr || "—") + "), we'll start preparing it and email you at every step.";
  } else if (cancelled) {
    subject = "Order #" + id + " has been cancelled";
    headline = "Your order has been cancelled";
    message = "Order #" + esc_(id) + " was cancelled. If you have paid for it or this is a mistake, just reply to this email and we'll sort it out.";
  } else if (kind === "status") {
    const lines = {
      0: ["Order #" + id + " is confirmed", "Your order is confirmed", "We've confirmed your order and it's queued for preparation."],
      1: ["Order #" + id + " is being prepared", "Your order is being prepared", "Your products are being batched and packed at our Telangana farm facility."],
      2: ["Order #" + id + " has been dispatched", "Your order is on its way!", "Your order has left our facility and is in transit to you."],
      3: ["Order #" + id + " is out for delivery", "Out for delivery today", "Your order is out for delivery. " + (pay.method === "cod" ? "Please keep ₹" + money_(pay.total) + " ready for the delivery partner." : "Please keep your phone handy.")],
      4: ["Order #" + id + " has been delivered", "Delivered — enjoy!", "Your order has been delivered. We hope you love it — reply to this email if anything isn't right."]
    }[stage];
    subject = lines[0]; headline = lines[1]; message = lines[2];
  } else if (kind === "payment") {
    if (pay.status === "paid") {
      subject = "Payment received for order #" + id;
      headline = "Payment received ✓";
      message = "We've received your UPI payment of ₹" + money_(pay.total) + ". Your order is now being prepared.";
    } else if (pay.status === "cod_confirmed") {
      subject = "Your COD order #" + id + " is confirmed";
      headline = "COD order confirmed ✓";
      message = "Thanks for confirming! Please pay ₹" + money_(pay.total) + " in cash or UPI when your order is delivered.";
    } else {
      subject = "Update on order #" + id;
      headline = "Your order has an update";
      message = "There's an update to the payment on your order.";
    }
  } else {
    subject = "Tracking details for order #" + id;
    headline = "Track your parcel";
    message = "Your order has been handed to " + esc_(ship.courier || "our courier partner") + ". Use the details below to follow it.";
  }

  const timeline = cancelled ? "" : STAGES.map((label, i) => {
    const done = i <= stage, next = i === stage + 1;
    const color = done ? "#166534" : next ? "#b8862f" : "#94a3b8";
    const dot = done ? "✓" : next ? "●" : "○";
    return '<tr><td style="width:28px;padding:5px 0;color:' + color + ';font-weight:700;font-size:15px">' + dot + "</td>" +
      '<td style="padding:5px 0;color:' + color + ";font-size:14px;" + (done || next ? "font-weight:600" : "") + '">' + esc_(label) + "</td></tr>";
  }).join("");

  const tracking = (ship.courier || ship.awb) ?
    '<tr><td style="padding:14px 28px 0"><table width="100%" style="background:#f4efe3;border-radius:12px"><tr><td style="padding:14px 16px;font-size:14px;color:#1f2937">' +
      "<b>Courier:</b> " + esc_(ship.courier || "—") + (ship.awb ? "<br><b>AWB / tracking no.:</b> " + esc_(ship.awb) : "") +
      (/^https:\/\/[^"'<>\s]+$/.test(ship.trackingUrl || "") ? '<br><a href="' + esc_(ship.trackingUrl) + '" style="display:inline-block;margin-top:10px;background:#10351f;color:#ffffff;text-decoration:none;padding:9px 18px;border-radius:999px;font-weight:600">Track shipment</a>' : "") +
    "</td></tr></table></td></tr>" : "";

  const items = (order.items || []).map(it => {
    const qty = Number(it.qty) || 1, price = Number(it.price) || 0;
    const img = absUrl_(it.image);
    return "<tr>" +
      '<td style="padding:8px 0;width:60px">' + (img ? '<img src="' + esc_(img) + '" width="52" height="52" alt="" style="border-radius:8px;border:1px solid #e6dac4;object-fit:contain;background:#fff">' : "") + "</td>" +
      '<td style="padding:8px 10px;font-size:14px;color:#1f2937">' + esc_(it.title || "Product") + '<br><span style="color:#6c7a70;font-size:12px">Qty: <b>' + qty + "</b> · ₹" + money_(price) + " each</span></td>" +
      '<td style="padding:8px 0;font-size:14px;font-weight:700;color:#10351f;text-align:right;white-space:nowrap">₹' + money_(price * qty) + "</td></tr>";
  }).join("");

  const a = order.address || {};
  const address = [a.flat, a.street, a.landmark, a.city, a.state].filter(Boolean).map(esc_).join(", ") + (a.pincode ? " — " + esc_(a.pincode) : "");
  const payLine = pay.method === "cod"
    ? "Cash on Delivery" + (pay.status === "cod_confirmed" ? " (confirmed)" : "")
    : "UPI" + (pay.utr ? " · UTR " + esc_(pay.utr) : "") + (pay.status === "paid" ? " (payment received)" : " (payment being verified)");

  const html =
    '<div style="margin:0;padding:24px 12px;background:#f1e9d9;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#fffdf8;border-radius:16px;overflow:hidden;border-collapse:collapse">' +
      '<tr><td style="background:#10351f;padding:22px 28px;text-align:center">' +
        '<div style="font-family:Georgia,serif;font-size:24px;letter-spacing:2px;color:#ffffff">CHEKORGANICS</div>' +
        '<div style="font-size:10px;letter-spacing:4px;color:#e3c47c;margin-top:4px">ROUTE TO ROOTS</div></td></tr>' +
      '<tr><td style="padding:26px 28px 6px">' +
        '<div style="font-family:Georgia,serif;font-size:22px;color:#10351f;font-weight:bold">' + esc_(headline) + "</div>" +
        '<p style="font-size:14px;line-height:1.6;color:#3d4a41;margin:10px 0 0">' + message + "</p>" +
        '<p style="font-size:13px;color:#6c7a70;margin:12px 0 0">Order <b style="color:#10351f">#' + esc_(id) + "</b>" +
          (order.shipping && order.shipping.eta && !cancelled && stage < 4 ? " · Estimated delivery <b style=\"color:#10351f\">" + esc_(order.shipping.eta) + "</b>" : "") + "</p></td></tr>" +
      (timeline ? '<tr><td style="padding:14px 28px 0"><table width="100%" style="border-top:1px solid #e6dac4;padding-top:8px">' + timeline + "</table></td></tr>" : "") +
      tracking +
      '<tr><td style="padding:18px 28px 0"><div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#10351f;border-top:1px solid #e6dac4;padding-top:14px">ORDERED ITEMS</div>' +
        '<table width="100%" style="border-collapse:collapse">' + items + "</table>" +
        '<table width="100%" style="border-top:1px solid #e6dac4;margin-top:6px"><tr>' +
          '<td style="padding:10px 0;font-size:15px;font-weight:700;color:#10351f">' + (pay.method === "cod" ? "To pay on delivery" : "Order total") + "</td>" +
          '<td style="padding:10px 0;font-size:15px;font-weight:700;color:#10351f;text-align:right">₹' + money_(pay.total) + "</td></tr></table></td></tr>" +
      '<tr><td style="padding:10px 28px 0;font-size:13px;line-height:1.6;color:#3d4a41">' +
        "<b>Delivery address:</b> " + esc_((order.customer && order.customer.name) || "") + ", " + address +
        "<br><b>Payment:</b> " + payLine + "</td></tr>" +
      '<tr><td style="padding:22px 28px 26px;text-align:center">' +
        '<a href="' + STORE_URL + '" style="display:inline-block;background:#c29a45;color:#10351f;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:700;font-size:14px">Visit CHEKORGANICS</a>' +
        '<p style="font-size:12px;color:#6c7a70;margin:16px 0 0">Track this order any time from "Track Order" on our website with order ID #' + esc_(id) +
        ". Questions? Just reply to this email.</p></td></tr>" +
    "</table></div>";

  return { subject: subject + " | " + BRAND, html: html };
}

/* ------------------------------------------------------- Firestore REST */
// Runs with the script owner's Google login (Firebase project owner), so security rules
// don't apply; x-goog-user-project bills the API calls to the Firebase project.

function request_(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method,
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "x-goog-user-project": PROJECT_ID },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error("Firestore " + code + ": " + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || "{}");
}

function runQuery_(afterIso, limit, direction) {
  const rows = request_("post", API + ":runQuery", {
    structuredQuery: {
      from: [{ collectionId: "orders" }],
      where: { fieldFilter: { field: { fieldPath: "emailQueueAt" }, op: "GREATER_THAN", value: { timestampValue: afterIso } } },
      orderBy: [{ field: { fieldPath: "emailQueueAt" }, direction: direction }],
      limit: limit
    }
  });
  return (rows || []).filter(r => r.document);
}

function patchEmailLog_(docName, log) {
  request_("patch", "https://firestore.googleapis.com/v1/" + docName + "?updateMask.fieldPaths=emailLog", {
    fields: { emailLog: encode_(log) }
  });
}

function decode_(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(k => { out[k] = value_(fields[k]); });
  return out;
}

function value_(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decode_(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(value_);
  return null;
}

function encode_(obj) {
  const fields = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    fields[k] = v === null || v === undefined ? { nullValue: null } : typeof v === "number" ? { doubleValue: v } : { stringValue: String(v) };
  });
  return { mapValue: { fields: fields } };
}

/* -------------------------------------------------------------- helpers */

function esc_(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function money_(n) {
  return Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// product images are saved as bundled paths ("assets/…") or https URLs
function absUrl_(src) {
  const s = String(src || "");
  if (/^https:\/\/[^"'<>\s]+$/.test(s)) return s;
  if (/^assets\/[^"'<>\s]+$/.test(s)) return STORE_URL + s;
  return "";
}
