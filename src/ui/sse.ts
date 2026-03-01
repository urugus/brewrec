import type { Response } from "express";
import type { ProgressEvent, ProgressReporter } from "../services/progress.js";

export const initSse = (res: Response): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  try {
    if (!res.writableEnded && !res.destroyed) {
      res.write(":\n\n");
    }
  } catch {
    // client already disconnected
  }
};

export const sendSseEvent = (res: Response, event: string, data: unknown): void => {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // client already disconnected
  }
};

export const endSse = (res: Response): void => {
  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
};

export const sseReporter = (res: Response): ProgressReporter => {
  return (event: ProgressEvent) => {
    sendSseEvent(res, "progress", event);
  };
};
