import { createFumadocsSource, type CompiledContent } from 'lume-cms';
import config from '../lume.config';

export function createDocsSource(content: CompiledContent) {
  return createFumadocsSource(content, config);
}
