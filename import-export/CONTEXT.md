# Context / glossary

Plain-language definitions for the terms this repo's userscripts use. Glossary only — no implementation details.

## Export post-processor

The `import-export/import-export-V0.js` userscript. Despite the folder name, it only does **export**: it rewrites the Markdown that WorkFlowy copies out of its Export dialog. It never imports text into WorkFlowy. "Import" in the folder name is aspirational, not implemented.

## Export dialog

WorkFlowy's own pop-up, opened with **Cmd/Ctrl+Shift+E**. It has four **format tabs** — Formatted, Markdown, Plain Text, OPML — a preview area, and **Download** / **Copy** buttons.

## Markdown tab

The one format tab whose output the post-processor understands. The transform rules (headings, hashtags, block quotes, code blocks) assume Markdown input, so the transformed copy only runs on this tab.

## Native Copy

WorkFlowy's own blue **Copy** button. Always copies the **raw** export, unchanged. The post-processor never alters it.

## Copy (mod)

The script's own green button next to native Copy, and the Cmd/Ctrl+C shortcut inside the dialog. Copies the **transformed** Markdown (raw export run through the post-processor). Active only on the Markdown tab; greyed out on every other tab.

## Toggle panel

The script's "Export options" panel (bottom-right of the dialog). Its switches decide which transforms run. State is saved in the browser's localStorage.
