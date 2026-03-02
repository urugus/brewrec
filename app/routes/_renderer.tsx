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
  transition: border-color 0.15s;
}
li button:hover {
  border-color: var(--accent);
}
li button.recipe-item-active {
  border-color: var(--accent);
  background: #f0faf9;
}
.recipe-item-name {
  display: block;
  font-weight: 600;
  font-size: 13px;
}
.recipe-item-meta {
  display: block;
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}
.empty-state {
  padding: 12px;
  text-align: center;
}
.empty-state-desc {
  font-size: 13px;
  color: #888;
  margin: 0;
  line-height: 1.5;
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
  align-items: center;
}
.row-divider {
  width: 1px;
  height: 20px;
  background: var(--line);
  flex-shrink: 0;
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
button.primary:disabled,
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
.editor-panel {
  display: flex;
  flex-direction: column;
}
.editor-title {
  font-size: 16px;
  margin: 0 0 8px;
  color: var(--ink);
}
.editor-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  border: 2px dashed var(--line);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  color: #888;
}
.editor-empty-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--ink);
}
.editor-empty-desc {
  font-size: 13px;
  margin: 0 0 20px;
}
.workflow-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.workflow-step {
  background: var(--accent);
  color: white;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 600;
}
.workflow-arrow {
  color: #aaa;
  font-size: 16px;
}
.status-text {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}
.status-success {
  color: var(--accent);
  background: #f0faf9;
}
.status-error {
  color: #dc2626;
  background: #fef2f2;
}
.status-info {
  color: var(--ink);
}
.status-loading {
  color: #b45309;
}
.status-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to { transform: rotate(360deg); }
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
.var-required {
  color: #dc2626;
  font-weight: 700;
}
.var-optional {
  color: #aaa;
  font-size: 11px;
  font-weight: 400;
  margin-left: 4px;
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
.record-panel {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.record-panel h3 {
  font-size: 15px;
  margin: 0 0 10px;
}
.record-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.record-form input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.record-form button {
  margin-top: 4px;
}
.record-status {
  margin-top: 8px;
}
.record-status-indicator {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
  display: flex;
  align-items: center;
}
.record-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dc2626;
  margin-right: 6px;
  flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.record-status-help {
  font-size: 12px;
  color: #888;
  margin: 4px 0 0;
}
.record-error {
  margin-top: 6px;
  font-size: 12px;
  color: #dc2626;
}
.record-log {
  margin-top: 8px;
  max-height: 120px;
  overflow-y: auto;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.record-log-entry {
  padding: 1px 0;
  color: #555;
}
.record-log-entry[data-type="warn"] {
  color: #b45309;
}
.record-done {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: #f0faf9;
}
.record-done-summary {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 8px;
}
.record-compile-done {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: #f0faf9;
}
.debug-log {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #faf8f2;
}
.debug-log-ok {
  border-color: var(--accent);
  background: #f0faf9;
}
.debug-log-fail {
  border-color: #dc2626;
  background: #fef2f2;
}
.debug-log h3 {
  font-size: 14px;
  margin: 0 0 8px;
}
.debug-result-summary {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.debug-video-link {
  margin-bottom: 8px;
}
.debug-video-link a {
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
}
.debug-log-entries {
  max-height: 200px;
  overflow-y: auto;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.debug-log-entry {
  padding: 2px 0;
  color: #555;
}
.debug-log-entry[data-type="warn"] {
  color: #b45309;
}
.debug-log-entry[data-type="step_failed"] {
  color: #dc2626;
}
.debug-log-entry[data-type="step_ok"] {
  color: var(--accent);
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
