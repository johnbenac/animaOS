import { describe, expect, test } from "bun:test";
import { createWrappedDek, unwrapDek } from "../auth-crypto";

describe("auth-crypto", () => {
  test("createWrappedDek + unwrapDek roundtrip with correct passphrase", () => {
    const passphrase = "correct horse battery staple";
    const { dek, record } = createWrappedDek(passphrase);

    const unwrapped = unwrapDek(passphrase, record);
    expect(unwrapped.equals(dek)).toBe(true);
    expect(unwrapped.length).toBe(32);
  });

  test("unwrapDek fails with wrong passphrase", () => {
    const { record } = createWrappedDek("right-pass");
    expect(() => unwrapDek("wrong-pass", record)).toThrow();
  });
});
