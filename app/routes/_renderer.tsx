import { jsxRenderer } from "hono/jsx-renderer";

const PAGE_STYLE = `
:root {
  --bg: #f7f4ec;
  --panel: #fffdf7;
  --ink: #222;
  --accent: #0f766e;
  --line: #d9d5ca;
}
body {
  margin: 0;
  font-family: "IBM Plex Sans", "Noto Sans JP", sans-serif;
  background: radial-gradient(circle at 20% 10%, #fff4cc, transparent 30%), var(--bg);
  color: var(--ink);
}
main {
  max-width: 1100px;
  margin: 24px auto;
  padding: 0 16px;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
}
h1 {
  font-size: 18px;
  margin: 0 0 12px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li button {
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
  padding: 10px;
  cursor: pointer;
}
textarea {
  width: 100%;
  min-height: 500px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
button.primary {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
button.secondary {
  background: white;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.heal-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.heal-toggle input[type="checkbox"] {
  accent-color: var(--accent);
}
.vars-form {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #faf8f2;
}
.vars-form h3 {
  font-size: 14px;
  margin: 0 0 8px;
}
.var-field {
  margin-bottom: 6px;
}
.var-field label {
  display: block;
  font-size: 13px;
}
.var-label-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}
.var-name {
  font-weight: 600;
}
.var-desc {
  color: #888;
  font-size: 12px;
}
.var-field input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.plan-result {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: #f0faf9;
}
.plan-result h3 {
  font-size: 15px;
  margin: 0 0 8px;
  color: var(--accent);
}
.plan-result h4 {
  font-size: 13px;
  margin: 10px 0 4px;
}
.plan-meta {
  font-size: 12px;
  color: #666;
  display: flex;
  gap: 16px;
  margin-bottom: 6px;
}
.plan-vars table {
  width: 100%;
  font-size: 12px;
  border-collapse: collapse;
}
.plan-vars td {
  padding: 2px 8px 2px 0;
  border-bottom: 1px solid var(--line);
}
.plan-vars .var-key {
  font-weight: 600;
  white-space: nowrap;
}
.plan-warnings ul {
  padding-left: 18px;
  margin: 4px 0;
  font-size: 12px;
  color: #b45309;
}
.plan-steps ol {
  padding-left: 22px;
  margin: 4px 0;
}
.plan-step {
  margin-bottom: 4px;
  font-size: 13px;
  line-height: 1.5;
}
.step-badge {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.step-badge[data-mode="pw"] {
  background: #dbeafe;
  color: #1e40af;
}
.step-badge[data-mode="http"] {
  background: #fef3c7;
  color: #92400e;
}
.step-badge[data-action] {
  background: #e5e7eb;
  color: #374151;
}
.step-title {
  font-weight: 500;
}
.step-url {
  display: block;
  font-size: 11px;
  color: #888;
  word-break: break-all;
  margin-left: 4px;
}
.run-log {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #faf8f2;
}
.run-log-ok {
  border-color: var(--accent);
  background: #f0faf9;
}
.run-log-fail {
  border-color: #dc2626;
  background: #fef2f2;
}
.run-log h3 {
  font-size: 14px;
  margin: 0 0 8px;
}
.run-result-summary {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.run-log-entries {
  max-height: 200px;
  overflow-y: auto;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.run-log-entry {
  padding: 2px 0;
  color: #555;
}
.run-log-entry[data-type="warn"] {
  color: #b45309;
}
.run-log-entry[data-type="step_failed"] {
  color: #dc2626;
}
@media (max-width: 900px) {
  main {
    grid-template-columns: 1fr;
  }
}
`;

export default jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>browrec recipes</title>
        <style>{PAGE_STYLE}</style>
        {import.meta.env.PROD ? (
          <script type="module" src="/static/client.js" />
        ) : (
          <script type="module" src="/app/client.ts" />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
});
