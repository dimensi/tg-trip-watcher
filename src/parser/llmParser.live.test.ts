import test from "node:test";
import assert from "node:assert/strict";

const SHOULD_RUN = process.env.RUN_LLM_PARSER_TESTS === "1";
const REQUIRED_ENV = ["OPENROUTER_API_KEY"] as const;
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);

const skipReason = !SHOULD_RUN
  ? "Set RUN_LLM_PARSER_TESTS=1 to run live LLM parser tests"
  : missingEnv.length > 0
    ? `Missing required env vars: ${missingEnv.join(", ")}`
    : undefined;

const tourSamples = [
  `Паттайя, 8 ночей
Вылет из: #Владивосток #Дальний_Восток
Даты: 15.03.26 - 23.03.26
Цена: 65700P
Бронировать: https://пртс.рф/c0g6`,
  `Хургада, 6 ночей
Вылет из: #Поволжье #Самара
Даты: 12.03.26 - 18.03.26
Цена: 36200P
Бронировать: https://пртс.рф/jB31`,
  `Аланья, 6 ночей
Вылет из: #СПб
Даты: 01.06.26 - 07.07.26
Цена: 49900P
Бронировать: https://пртс.рф/5P2M`,
];

const assertParsedShape = (parsed: ParsedTour): void => {
  assert.equal(typeof parsed.destination, "string");
  assert.ok(parsed.destination.length > 0);
  if (parsed.nights === undefined) {
    throw new Error("Expected nights to be present in live LLM result");
  }
  assert.equal(Number.isInteger(parsed.nights), true);
  assert.ok(parsed.nights > 0);
  assert.equal(Array.isArray(parsed.departureCities), true);
  assert.ok(parsed.departureCities.length > 0);
  assert.match(parsed.dateStart, /^\d{4}-\d{2}-\d{2}$/);
  if (parsed.dateEnd === undefined) {
    throw new Error("Expected dateEnd to be present in live LLM result");
  }
  assert.match(parsed.dateEnd, /^\d{4}-\d{2}-\d{2}$/);
  if (parsed.price === undefined) {
    throw new Error("Expected price to be present in live LLM result");
  }
  assert.equal(typeof parsed.price, "number");
  assert.ok(parsed.price > 0);
  if (parsed.bookingUrl === undefined) {
    throw new Error("Expected bookingUrl to be present in live LLM result");
  }
  assert.ok(parsed.bookingUrl.length > 0);
  assert.ok(parsed.confidence >= 0 && parsed.confidence <= 1);
};

test(
  "llmParseTour live: parses real tour samples",
  { skip: skipReason },
  async () => {
    const { initJsonConfig } = await import("../config");
    initJsonConfig();
    const { llmParseTour } = await import("./llmParser");

    for (const sample of tourSamples) {
      const parsed = await llmParseTour(sample);
      assertParsedShape(parsed);
    }
  },
);
import { ParsedTour } from '../types/tour';
