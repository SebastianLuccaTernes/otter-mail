/**
 * The assistants' mail tools on a seeded cache: the inbox across mailboxes,
 * search, and a whole thread with its bodies (HTML-only mail as text).
 */

import { DatabaseSync } from "node:sqlite";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Platform, SqlDatabase } from "../../platform.ts";
import type { GmailAccount, GmailMessageDetail } from "../../types.ts";

const home: GmailAccount = { id: "me@home.test", email: "me@home.test", name: "Home" };
const work: GmailAccount = { id: "me@work.test", email: "me@work.test", name: "Work" };

function message(
  id: string,
  threadId: string,
  fields: Partial<GmailMessageDetail> & { date: number },
): GmailMessageDetail {
  return {
    id,
    threadId,
    fromName: "Ada",
    fromEmail: "ada@example.com",
    to: "me@home.test",
    subject: "Lunch Friday?",
    snippet: "Are you free?",
    unread: false,
    starred: false,
    labelIds: ["INBOX"],
    hasAttachments: false,
    bodyHtml: null,
    bodyText: null,
    attachments: [],
    ...fields,
  };
}

let runMailTool: typeof import("../assistant/mail-tools.ts").runMailTool;

beforeAll(async () => {
  const { setPlatform } = await import("../../platform.ts");
  const mailStore = await import("../mail-store.ts");
  ({ runMailTool } = await import("../assistant/mail-tools.ts"));
  const files = new Map([
    ["accounts.json", new TextEncoder().encode(JSON.stringify([home, work]))],
  ]);
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  setPlatform({
    log: () => {},
    database: () => database,
    files: { read: async (path: string) => files.get(path) ?? null },
  } as unknown as Platform);

  mailStore.upsertMessageDetail(
    home.id,
    message("h1", "t-lunch", {
      date: Date.parse("2026-09-27T10:00:00Z"),
      bodyText: "Are you free for lunch on Friday at noon?",
    }),
  );
  mailStore.upsertMessageDetail(
    home.id,
    message("h2", "t-lunch", {
      date: Date.parse("2026-09-28T10:00:00Z"),
      fromName: "",
      fromEmail: "me@home.test",
      subject: "Re: Lunch Friday?",
      snippet: "Yes!",
      labelIds: ["SENT"],
      bodyHtml: "<p>Yes, noon works.</p><p>See you &amp; Bob there</p>",
    }),
  );
  mailStore.upsertMessageDetail(
    work.id,
    message("w1", "t-invoice", {
      date: Date.parse("2026-09-29T08:00:00Z"),
      fromName: "Billing",
      fromEmail: "billing@acme.test",
      to: "me@work.test",
      subject: "Invoice 42",
      snippet: "Your invoice is attached",
      unread: true,
      labelIds: ["INBOX", "UNREAD"],
      bodyText: "Invoice 42 is due on October 10.",
    }),
  );
});

describe("mail tools", () => {
  it("lists the inbox of every mailbox, newest first", async () => {
    const text = await runMailTool("list_inbox", {});
    expect(text.indexOf("Invoice 42")).toBeLessThan(text.indexOf("Lunch Friday?"));
    expect(text).toContain("[me@work.test] threadId t-invoice");
    expect(text).toContain("unread");
  });

  it("lists only unread conversations, or one mailbox", async () => {
    expect(await runMailTool("list_inbox", { unreadOnly: true })).not.toContain("Lunch");
    expect(await runMailTool("list_inbox", { account: "ME@HOME.TEST" })).not.toContain("Invoice");
  });

  it("searches messages", async () => {
    const text = await runMailTool("search_mail", { query: "invoice" });
    expect(text).toContain("Billing <billing@acme.test>");
    // No message has every word: the ones with the most of them.
    const phrase = await runMailTool("search_mail", { query: "lunch with Ada" });
    expect(phrase).toContain("threadId t-lunch");
    expect(phrase).not.toContain("Invoice");
    expect(await runMailTool("search_mail", { query: "nothing-like-this" })).toBe(
      "No messages found.",
    );
  });

  it("reads a thread with its bodies, HTML as text", async () => {
    const text = await runMailTool("read_thread", { account: home.id, threadId: "t-lunch" });
    expect(text).toContain("Are you free for lunch on Friday at noon?");
    expect(text).toContain("Yes, noon works.\nSee you & Bob there");
    expect(text.indexOf("noon?")).toBeLessThan(text.indexOf("noon works"));
  });

  it("answers mistakes as text the model can act on", async () => {
    expect(await runMailTool("read_thread", { account: "who@else.test", threadId: "x" })).toMatch(
      /^Error: No mailbox who@else.test; the mailboxes are me@home.test, me@work.test\.$/,
    );
    expect(await runMailTool("search_mail", {})).toBe("Error: query is required.");
  });

  it("cuts long answers", async () => {
    expect(await runMailTool("list_inbox", {}, 20)).toMatch(/^.{20}\n…\(cut off\)$/s);
  });
});
