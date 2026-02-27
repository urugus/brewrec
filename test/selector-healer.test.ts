import { describe, expect, it } from "vitest";
import {
  extractHintsFromSelector,
  parseSelectorsFromLlmResponse,
} from "../src/core/selector-healer.js";

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

  it("extracts id with colon from CSS selector", () => {
    const hints = extractHintsFromSelector("#app:main-content");
    expect(hints.id).toBe("app:main-content");
  });
});

describe("parseSelectorsFromLlmResponse", () => {
  it("extracts backtick-wrapped selectors", () => {
    const response = '1. `#login_button`\n2. `input[type="submit"]`\n3. `.form__login`';
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["#login_button", 'input[type="submit"]', ".form__login"]);
  });

  it("extracts bare CSS selectors without backticks", () => {
    const response = "#login_button\n.form__login\ninput.submit";
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["#login_button", ".form__login", "input.submit"]);
  });

  it("accepts uppercase tag names", () => {
    const response = "`DIV.container`\nSPAN.label";
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["DIV.container", "SPAN.label"]);
  });

  it("ignores explanatory text and empty lines", () => {
    const response = "Here are the selectors:\n\n`#submit`\n\nThis should work.";
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["#submit"]);
  });

  it("ignores lines with spaces (natural language)", () => {
    const response = "The button is located here\n`button.login`\ntry this one";
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["button.login"]);
  });

  it("returns empty array for empty response", () => {
    const selectors = parseSelectorsFromLlmResponse("");
    expect(selectors).toEqual([]);
  });

  it("strips numbered list prefixes", () => {
    const response = "1. `#btn`\n2. `.submit`\n- `form > input`";
    const selectors = parseSelectorsFromLlmResponse(response);
    expect(selectors).toEqual(["#btn", ".submit", "form > input"]);
  });
});
