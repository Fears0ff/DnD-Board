import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Markdown → санитизированный HTML для предпросмотра заметок.
 * marked разбирает текст, dompurify вычищает любой опасный HTML
 * (скрипты, обработчики событий, iframe и т.п.) перед dangerouslySetInnerHTML.
 */
export function useMarkdownPreview(markdown: string): string {
  return useMemo(() => {
    const raw = marked.parse(markdown, { async: false }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [markdown]);
}
