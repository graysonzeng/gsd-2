import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { AssistantMessage, Model } from "../types.js";
import { processResponsesStream } from "./openai-responses-shared.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

function makeOutput(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.4",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function* fromEvents(events: unknown[]): AsyncGenerator<any> {
	for (const event of events) {
		yield event;
	}
}

describe("processResponsesStream response.failed diagnostics", () => {
	it("surfaces response.error details instead of generic Unknown error", async () => {
		const output = makeOutput();
		const stream = new AssistantMessageEventStream();
		const model = {
			id: "gpt-5.4",
			provider: "openai",
			api: "openai-responses",
			input: ["text"],
			reasoning: false,
		} as unknown as Model<"openai-responses">;

		await assert.rejects(
			processResponsesStream(
				fromEvents([
					{
						type: "response.failed",
						response: {
							status: "failed",
							error: {
								type: "server_error",
								code: "rate_limit_exceeded",
								message: "Rate limit exceeded. Please try again later.",
							},
						},
					},
				]),
				output,
				stream,
				model,
			),
			/server_error rate_limit_exceeded: Rate limit exceeded\. Please try again later\./,
		);
	});
});
