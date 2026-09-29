/**
 * A project's sidebar, in place of a mailbox's: the same heading (where you
 * are, and the menu to go elsewhere), the project's overview, and its
 * conversations, from every mailbox or one.
 */

import { LayersIcon, NotebookTextIcon } from "lucide-react";

import { AccountMenuItems, Section, SkRow } from "./accounts-sidebar";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import type { SettingsPane } from "./api";
import { useProjectThreads, type Project } from "./projects";
import { MailboxSwitcher, WindowTitle } from "./top-bar";
import type { GmailAccount } from "./types";

export function ProjectSidebar({
  project,
  accounts,
  overview,
  onOverview,
  mailbox,
  onMailbox,
  onSelectAccount,
  onSelectProject,
  onOpenSettings,
  onSync,
  syncing,
}: {
  project: Project;
  accounts: GmailAccount[];
  /** The overview is showing (no conversation open). */
  overview: boolean;
  onOverview: () => void;
  /** The mailbox the list shows the conversations of; null for all. */
  mailbox: string | null;
  onMailbox: (accountId: string | null) => void;
  onSelectAccount: (accountId: string) => void;
  onSelectProject: (projectId: string) => void;
  onOpenSettings: (pane?: SettingsPane) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const rows = useProjectThreads(project.id).data?.pages[0]?.messages ?? [];
  const unreadIn = (accountId: string | null) =>
    rows.filter((m) => (!accountId || m.accountId === accountId) && (m.threadUnread ?? m.unread))
      .length;
  const mailboxes = accounts.filter((a) => rows.some((m) => m.accountId === a.id));

  return (
    <div className="flex h-full min-w-0 flex-col">
      <WindowTitle />
      <div className="shrink-0 px-(--sidebar-content-inset) pb-2">
        <MailboxSwitcher
          accounts={accounts}
          selectedAccountId={null}
          onSelectAccount={onSelectAccount}
          project={project}
          onSelectProject={onSelectProject}
        >
          <AccountMenuItems onOpenSettings={onOpenSettings} onSync={onSync} syncing={syncing} />
        </MailboxSwitcher>
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
        {mailboxes.length > 1 ? (
          <Section title="Conversations">
            <SkRow
              icon={<LayersIcon className="size-4" />}
              title="Every mailbox"
              selected={mailbox === null}
              badge={unreadIn(null)}
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
                badge={unreadIn(account.id)}
                onClick={() => onMailbox(account.id)}
              />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
