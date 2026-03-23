/**
 * a-mod: Anima Cognitive Core Client
 * 
 * HTTP client for communicating with the Python cognitive core.
 */

import type { AnimaClient, ChatRequest, ChatResponse } from "./types.js";

interface AnimaClientOptions {
  baseUrl: string;
  username: string;
  password: string;
}

export class AnimaApiClient implements AnimaClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private unlockToken: string | null = null;

  constructor(opts: AnimaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.username = opts.username;
    this.password = opts.password;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.unlockToken) {
      h["x-anima-unlock"] = this.unlockToken;
    }
    return h;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Login failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    this.unlockToken = data.unlockToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const doRequest = async (): Promise<T> => {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401 && this.username) {
        await this.login();
        // Retry once
        const retry = await fetch(url, {
          method,
          headers: this.headers(),
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retry.ok) {
          const text = await retry.text().catch(() => "");
          throw new Error(`API ${method} ${path} failed after re-auth: ${retry.status} ${text}`);
        }
        return retry.json() as Promise<T>;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
      }

      return res.json() as Promise<T>;
    };

    return doRequest();
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>("POST", "/chat", {
      message: req.message,
      userId: req.userId,
      stream: req.stream ?? false,
    });
  }

  async linkChannel(channel: string, chatId: string, userId: number, secret?: string): Promise<void> {
    await this.request("POST", `/${channel}/link`, {
      chatId,
      userId,
      ...(secret ? { linkSecret: secret } : {}),
    });
  }

  async unlinkChannel(channel: string, chatId: string): Promise<void> {
    await this.request("DELETE", `/${channel}/link?chatId=${chatId}`);
  }

  async lookupUser(channel: string, chatId: string): Promise<number | null> {
    try {
      const data = await this.request<{ userId: number }>(
        "GET", 
        `/${channel}/link?chatId=${chatId}`
      );
      return data.userId;
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        return null;
      }
      throw err;
    }
  }
}
