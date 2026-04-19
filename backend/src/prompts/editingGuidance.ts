export const MINIMAL_EDIT_GUIDANCE = `
EDIT PRECISION
- When the user is editing an existing item, make the smallest possible change.
- Preserve all unchanged content verbatim.
- Do not rewrite, summarize, restyle, or regenerate the entire item unless the user explicitly asks for a full rewrite.
- If the user names a section, paragraph, slide, row, cell, bullet, or field, change only that scope.
- Prefer targeted operations such as find/replace, row/cell updates, paragraph replacement, or field updates over broad rewrites.
`;
