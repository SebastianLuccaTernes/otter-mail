/**
 * A project tab's sidebar, in place of the mailboxes': the project, its
 * overview, its conversations by mailbox (a project spans them), its links,
 * and settling it.
 */

import { useState } from "react";
import {
  CircleCheckIcon,
  FolderOpenIcon,
  LayersIcon,
  LinkIcon,
  NotebookTextIcon,
  RotateCcwIcon,
} from "lucide-react";

import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { AddRow, Section, SkRow, SIDEBAR_ROW } from "./accounts-sidebar";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { projectsApi, useProjectThreads, type Project } from "./projects";
import { toast } from "./toast";
import type { GmailAccount } from "./types";

export function ProjectSidebar({
  project,
  accounts,
  overview,
  onOverview,
  mailbox,
  onMailbox,
}: {
  project: Project;
  accounts: GmailAccount[];
  /** The overview is showing (no conversation open). */
  overview: boolean;
  onOverview: () => void;
  /** The mailbox the list shows the conversations of; null for all. */
  mailbox: string | null;
  onMailbox: (accountId: string | null) => void;
}) {
  const rows = useProjectThreads(project.id).data?.pages[0]?.messages ?? [];
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const settled = project.status === "settled";
  const unreadOf = (accountId: string | null) =>
    rows.filter((m) => (!accountId || m.accountId === accountId) && (m.threadUnread ?? m.unread))
      .length;
  const mailboxes = accounts.filter((a) => rows.some((m) => m.accountId === a.id));

  const setStatus = (status: Project["status"]) =>
    void projectsApi
      .update(project.id, { status })
      .catch(() => toast.error("Couldn't change the project"));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 px-(--sidebar-content-inset) pb-2 pt-2">
        <div className="flex h-9 min-w-0 items-center gap-2 px-(--sidebar-row-content-inset) text-sidebar-foreground">
          {settled ? (
            <CircleCheckIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
          ) : (
            <FolderOpenIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
          )}
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">
            {project.name}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-(--sidebar-content-inset)">
        <SkRow
          icon={<NotebookTextIcon className="size-4" />}
          title="Overview"
          selected={overview}
          onClick={onOverview}
        />
      </div>

      <div className="min-h-0 flex-1 scroll-fade-y overflow-y-auto px-(--sidebar-content-inset) pb-8 pt-3">
        <Section title="Conversations">
          <SkRow
            icon={<LayersIcon className="size-4" />}
            title="All mailboxes"
            selected={mailbox === null}
            badge={unreadOf(null)}
            onClick={() => onMailbox(null)}
          />
          {mailboxes.map((account) => (
            <SkRow
              key={account.id}
              icon={
                <span
                  aria-hidden
                  className="flex size-4 items-center justify-center rounded-[4px] text-[9px] font-bold leading-none text-white"
                  style={{ background: getAccountColor(account) }}
                >
                  {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
                </span>
              }
              title={getAccountDisplayName(account)}
              selected={mailbox === account.id}
              badge={unreadOf(account.id)}
              onClick={() => onMailbox(account.id)}
            />
          ))}
        </Section>

        <Section title="Links">
          {project.links.map((link) => (
            <SkRow
              key={link.id}
              icon={<LinkIcon className="size-4" />}
              title={link.title}
              onClick={() => void window.desktopBridge.openExternal(link.url)}
            />
          ))}
          <AddRow label="Add link" onClick={() => setAdding(true)} />
        </Section>
      </div>

      <div className="shrink-0 px-(--sidebar-content-inset) pb-(--sidebar-content-inset) pt-1">
        <button
          type="button"
          onClick={() => setStatus(settled ? "active" : "settled")}
          className={`${SIDEBAR_ROW} justify-center border border-border/70 px-(--sidebar-row-content-inset) text-sidebar-foreground hover:bg-sidebar-row-hover`}
        >
          {settled ? (
            <RotateCcwIcon className="size-4 text-sidebar-muted-foreground" />
          ) : (
            <CircleCheckIcon className="size-4 text-sidebar-muted-foreground" />
          )}
          {settled ? "Reopen project" : "Settle project"}
        </button>
      </div>

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add link"
        confirmLabel="Add"
        confirmDisabled={!url.trim()}
        onConfirm={async () => {
          const value = url.trim();
          await projectsApi
            .addLink(project.id, /^[a-z]+:/i.test(value) ? value : `https://${value}`)
            .catch((err: unknown) => {
              toast.error("That isn't a link");
              throw err;
            });
          setUrl("");
        }}
      >
        <Field label="Address" orientation="vertical">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/…"
            autoFocus
          />
        </Field>
      </Dialog>
    </div>
  );
}
