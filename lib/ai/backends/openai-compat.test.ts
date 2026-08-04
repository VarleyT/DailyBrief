import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatCompletionRequest,
  PRESETS,
} from "./openai-compat";

const RUN_OPTIONS = {
  systemPrompt: "system",
  userPrompt: "user",
};

test("disables thinking for DeepSeek requests", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "deepseek-v4-flash",
    PRESETS.deepseek,
  );

  assert.deepEqual(request.thinking, { type: "disabled" });
});

test("does not send thinking to OpenAI", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "gpt-4o-mini",
    PRESETS.openai,
  );

  assert.equal(Object.hasOwn(request, "thinking"), false);
});

test("does not send thinking to MiniMax", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "MiniMax-M2.7",
    PRESETS.minimax,
  );

  assert.equal(Object.hasOwn(request, "thinking"), false);
});
