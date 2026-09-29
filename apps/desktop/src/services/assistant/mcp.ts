/**
 * Otter Mail's MCP server for the agents on this Mac (Claude, Codex): the
 * mail (search, read a conversation, save an attachment, draft) and the
 * projects (contracts' project-tools.ts), through the same handlers the
 * windows use. Streamable HTTP on 127.0.0.1, behind a token made at launch;
 * each agent session is handed its address.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  callTool,
  defineTool as tool,
  projectTools,
  type AgentTool,
} from "@otter-mail/contracts/project-tools";
import {
  accountStore,
  getAttachmentBytes,
  mailStore,
  projectsBackend,
  registeredHandlers,
  type GmailMessageDetail,
  type GmailMessageSummary,
} from "@otter-mail/core";

import { logger } from "../../logger.js";
import { attachmentsDir } from "./local.js";

/** The server's name, as agents see it (Claude: `mcp__otter_mail__…`). */
export const MCP_SERVER_NAME = "otter_mail";

const call = <T>(channel: string, params: unknown): Promise<T> => {
  const handler = registeredHandlers().get(channel);
  if (!handler) throw new Error(`No handler for ${channel}.`);
  return Promise.resolve(handler(params)) as Promise<T>;
};

async function accountFor(mailbox: string) {
  const email = mailbox.trim().toLowerCase();
  const account = (await accountStore.listAccounts()).find((a) => a.email.toLowerCase() === email);
  if (!account) throw new Error(`No mailbox ${mailbox} in Otter Mail; list_mailboxes has them.`);
  return account;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A conversation row as an agent reads it. */
const row = (email: string, m: GmailMessageSummary) => ({
  mailbox: email,
  threadId: m.threadId,
  subject: m.subject,
  from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
  date: iso(m.date),
  snippet: m.snippet,
  messages: m.threadCount ?? 1,
  unread: m.threadUnread ?? m.unread,
  hasAttachments: m.hasAttachments,
});

/** HTML mail as plain text, for mail that has no text part. */
function htmlText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BODY_CHARS = 20_000;

const mailbox = z.string().describe("The mailbox, by its email address (list_mailboxes).");

function mailTools(): AgentTool[] {
  return [
    tool({
      name: "list_mailboxes",
      title: "List mailboxes",
      description: "The mailboxes in Otter Mail (Gmail and IMAP), by address.",
      readOnly: true,
      inputSchema: {},
      async run() {
        return (await accountStore.listAccounts()).map((a) => ({
          mailbox: a.email,
          name: a.displayName || a.name,
          provider: a.provider ?? "gmail",
        }));
      },
    }),
    tool({
      name: "search_mail",
      title: "Search mail",
      description:
        "Searches conversations with Gmail's search operators (from:, to:, subject:, has:attachment, filename:, after:, in:inbox, label:, …), newest first. Without a mailbox, searches them all.",
      readOnly: true,
      inputSchema: {
        query: z.string().min(1),
        mailbox: mailbox.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      async run({ query, mailbox, limit }) {
        const accounts = mailbox ? [await accountFor(mailbox)] : await accountStore.listAccounts();
        const result = await call<{ messages: GmailMessageSummary[]; offline?: boolean }>(
          "gmail:search",
          { q: query, accountIds: accounts.map((a) => a.id) },
        );
        const emails = new Map(accounts.map((a) => [a.id, a.email]));
        return {
          ...(result.offline ? { offline: true } : {}),
          conversations: result.messages
            .slice(0, limit)
            .map((m) => row(emails.get(m.accountId ?? "") ?? "", m)),
        };
      },
    }),
    tool({
      name: "read_thread",
      title: "Read a conversation",
      description:
        "Every message of a conversation, oldest first: who, when, the text, and its attachments (save one with get_attachment to read it).",
      readOnly: true,
      inputSchema: { mailbox, threadId: z.string().min(1) },
      async run({ mailbox, threadId }) {
        const account = await accountFor(mailbox);
        const messages = mailStore.getThreadMessages(account.id, threadId);
        if (messages.length === 0) {
          throw new Error("That conversation isn't in Otter Mail; find it with search_mail.");
        }
        const details = await Promise.all(
          messages.map((m) =>
            call<GmailMessageDetail>("gmail:getMessage", {
              accountId: account.id,
              messageId: m.id,
            }),
          ),
        );
        return {
          mailbox: account.email,
          threadId,
          subject: messages[0].subject,
          messages: details.map((d) => {
            const body = d.bodyText?.trim() || htmlText(d.bodyHtml ?? "");
            return {
              messageId: d.id,
              from: d.fromName ? `${d.fromName} <${d.fromEmail}>` : d.fromEmail,
              to: d.to,
              ...(d.cc ? { cc: d.cc } : {}),
              date: iso(d.date),
              labels: d.labelIds,
              body: body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS)}\n[…cut]` : body,
              attachments: d.attachments.map((a) => ({
                attachmentId: a.id,
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
              })),
            };
          }),
        };
      },
    }),
    tool({
      name: "get_attachment",
      title: "Save an attachment",
      description:
        "Saves an attachment (from read_thread or a project's documents) to a file on this Mac and answers its path, to read it with your own tools.",
      readOnly: true,
      inputSchema: {
        mailbox,
        messageId: z.string().min(1),
        attachmentId: z.string().min(1),
        filename: z.string().min(1).max(255),
      },
      async run({ mailbox, messageId, attachmentId, filename }) {
        const account = await accountFor(mailbox);
        const bytes = await getAttachmentBytes(account.id, messageId, attachmentId);
        const dir = path.join(await attachmentsDir(), "mail", messageId.replace(/[^\w.-]/g, "_"));
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, path.basename(filename).replace(/^\.+/, "_"));
        await fs.writeFile(file, bytes);
        return { path: file, size: bytes.length };
      },
    }),
    tool({
      name: "create_draft",
      title: "Draft an email",
      description:
        "Saves a draft in the mailbox, for the user to review and send from Otter Mail (it isn't sent). With a threadId it's a reply in that conversation; the subject then defaults to Re: its subject.",
      readOnly: false,
      inputSchema: {
        mailbox,
        to: z.string().describe("Recipients, comma-separated."),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().describe("Plain text."),
        threadId: z.string().optional().describe("The conversation this replies in."),
      },
      async run({ mailbox, to, cc, bcc, subject, body, threadId }) {
        const account = await accountFor(mailbox);
        const original = threadId ? mailStore.getThreadMessages(account.id, threadId)[0] : null;
        const saved = await call<{ draftId: string; threadId?: string }>("gmail:saveDraft", {
          accountId: account.id,
          sessionKey: `agent-${randomBytes(6).toString("hex")}`,
          to,
          cc,
          bcc,
          subject:
            subject ??
            (original ? `${/^re:/i.test(original.subject) ? "" : "Re: "}${original.subject}` : ""),
          body,
          threadId,
        });
        return { draftId: saved.draftId, threadId: saved.threadId ?? threadId ?? null };
      },
    }),
  ];
}

const INSTRUCTIONS =
  "Otter Mail's mail and projects. Mailboxes are named by address, conversations by mailbox and threadId. A project gathers the conversations, documents (their attachments), links and notes of one piece of work until it's settled. Draft rather than send: the user sends from Otter Mail.";

function register(server: McpServer, tools: AgentTool[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false },
      },
      async (args: Record<string, unknown>) => {
        const result = await callTool(tool, args);
        if (result.isError) {
          logger.info("assistant", "mcp tool failed", {
            tool: tool.name,
            error: result.content[0].text,
          });
        }
        return result;
      },
    );
  }
}

export const MCP_TOOLS = () => [...mailTools(), ...projectTools(projectsBackend)];

/** The tools that only read: allowed without asking. */
export const readOnlyToolNames = () =>
  MCP_TOOLS()
    .filter((t) => t.readOnly)
    .map((t) => t.name);

let listening: Promise<{ url: string; token: string }> | null = null;

/** Starts the server (once) and answers where it is and its token. */
export function mcpServer(): Promise<{ url: string; token: string }> {
  listening ??= new Promise((resolve, reject) => {
    const token = randomBytes(32).toString("hex");
    const httpServer = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${token}` || !req.url?.startsWith("/mcp")) {
        res.writeHead(401).end();
        return;
      }
      void (async () => {
        const server = new McpServer(
          { name: "otter-mail", version: "1.0.0" },
          { instructions: INSTRUCTIONS },
        );
        register(server, MCP_TOOLS());
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
      })().catch((err: unknown) => {
        logger.warn("assistant", "mcp request failed", { error: String(err) });
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as { port: number };
      logger.info("assistant", "mcp server listening", { port });
      resolve({ url: `http://127.0.0.1:${port}/mcp`, token });
    });
  });
  return listening;
}
