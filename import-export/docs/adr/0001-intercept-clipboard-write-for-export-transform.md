# 1. Intercept navigator.clipboard.write to transform the export

Date: 2026-09-01
Status: Accepted

## Context

The export post-processor (`import-export/import-export-V0.js`) used to read the
export text out of a `<textarea>` in WorkFlowy's Export dialog, transform it, and
put the result on the clipboard by hijacking the browser `copy` event (which fired
because WorkFlowy auto-selected the textarea's text).

WorkFlowy rebuilt the Export dialog. As observed live on 2026-09-01
(workflowy.com):

- The export preview is now rendered inside a **sandboxed, cross-origin `blob:`
  `<iframe>`**. `iframe.contentDocument` is `null` from the parent page, so the
  script can no longer read the export text from the DOM.
- There is **no `<textarea>`** and the text is **not auto-selected**, so a plain
  Cmd+C has nothing to copy and fires no useful `copy` event.
- The **Copy** button hands the export string to
  **`navigator.clipboard.write()`** as a `ClipboardItem` of type `text/plain` —
  a path the old `copy`-event / `execCommand` hooks never see.

All three assumptions the old code relied on are gone, which is why v3.2 silently
produced raw, untransformed copies.

## Decision

Stop reading the DOM. Instead, **monkey-patch `navigator.clipboard.write`** in the
page. A one-shot flag (`transformNextCopy`) decides whether to transform:

- The flag is **off** by default, so WorkFlowy's native Copy stays a raw copy.
- The script's **Copy (mod)** button and the dialog's **Cmd/Ctrl+C** arm the flag,
  then click the native Copy button. WorkFlowy generates the export and calls
  `clipboard.write`; the patch pulls out the `text/plain`, runs `processText()`,
  and writes the transformed text instead.

The transformed value is supplied as a **Promise inside a `ClipboardItem`**, built
synchronously within the click, so the browser awaits the transform without losing
the user gesture that authorizes a clipboard write.

Transformed copy is restricted to the **Markdown tab** (the only format
`processText` understands), and the dialog is defaulted to the Markdown tab on open.

WorkFlowy elements are located by **visible button text** ("Copy", "Markdown", …)
rather than CSS class names, which change far more often.

## Alternatives considered

- **Keep reading the DOM / textarea** — impossible: the text lives in a
  cross-origin iframe and no textarea exists.
- **Read the clipboard after native Copy, transform, write back** — needs
  `clipboard-read` permission, is racy, and briefly leaves raw text on the
  clipboard.
- **Reproduce WorkFlowy's Markdown export ourselves from the outline data** — far
  more code and a second thing to keep in sync with WorkFlowy.

## Consequences

- Robust to WorkFlowy CSS/markup changes; only breaks if WorkFlowy stops using
  `navigator.clipboard.write` or renames the "Copy" / "Markdown" buttons' text.
- The final clipboard write can only be verified with the page focused; browser
  automation (unfocused) rejects it with `NotAllowedError: Document is not
  focused`. A real user click is focused, so this is a test-harness limit, not a
  runtime bug.
- If the transform throws, the patch falls back to a raw copy rather than failing.
