import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pin the workspace root to this app so standalone file-tracing is correct
  // even when a parent directory has its own lockfile.
  turbopack: { root: __dirname },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
