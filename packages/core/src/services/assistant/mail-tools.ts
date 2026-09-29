/**
 * The mail tools every assistant can call: read-only views of the local mail
 * cache (search, the inbox, a whole thread). Each provider hands them to its
 * agent its own way (Codex dynamic tools, a Claude MCP server, Apple
 * Intelligence's Tool protocol) and runs them here.
 */

import { providerFor } from "../../providers/index.js";
import type { GmailMessageSummary } from "../../types.js";
import { listAccounts } from "../account-store.js";
import * as mailStore from "../mail-store.js";
import { turnedOffMailboxes } from "../mail-sync.js";

export type MailToolParameter = {
  name: string;
  type: "string" | "integer" | "boolean";
  description: string;
  optional: boolean;
};

export type MailTool = { name: string; description: string; parameters: MailToolParameter[] };

const ACCOUNT: MailToolParameter = {
  name: "account",
  type: "string",
  description: "Only this mailbox (its email address). Omit for every mailbox.",
  optional: true,
};

const LIMIT: MailToolParameter = {
  name: "limit",
  type: "integer",
  description: "How many results, at most (default 10).",
  optional: true,
};

export const MAIL_TOOLS: MailTool[] = [
  {
    name: "list_inbox",
    description: "The newest conversations in the inbox, newest first.",
    parameters: [
      ACCOUNT,
      {
        name: "unreadOnly",
        type: "boolean",
        description: "Only unread conversations.",
        optional: true,
      },
      LIMIT,
    ],
  },
  {
    name: "search_mail",
    description:
      "Searches every message by words in the sender, recipients, subject and body, newest first.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "A few words to look for, like a name or a word from the subject.",
        optional: false,
      },
      ACCOUNT,
      LIMIT,
    ],
  },
  {
    name: "read_thread",
    description: "Every message of one conversation, with its text, oldest first.",
    parameters: [
      {
        name: "account",
        type: "string",
        description: "The conversation's mailbox (its email address).",
        optional: false,
      },
      { name: "threadId", type: "string", description: "The conversation's id.", optional: false },
    ],
  },
];

/** JSON Schema for a tool's arguments (Codex and Claude take tools this way). */
export function mailToolSchema(tool: MailTool): {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
} {
  return {
    type: "object",
    properties: Object.fromEntries(
      tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }]),
    ),
    required: tool.parameters.filter((p) => !p.optional).map((p) => p.name),
  };
}

export const isMailTool = (name: string): boolean => MAIL_TOOLS.some((t) => t.name === name);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** A tool's answer is cut here unless the caller asks for less. */
const DEFAULT_MAX_CHARS = 20_000;

/**
 * Runs a mail tool; the answer is plain text for the model (errors too, so
 * it can recover). `maxChars` keeps answers inside small context windows.
 */
export async function runMailTool(
  name: string,
  args: unknown,
  maxChars = DEFAULT_MAX_CHARS,
): Promise<string> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  try {
    const text = await run(name, a);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(cut off)` : text;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function run(name: string, a: Record<string, unknown>): Promise<string> {
  const limit = Math.min(Math.max(Math.trunc(Number(a.limit) || DEFAULT_LIMIT), 1), MAX_LIMIT);
  switch (name) {
    case "list_inbox": {
      const accounts = await mailboxes(a.account);
      const threads = accounts
        .flatMap((id) =>
          mailStore
            .getThreadsPage(id, "INBOX", 0, MAX_LIMIT)
            .messages.map((m) => ({ ...m, accountId: id })),
        )
        .filter((m) => !a.unreadOnly || m.threadUnread || m.unread)
        .sort((x, y) => y.date - x.date)
        .slice(0, limit);
      return threads.length > 0 ? threads.map(listing).join("\n\n") : "The inbox is empty.";
    }
    case "search_mail": {
      const query = typeof a.query === "string" ? a.query.trim() : "";
      if (!query) throw new Error("query is required.");
      const [only] = a.account ? await mailboxes(a.account) : [null];
      const { messages } = mailStore.searchMessages(query, only, 0, limit);
      const found = messages.length > 0 ? messages : anyWords(query, only, limit);
      return found.length > 0 ? found.map(listing).join("\n\n") : "No messages found.";
    }
    case "read_thread": {
      const [account] = await mailboxes(a.account);
      const threadId = typeof a.threadId === "string" ? a.threadId : "";
      const messages = mailStore.getThreadMessages(account, threadId);
      if (messages.length === 0) throw new Error(`No conversation ${threadId} in ${account}.`);
      const texts = await Promise.all(messages.map((m) => messageText(account, m)));
      return texts.join("\n\n---\n\n");
    }
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}

/**
 * Models search in phrases ("lunch with Ada"); when no message has every
 * word, the messages with the most of them, newest first.
 */
function anyWords(query: string, accountId: string | null, limit: number): GmailMessageSummary[] {
  const hits = new Map<string, { message: GmailMessageSummary; words: number }>();
  for (const word of new Set(query.toLowerCase().split(/\s+/))) {
    for (const message of mailStore.searchMessages(word, accountId, 0, MAX_LIMIT).messages) {
      const key = `${message.accountId}/${message.id}`;
      const hit = hits.get(key) ?? { message, words: 0 };
      hit.words += 1;
      hits.set(key, hit);
    }
  }
  return [...hits.values()]
    .sort((x, y) => y.words - x.words || y.message.date - x.message.date)
    .slice(0, limit)
    .map((hit) => hit.message);
}

/** Account ids to look in: the one asked for, else every mailbox that's on. */
async function mailboxes(account: unknown): Promise<string[]> {
  const accounts = await listAccounts();
  if (typeof account === "string" && account.trim()) {
    const wanted = account.trim().toLowerCase();
    const found = accounts.find((x) => x.id.toLowerCase() === wanted || x.email === wanted);
    if (!found) throw new Error(`No mailbox ${account}; the mailboxes are ${ids(accounts)}.`);
    return [found.id];
  }
  const off = turnedOffMailboxes();
  return accounts.filter((x) => !off.has(x.id)).map((x) => x.id);
}

const ids = (accounts: { id: string }[]) => accounts.map((x) => x.id).join(", ");

function from(m: GmailMessageSummary): string {
  return m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
}

function listing(m: GmailMessageSummary): string {
  const unread = m.threadUnread || m.unread ? " · unread" : "";
  const count = m.threadCount && m.threadCount > 1 ? ` · ${m.threadCount} messages` : "";
  return [
    `[${m.accountId}] threadId ${m.threadId} · ${new Date(m.date).toISOString()}${unread}${count}`,
    `From: ${from(m)}`,
    `Subject: ${m.subject || "(no subject)"}`,
    decodeEntities(m.snippet),
  ].join("\n");
}

/** One message with its body: cached, else fetched once and cached (as opening it would). */
async function messageText(accountId: string, m: GmailMessageSummary): Promise<string> {
  let detail = mailStore.getMessageDetail(accountId, m.id);
  if (!detail) {
    detail = await providerFor(accountId).getMessage(accountId, m.id);
    mailStore.upsertMessageDetail(accountId, detail);
  }
  const body = detail.bodyText?.trim() || htmlToText(detail.bodyHtml ?? "") || m.snippet;
  const attachments = detail.attachments.map((x) => x.filename).filter(Boolean);
  return [
    `From: ${from(m)}`,
    `To: ${m.to}`,
    ...(detail.cc ? [`Cc: ${detail.cc}`] : []),
    `Date: ${new Date(m.date).toISOString()}`,
    `Subject: ${m.subject || "(no subject)"}`,
    ...(attachments.length > 0 ? [`Attachments: ${attachments.join(", ")}`] : []),
    "",
    body,
  ].join("\n");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
