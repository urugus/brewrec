export type ProgressEvent =
  | { type: "step_start"; stepId: string; title: string }
  | { type: "step_ok"; stepId: string }
  | { type: "step_failed"; stepId: string; error: string }
  | { type: "info"; message: string }
  | { type: "warn"; message: string };

export type ProgressReporter = (event: ProgressEvent) => void;

export const nullReporter: ProgressReporter = () => {};

export const stderrReporter: ProgressReporter = (event) => {
  switch (event.type) {
    case "step_start":
      process.stderr.write(`  [${event.stepId}] ${event.title}...`);
      break;
    case "step_ok":
      process.stderr.write(" OK\n");
      break;
    case "step_failed":
      process.stderr.write(` FAILED\n    -> ${event.error}\n`);
      break;
    case "info":
      process.stderr.write(`${event.message}\n`);
      break;
    case "warn":
      process.stderr.write(`${event.message}\n`);
      break;
  }
};
