import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { Model } from "../types.js";
import { processResponsesStream } from "./openai-responses-shared.js";
import { assertStreamSuccess, buildInitialOutput, formatOpenAIError } from "./openai-shared.js";

const openAIResponsesModel: Model<"openai-responses"> = {
	id: "gpt-5.4",
	name: "gpt-5.4",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 200000,
	maxTokens: 32000,
};

describe("formatOpenAIError", () => {
	it("extracts nested response error details", () => {
		const message = formatOpenAIError({
			response: {
				error: {
					message: "Rate limit exceeded",
					code: "rate_limit_exceeded",
				},
				status: 429,
			},
		});

		assert.equal(message, "Rate limit exceeded | code=rate_limit_exceeded | status=429");
	});

	it("falls back to nested cause when top-level message is generic", () => {
		const message = formatOpenAIError({
			message: "Unknown error",
			cause: { message: "Upstream gateway timeout" },
			code: "gateway_timeout",
		});

		assert.equal(message, "Upstream gateway timeout | code=gateway_timeout");
	});
});

describe("assertStreamSuccess", () => {
	it("surfaces output.errorMessage instead of generic unknown errors", () => {
		const output = buildInitialOutput(openAIResponsesModel);
		output.stopReason = "error";
		output.errorMessage = "OpenAI response failed | code=server_error";

		assert.throws(() => assertStreamSuccess(output), /OpenAI response failed \| code=server_error/);
	});
});

describe("processResponsesStream", () => {
	it("surfaces response.failed event details instead of hardcoded unknown error", async () => {
		async function* failedEvents() {
			yield {
				type: "response.failed",
				sequence_number: 1,
				response: {
					status: "failed",
					error: {
						message: "Rate limit exceeded",
						code: "rate_limit_exceeded",
					},
				},
			} as any;
		}

		const output = buildInitialOutput(openAIResponsesModel);
		const stream = new AssistantMessageEventStream();

		await assert.rejects(
			() => processResponsesStream(failedEvents(), output, stream, openAIResponsesModel),
			/Rate limit exceeded \| code=rate_limit_exceeded/,
		);
	});
});
