import { describe, expect, it } from "vitest";
import { extractHintsFromSelector } from "../src/core/selector-healer.js";

describe("extractHintsFromSelector", () => {
  it("extracts placeholder from attribute selector", () => {
    const hints = extractHintsFromSelector('input[placeholder="Email address or staff code"]');
    expect(hints.placeholder).toBe("Email address or staff code");
  });

  it("extracts id from CSS selector", () => {
    const hints = extractHintsFromSelector("div.panel > input#user_email.form__input");
    expect(hints.id).toBe("user_email");
  });

  it("extracts name from attribute selector", () => {
    const hints = extractHintsFromSelector('[name="username"]');
    expect(hints.name).toBe("username");
  });

  it("extracts role from attribute selector", () => {
    const hints = extractHintsFromSelector('[role="button"]');
    expect(hints.role).toBe("button");
  });

  it("extracts text from has-text selector", () => {
    const hints = extractHintsFromSelector('label:has-text("Username")');
    expect(hints.text).toBe("Username");
  });

  it("extracts multiple hints from complex selector", () => {
    const hints = extractHintsFromSelector(
      'input#login_email[placeholder="Email"][name="user_email"]',
    );
    expect(hints.id).toBe("login_email");
    expect(hints.placeholder).toBe("Email");
    expect(hints.name).toBe("user_email");
  });

  it("returns empty hints for simple CSS selector", () => {
    const hints = extractHintsFromSelector("div > span > a");
    expect(hints.placeholder).toBeUndefined();
    expect(hints.name).toBeUndefined();
    expect(hints.id).toBeUndefined();
    expect(hints.role).toBeUndefined();
    expect(hints.text).toBeUndefined();
  });
});
