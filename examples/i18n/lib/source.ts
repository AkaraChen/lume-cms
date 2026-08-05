import { createFumadocsSource, type CompiledContent } from 'lume-cms';
import { i18n } from './i18n';

export function createDocsSource(content: CompiledContent) {
  return createFumadocsSource(content, { i18n });
}
