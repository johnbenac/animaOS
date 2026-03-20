interface ChatResponse {
  response: string;
  model: string;
  provider: string;
  toolsUsed: string[];
}

interface TelegramLinkResponse {
  chatId: number;
  userId: number;
}

class AnimaApiClient {
  private baseUrl: string;
  private unlockToken: string | null = null;
  private username: string;
  private password: string;

  constructor() {
    this.baseUrl = process.env.PYTHON_API_BASE || "http://127.0.0.1:3031/api";
    this.username = process.env.ANIMA_USERNAME || "";
    this.password = process.env.ANIMA_PASSWORD || "";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.unlockToken) {
      h["x-anima-unlock"] = this.unlockToken;
    }
    return h;
  }

  async login(): Promise<void> {
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
    console.log("[anima-api] Authenticated successfully");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-retry on 401
    if (res.status === 401 && this.username) {
      await this.login();
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
  }

  async chat(message: string, userId: number): Promise<ChatResponse> {
    return this.request<ChatResponse>("POST", "/chat", {
      message,
      userId,
      stream: false,
    });
  }

  async linkTelegram(
    chatId: number,
    userId: number,
    linkSecret?: string,
  ): Promise<TelegramLinkResponse> {
    return this.request<TelegramLinkResponse>("POST", "/telegram/link", {
      chatId,
      userId,
      ...(linkSecret ? { linkSecret } : {}),
    });
  }

  async unlinkTelegram(chatId: number): Promise<void> {
    await this.request("DELETE", `/telegram/link?chatId=${chatId}`);
  }

  async lookupTelegram(chatId: number): Promise<number | null> {
    try {
      const data = await this.request<TelegramLinkResponse>(
        "GET",
        `/telegram/link?chatId=${chatId}`,
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

export const animaApi = new AnimaApiClient();
