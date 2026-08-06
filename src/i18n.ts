import path from 'node:path';
import * as z from 'zod/mini';
import type { I18nConfig } from 'fumadocs-core/i18n';

export interface CompiledI18nConfig {
  languages: string[];
  defaultLanguage: string;
  parser: 'dot' | 'dir' | 'none';
  fallbackLanguage: string | null;
  hideLocale: 'always' | 'default-locale' | 'never';
}

const uniqueLanguages = 'i18n.languages must contain unique non-empty language codes';
const language = z.string(uniqueLanguages).check(z.minLength(1, uniqueLanguages));
const i18nSchema = z.object({
  languages: z.array(language, uniqueLanguages).check(
    z.minLength(1, uniqueLanguages),
    z.refine((values) => new Set(values).size === values.length, uniqueLanguages),
  ),
  defaultLanguage: language,
  parser: z._default(z.enum(['dot', 'dir', 'none'], 'i18n.parser must be "dot", "dir", or "none"'), 'dot'),
  fallbackLanguage: z.nullish(language),
  hideLocale: z._default(z.enum(['always', 'default-locale', 'never'], 'i18n.hideLocale must be "always", "default-locale", or "never"'), 'never'),
}).check(
  z.refine((config) => config.languages.includes(config.defaultLanguage), 'i18n.defaultLanguage must be included in i18n.languages'),
  z.refine((config) => config.fallbackLanguage == null || config.languages.includes(config.fallbackLanguage), 'i18n.fallbackLanguage must be null or included in i18n.languages'),
);

export function normalizeI18n(config: I18nConfig): CompiledI18nConfig {
  const { fallbackLanguage, ...rest } = z.parse(i18nSchema, config);
  return { ...rest, fallbackLanguage: fallbackLanguage === undefined ? rest.defaultLanguage : fallbackLanguage };
}

export function parseI18nPath(filePath: string, i18n?: CompiledI18nConfig) {
  if (!i18n) return { path: filePath, locale: undefined, locales: [''] };
  if (i18n.parser === 'dir') {
    const [locale, ...segments] = filePath.split('/');
    if (segments.length > 0 && (i18n.languages.includes(locale) || locale === '$')) {
      return {
        path: segments.join('/'),
        locale,
        locales: locale === '$' ? i18n.languages : [locale],
      };
    }
  } else {
    const segments = filePath.split('/');
    const base = segments.pop();
    const parts = base?.split('.') ?? [];
    if (parts.length >= 3) {
      const locale = parts.at(-2)!;
      if (i18n.languages.includes(locale) || locale === '$') {
        parts.splice(-2, 1);
        segments.push(parts.join('.'));
        return {
          path: segments.join('/'),
          locale,
          locales: locale === '$' ? i18n.languages : [locale],
        };
      }
    }
  }
  return { path: filePath, locale: i18n.defaultLanguage, locales: [i18n.defaultLanguage] };
}

export function localePathKey(locale: string, value: string) {
  return `${locale}\0${path.posix.normalize(value)}`;
}
