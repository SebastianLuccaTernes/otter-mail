import Foundation
import FoundationModels

/**
 * Apple's on-device model as an agent (Foundation Models), with Otter Mail's
 * tools on the iPhone (AgentTools.swift). The model runs here and nothing
 * leaves the phone, chats included: each is kept as the model's transcript,
 * in Application Support, and goes when the account signs out.
 */
final class AppleAgent {
    struct Chat: Codable {
        var id: String
        var title: String
        var lastActive: Date
        var transcript: Transcript
    }

    let tools = AgentTools()
    /** Shows an approval on the turn and waits for the answer: "once", "session" or "deny". */
    var approve: (Agent.Approval) async -> String = { _ in "deny" }
    private(set) var chat: Chat?
    private var session: LanguageModelSession?
    /** Tools the user allowed for the rest of this chat. */
    private var allowed: Set<String> = []

    init() {
        tools.confirm = { [unowned self] tool, title, detail in try await confirm(tool, title, detail) }
    }

    /** Why the model can't run here, or nil when it can. */
    static var unavailable: String? {
        switch SystemLanguageModel.default.availability {
        case .available: nil
        case .unavailable(.deviceNotEligible): "This iPhone doesn't have Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled): "Turn on Apple Intelligence in the Settings app to use it here."
        case .unavailable(.modelNotReady): "Apple Intelligence is still getting ready on this iPhone. Try again in a little while."
        case .unavailable: "Apple Intelligence isn't available right now."
        }
    }

    func newChat() {
        session = nil
        chat = nil
        allowed = []
    }

    func open(_ chat: Chat) {
        newChat()
        self.chat = chat
        session = LanguageModelSession(tools: tools.all.map { $0 as any Tool }, transcript: chat.transcript)
    }

    /** One turn, the answer streamed to `onText` as it grows; the chat is kept after, however it ends. */
    func respond(to prompt: String, title: String, onText: (String) -> Void) async throws {
        let session = session ?? LanguageModelSession(tools: tools.all.map { $0 as any Tool }, instructions: Self.instructions)
        self.session = session
        defer { keep(session.transcript, title: title) }
        for try await snapshot in session.streamResponse(to: prompt) {
            onText(snapshot.content)
        }
    }

    private func confirm(_ tool: String, _ title: String, _ detail: String) async throws {
        guard !allowed.contains(tool) else { return }
        let question = "Allow Apple to \(title.prefix(1).lowercased())\(title.dropFirst())?"
        let approval = Agent.Approval(id: UUID().uuidString, question: question, detail: detail, choices: ["once", "session", "deny"])
        switch await approve(approval) {
        case "once": break
        case "session": allowed.insert(tool)
        default: throw ToolError("The user declined.")
        }
    }

    /** What every agent is told about Otter Mail (the Mac's AGENT_INSTRUCTIONS), for the tools the phone has. */
    private static var instructions: String {
        """
        You are the agent built into Otter Mail, a mail client, on the user's iPhone.
        The user's mailboxes (Gmail, IMAP, …) are yours through the otter-mail tools: list_accounts, search_mail, list_threads, get_thread, update_threads, save_draft, send_email and the rest. Use them for anything about the user's mail.
        Messages may end with a '— context from Otter Mail —' block that points at conversations by mailbox and threadId; read them with get_thread when you need them.
        When the user wants to write to someone, save the message with save_draft (a reply's replyTo can be the conversation's threadId) rather than only writing it out; send it only if they asked for it to be sent. Never send an email, or take any other irreversible action on the user's mailboxes, unless the user explicitly asks for it in this conversation.
        It's \(Date.now.formatted(date: .complete, time: .shortened)).
        """
    }

    /** What to tell the user when a turn fails. */
    static func message(_ error: Error) -> String {
        // iOS 27 reports these as LanguageModelError; iOS 26 as GenerationError.
        if #available(iOS 27, *), let error = error as? LanguageModelError {
            switch error {
            case .contextSizeExceeded: return Failure.contextWindow
            case .guardrailViolation, .refusal: return Failure.refused
            case .unsupportedLanguageOrLocale: return Failure.unsupportedLanguage
            default: return error.localizedDescription
            }
        }
        switch error as? LanguageModelSession.GenerationError {
        case .exceededContextWindowSize: return Failure.contextWindow
        case .guardrailViolation, .refusal: return Failure.refused
        case .unsupportedLanguageOrLocale: return Failure.unsupportedLanguage
        default: return error.localizedDescription
        }
    }

    private enum Failure {
        static let contextWindow = "This chat is too long for Apple's on-device model. Start a new one."
        static let refused = "Apple's model won't help with that."
        static let unsupportedLanguage = "Apple's model doesn't speak this language yet."
    }

    // ── Chats, kept here ─────────────────────────────────────────────────────

    private static let folder = URL.applicationSupportDirectory.appending(path: "apple-chats", directoryHint: .isDirectory)

    private func keep(_ transcript: Transcript, title: String) {
        let chat = Chat(id: chat?.id ?? UUID().uuidString, title: chat?.title ?? title, lastActive: .now, transcript: transcript)
        self.chat = chat
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        try? JSONEncoder().encode(chat).write(to: Self.folder.appending(path: "\(chat.id).json"), options: [.atomic, .completeFileProtection])
    }

    /** Every chat kept here, newest first. */
    static func chats() -> [Chat] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.compactMap { try? JSONDecoder().decode(Chat.self, from: Data(contentsOf: $0)) }
            .sorted { $0.lastActive > $1.lastActive }
    }

    static func chat(_ id: String) -> Chat? {
        try? JSONDecoder().decode(Chat.self, from: Data(contentsOf: folder.appending(path: "\(id).json")))
    }

    static func delete(_ id: String) {
        try? FileManager.default.removeItem(at: folder.appending(path: "\(id).json"))
    }

    /** Signing out (or leaving the demo) takes the chats with it: they quote the mail. */
    static func forgetAll() {
        try? FileManager.default.removeItem(at: folder)
    }

    /** A kept chat as the panel shows it: questions (without the handoff block), answers, and the steps they took. */
    func turns(_ transcript: Transcript) -> [Agent.Turn] {
        var turns: [Agent.Turn] = []
        func answer(_ change: (inout Agent.Turn) -> Void) {
            if turns.last?.role != .agent { turns.append(Agent.Turn(role: .agent, text: "")) }
            change(&turns[turns.count - 1])
        }
        for entry in transcript {
            switch entry {
            case .prompt(let prompt):
                let question = Self.text(prompt.segments).components(separatedBy: MailContext.marker)[0]
                turns.append(Agent.Turn(role: .user, text: question.trimmingCharacters(in: .whitespacesAndNewlines)))
            case .toolOutput(let output):
                answer { $0.tools.append(Agent.Tool(name: tools.title(of: output.toolName), output: String(Self.text(output.segments).prefix(400)))) }
            case .response(let response):
                answer { $0.text += ($0.text.isEmpty ? "" : "\n\n") + Self.text(response.segments) }
            default:
                break
            }
        }
        return turns
    }

    private static func text(_ segments: [Transcript.Segment]) -> String {
        segments.map { segment in
            if case .text(let text) = segment { text.content } else { "" }
        }.joined()
    }
}
