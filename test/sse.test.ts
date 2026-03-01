import { describe, expect, it } from "vitest";
import { createSseConnection, sendSseEvent, sseReporter } from "../src/ui/sse.js";

describe("sse connection", () => {
  it("includes keepalive and event payload", async () => {
    const connection = createSseConnection();
    sendSseEvent(connection, "done", { ok: true });

    await connection.close();
    const text = await connection.response.text();

    expect(connection.response.headers.get("content-type")).toContain("text/event-stream");
    expect(text.startsWith(":\n\n")).toBe(true);
    expect(text).toContain('event: done\ndata: {"ok":true}\n\n');
  });

  it("flushes queued events before close resolves", async () => {
    const connection = createSseConnection();
    sendSseEvent(connection, "error", { code: "boom" });

    await connection.close();
    const text = await connection.response.text();

    expect(text).toContain('event: error\ndata: {"code":"boom"}\n\n');
  });

  it("supports idempotent close", async () => {
    const connection = createSseConnection();
    sendSseEvent(connection, "done", { ok: true });

    await Promise.all([connection.close(), connection.close()]);
    const text = await connection.response.text();

    expect(text).toContain('event: done\ndata: {"ok":true}\n\n');
  });

  it("formats progress reporter events", async () => {
    const connection = createSseConnection();
    const report = sseReporter(connection);
    report({ type: "info", message: "step started" });

    await connection.close();
    const text = await connection.response.text();

    expect(text).toContain('event: progress\ndata: {"type":"info","message":"step started"}\n\n');
  });
});
