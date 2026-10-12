/* ==========================================================================
   Builds ../instagram.json + ../assets/instagram/*.webp for the homepage feed.

   Uses the official Instagram API (Instagram Login, graph.instagram.com) with a
   long-lived access token for a Business or Creator account. Images are
   downloaded and converted to WebP because Instagram media URLs expire.

   Usage:   cd .build && npm i && IG_ACCESS_TOKEN=... node fetch-instagram.mjs
   Env:     IG_ACCESS_TOKEN  (required; never commit it)
            IG_LIMIT         posts to keep (default 12)
            IG_API_BASE      API base URL (default https://graph.instagram.com/v21.0; tests point it at a mock)
   In CI the token comes from the GitHub secret IG_ACCESS_TOKEN
   (see .github/workflows/instagram-feed.yml).
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const TOKEN = process.env.IG_ACCESS_TOKEN;
const LIMIT = Math.min(Math.max(Number(process.env.IG_LIMIT) || 12, 1), 50);
const API = (process.env.IG_API_BASE || "https://graph.instagram.com/v21.0").replace(/\/$/, "");
const ROOT = path.resolve(process.env.IG_OUT_ROOT || "..");
const OUT_JSON = path.join(ROOT, "instagram.json");
const IMG_DIR = path.join(ROOT, "assets", "instagram");

if (!TOKEN) {
  console.log("IG_ACCESS_TOKEN is not set — skipping the Instagram feed update (the site keeps its current feed).");
  process.exit(0);
}

// Never print the token: errors from the API are reported without the request URL.
async function api(pathAndQuery) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const r = await fetch(`${API}${pathAndQuery}${sep}access_token=${encodeURIComponent(TOKEN)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) {
    const e = body.error || {};
    const hint = e.code === 190 ? " — the access token is invalid or expired; generate a new long-lived token." : "";
    throw new Error(`Instagram API ${r.status}: ${e.message || "request failed"}${hint}`);
  }
  return body;
}

let me, media;
try {
  // profile fields for the app-style header; fall back to the minimum if a field isn't available
  me = await api("/me?fields=user_id,username,name,profile_picture_url,followers_count,media_count").catch(() => api("/me?fields=user_id,username"));
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  media = await api(`/me/media?fields=${fields}&limit=${Math.min(LIMIT * 2, 50)}`);
} catch (e) {
  // the existing instagram.json is left untouched, so the site keeps its last good feed
  console.error("Instagram feed update failed: " + e.message);
  process.exit(1);
}

fs.mkdirSync(IMG_DIR, { recursive: true });
const posts = [];
for (const m of media.data || []) {
  if (posts.length >= LIMIT) break;
  const src = m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url; // carousels: media_url is the first item
  if (!src || !m.permalink || !/^https:\/\/(www\.)?instagram\.com\//.test(m.permalink)) continue;
  const id = String(m.id).replace(/[^0-9A-Za-z_]/g, "");
  const file = `assets/instagram/${id}.webp`;
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get("content-type") || "";
    if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) throw new Error("image too large");
    const img = sharp(buf).rotate().resize(640, 640, { fit: "cover", position: "attention" });
    await img.webp({ quality: 80 }).toFile(path.join(ROOT, file));
  } catch (e) {
    console.warn(`skip ${id}: ${e.message}`);
    continue;
  }
  posts.push({
    id,
    type: m.media_type,
    isReel: m.media_product_type === "REELS",
    permalink: m.permalink,
    timestamp: m.timestamp || null,
    caption: (m.caption || "").slice(0, 400),
    image: file,
  });
}

// profile picture (Instagram's URL expires too)
let avatar = null;
if (me.profile_picture_url) {
  try {
    const r = await fetch(me.profile_picture_url);
    if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) {
      await sharp(Buffer.from(await r.arrayBuffer())).resize(160, 160, { fit: "cover" }).webp({ quality: 85 }).toFile(path.join(IMG_DIR, "profile.webp"));
      avatar = "assets/instagram/profile.webp";
    }
  } catch (e) {
    console.warn("skip profile picture: " + e.message);
  }
}

// remove images of posts that dropped out of the feed
const keep = new Set(posts.map(p => path.basename(p.image)).concat(avatar ? ["profile.webp"] : []));
for (const f of fs.readdirSync(IMG_DIR)) if (f.endsWith(".webp") && !keep.has(f)) fs.unlinkSync(path.join(IMG_DIR, f));

const username = me.username || "chekorganics";
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const out = {
  username,
  name: me.name || null,
  avatar,
  followers: num(me.followers_count),
  mediaCount: num(me.media_count),
  profileUrl: `https://www.instagram.com/${username}/`,
  generatedAt: new Date().toISOString(),
  posts,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
console.log(`@${username}: ${posts.length} posts → ${path.relative(process.cwd(), OUT_JSON)}`);
