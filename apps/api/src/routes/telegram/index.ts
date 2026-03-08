// Telegram routes — webhook for Telegram bot integration

import { Hono } from "hono";
import { webhook } from "./handlers";

const telegram = new Hono();

telegram.post("/webhook", webhook);

export default telegram;
