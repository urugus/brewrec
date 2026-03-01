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
  const pendingChunks: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let accepting = true;
  let finalized = false;
  let closePromise: Promise<void> | null = null;

  const finalize = (): void => {
    if (finalized) return;
    accepting = false;
    finalized = true;
    try {
      controller?.close();
    } catch {
      // already closed
    }
    controller = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of pendingChunks) {
        if (finalized) break;
        c.enqueue(chunk);
      }
      pendingChunks.length = 0;
    },
    cancel() {
      finalize();
    },
  });

  const enqueue = (chunk: string): void => {
    if (!accepting) return;
    const encoded = encoder.encode(chunk);

    if (!controller) {
      pendingChunks.push(encoded);
      return;
    }

    try {
      controller.enqueue(encoded);
    } catch {
      finalize();
    }
  };

  enqueue(":\n\n");

  return {
    close: async () => {
      if (closePromise) return closePromise;
      accepting = false;
      closePromise = (async () => {
        finalize();
      })();
      await closePromise;
    },
    response: new Response(stream, { headers: SSE_HEADERS }),
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
