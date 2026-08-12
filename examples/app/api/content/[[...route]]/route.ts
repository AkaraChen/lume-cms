import { toNextHandler } from 'lume-cms/api';
import { contentApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

const handlers = toNextHandler(contentApi);
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
