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
