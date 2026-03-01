import type { ProgressEvent, ProgressReporter } from "../services/progress.js";

export type SseConnection = {
  close: () => Promise<void>;
  response: Response;
  send: (event: string, data: unknown) => void;
};

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

const encoder = new TextEncoder();

export const createSseConnection = (): SseConnection => {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  let closed = false;
  let writeQueue: Promise<void> = Promise.resolve();

  const enqueue = (chunk: string): void => {
    if (closed) return;

    writeQueue = writeQueue
      .then(async () => {
        if (closed) return;
        await writer.write(encoder.encode(chunk));
      })
      .catch(() => {
        closed = true;
      });
  };

  enqueue(":\n\n");

  return {
    close: async () => {
      if (closed) return;
      closed = true;
      await writeQueue.catch(() => undefined);
      await writer.close().catch(() => undefined);
    },
    response: new Response(stream.readable, { headers: SSE_HEADERS }),
    send: (event: string, data: unknown) => {
      enqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
};

export const sendSseEvent = (connection: SseConnection, event: string, data: unknown): void => {
  connection.send(event, data);
};

export const sseReporter = (connection: SseConnection): ProgressReporter => {
  return (event: ProgressEvent) => {
    sendSseEvent(connection, "progress", event);
  };
};
