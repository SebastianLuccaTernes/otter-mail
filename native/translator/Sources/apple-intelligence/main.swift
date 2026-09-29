import Foundation
import FoundationModels

// Apple Intelligence for the Otter Mail assistant: the Mac's on-device model
// (macOS 26+), through Foundation Models. Nothing leaves the Mac. The mail
// tools run in the app: a tool call goes out as a line on stdout, and its
// answer comes back as a line on stdin.
//
// (Private Cloud Compute, macOS 27, needs a managed entitlement from Apple:
// com.apple.developer.private-cloud-compute.)
//
// Usage: `apple-intelligence <command>`
//   status  → ModelStatus JSON on stdout
//   chat    one turn. stdin: a ChatRequest line, then a ToolResult line per
//           tool call; stdout: Event lines (delta, tool, done, error).

struct ModelStatus: Encodable {
  let available: Bool
  /// Why not: "deviceNotEligible", "appleIntelligenceNotEnabled", "modelNotReady",
  /// "unsupported" (macOS before 26).
  var reason: String? = nil
}

struct Message: Decodable {
  /// "user" or "assistant".
  let role: String
  let text: String
}

struct ToolParameter: Decodable {
  let name: String
  /// "string", "integer" or "boolean".
  let type: String
  let description: String
  let optional: Bool
}

struct ToolSpec: Decodable {
  let name: String
  let description: String
  let parameters: [ToolParameter]
}

struct ChatRequest: Decodable {
  let instructions: String
  let history: [Message]
  let prompt: String
  let tools: [ToolSpec]
}

struct ToolResult: Decodable {
  let id: String
  let output: String
}

struct Event: Encodable {
  let type: String
  var text: String? = nil
  var id: String? = nil
  var name: String? = nil
  /// The tool call's arguments, as JSON.
  var arguments: String? = nil
  var message: String? = nil
}

func emit(_ event: Event) {
  guard let data = try? JSONEncoder().encode(event) else { return }
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

// MARK: - Status

@available(macOS 26, *)
func status() -> ModelStatus {
  switch SystemLanguageModel.default.availability {
  case .available:
    return ModelStatus(available: true)
  case .unavailable(.deviceNotEligible):
    return ModelStatus(available: false, reason: "deviceNotEligible")
  case .unavailable(.appleIntelligenceNotEnabled):
    return ModelStatus(available: false, reason: "appleIntelligenceNotEnabled")
  case .unavailable(.modelNotReady):
    return ModelStatus(available: false, reason: "modelNotReady")
  case .unavailable:
    return ModelStatus(available: false, reason: "unsupported")
  }
}

// MARK: - Tools

/// Tool calls waiting for the app's answer, by id.
actor ToolCalls {
  private var pending: [String: CheckedContinuation<String, Never>] = [:]
  private var closed = false

  func call(name: String, arguments: String) async -> String {
    if closed { return "Error: Otter Mail went away." }
    let id = UUID().uuidString
    return await withCheckedContinuation { continuation in
      pending[id] = continuation
      emit(Event(type: "tool", id: id, name: name, arguments: arguments))
    }
  }

  func resolve(_ result: ToolResult) {
    pending.removeValue(forKey: result.id)?.resume(returning: result.output)
  }

  /// stdin closed: nothing will answer anymore.
  func close() {
    closed = true
    for continuation in pending.values { continuation.resume(returning: "Error: Otter Mail went away.") }
    pending = [:]
  }
}

/// One of the app's mail tools; calling it asks the app.
@available(macOS 26, *)
struct MailTool: Tool {
  typealias Arguments = GeneratedContent
  let name: String
  let description: String
  let parameters: GenerationSchema
  let calls: ToolCalls

  init(_ spec: ToolSpec, calls: ToolCalls) throws {
    name = spec.name
    description = spec.description
    let properties = spec.parameters.map { p in
      DynamicGenerationSchema.Property(
        name: p.name,
        description: p.description,
        schema: p.type == "integer"
          ? DynamicGenerationSchema(type: Int.self)
          : p.type == "boolean"
            ? DynamicGenerationSchema(type: Bool.self) : DynamicGenerationSchema(type: String.self),
        isOptional: p.optional)
    }
    parameters = try GenerationSchema(
      root: DynamicGenerationSchema(name: spec.name, properties: properties), dependencies: [])
    self.calls = calls
  }

  func call(arguments: GeneratedContent) async throws -> String {
    await calls.call(name: name, arguments: arguments.jsonString)
  }
}

// MARK: - Chat

@available(macOS 26, *)
func session(for request: ChatRequest, tools: [MailTool]) -> LanguageModelSession {
  let instructions = Transcript.Instructions(
    segments: [.text(.init(content: request.instructions))],
    toolDefinitions: tools.map { Transcript.ToolDefinition(tool: $0) })
  let history: [Transcript.Entry] = request.history.map { message in
    let segments: [Transcript.Segment] = [.text(.init(content: message.text))]
    return message.role == "user"
      ? .prompt(Transcript.Prompt(segments: segments))
      : .response(Transcript.Response(assetIDs: [], segments: segments))
  }
  let transcript = Transcript(entries: [.instructions(instructions)] + history)
  return LanguageModelSession(tools: tools, transcript: transcript)
}

/// What the user reads when a turn fails.
@available(macOS 26, *)
func describe(_ error: Error) -> String {
  let tooLong =
    "This chat is too long for the on-device model. Start a new chat, or ask about less mail at once."
  let declined = "Apple Intelligence declined to answer this."
  // macOS 27 reports some failures as LanguageModelError.
  #if compiler(>=6.4)
    if #available(macOS 27, *), let error = error as? LanguageModelError {
      switch error {
      case .contextSizeExceeded: return tooLong
      case .guardrailViolation, .refusal: return declined
      case .unsupportedLanguageOrLocale: return "Apple Intelligence doesn't support this language yet."
      case .rateLimited: return "Apple Intelligence is busy. Try again in a moment."
      default: return error.localizedDescription
      }
    }
  #endif
  guard let error = error as? LanguageModelSession.GenerationError else {
    return error.localizedDescription
  }
  switch error {
  case .exceededContextWindowSize:
    return tooLong
  case .guardrailViolation, .refusal:
    return declined
  case .unsupportedLanguageOrLocale:
    return "Apple Intelligence doesn't support this language yet."
  case .assetsUnavailable:
    return "The Apple Intelligence model isn't ready yet. Try again in a moment."
  case .rateLimited:
    return "Apple Intelligence is busy. Try again in a moment."
  default:
    return error.localizedDescription
  }
}

@available(macOS 26, *)
func runTurn(_ request: ChatRequest, calls: ToolCalls) async {
  do {
    let tools = try request.tools.map { try MailTool($0, calls: calls) }
    let stream = session(for: request, tools: tools).streamResponse(to: request.prompt)
    // Each snapshot holds the whole answer so far; send what's new.
    var sent = ""
    for try await snapshot in stream {
      let text = snapshot.content
      guard text.count > sent.count, text.hasPrefix(sent) else { continue }
      emit(Event(type: "delta", text: String(text.dropFirst(sent.count))))
      sent = text
    }
    emit(Event(type: "done"))
  } catch {
    emit(Event(type: "error", message: describe(error)))
  }
  exit(0)
}

@available(macOS 26, *)
func chat() async {
  let calls = ToolCalls()
  var started = false
  do {
    for try await line in FileHandle.standardInput.bytes.lines {
      let data = Data(line.utf8)
      if !started {
        let request = try JSONDecoder().decode(ChatRequest.self, from: data)
        started = true
        Task { await runTurn(request, calls: calls) }
      } else if let result = try? JSONDecoder().decode(ToolResult.self, from: data) {
        await calls.resolve(result)
      }
    }
  } catch {
    fail("Couldn't read the request: \(error)")
  }
  // stdin closed: the app stopped the turn, or quit.
  await calls.close()
  exit(0)
}

// MARK: - Main

guard let command = CommandLine.arguments.dropFirst().first else {
  fail("usage: apple-intelligence status|chat")
}
if #available(macOS 26, *) {
  switch command {
  case "status":
    FileHandle.standardOutput.write(try JSONEncoder().encode(status()))
  case "chat":
    await chat()
  default:
    fail("unknown command: \(command)")
  }
} else if command == "status" {
  FileHandle.standardOutput.write(
    try JSONEncoder().encode(ModelStatus(available: false, reason: "unsupported")))
} else {
  fail("Apple Intelligence needs macOS 26.")
}
