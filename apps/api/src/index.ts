import { Hono } from "hono";
import { cors } from "hono/cors";
import auth from "./routes/auth";
import users from "./routes/users";
import chat from "./routes/chat";
import config from "./routes/config";
import memory from "./routes/memory";
import soul from "./routes/soul";
import telegram from "./routes/telegram";
import discord from "./routes/discord";
import tasks from "./routes/tasks";
import channel from "./routes/channel";
import vault from "./routes/vault";
import { startTaskReminderCron } from "./cron/task-reminders";
import { ensureRuntimeLayout } from "./lib/runtime-paths";
import { startDiscordGatewayRelay } from "./discord/gateway-relay";

await ensureRuntimeLayout();

const app = new Hono();

// --- Bot Proxy Configuration ---
const PYTHON_API_BASE = process.env.PYTHON_API_BASE || "http://127.0.0.1:3031/api";
app.set("pythonApiBase", PYTHON_API_BASE);

// Middleware
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:1420",
      "http://localhost:5173",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ],
    credentials: true,
  }),
);

// --- Bot Proxy Routes (Active) ---
app.route("/api/telegram", telegram);
app.route("/api/discord", discord);

// --- Legacy/Local Routes (Deprecated in favor of FastAPI) ---
// Note: We keep these for now to avoid breaking existing clients until fully migrated.
// app.route("/api/auth", auth);
// app.route("/api/users", users);
// app.route("/api/chat", chat);
// app.route("/api/config", config);
// app.route("/api/memory", memory);
// app.route("/api/soul", soul);
// app.route("/api/tasks", tasks);
// app.route("/api/channel", channel);
// app.route("/api/vault", vault);


// Health check
app.get("/", (c) => c.json({ message: "ANIMA Bot Proxy (Legacy API)", version: "0.1.0" }));
app.get("/health", (c) => c.json({ status: "healthy", service: "bot-proxy" }));

// Start background crons (DISABLED in Proxy mode - moving to FastAPI)
// startTaskReminderCron();

// Start Discord Gateway Relay (Keep enabled if Discord is used via Gateway)
startDiscordGatewayRelay();

export default {
  port: 3033,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};
