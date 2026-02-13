// Email routes - fetch inbox messages from Gmail or Outlook via access token.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { fetchEmails } from "../email";

const email = new Hono();

const fetchEmailSchema = z.object({
  provider: z.enum(["gmail", "outlook"]),
  accessToken: z.string().min(1),
  maxResults: z.number().int().min(1).max(20).optional().default(10),
  unreadOnly: z.boolean().optional().default(false),
  query: z.string().optional(),
});

email.get("/providers", (c) => {
  return c.json([
    { id: "gmail", name: "Google Mail" },
    { id: "outlook", name: "Outlook" },
  ]);
});

email.post("/fetch", zValidator("json", fetchEmailSchema), async (c) => {
  const data = c.req.valid("json");

  try {
    const emails = await fetchEmails(data);
    return c.json({
      provider: data.provider,
      count: emails.length,
      emails,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch emails";
    return c.json({ error: message }, 502);
  }
});

export default email;
