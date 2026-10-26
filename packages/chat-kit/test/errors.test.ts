import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorText, isTurnFailure, readOr, TurnFailure } from "../src/errors.ts";
import { failedFrom } from "../src/outcome.ts";
import { errorWithThrowingMessage, throwingPrototype } from "./helpers.ts";

describe("what the kit reads of a thrown value", () => {
  it("readOr returns what the read returns, or the fallback when it throws", () => {
    assert.equal(readOr(() => 1, 2), 1);
    assert.equal(readOr(() => undefined, 2), undefined, "a read that returns undefined is not a failure");
    assert.equal(readOr((): number => { throw new Error("x"); }, 2), 2);
  });

  it("errorText is an error's message, and the string form of anything else", () => {
    assert.equal(errorText(new Error("boom")), "boom");
    assert.equal(errorText("plain"), "plain");
    assert.equal(errorText(42), "42");
    assert.equal(errorText(undefined), "undefined");
  });

  it("errorText never throws: a null-prototype object, an error whose message getter throws, a proxy whose prototype trap throws", () => {
    assert.equal(errorText(Object.create(null)), "unknown error");
    assert.equal(errorText(errorWithThrowingMessage()), "unknown error");
    assert.equal(errorText(throwingPrototype()), "unknown error");
  });

  it("failedFrom ends a turn with what it caught, even a value with no text: the turn still gets its final message", () => {
    const target = { provider: "p", model: "m", api: "unknown" } as Parameters<typeof failedFrom>[0];
    const signal = new AbortController().signal;
    for (const thrown of [errorWithThrowingMessage(), Object.create(null), throwingPrototype()]) {
      const event = failedFrom(target, thrown, signal);
      assert.ok(event.type === "error");
      assert.equal(event.error.chatKit.error?.code, "PROVIDER_ERROR");
      assert.match(event.error.errorMessage ?? "", /unknown error/);
    }
    const own = failedFrom(target, new TurnFailure("UNSUPPORTED", "x"), signal);
    assert.ok(own.type === "error");
    assert.equal(own.error.chatKit.error?.code, "UNSUPPORTED");
  });

  it("isTurnFailure tells the kit's own failures apart, and never throws", () => {
    assert.equal(isTurnFailure(new TurnFailure("UNSUPPORTED", "x")), true);
    assert.equal(isTurnFailure(new Error("x")), false);
    assert.equal(isTurnFailure(undefined), false);
    assert.equal(isTurnFailure(throwingPrototype()), false);
  });
});
