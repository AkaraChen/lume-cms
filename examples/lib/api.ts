import { createLumeApi } from 'lume-cms/api';
import { sources } from './source';

export const contentApi = createLumeApi({
  sources,
  basePath: '/api/content',
});
