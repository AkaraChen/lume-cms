import path from 'node:path';
import type { I18nConfig } from 'fumadocs-core/i18n';

export interface CompiledI18nConfig {
  languages: string[];
  defaultLanguage: string;
  parser: 'dot' | 'dir' | 'none';
  fallbackLanguage: string | null;
  hideLocale: 'always' | 'default-locale' | 'never';
}

/** `parser`/`hideLocale` are literal unions on `I18nConfig`; only cross-field facts need checking. */
export function normalizeI18n(config: I18nConfig): CompiledI18nConfig {
  const { defaultLanguage, parser = 'dot', hideLocale = 'never' } = config;
  const languages = [...config.languages];
  const fallbackLanguage = config.fallbackLanguage === undefined ? defaultLanguage : config.fallbackLanguage;
  if (languages.length === 0 || languages.some((language) => !language) || new Set(languages).size !== languages.length) {
    throw new TypeError('i18n.languages must contain unique non-empty language codes');
  }
  if (!languages.includes(defaultLanguage)) {
    throw new TypeError('i18n.defaultLanguage must be included in i18n.languages');
  }
  if (fallbackLanguage !== null && !languages.includes(fallbackLanguage)) {
    throw new TypeError('i18n.fallbackLanguage must be null or included in i18n.languages');
  }
  return { languages, defaultLanguage, parser, fallbackLanguage, hideLocale };
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
