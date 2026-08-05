import { run } from '@mdx-js/mdx';
import { createElement, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import type { CompiledBody } from './types.js';

export type CompiledBodyComponent = ComponentType<{
  components?: Record<string, any>;
}>;

/** Evaluate trusted, build-produced MDX on the server and return its React component. */
export async function evaluateCompiledBody(body: CompiledBody): Promise<CompiledBodyComponent> {
  if (!body.code) throw new TypeError('The compiled body does not include an MDX function body');
  const module = await run(body.code, { ...runtime, baseUrl: import.meta.url });
  return module.default as CompiledBodyComponent;
}

export function createCompiledBodyComponent(body: CompiledBody): CompiledBodyComponent {
  let component: Promise<CompiledBodyComponent> | undefined;
  return async function CompiledContent(props) {
    const Content = await (component ??= evaluateCompiledBody(body));
    return createElement(Content, props);
  };
}
