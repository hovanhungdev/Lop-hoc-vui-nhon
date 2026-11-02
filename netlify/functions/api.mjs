import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const CATS = ["Gọi tên", "Ôn tập", "Vận động", "Khác"];
const COOKIE = "lhvn_admin";
const TTL = 8 * 3600;
const fails = new Map(); // IP -> {n, t}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const str = (v, max) => String(v ?? "").slice(0, max);
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// ---- Phiên đăng nhập: JWT HS256 trong cookie HttpOnly ----
const secret = () => process.env.JWT_SECRET || "";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(p)}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
};
function verify(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!s || !secret()) return null;
  const exp = crypto.createHmac("sha256", secret()).update(`${h}.${b}`).digest("base64url");
  if (!safeEq(s, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, "base64url").toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
const getCookie = (req, name) =>
  (req.headers.get("cookie") || "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];

async function authState(db) {
  return (await db.get("auth", { type: "json" })) || { ver: 1 };
}
async function requireAdmin(req, db) {
  const p = verify(getCookie(req, COOKIE));
  if (!p) return null;
  const a = await authState(db);
  return p.ver === a.ver ? p : null;
}
function checkPassword(a, password) {
  if (a.hash) {
    const h = crypto.scryptSync(password, Buffer.from(a.salt, "hex"), 32);
    return crypto.timingSafeEqual(h, Buffer.from(a.hash, "hex"));
  }
  return !!process.env.ADMIN_PASSWORD && safeEq(password, process.env.ADMIN_PASSWORD);
}
const cookie = (value, maxAge, secure) =>
  `${COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

// ---- Làm sạch dữ liệu admin gửi lên ----
const ref = (v) => (/^\/(api\/img\/[a-f0-9]{24}|assets\/[\w./-]+)$/.test(v) || /^#[0-9a-f]{6}$/i.test(v) ? v : "");
function cleanGame(g) {
  const id = str(g.id, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error(`Mã trò chơi không hợp lệ: "${id}"`);
  const c = (x) => (/^#[0-9a-f]{6}$/i.test(x) ? x : "#35c4b0");
  return {
    id, title: str(g.title, 80) || id, desc: str(g.desc, 160), cat: CATS.includes(g.cat) ? g.cat : "Khác",
    icon: str(g.icon, 8) || "🎮", colors: [c(g.colors?.[0]), c(g.colors?.[1] || "#2a9df4")],
    thumb: /^\/api\/img\//.test(g.thumb) ? ref(g.thumb) : "", bg: ref(g.bg),
    mode: g.mode === "fn" ? "fn" : "html", code: str(g.code, 200000), hidden: !!g.hidden,
  };
}

export default async (req, ctx) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const db = getStore("lhvn");
  const imgs = getStore("lhvn-img");
  const secure = !/^(localhost|127\.)/.test(url.hostname);

  try {
    // ----- Công khai -----
    if (req.method === "GET" && path === "public") {
      const [settings, games] = await Promise.all([db.get("settings", { type: "json" }), db.get("games", { type: "json" })]);
      return json({ settings: settings || {}, games: games || [] });
    }
    if (req.method === "GET" && path.startsWith("img/")) {
      const r = await imgs.getWithMetadata(path.slice(4), { type: "arrayBuffer" });
      if (!r) return new Response("Not found", { status: 404 });
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }

    // ----- Đăng nhập -----
    if (req.method === "POST" && path === "login") {
      if (!secret()) return json({ error: "Chưa cấu hình JWT_SECRET trên Netlify." }, 500);
      const ip = ctx.ip || req.headers.get("x-nf-client-connection-ip") || "?";
      const f = fails.get(ip);
      if (f && f.n >= 5 && Date.now() - f.t < 600000) return json({ error: "Sai quá nhiều lần. Thử lại sau 10 phút." }, 429);
      const { username = "", password = "" } = await req.json();
      const a = await authState(db);
      const user = a.user || process.env.ADMIN_USERNAME || "admin";
      const ok = safeEq(String(username), user) && checkPassword(a, String(password));
      if (!ok) {
        fails.set(ip, { n: (f && Date.now() - f.t < 600000 ? f.n : 0) + 1, t: Date.now() });
        await new Promise((r) => setTimeout(r, 700));
        return json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }, 401);
      }
      fails.delete(ip);
      const token = sign({ sub: user, ver: a.ver, exp: Math.floor(Date.now() / 1000) + TTL });
      return json({ ok: true, user }, 200, { "set-cookie": cookie(token, TTL, secure) });
    }
    if (req.method === "POST" && path === "logout") return json({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });

    // ----- Chỉ admin -----
    const me = await requireAdmin(req, db);
    if (path === "me") return me ? json({ ok: true, user: me.sub }) : json({ error: "Chưa đăng nhập" }, 401);
    if (!me) return json({ error: "Cần đăng nhập admin." }, 401);

    if (req.method === "PUT" && path === "admin/games") {
      const list = await req.json();
      if (!Array.isArray(list) || list.length > 100) return json({ error: "Danh sách không hợp lệ." }, 400);
      const seen = new Set();
      const games = list.map(cleanGame).filter((g) => !seen.has(g.id) && seen.add(g.id));
      await db.setJSON("games", games);
      return json({ ok: true, games });
    }
    if (req.method === "PUT" && path === "admin/settings") {
      const s = await req.json();
      const settings = { title: str(s.title, 80), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "", logo: ref(s.logo), hero: ref(s.hero) };
      await db.setJSON("settings", settings);
      return json({ ok: true, settings });
    }
    if (req.method === "POST" && path === "img") {
      const { data = "" } = await req.json();
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
      if (!m) return json({ error: "Chỉ nhận ảnh JPG, PNG hoặc WebP." }, 400);
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 2.5 * 1024 * 1024) return json({ error: "Ảnh quá lớn (tối đa 2,5 MB)." }, 413);
      const id = crypto.randomBytes(12).toString("hex");
      await imgs.set(id, buf, { metadata: { type: m[1] } });
      return json({ ok: true, url: `/api/img/${id}` });
    }
    if (req.method === "POST" && path === "admin/password") {
      const { current = "", next = "", username = "" } = await req.json();
      const a = await authState(db);
      if (!checkPassword(a, String(current))) return json({ error: "Mật khẩu hiện tại không đúng." }, 403);
      if (String(next).length < 8) return json({ error: "Mật khẩu mới cần ít nhất 8 ký tự." }, 400);
      const salt = crypto.randomBytes(16);
      const hash = crypto.scryptSync(String(next), salt, 32).toString("hex");
      const user = str(username, 40).trim() || a.user || process.env.ADMIN_USERNAME || "admin";
      await db.setJSON("auth", { user, salt: salt.toString("hex"), hash, ver: (a.ver || 1) + 1 });
      return json({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });
    }
    return json({ error: "Không tìm thấy." }, 404);
  } catch (e) {
    return json({ error: e.message || "Lỗi máy chủ" }, 400);
  }
};
