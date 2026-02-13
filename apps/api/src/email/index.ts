export type EmailProvider = "gmail" | "outlook";

export interface FetchEmailsInput {
  provider: EmailProvider;
  accessToken: string;
  maxResults?: number;
  unreadOnly?: boolean;
  query?: string;
}

export interface EmailMessage {
  id: string;
  provider: EmailProvider;
  subject: string;
  from: string;
  fromEmail?: string;
  receivedAt: string;
  preview: string;
  isRead: boolean;
  webLink?: string;
}

interface GmailMessageRef {
  id: string;
}

interface GmailListResponse {
  messages?: GmailMessageRef[];
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageResponse {
  id: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: GmailHeader[];
  };
}

interface OutlookAddress {
  emailAddress?: {
    name?: string;
    address?: string;
  };
}

interface OutlookMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isRead?: boolean;
  receivedDateTime?: string;
  webLink?: string;
  from?: OutlookAddress;
}

interface OutlookListResponse {
  value?: OutlookMessage[];
}

function safeIsoDate(input?: string): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function parseFromHeader(raw?: string): { display: string; email?: string } {
  if (!raw) return { display: "Unknown" };

  const match = raw.match(/^(.*)<([^>]+)>$/);
  if (!match) return { display: raw.trim() };

  const name = match[1].trim().replace(/^"|"$/g, "");
  const email = match[2].trim();
  return { display: name || email, email };
}

async function fetchJson<T>(
  url: string,
  token: string,
  provider: EmailProvider,
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[${provider}] ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
    );
  }

  return (await res.json()) as T;
}

async function fetchGmailEmails(
  input: Required<Pick<FetchEmailsInput, "accessToken" | "maxResults" | "unreadOnly">> &
    Pick<FetchEmailsInput, "query">,
): Promise<EmailMessage[]> {
  const params = new URLSearchParams();
  params.set("maxResults", String(input.maxResults));
  params.set("includeSpamTrash", "false");

  const q: string[] = [];
  if (input.unreadOnly) q.push("is:unread");
  if (input.query?.trim()) q.push(input.query.trim());
  if (q.length) params.set("q", q.join(" "));

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`;
  const list = await fetchJson<GmailListResponse>(listUrl, input.accessToken, "gmail");

  const refs = list.messages || [];
  if (refs.length === 0) return [];

  const messages = await Promise.all(
    refs.map(async (ref) => {
      const detailUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}`,
      );
      detailUrl.searchParams.set("format", "metadata");
      detailUrl.searchParams.append("metadataHeaders", "Subject");
      detailUrl.searchParams.append("metadataHeaders", "From");
      detailUrl.searchParams.append("metadataHeaders", "Date");

      const msg = await fetchJson<GmailMessageResponse>(
        detailUrl.toString(),
        input.accessToken,
        "gmail",
      );

      const headers = msg.payload?.headers || [];
      const headerMap = new Map(
        headers.map((h) => [h.name.toLowerCase(), h.value] as const),
      );
      const from = parseFromHeader(headerMap.get("from"));
      const receivedFromDate = headerMap.get("date");

      const receivedAt = msg.internalDate
        ? safeIsoDate(new Date(Number(msg.internalDate)).toISOString())
        : safeIsoDate(receivedFromDate);

      return {
        id: msg.id,
        provider: "gmail" as const,
        subject: headerMap.get("subject") || "(no subject)",
        from: from.display,
        fromEmail: from.email,
        receivedAt,
        preview: msg.snippet || "",
        isRead: !(msg.labelIds || []).includes("UNREAD"),
        webLink: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      };
    }),
  );

  return messages.sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

async function fetchOutlookEmails(
  input: Required<Pick<FetchEmailsInput, "accessToken" | "maxResults" | "unreadOnly">> &
    Pick<FetchEmailsInput, "query">,
): Promise<EmailMessage[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$top", String(input.maxResults));
  url.searchParams.set(
    "$select",
    "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink",
  );
  url.searchParams.set("$orderby", "receivedDateTime DESC");

  if (input.unreadOnly) {
    url.searchParams.set("$filter", "isRead eq false");
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[outlook] ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as OutlookListResponse;
  let rows = data.value || [];

  if (input.query?.trim()) {
    const q = input.query.trim().toLowerCase();
    rows = rows.filter((m) => {
      const subject = (m.subject || "").toLowerCase();
      const preview = (m.bodyPreview || "").toLowerCase();
      const from = (m.from?.emailAddress?.name || "").toLowerCase();
      const email = (m.from?.emailAddress?.address || "").toLowerCase();
      return (
        subject.includes(q) ||
        preview.includes(q) ||
        from.includes(q) ||
        email.includes(q)
      );
    });
  }

  return rows.map((m) => {
    const sender = m.from?.emailAddress;
    return {
      id: m.id,
      provider: "outlook",
      subject: m.subject || "(no subject)",
      from: sender?.name || sender?.address || "Unknown",
      fromEmail: sender?.address,
      receivedAt: safeIsoDate(m.receivedDateTime),
      preview: m.bodyPreview || "",
      isRead: Boolean(m.isRead),
      webLink: m.webLink,
    };
  });
}

export async function fetchEmails(input: FetchEmailsInput): Promise<EmailMessage[]> {
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 10, 20));
  const unreadOnly = input.unreadOnly ?? false;

  if (input.provider === "gmail") {
    return fetchGmailEmails({
      accessToken: input.accessToken,
      maxResults,
      unreadOnly,
      query: input.query,
    });
  }

  return fetchOutlookEmails({
    accessToken: input.accessToken,
    maxResults,
    unreadOnly,
    query: input.query,
  });
}
