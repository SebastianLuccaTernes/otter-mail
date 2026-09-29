/**
 * Apple Intelligence: the Mac's on-device model, through the
 * native/translator `apple-intelligence` helper (Foundation Models). One
 * helper process per turn: the request goes in as a JSON line, deltas and
 * tool calls come out as JSON lines, and each tool call is answered on stdin
 * with core's mail tools. Nothing leaves the Mac.
 *
 * The model keeps no chats, so each one's messages are kept here (in the
 * app's files) and replayed as the transcript. Its context is small (4,096
 * tokens), so the replay and every tool answer are trimmed to fit.
 */

import { app } from "electron";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  MAIL_TOOLS,
  accountStore,
  logger,
  runMailTool,
  type ChatProvider,
  type ChatSessionMessage,
  type ProviderSnapshot,
} from "@otter-mail/core";
import { helperPath } from "../translator.js";

const STATUS_TIMEOUT_MS = 15_000;
/** Most of one tool answer the model sees (~1,000 tokens). */
const TOOL_OUTPUT_CHARS = 4_000;
/** Most of the earlier messages replayed with a turn (~750 tokens). */
const HISTORY_CHARS = 3_000;
const TOOL_OUTPUT_PREVIEW_CHARS = 400;
/** Chats kept for replay, newest first. */
const MAX_CHATS = 50;

type Message = { role: "user" | "assistant"; text: string };
type ModelStatus = { available: boolean; reason?: string };

const UNAVAILABLE: Record<string, string> = {
  deviceNotEligible: "This Mac can't run Apple Intelligence.",
  appleIntelligenceNotEnabled:
    "Apple Intelligence is off. Turn it on in System Settings → Apple Intelligence & Siri.",
  modelNotReady: "The Apple Intelligence model is still downloading. Try again in a few minutes.",
  unsupported: "Apple Intelligence needs macOS 26 or later.",
};

async function instructions(): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", { dateStyle: "full" });
  const mailboxes = (await accountStore.listAccounts()).map((a) => a.id).join(", ");
  return [
    "You are the assistant built into Otter Mail, a mail app on the user's Mac.",
    `Today is ${today}. The user's mailboxes: ${mailboxes || "none yet"}.`,
    "Look at the user's mail with the tools: list_inbox for what's new, search_mail to find messages, read_thread to read a conversation by its account and threadId.",
    "Messages may end with a '— context from Otter Mail —' block naming conversations by account and threadId.",
    "You can read mail but not send, change or delete it. Answer briefly.",
  ].join("\n");
}

// ── Chats ───────────────────────────────────────────────────────────────────

const chatsFile = () => path.join(app.getPath("userData"), "assistant-apple-chats.json");
let chats: Map<string, Message[]> | null = null;

async function loadChats(): Promise<Map<string, Message[]>> {
  if (chats) return chats;
  const raw = await fs.readFile(chatsFile(), "utf-8").catch(() => "[]");
  try {
    chats = new Map(JSON.parse(raw) as [string, Message[]][]);
  } catch {
    chats = new Map();
  }
  return chats;
}

async function saveChats(): Promise<void> {
  if (!chats) return;
  const entries = [...chats].slice(-MAX_CHATS);
  chats = new Map(entries);
  await fs.writeFile(chatsFile(), JSON.stringify(entries));
}

/** The newest messages that fit the replay budget, oldest first. */
function recent(messages: Message[]): Message[] {
  const out: Message[] = [];
  let chars = 0;
  for (const m of messages.toReversed()) {
    chars += m.text.length;
    if (chars > HISTORY_CHARS) break;
    out.unshift(m);
  }
  // A transcript starts with the user.
  return out[0]?.role === "assistant" ? out.slice(1) : out;
}

// ── Helper ──────────────────────────────────────────────────────────────────

function modelStatus(): Promise<ModelStatus> {
  return new Promise((resolve, reject) => {
    execFile(
      helperPath("apple-intelligence"),
      ["status"],
      { timeout: STATUS_TIMEOUT_MS },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(JSON.parse(stdout) as ModelStatus);
        } catch {
          reject(new Error("The helper returned malformed output."));
        }
      },
    );
  });
}

const running = new Map<string, ChildProcess>();

export const appleProvider: ChatProvider = {
  kind: "apple",
  displayName: "Apple Intelligence",

  async checkStatus() {
    const base = {
      kind: "apple" as const,
      displayName: "Apple Intelligence",
      version: `macOS ${process.getSystemVersion()}`,
      models: [{ slug: "on-device", name: "On-device", isDefault: true }],
      model: "on-device",
      sessions: false,
    };
    let status: ModelStatus;
    try {
      status = await modelStatus();
    } catch (error) {
      logger.info("assistant", "apple intelligence status failed", { error: String(error) });
      return {
        ...base,
        installed: false,
        status: "error",
        auth: { status: "unknown" },
        message: "The Apple Intelligence helper didn't run. Build it with `pnpm build:translator`.",
      } satisfies Omit<ProviderSnapshot, "checkedAt" | "enabled">;
    }
    if (!status.available)
      return {
        ...base,
        installed: true,
        status: "error",
        auth: { status: "unknown" },
        message: UNAVAILABLE[status.reason ?? ""] ?? UNAVAILABLE.unsupported,
      };
    return {
      ...base,
      installed: true,
      status: "ready",
      auth: { status: "authenticated", label: "On this Mac" },
      message: "Runs on this Mac. Its memory is short: a few emails at a time.",
    };
  },

  async sendTurn(turn, _settings, emit) {
    const { requestId } = turn;
    const saved = await loadChats();
    const sessionId = turn.sessionId ?? randomUUID();
    if (sessionId !== turn.sessionId) emit({ requestId, type: "session", sessionId });
    const history = saved.get(sessionId) ?? [];
    const attached = (turn.attachments ?? []).map((a) => a.name);
    const prompt = attached.length
      ? `${turn.input}\n\n(Attached, which you can't open: ${attached.join(", ")}.)`
      : turn.input;

    const child = spawn(helperPath("apple-intelligence"), ["chat"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    running.set(requestId, child);
    let answer = "";
    let settled = false;
    const settle = (event: Parameters<typeof emit>[0]) => {
      if (settled) return;
      settled = true;
      emit(event);
    };
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk: Buffer) =>
      logger.info("assistant", "apple intelligence stderr", {
        line: chunk.toString().slice(0, 300),
      }),
    );

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let event: {
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        arguments?: string;
        message?: string;
      };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "delta" && event.text) {
        answer += event.text;
        emit({ requestId, type: "delta", text: event.text });
      } else if (event.type === "tool" && event.id && event.name) {
        const { id, name } = event;
        emit({ requestId, type: "tool", name });
        let args: unknown = {};
        try {
          args = JSON.parse(event.arguments ?? "{}");
        } catch {
          // The tool reports the missing arguments.
        }
        void runMailTool(name, args, TOOL_OUTPUT_CHARS).then((output) => {
          emit({
            requestId,
            type: "toolResult",
            output: output.slice(0, TOOL_OUTPUT_PREVIEW_CHARS),
          });
          child.stdin.write(`${JSON.stringify({ id, output })}\n`);
        });
      } else if (event.type === "done") {
        // Re-inserted, so the Map stays in order of use.
        saved.delete(sessionId);
        saved.set(sessionId, [
          ...history,
          { role: "user", text: turn.input },
          { role: "assistant", text: answer },
        ]);
        void saveChats().catch(() => {});
        settle({ requestId, type: "done", responseId: null });
      } else if (event.type === "error") {
        settle({ requestId, type: "error", message: `agent_error: ${event.message ?? "failed"}` });
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        instructions: await instructions(),
        history: recent(history),
        prompt,
        tools: MAIL_TOOLS,
      })}\n`,
    );

    await new Promise<void>((resolve) => {
      child.on("error", (error) => {
        logger.info("assistant", "apple intelligence failed to start", { error: String(error) });
        settle({
          requestId,
          type: "error",
          message: "agent_error: The Apple Intelligence helper didn't run.",
        });
        resolve();
      });
      child.on("close", (code, signal) => {
        running.delete(requestId);
        settle(
          signal
            ? { requestId, type: "error", message: "cancelled" }
            : {
                requestId,
                type: "error",
                message: `agent_error: The model stopped (exit ${code}).`,
              },
        );
        resolve();
      });
    });
  },

  cancel(requestId) {
    running.get(requestId)?.kill();
  },

  async steer() {
    return false;
  },

  async respondApproval() {},

  async listSkills() {
    return [];
  },

  async listSessions() {
    return [];
  },

  async readSession(_settings, sessionId): Promise<ChatSessionMessage[]> {
    return (await loadChats()).get(sessionId) ?? [];
  },

  async deleteSession(_settings, sessionId) {
    if ((await loadChats()).delete(sessionId)) await saveChats();
  },

  shutdown() {
    for (const child of running.values()) child.kill();
  },
};
