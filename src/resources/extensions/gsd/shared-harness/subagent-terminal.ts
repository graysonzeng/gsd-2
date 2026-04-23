export interface SubagentTerminalResult {
  outputText: string;
  stopReason: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  terminalError: string | null;
  assistantStarted: boolean;
  messageUpdateCount: number;
  toolExecutionCount: number;
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { type?: unknown; text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n")
    .trim();
}

function extractAssistantMessage(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== "object") return null;

  const typedEvent = event as {
    type?: unknown;
    message?: Record<string, unknown>;
    messages?: Array<Record<string, unknown>>;
  };

  if (
    (typedEvent.type === "message_end" || typedEvent.type === "turn_end")
    && typedEvent.message?.role === "assistant"
  ) {
    return typedEvent.message;
  }

  if (typedEvent.type === "agent_end" && Array.isArray(typedEvent.messages)) {
    const messages = typedEvent.messages.filter((message) => message?.role === "assistant");
    return messages[messages.length - 1] ?? null;
  }

  return null;
}

export function parseSubagentTerminalResult(rawOutput: string): SubagentTerminalResult {
  let lastAssistantMessage: Record<string, unknown> | null = null;
  let lastAssistantStartMessage: Record<string, unknown> | null = null;
  let messageUpdateCount = 0;
  let toolExecutionCount = 0;

  for (const line of rawOutput.split("\n")) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        parsed
        && typeof parsed === "object"
        && (parsed as { type?: unknown }).type === "message_start"
        && (parsed as { message?: Record<string, unknown> }).message?.role === "assistant"
      ) {
        lastAssistantStartMessage = (parsed as { message: Record<string, unknown> }).message;
      }
      if (parsed && typeof parsed === "object") {
        const eventType = (parsed as { type?: unknown }).type;
        if (eventType === "message_update") {
          messageUpdateCount += 1;
        }
        if (eventType === "tool_execution_start") {
          toolExecutionCount += 1;
        }
      }
      const assistantMessage = extractAssistantMessage(parsed);
      if (assistantMessage) {
        lastAssistantMessage = assistantMessage;
      }
    } catch {
      continue;
    }
  }

  const outputText = extractTextContent(lastAssistantMessage?.content);
  const stopReason = typeof lastAssistantMessage?.stopReason === "string"
    ? lastAssistantMessage.stopReason
    : null;
  const errorMessage = typeof lastAssistantMessage?.errorMessage === "string"
    ? lastAssistantMessage.errorMessage
    : null;
  const assistantMetadata = lastAssistantMessage ?? lastAssistantStartMessage;
  const provider = typeof assistantMetadata?.provider === "string"
    ? assistantMetadata.provider
    : null;
  const model = typeof assistantMetadata?.model === "string"
    ? assistantMetadata.model
    : null;

  return {
    outputText,
    stopReason,
    errorMessage,
    provider,
    model,
    terminalError: errorMessage ?? (stopReason === "error" ? "subagent terminal error" : null),
    assistantStarted: Boolean(lastAssistantStartMessage || lastAssistantMessage),
    messageUpdateCount,
    toolExecutionCount,
  };
}
