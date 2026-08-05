import content from '../content.generated.json';
import { createFumadocsSource } from 'lume-cms/fumadocs';
import type { CompiledContent } from 'lume-cms';

export const { getSource, contentSource } = createFumadocsSource(content as CompiledContent, {
  baseUrl: '/blog',
});
