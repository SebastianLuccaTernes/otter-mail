import Foundation
import FoundationModels

/**
 * Otter Mail's agent tools on the iPhone, for Apple's model (AppleAgent.swift):
 * core's tools (packages/core agent/tools/mail.ts) by the same names,
 * arguments and results, over the mail on this iPhone (the MailStore). The
 * phone has the ones it can run: no attachment files, new labels, Bcc or
 * calendar, as in the rest of the app. As in core, a change asks first
 * (drafts don't), and what goes wrong goes back to the model to read.
 */
final class AgentTools {
    /** The mail the app shows (the demo's, or the account's). */
    var mailStore: () -> MailStore? = { nil }
    /** Asks before a change, with exactly what will happen; throws when the user declines. */
    var confirm: (_ tool: String, _ title: String, _ detail: String) async throws -> Void = { _, _, _ in }
    /** Told of each call: the step's title, and its result. */
    var onStep: (_ title: String, _ output: String) -> Void = { _, _ in }

    var all: [any OtterTool] {
        [
            ListAccounts(tools: self), ListLabels(tools: self), ListThreads(tools: self), SearchMail(tools: self),
            GetThread(tools: self), UpdateThreads(tools: self), TrashThreads(tools: self), RestoreThreads(tools: self),
            SaveDraft(tools: self), DeleteDraft(tools: self), SendEmail(tools: self),
        ]
    }

    /** A tool's title ("Search mail"), for the chat's steps. */
    func title(of name: String) -> String { all.first { $0.name == name }?.title ?? name }

    /** Runs a tool's work where the mail is: its result as JSON, or what went wrong. */
    fileprivate func run(_ tool: some OtterTool, _ work: @MainActor () async throws -> Any) async -> String {
        let output: String
        do {
            let data = try JSONSerialization.data(withJSONObject: try await work(), options: [.sortedKeys, .withoutEscapingSlashes])
            output = String(decoding: data, as: UTF8.self)
        } catch {
            output = "Error: \(error.localizedDescription)"
        }
        onStep(tool.title, output)
        return output
    }

    // ── Mailboxes and conversations ──────────────────────────────────────────

    fileprivate var store: MailStore {
        get throws {
            guard let store = mailStore() else { throw ToolError("There's no mail here yet.") }
            return store
        }
    }

    /** The mailbox an argument names, by address; optional when there's only one. */
    fileprivate func mailbox(_ account: String?) throws -> Mailbox {
        let all = try store.mailboxes
        let known = all.map(\.email).joined(separator: ", ")
        guard let wanted = account?.trimmingCharacters(in: .whitespaces).lowercased(), !wanted.isEmpty else {
            if all.count == 1 { return all[0] }
            throw ToolError("\"account\" is required: \(known).")
        }
        guard let found = all.first(where: { $0.email.lowercased() == wanted }) else {
            throw ToolError("No mailbox \"\(wanted)\". Mailboxes: \(known).")
        }
        return found
    }

    /** The mailboxes a list argument names; when it's left out, every one shown. */
    fileprivate func mailboxes(_ accounts: [String]?) throws -> [Mailbox] {
        guard let accounts, !accounts.isEmpty else { return try store.shownMailboxes }
        return try accounts.map { try mailbox($0) }
    }

    /** The conversations an argument names, each one in `mailbox`. */
    fileprivate func threads(_ ids: [String], in mailbox: Mailbox) throws -> [MailThread] {
        guard !ids.isEmpty else { throw ToolError("\"threadIds\" is required.") }
        return try ids.map { id in
            guard let thread = try store.thread(id), thread.mailbox == mailbox.email else {
                throw ToolError("No conversation \(id) in \(mailbox.email) on this device.")
            }
            return thread
        }
    }

    /** The conversation a message or thread id belongs to. */
    fileprivate func conversation(_ ref: String, in mailbox: Mailbox) throws -> MailThread {
        let found = try store.allThreads(of: mailbox.email).first { $0.id == ref || $0.messages.contains { $0.id == ref } }
        guard let found else { throw ToolError("No message or conversation \(ref) in \(mailbox.email). Find it with search_mail.") }
        return found
    }

    /** One conversation in a list, as agents get it. */
    fileprivate func row(_ thread: MailThread) throws -> [String: Any] {
        let latest = thread.latest
        var row: [String: Any] = [
            "account": thread.mailbox,
            "threadId": thread.id,
            "messageId": latest.id,
            "date": Self.localTime(latest.date),
            "from": Self.address(latest.from),
            "to": latest.to.map(Self.address).joined(separator: ", "),
            "subject": thread.subject,
            "snippet": latest.snippet,
            "unread": thread.unread,
            "starred": thread.starred,
            "labels": try labelNames(thread),
        ]
        if thread.messages.count > 1 { row["messages"] = thread.messages.count }
        if thread.hasAttachments { row["attachments"] = true }
        return row
    }

    fileprivate func labelNames(_ thread: MailThread) throws -> [String] {
        let names = Dictionary(try store.mailbox(thread.mailbox)?.labels.map { ($0.id, $0.name) } ?? []) { a, _ in a }
        return thread.labels.filter { $0 != "UNREAD" && $0 != "STARRED" }.sorted().map { names[$0] ?? $0 }
    }

    /** A page of rows, and the next page's cursor when there's more. */
    fileprivate func page(_ threads: [MailThread], cursor: String?, limit: Int) throws -> [String: Any] {
        let offset = cursor.flatMap(Int.init) ?? 0
        let end = min(offset + limit, threads.count)
        var page: [String: Any] = ["threads": try threads[min(offset, end)..<end].map(row)]
        if end < threads.count { page["cursor"] = String(end) }
        return page
    }

    // ── Labels ───────────────────────────────────────────────────────────────

    /** Names agents use for the labels every mailbox has (core's LABEL_ALIASES). */
    private static let folders: [String: Folder] = [
        "inbox": .inbox, "sent": .sent, "draft": .drafts, "drafts": .drafts, "spam": .junk, "junk": .junk,
        "trash": .trash, "starred": .starred, "important": .important, "all": .allMail, "all mail": .allMail, "archive": .allMail,
    ]

    fileprivate func folder(_ ref: String, in mailbox: Mailbox) throws -> Folder {
        let wanted = ref.trimmingCharacters(in: .whitespaces).lowercased()
        if let folder = Self.folders[wanted] { return folder }
        if let label = mailbox.labels.first(where: { $0.id.lowercased() == wanted || $0.name.lowercased() == wanted }) {
            return .label(id: label.id, name: label.name)
        }
        let names = mailbox.labels.map(\.name).joined(separator: ", ")
        throw ToolError("No label \"\(ref)\" in \(mailbox.email). Its labels: inbox, sent, drafts, spam, trash, starred\(names.isEmpty ? "" : ", \(names)").")
    }

    /** A label's id, to add to or remove from a conversation. */
    fileprivate func labelID(_ ref: String, in mailbox: Mailbox) throws -> String {
        switch try folder(ref, in: mailbox) {
        case .inbox: "INBOX"
        case .starred: "STARRED"
        case .important: "IMPORTANT"
        case .junk: "SPAM"
        case .trash: "TRASH"
        case .label(let id, _): id
        default: throw ToolError("\"\(ref)\" isn't a label a conversation can be given.")
        }
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    /**
     * A message from a tool's arguments, as the composer would write it: a reply
     * answers the right people and quotes the message, a forward carries it, and
     * the mailbox's signature follows the body.
     */
    fileprivate func compose(_ a: ComposeArguments) throws -> Draft {
        let mailbox = try mailbox(a.account)
        if a.replyTo != nil && a.forward != nil { throw ToolError("Use \"replyTo\" or \"forward\", not both.") }
        var draft: Draft
        if let ref = a.replyTo {
            draft = Draft.reply(to: try conversation(ref, in: mailbox), in: mailbox, all: a.replyAll ?? false)
        } else if let ref = a.forward {
            draft = Draft.forward(try conversation(ref, in: mailbox), in: mailbox)
        } else {
            draft = Draft.new(from: mailbox)
        }
        draft.body = (a.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines) + draft.body
        if let to = a.to { draft.to = to }
        if let cc = a.cc { draft.cc = cc }
        if let subject = a.subject { draft.subject = subject }
        if let id = a.draftId { draft.messageID = try draftMessage(id, in: mailbox).message.id }
        return draft
    }

    fileprivate func draftMessage(_ id: String, in mailbox: Mailbox) throws -> (message: Message, thread: MailThread) {
        for thread in try store.allThreads(of: mailbox.email) {
            if let message = thread.messages.first(where: { $0.id == id && $0.draft }) { return (message, thread) }
        }
        throw ToolError("No draft \(id) in \(mailbox.email). Its draftId is in get_thread.")
    }

    /** The message as the approval shows it. */
    fileprivate static func describe(_ draft: Draft) -> String {
        [
            "From: \(draft.from)",
            "To: \(draft.to.isEmpty ? "(nobody yet)" : draft.to)",
            draft.cc.isEmpty ? nil : "Cc: \(draft.cc)",
            "Subject: \(draft.subject.isEmpty ? "(no subject)" : draft.subject)",
            "",
            String(draft.body.prefix(600)),
        ].compactMap(\.self).joined(separator: "\n")
    }

    /** The subjects of some conversations, for approvals. */
    fileprivate static func subjects(_ threads: [MailThread]) -> String {
        let shown = threads.prefix(5).map { "“\($0.subject.isEmpty ? "(no subject)" : $0.subject)”" }.joined(separator: ", ")
        return shown + (threads.count > 5 ? " and \(threads.count - 5) more" : "")
    }

    fileprivate static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

    fileprivate static func address(_ person: Person) -> String {
        person.name.isEmpty || person.name == person.email ? person.email : "\(person.name) <\(person.email)>"
    }

    /** A time in this device's zone, with its offset: `2026-09-30T14:05+02:00` (core's localTime). */
    fileprivate static func localTime(_ date: Date) -> String { timeFormat.string(from: date) }

    private static let timeFormat = {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.dateFormat = "yyyy-MM-dd'T'HH:mmxxx"
        return format
    }()
}

nonisolated struct ToolError: LocalizedError {
    var errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

/** A tool with core's title ("Search mail"), for the chat's steps and approvals. */
nonisolated protocol OtterTool: Tool {
    var title: String { get }
}

// ── The tools ────────────────────────────────────────────────────────────────

nonisolated struct ListAccounts: OtterTool {
    let tools: AgentTools
    let name = "list_accounts"
    let title = "List mailboxes"
    let description = "The user's mailboxes (Gmail, IMAP, …) in Otter Mail: each one's address, provider, and whether it has a calendar. Every other tool names a mailbox by its address."

    @Generable struct Arguments {}

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let off = Set(store.preferences.arrangement.off)
            return ["mailboxes": store.arrangedMailboxes.map { m -> [String: Any] in
                var row: [String: Any] = [
                    "account": m.email,
                    "name": m.displayName.isEmpty ? m.name : m.displayName,
                    "provider": m.provider.rawValue,
                    "calendar": false,
                    "labels": m.capabilities.multipleLabels ? "labels" : "folders",
                ]
                if m.signedOut { row["signedOut"] = true }
                if off.contains(m.email) { row["turnedOff"] = true }
                return row
            }]
        }
    }
}

nonisolated struct ListLabels: OtterTool {
    let tools: AgentTools
    let name = "list_labels"
    let title = "List labels"
    let description = "A mailbox's labels (IMAP: its folders), with unread and total counts. Tools take a label by name."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let mailbox = try tools.mailbox(arguments.account)
            let folders = Folder.system.filter { $0 != .allMail && ($0 != .important || mailbox.capabilities.categories) }
                + mailbox.labels.map { Folder.label(id: $0.id, name: $0.name) }
            return ["labels": folders.map { folder -> [String: Any] in
                var row: [String: Any] = ["name": folder.title, "total": store.threads(in: folder, scope: mailbox.email).count]
                if case .label(_, let name) = folder { row["name"] = name; row["type"] = "user" } else { row["type"] = "system" }
                let unread = store.unreadCount(in: folder, scope: mailbox.email)
                if unread > 0 { row["unread"] = unread }
                return row
            }]
        }
    }
}

nonisolated struct ListThreads: OtterTool {
    let tools: AgentTools
    let name = "list_threads"
    let title = "List conversations"
    let description = "The newest conversations in a label (default the inbox), from every mailbox unless one is named. Reads what Otter Mail has on this iPhone."

    @Generable struct Arguments {
        @Guide(description: "One mailbox, by address; default every one.") var account: String?
        @Guide(description: "inbox (default), sent, drafts, starred, spam, trash, all, or a label's name.") var label: String?
        var unreadOnly: Bool?
        @Guide(description: "Default 25, at most 100.") var limit: Int?
        @Guide(description: "The previous page's cursor, for the next page.") var cursor: String?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let mailboxes = arguments.account == nil ? try tools.mailboxes(nil) : [try tools.mailbox(arguments.account)]
            let threads = try mailboxes.flatMap { mailbox in
                store.threads(in: try tools.folder(arguments.label ?? "inbox", in: mailbox), scope: mailbox.email)
            }
            .filter { !(arguments.unreadOnly ?? false) || $0.unread }
            .sorted { $0.latest.date > $1.latest.date }
            return try tools.page(threads, cursor: arguments.cursor, limit: min(arguments.limit ?? 25, 100))
        }
    }
}

nonisolated struct SearchMail: OtterTool {
    let tools: AgentTools
    let name = "search_mail"
    let title = "Search mail"
    let description = "Searches every mailbox (or those named) and answers matching conversations, newest first, up to 50 per page. Words, and the operators from:, to:, subject:, label:, is:unread, is:starred, has:attachment, on what's on this iPhone."

    @Generable struct Arguments {
        var query: String
        @Guide(description: "Mailboxes to search, by address; default every one.") var accounts: [String]?
        @Guide(description: "The previous page's cursor, for the next page.") var cursor: String?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let threads = try tools.mailboxes(arguments.accounts)
                .flatMap { store.search(arguments.query, scope: $0.email) }
                .sorted { $0.latest.date > $1.latest.date }
            var page = try tools.page(threads, cursor: arguments.cursor, limit: 50)
            page["estimate"] = threads.count
            return page
        }
    }
}

nonisolated struct GetThread: OtterTool {
    let tools: AgentTools
    let name = "get_thread"
    let title = "Read a conversation"
    let description = "A whole conversation: every message's sender, recipients, date, text and attachments (oldest first). Quoted history is left out of each message unless includeQuoted is set, since the earlier messages are there. Reading doesn't mark it read."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
        var threadId: String
        var includeQuoted: Bool?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let mailbox = try tools.mailbox(arguments.account)
            let thread = try tools.threads([arguments.threadId], in: mailbox)[0]
            let messages = thread.messages.map { m -> [String: Any] in
                let text = arguments.includeQuoted == true ? m.text : Quote.split(m.text).body
                var row: [String: Any] = [
                    "messageId": m.id,
                    "date": AgentTools.localTime(m.date),
                    "from": AgentTools.address(m.from),
                    "to": m.to.map(AgentTools.address).joined(separator: ", "),
                    "body": String(text.prefix(30_000)),
                ]
                if !m.cc.isEmpty { row["cc"] = m.cc.map(AgentTools.address).joined(separator: ", ") }
                if m.unread { row["unread"] = true }
                if m.draft { row["draftId"] = m.id }
                if !m.attachments.isEmpty {
                    row["attachments"] = m.attachments.map { ["filename": $0.filename, "mimeType": $0.mimeType, "size": $0.size] }
                }
                return row
            }
            return [
                "account": mailbox.email,
                "threadId": thread.id,
                "subject": thread.subject,
                "labels": try tools.labelNames(thread),
                "starred": thread.starred,
                "messages": messages,
            ]
        }
    }
}

nonisolated struct UpdateThreads: OtterTool {
    let tools: AgentTools
    let name = "update_threads"
    let title = "Update conversations"
    let description = "Archives, moves back to the inbox, marks read or unread, stars or unstars, and adds or removes labels on conversations of one mailbox. In IMAP mailboxes a message is in one folder: adding a label moves it there."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
        var threadIds: [String]
        @Guide(description: "Out of the inbox.") var archive: Bool?
        var moveToInbox: Bool?
        @Guide(description: "true: mark read; false: mark unread.") var read: Bool?
        var starred: Bool?
        @Guide(description: "Label names.") var addLabels: [String]?
        var removeLabels: [String]?
    }

    func call(arguments a: Arguments) async throws -> String {
        await tools.run(self) {
            let store = try tools.store
            let mailbox = try tools.mailbox(a.account)
            let threads = try tools.threads(a.threadIds, in: mailbox)
            if a.archive == true && a.moveToInbox == true { throw ToolError("\"archive\" and \"moveToInbox\" contradict each other.") }
            let add = try (a.addLabels ?? []).map { try tools.labelID($0, in: mailbox) }
            let remove = try (a.removeLabels ?? []).map { try tools.labelID($0, in: mailbox) }
            let done = [
                a.archive == true ? "archive" : nil,
                a.moveToInbox == true ? "move to the inbox" : nil,
                a.read.map { $0 ? "mark read" : "mark unread" },
                a.starred.map { $0 ? "star" : "unstar" },
                add.isEmpty ? nil : "label \(a.addLabels!.joined(separator: ", "))",
                remove.isEmpty ? nil : "unlabel \(a.removeLabels!.joined(separator: ", "))",
            ].compactMap(\.self)
            guard let first = done.first else { throw ToolError("Nothing to change.") }
            let action = ([first.prefix(1).uppercased() + first.dropFirst()] + done.dropFirst()).joined(separator: ", ")
            try await tools.confirm(name, title, "\(action): \(AgentTools.plural(threads.count, "conversation")) in \(mailbox.email)\n\(AgentTools.subjects(threads))")
            for thread in threads {
                if a.archive == true { store.archive(thread.id) }
                if a.moveToInbox == true { store.moveToInbox(thread.id) }
                if let read = a.read { store.setRead(read, thread.id) }
                if let starred = a.starred, starred != thread.starred { store.toggleStar(thread.id) }
                for label in add where store.thread(thread.id)?.labels.contains(label) == false { store.toggleLabel(label, thread.id) }
                for label in remove where store.thread(thread.id)?.labels.contains(label) == true { store.toggleLabel(label, thread.id) }
            }
            return ["updated": threads.count]
        }
    }
}

nonisolated struct TrashThreads: OtterTool {
    let tools: AgentTools
    let name = "trash_threads"
    let title = "Move to Trash"
    let description = "Moves conversations of one mailbox to the Trash (restore_threads brings them back)."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
        var threadIds: [String]
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let mailbox = try tools.mailbox(arguments.account)
            let threads = try tools.threads(arguments.threadIds, in: mailbox)
            try await tools.confirm(name, title, "Move \(AgentTools.plural(threads.count, "conversation")) in \(mailbox.email) to the Trash\n\(AgentTools.subjects(threads))")
            for thread in threads { try tools.store.trash(thread.id) }
            return ["trashed": threads.count]
        }
    }
}

nonisolated struct RestoreThreads: OtterTool {
    let tools: AgentTools
    let name = "restore_threads"
    let title = "Restore from Trash"
    let description = "Takes conversations out of the Trash, back where they were."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
        var threadIds: [String]
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let mailbox = try tools.mailbox(arguments.account)
            let threads = try tools.threads(arguments.threadIds, in: mailbox)
            try await tools.confirm(name, title, "Restore \(AgentTools.plural(threads.count, "conversation")) in \(mailbox.email) from the Trash\n\(AgentTools.subjects(threads))")
            for thread in threads { try tools.store.moveToInbox(thread.id) }
            return ["restored": threads.count]
        }
    }
}

/** What save_draft and send_email take (core's COMPOSE_INPUT, as far as the phone goes: no Bcc or files). */
nonisolated protocol ComposeArguments {
    var account: String? { get }
    var to: String? { get }
    var cc: String? { get }
    var subject: String? { get }
    var body: String? { get }
    var replyTo: String? { get }
    var replyAll: Bool? { get }
    var forward: String? { get }
    var draftId: String? { get }
}

nonisolated struct SaveDraft: OtterTool {
    let tools: AgentTools
    let name = "save_draft"
    let title = "Save a draft"
    let description = "Writes a message into the mailbox's Drafts without sending it, for the user to review and send from Otter Mail: the safe way to prepare mail. A reply needs only replyTo (the conversation's threadId works) and body. With draftId, replaces that draft."

    @Generable struct Arguments: ComposeArguments {
        @Guide(description: "The mailbox the draft is in (its address).") var account: String?
        @Guide(description: "Recipients, comma-separated. Replies fill it in when left out.") var to: String?
        var cc: String?
        @Guide(description: "Replies and forwards fill it in when left out.") var subject: String?
        @Guide(description: "Plain text. The mailbox's signature and, for replies and forwards, the original message are added below it.") var body: String?
        @Guide(description: "A messageId to reply to, or a threadId (its latest message): the reply joins its conversation, goes to its sender (with replyAll, everyone on it) and quotes it.") var replyTo: String?
        var replyAll: Bool?
        @Guide(description: "A messageId to forward. Needs `to`.") var forward: String?
        @Guide(description: "An existing draft to replace (its draftId from get_thread); leave it out for a new one.") var draftId: String?
    }

    // A draft sends nothing and is the user's to look at: no approval.
    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let draft = try tools.compose(arguments)
            try await tools.store.save(draft)
            return draft.threadID.map { ["saved": true, "threadId": $0] } ?? ["saved": true]
        }
    }
}

nonisolated struct DeleteDraft: OtterTool {
    let tools: AgentTools
    let name = "delete_draft"
    let title = "Delete a draft"
    let description = "Deletes a draft (its draftId is in get_thread)."

    @Generable struct Arguments {
        @Guide(description: "The mailbox, by address. Optional when there's only one.") var account: String?
        var draftId: String
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let mailbox = try tools.mailbox(arguments.account)
            let found = try tools.draftMessage(arguments.draftId, in: mailbox)
            try await tools.confirm(name, title, "Delete draft \(arguments.draftId) in \(mailbox.email)")
            try await tools.store.discard(Draft.resume(found.message, in: found.thread))
            return ["deleted": true]
        }
    }
}

nonisolated struct SendEmail: OtterTool {
    let tools: AgentTools
    let name = "send_email"
    let title = "Send email"
    let description = "Sends a message: new, a reply (replyTo) or a forward (forward). Only when the user asked for it to be sent; otherwise use save_draft. With draftId, that draft is deleted once it's sent."

    @Generable struct Arguments: ComposeArguments {
        @Guide(description: "The mailbox to send from (its address).") var account: String?
        @Guide(description: "Recipients, comma-separated. Replies fill it in when left out.") var to: String?
        var cc: String?
        @Guide(description: "Replies and forwards fill it in when left out.") var subject: String?
        @Guide(description: "Plain text. The mailbox's signature and, for replies and forwards, the original message are added below it.") var body: String?
        @Guide(description: "A messageId to reply to, or a threadId (its latest message): the reply joins its conversation, goes to its sender (with replyAll, everyone on it) and quotes it.") var replyTo: String?
        var replyAll: Bool?
        @Guide(description: "A messageId to forward. Needs `to`.") var forward: String?
        @Guide(description: "A draft this message replaces.") var draftId: String?
    }

    func call(arguments: Arguments) async throws -> String {
        await tools.run(self) {
            let draft = try tools.compose(arguments)
            guard draft.canSend else { throw ToolError("\"to\" is required.") }
            try await tools.confirm(name, title, AgentTools.describe(draft))
            try await tools.store.send(draft)
            return ["sent": true]
        }
    }
}
