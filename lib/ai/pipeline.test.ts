import assert from "node:assert/strict";
import test from "node:test";
import { LlmIncompleteResponseError } from "./errors";
import {
  buildFallbackDailyReport,
  generateDailyReport,
  type ArticleInput,
} from "./pipeline";

function article(
  category: ArticleInput["category"],
  index: number,
  summary?: string,
  excerpt = `${category} excerpt ${index}`,
): ArticleInput {
  return {
    sourceId: `${category}-source-${index % 2}`,
    source: `Source ${index % 2}`,
    title: `${category} title ${index}`,
    url: `https://example.com/${category}/${index}`,
    excerpt,
    summary,
    category,
    publishedAt: new Date(Date.now() - index * 1_000),
  };
}

test("buildFallbackDailyReport preserves summaries and category caps", () => {
  const articles = [
    ...Array.from({ length: 7 }, (_, index) =>
      article("tech", index, index === 0 ? "enriched tech summary" : undefined),
    ),
    ...Array.from({ length: 6 }, (_, index) => article("finance", index)),
    ...Array.from({ length: 4 }, (_, index) => article("politics", index)),
  ];

  const report = buildFallbackDailyReport(articles);

  assert.equal(report.tech_briefs.length, 5);
  assert.equal(report.finance_briefs.length, 5);
  assert.equal(report.politics_briefs.length, 3);
  assert.equal(report.tech_briefs[0]?.summary, "enriched tech summary");
  assert.equal(report.finance_briefs[0]?.summary, "finance excerpt 0");
  assert.equal(report.politics_briefs[0]?.url, "https://example.com/politics/0");
  assert.equal(articles[0]?.summary, "enriched tech summary");
});

test("buildFallbackDailyReport falls back from excerpt to title", () => {
  const report = buildFallbackDailyReport([
    article("tech", 0, undefined, "   "),
  ]);

  assert.equal(report.tech_briefs[0]?.summary, "tech title 0");
});

test("generateDailyReport falls back after two invalid outputs", async () => {
  const articles = [article("tech", 0, "summary")];
  let attempts = 0;

  const { report } = await generateDailyReport(articles, async () => {
    attempts += 1;
    if (attempts === 1) throw new SyntaxError("Unexpected end of JSON input");
    throw new LlmIncompleteResponseError("finish_reason=length");
  });

  assert.equal(attempts, 2);
  assert.equal(report.tech_briefs.length, 1);
  assert.equal(report.tech_briefs[0]?.summary, "summary");
});

test("generateDailyReport does not hide provider failures", async () => {
  const articles = [article("tech", 0)];
  let attempts = 0;

  await assert.rejects(
    generateDailyReport(articles, async () => {
      attempts += 1;
      throw new Error("401 invalid API key");
    }),
    /401 invalid API key/,
  );
  assert.equal(attempts, 2);
});
