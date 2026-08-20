import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LlmIncompleteResponseError } from "../errors";
import {
  buildChatCompletionRequest,
  PRESETS,
  runOpenAICompat,
} from "./openai-compat";

const RUN_OPTIONS = {
  systemPrompt: "system",
  userPrompt: "user",
};

test("builds DeepSeek requests in JSON non-thinking mode", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "deepseek-v4-flash",
    PRESETS.deepseek,
  );

  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.deepEqual(request.thinking, { type: "disabled" });
  assert.equal(request.max_tokens, 8192);
});

test("does not send DeepSeek-only options to OpenAI", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "gpt-4o-mini",
    PRESETS.openai,
  );

  assert.equal(Object.hasOwn(request, "response_format"), false);
  assert.equal(Object.hasOwn(request, "thinking"), false);
});

test("does not send DeepSeek-only options to MiniMax", () => {
  const request = buildChatCompletionRequest(
    RUN_OPTIONS,
    "MiniMax-M2.7",
    PRESETS.minimax,
  );

  assert.equal(Object.hasOwn(request, "response_format"), false);
  assert.equal(Object.hasOwn(request, "thinking"), false);
});

test("rejects incomplete DeepSeek responses through the HTTP client", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const responses = [
    {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"ok":true}' },
          finish_reason: "stop",
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"ok":' },
          finish_reason: "length",
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "   " },
          finish_reason: "stop",
        },
      ],
    },
    { choices: [] },
  ];
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestBodies.push(JSON.parse(body) as Record<string, unknown>);
      const response = responses[requestCount];
      requestCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `test-${requestCount}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "deepseek-v4-flash",
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          ...response,
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");

  const previousApiKey = process.env.DEEPSEEK_API_KEY;
  const previousBaseUrl = process.env.DEEPSEEK_BASE_URL;
  const previousCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-brief-test-"));
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  process.env.DEEPSEEK_API_KEY = "test-key-openai-compat";
  process.env.DEEPSEEK_BASE_URL = baseUrl;
  process.chdir(tempDir);

  const config = {
    ...PRESETS.deepseek,
    defaultBaseUrl: baseUrl,
  };

  try {
    const result = await runOpenAICompat(RUN_OPTIONS, config);
    assert.equal(result.text, '{"ok":true}');

    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(
        runOpenAICompat(RUN_OPTIONS, config),
        LlmIncompleteResponseError,
      );
    }

    assert.equal(requestBodies.length, 4);
    for (const body of requestBodies) {
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.deepEqual(body.thinking, { type: "disabled" });
      assert.equal(body.max_tokens, 8192);
    }
  } finally {
    process.chdir(previousCwd);
    if (previousApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBaseUrl;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
