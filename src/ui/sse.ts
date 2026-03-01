import type { Response } from "express";
import type { ProgressEvent, ProgressReporter } from "../services/progress.js";

export const initSse = (res: Response): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
};

export const sendSseEvent = (res: Response, event: string, data: unknown): void => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const endSse = (res: Response): void => {
  res.end();
};

export const sseReporter = (res: Response): ProgressReporter => {
  return (event: ProgressEvent) => {
    sendSseEvent(res, "progress", event);
  };
};
