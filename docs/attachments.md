# Attachments

Files attached to a chat message or to an execution run go through the same
pipeline: they are validated and converted on upload
(`backend/modules/attachments/use-cases/create-attachment.ts`) and turned into
model content when sent (`backend/core/attachments/build-attachment-content.ts`).

## Supported formats

| Format | Extensions | Reaches the model as |
| --- | --- | --- |
| Plain text | `.txt` | Text |
| Markdown | `.md`, `.markdown` | Text |
| CSV | `.csv` | Text |
| JSON | `.json` | Text |
| PDF with a text layer | `.pdf` | Extracted text |
| Word | `.docx` | Extracted text; table cells separated by `\|` |
| Excel | `.xlsx`, `.xls` | One CSV block per sheet |
| PowerPoint | `.pptx` | Extracted text, one block per slide |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | Image, only on models with vision |

The legacy binary formats `.doc` and `.ppt` are not supported.

## Rules

- The extension decides the format. The type reported by the browser is only
  used when the extension is unknown, because it varies by operating system.
- Files are limited to 50 MB, and images to 5 MB because providers reject
  larger ones. The UI and the backend both check it.
- A file that cannot be read, or a Word or PowerPoint file with no text, is
  rejected on upload.
- An image sent to a model without vision rejects the message.
- The text of all the attachments in one message is limited to 100,000
  characters on cloud models and to about half of the context window on local
  models, because Ollama silently drops whatever exceeds it. Past the limit,
  the text is cut, the model sees a marker where it stops, and the user gets a
  warning. Files that no longer fit are left out.

## Searching files in a chat

Chat files are split into chunks and embedded locally with
`nomic-embed-text`, so this works offline and with cloud models. Each turn
searches every file in the chat and adds the most relevant excerpts to the
message: up to 12,000 characters on cloud models and about a quarter of the
context window on local ones. That is how a long file's later parts, and
files from earlier turns, reach the model.

- Indexing runs in the background, one file at a time, and never delays a
  message. While a file is being indexed, the user gets a warning and only the
  part that is ready can be found.
- It resumes after a restart. Files older than this feature are indexed the
  next time their chat is used.
- Files are indexed up to 500 chunks (roughly 350 pages).
- Images are not indexed. Execution runs read their files whole and do not
  search them.
- Excerpts suit specific questions. A request about a whole long document only
  sees what was included in the turn it was attached.

Adding a format takes an entry in `MIME_TYPE_BY_EXTENSION`
(`backend/core/attachments/attachment-limits.ts`), an extractor in
`textExtractorFor` if it is not plain text, and an entry in
`SUPPORTED_EXTENSIONS` (`frontend/src/features/chats/api/attachments.ts`).
