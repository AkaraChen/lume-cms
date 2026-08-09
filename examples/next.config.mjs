import { createLume } from 'lume-cms/next';

/** @type {import('next').NextConfig} */
const config = { reactStrictMode: true };

const withLume = createLume();

export default withLume(config);
