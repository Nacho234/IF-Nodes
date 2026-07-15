import type { KnowledgeSearchResult } from '../contract';

export interface KnowledgeChunkLike {
  id: string;
  title: string | null;
  content: string;
}

/** Tokeniza una consulta en términos útiles (minúsculas, ≥3 chars, sin repetir). */
function terms(query: string): string[] {
  const found = query
    .toLowerCase()
    .split(/[^a-záéíóúñü0-9]+/i)
    .filter((t) => t.length >= 3);
  return Array.from(new Set(found));
}

function countOccurrences(haystack: string, term: string): number {
  let count = 0;
  let index = haystack.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(term, index + term.length);
  }
  return count;
}

/**
 * Ranking por palabras clave (RAG v1): puntúa cada fragmento por cuántas veces
 * aparecen los términos de la consulta (el título pesa más). Devuelve los
 * mejores `limit` y un `context` concatenado listo para el prompt. Determinista
 * y sin dependencias (sirve en worker y runtime). Upgrade futuro: embeddings.
 */
export function rankKnowledge(
  chunks: KnowledgeChunkLike[],
  query: string,
  limit = 3,
): KnowledgeSearchResult {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return { hits: [], context: '' };

  const scored = chunks
    .map((chunk) => {
      const title = (chunk.title ?? '').toLowerCase();
      const content = chunk.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        score += countOccurrences(content, term);
        score += countOccurrences(title, term) * 3; // el título pesa más
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const hits = scored.map((s) => ({
    id: s.chunk.id,
    title: s.chunk.title,
    content: s.chunk.content,
    score: s.score,
  }));
  const context = hits.map((h) => (h.title ? `## ${h.title}\n${h.content}` : h.content)).join('\n\n');
  return { hits, context };
}
