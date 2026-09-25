/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.SMART_NOTES_NEXT_DIST_DIR || ".next",
  // EmbedPDF's usePdfiumEngine closes the native document on StrictMode's
  // simulated unmount while React state still reports status=loaded, which
  // leaves blank page frames (engine render → "document does not open").
  // Production builds are unaffected (StrictMode is dev-only); keep this off
  // until EmbedPDF exposes a StrictMode-safe engine lifecycle (SN-148).
  reactStrictMode: false,
  outputFileTracing: false,
  experimental: {
    instrumentationHook: true,
    // Build worker doesn't inherit the webpack hash override, which triggers
    // an intermittent `Hash.update(undefined)` crash on Node 22 + Windows.
    webpackBuildWorker: false,
    serverComponentsExternalPackages: ["pdf-parse"],
  },
  webpack: (config) => {
    // Force SHA-256 for all webpack hashing paths (default WasmHash crashes
    // intermittently on Node 22 + Windows).
    config.output.hashFunction = "sha256";
    if (config.output.hashDigest === undefined) {
      config.output.hashDigest = "hex";
    }
    // Disable realContentHash — it re-hashes asset contents at emit time
    // through a separate code path that does not pick up hashFunction in
    // some Next.js 14 builds and triggers the same crash.
    if (config.optimization) {
      config.optimization.realContentHash = false;
    }
    return config;
  },
};

export default nextConfig;
