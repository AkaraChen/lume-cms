import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from 'lume-cms/api';
import { contentApi } from '../../../../lib/api';

const handlers = toStartHandler(contentApi);

export const Route = createFileRoute('/api/content/$')({
  server: { handlers },
});
