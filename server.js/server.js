import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://rottenes.github.io";
const MAX_BODY = 8192;
const recentOrders = new Map();

function send(res, status, body, origin) {
  if (origin === SITE_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", SITE_ORIGIN);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function clean(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function validInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch { return null; }
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !Number.isFinite(authDate)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (authDate < now - 86400 || authDate > now + 60) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const received = Buffer.from(receivedHash, "hex");
  if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) return null;
  let user;
  try { user = JSON.parse(params.get("user") || "{}"); } catch { return null; }
  return { id: String(user.id || "unknown"), username: user.username ? "@" + user.username : "" };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { reject(new Error("too_large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    if (origin === SITE_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", SITE_ORIGIN);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
      res.setHeader("Access-Control-Max-Age", "86400");
      res.setHeader("Vary", "Origin");
    }
    res.statusCode = 204;
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true }, origin);
  if (req.method !== "POST" || url.pathname !== "/api/order") return send(res, 404, { error: "Страница не найдена" }, origin);
  if (origin !== SITE_ORIGIN) return send(res, 403, { error: "Источник запроса не разрешён" }, origin);
  if (!BOT_TOKEN || !CHAT_ID) return send(res, 503, { error: "Сервер ещё не настроен" }, origin);

  const telegramUser = validInitData(req.headers["x-telegram-init-data"]);
  if (!telegramUser) return send(res, 401, { error: "Открой приложение через Telegram и попробуй ещё раз" }, origin);
  let input;
  try { input = await readJson(req); } catch (err) {
    return send(res, err.message === "too_large" ? 413 : 400, { error: "Не удалось прочитать данные формы" }, origin);
  }
  const username = clean(input.username, 80);
  const phone = clean(input.phone, 12);
  const fullName = clean(input.fullName, 150);
  const city = clean(input.city, 100);
  const pickupAddress = clean(input.pickupAddress, 300);
  if (!username.startsWith("@") || !/^\+7[0-9]{10}$/.test(phone) || !fullName || !city || !pickupAddress) {
    return send(res, 400, { error: "Проверь заполнение полей и попробуй ещё раз" }, origin);
  }
  const now = Date.now();
  const history = (recentOrders.get(telegramUser.id) || []).filter(time => now - time < 600000);
  if (history.length >= 3) return send(res, 429, { error: "Слишком много заявок. Попробуй позже" }, origin);
  history.push(now);
  recentOrders.set(telegramUser.id, history);

  const message = ["Новая заявка на предзаказ · DROP 001", "", "Telegram: " + username, "Имя: " + fullName, "Телефон: " + phone, "Город: " + city, "Пункт СДЭК: " + pickupAddress].join("\n");
  try {
    const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error("Telegram sendMessage failed with HTTP", response.status);
      return send(res, 502, { error: "Не получилось отправить заявку. Попробуй ещё раз позже" }, origin);
    }
    return send(res, 200, { ok: true }, origin);
  } catch {
    console.error("Telegram API request failed");
    return send(res, 502, { error: "Не удалось связаться с Telegram. Попробуй позже" }, origin);
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("Preorder API listening on port " + PORT));
