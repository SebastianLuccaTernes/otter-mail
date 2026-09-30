import {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Undo2Icon } from "lucide-react";
import { cn, HintTooltip } from "../gmail/ui";

/*
 * Settings layout (after ChatGPT's): one centered column. The page title, page
 * description, section titles and descriptions share the card's left edge;
 * inside a card every row's text starts 16px in and every control ends 16px
 * from the right.
 */

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Settings search: while a query is set, rows that don't match it render
 * nothing, and sections and pages left without rows hide themselves. A page or
 * section whose own title matches keeps all of its rows.
 */
type SettingsSearch = { query: string; matched: boolean };

const SettingsSearchContext = createContext<SettingsSearch>({ query: "", matched: false });

/** The plain text of a title or description, for matching. */
function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

/** Every word of the query appears somewhere in the texts. */
function matchesQuery(query: string, texts: ReactNode[]): boolean {
  const haystack = texts.map(nodeText).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The search in effect here ("" outside a search). */
export function useSettingsSearch(): SettingsSearch {
  return useContext(SettingsSearchContext);
}

/** Whether something titled by `texts` shows under the current search. */
export function useSettingsSearchMatch(...texts: ReactNode[]): boolean {
  const { query, matched } = useSettingsSearch();
  return !query || matched || matchesQuery(query, texts);
}

/** Searches everything inside for `query`. */
export function SettingsSearchProvider({
  query,
  children,
}: {
  query: string;
  children: ReactNode;
}) {
  return (
    <SettingsSearchContext.Provider value={{ query: query.trim(), matched: false }}>
      {children}
    </SettingsSearchContext.Provider>
  );
}

/** Everything inside shows when `texts` (a page or section title) match the search. */
function SettingsSearchScope({ texts, children }: { texts: ReactNode[]; children: ReactNode }) {
  const search = useSettingsSearch();
  const matched = search.matched || (!!search.query && matchesQuery(search.query, texts));
  if (matched === search.matched) return children;
  return (
    <SettingsSearchContext.Provider value={{ ...search, matched }}>
      {children}
    </SettingsSearchContext.Provider>
  );
}

/**
 * While searching, hides a page or section that neither matched by its title
 * nor kept a row. Matched ones carry data-search-hit, so grids and lists
 * without rows still count as results.
 */
export function settingsSearchHideEmpty(
  search: SettingsSearch,
  matched: boolean,
): { className?: string; "data-search-hit"?: "" } {
  if (!search.query) return {};
  if (matched) return { "data-search-hit": "" };
  return {
    className: "[&:not(:has([data-slot=settings-row],[data-search-hit]))]:hidden",
  };
}

/** Shared settings card surface, with separators between rows. */
export function SettingsGroup({
  variant = "grouped",
  divided = true,
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "grouped" | "plain"; divided?: boolean }) {
  return (
    <div
      {...props}
      data-slot={variant === "grouped" ? "settings-group" : undefined}
      className={cn(
        // A search can leave a card without rows.
        "relative overflow-visible text-foreground empty:hidden",
        variant === "grouped" ? "rounded-xl border border-border/60 bg-card" : "space-y-1",
        variant === "grouped" && divided && "[&>*+*]:border-t [&>*+*]:border-border/40",
        // Row hovers and selections follow the card's corners.
        variant === "grouped" &&
          "[&>*:first-child]:rounded-t-[11px] [&>*:last-child]:rounded-b-[11px]",
        className,
      )}
    />
  );
}

/** A section's title (and optional description) above its card, flush with the card's edge. */
export function SettingsSectionHeader({
  title,
  description,
  icon,
  action,
  muted,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  /** Quiet group label (the keybindings list) instead of a section title. */
  muted?: boolean;
}) {
  return (
    // Text outside the cards lines up with the text inside them (Linear):
    // the cards' 1px border + 16px padding.
    <div
      className={cn(
        "flex min-h-7 items-center justify-between gap-4 px-[17px]",
        muted ? "mb-1" : "mb-3",
      )}
    >
      <div className="min-w-0">
        <h2
          data-slot="settings-section-title"
          className={cn(
            "flex items-center gap-2 text-sm",
            muted ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {icon}
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A titled group of rows. "plain" leaves the children uncarded (grids, lists). */
export function SettingsSection({
  title,
  description,
  icon,
  headerAction,
  variant = "grouped",
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  headerAction?: ReactNode;
  variant?: "grouped" | "plain";
  children: ReactNode;
}) {
  const search = useSettingsSearch();
  const matched = !!search.query && (search.matched || matchesQuery(search.query, [title]));
  const hide = settingsSearchHideEmpty(search, matched);
  return (
    <section {...props} {...hide} className={cn(className, hide.className)}>
      <SettingsSectionHeader
        title={title}
        description={description}
        icon={icon}
        action={headerAction}
      />
      <SettingsSearchScope texts={[title]}>
        {variant === "grouped" ? <SettingsGroup>{children}</SettingsGroup> : children}
      </SettingsSearchScope>
    </section>
  );
}

/**
 * One setting: title + description on the left, the control on the right.
 * Children render below the row (expanded editors, lists).
 */
export function SettingsRow({
  title,
  description,
  status,
  control,
  resetAction,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  /** Shown beside the title while the setting differs from its default. */
  resetAction?: ReactNode;
  children?: ReactNode;
}) {
  if (!useSettingsSearchMatch(title, description)) return null;
  return (
    <div
      {...props}
      data-slot="settings-row"
      className={cn("@container/settings-row px-4", children ? "pt-2.5 pb-1" : "py-2.5", className)}
    >
      <div className="flex min-h-9 flex-col gap-3 @min-[30rem]/settings-row:flex-row @min-[30rem]/settings-row:items-center @min-[30rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-normal text-foreground">{title}</h3>
            {resetAction ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 max-w-[30rem] text-[13px] leading-[18px] text-muted-foreground">
              {description}
            </p>
          ) : null}
          {status ? <div className="mt-1 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div
            data-slot="settings-row-control"
            className="flex min-w-0 shrink-0 items-center gap-2 @min-[30rem]/settings-row:justify-end"
          >
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Small undo button that puts one setting back to its default. */
export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label="Reset to default">
      <button
        type="button"
        aria-label={`Reset ${label} to default`}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Undo2Icon className="size-3" />
      </button>
    </HintTooltip>
  );
}

/**
 * Scrollable page: the pane's title (and a one-line description) over its
 * sections, in the settings column.
 */
export function SettingsPageContainer({
  title,
  description,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Beside the title, right-aligned with the cards' edge. */
  action?: ReactNode;
}) {
  const search = useSettingsSearch();
  if (search.query) {
    // One page among the search results: a smaller title, no action, and the
    // results scroll as one.
    const matched = search.matched || matchesQuery(search.query, [title]);
    const hide = settingsSearchHideEmpty(search, matched);
    return (
      <div {...props} {...hide} className={cn("space-y-6", hide.className)}>
        {title ? (
          <h2
            data-slot="settings-page-title"
            className="px-[17px] text-base font-medium text-foreground"
          >
            {title}
          </h2>
        ) : null}
        <SettingsSearchScope texts={[title]}>{children}</SettingsSearchScope>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        {...props}
        className={cn("mx-auto w-full max-w-[47rem] space-y-10 px-6 pb-20 pt-14", className)}
      >
        {title ? (
          <header className="flex items-end justify-between gap-4 px-[17px]">
            <div className="min-w-0">
              <h1
                data-slot="settings-page-title"
                className="text-[26px] font-medium leading-8 tracking-[-0.01em] text-foreground"
              >
                {title}
              </h1>
              {description ? (
                <p
                  data-slot="settings-page-description"
                  className="mt-1.5 text-sm text-muted-foreground"
                >
                  {description}
                </p>
              ) : null}
            </div>
            {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Text input in the app's control style (small size). */
export const TextInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(function TextInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] text-sm text-foreground outline-none transition-[box-shadow,border-color,background-color] placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16 disabled:opacity-64",
        className,
      )}
    />
  );
});

/** Text input that commits on blur / Enter (settings write once, not per keystroke). */
export function DraftInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof TextInput>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <TextInput
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}
