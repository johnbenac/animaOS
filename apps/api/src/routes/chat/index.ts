// Chat routes — conversation with the agent

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  sendMessageSchema,
  historyQuerySchema,
  clearHistorySchema,
  userIdQuerySchema,
  consolidateSchema,
} from "./schema";
import {
  sendMessage,
  getHistory,
  clearHistory,
  getBrief,
  getNudges,
  getHome,
  consolidate,
} from "./handlers";

const chat = new Hono();

chat.post("/", zValidator("json", sendMessageSchema), sendMessage);
chat.get("/history", zValidator("query", historyQuerySchema), getHistory);
chat.delete("/history", zValidator("json", clearHistorySchema), clearHistory);
chat.get("/brief", zValidator("query", userIdQuerySchema), getBrief);
chat.get("/nudges", zValidator("query", userIdQuerySchema), getNudges);
chat.get("/home", zValidator("query", userIdQuerySchema), getHome);
chat.post("/consolidate", zValidator("json", consolidateSchema), consolidate);

export default chat;
