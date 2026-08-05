import { defineI18n } from 'lume-cms/config';

export const i18n = defineI18n({
  languages: ['en', 'zh'],
  defaultLanguage: 'en',
  parser: 'dot',
});
