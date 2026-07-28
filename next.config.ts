import type {NextConfig} from 'next';

// Kuhaa ang app version gikan sa package.json aron i-inline sa client bundle.
// Gamiton ang `npm_package_version` (gi-set sa npm kada `npm run build/dev`)
// imbes i-import ang root package.json — kay ang pag-import sa root-level nga
// file maghimo sa NFT nga i-trace ang tibuok project (mag-bloat sa standalone).
// Mag-sync gihapon awtomatik sa package.json version.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },
  // Tugoti ang separate dist dir (env-driven) aron ang e2e test server makasabay
  // sa usa ka running nga dev server (lahi ang Next dev singleton lock). Default
  // gihapon '.next' kung walay env — walay kausaban sa normal nga dev/build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'standalone',
  // I-pin ang build ID sa git commit para consistent ang asset paths ug cache
  // keys tali sa mga replica.
  //
  // TIMAN-I: DILI ni ang mag-ayo sa "Failed to find Server Action". Na-test:
  // duha ka build nga parehas ang BUILD_ID mihatag gihapon ug 84 ka action IDs
  // nga WALAY usa nga managsama. Ang action IDs gikan sa
  // NEXT_SERVER_ACTIONS_ENCRYPTION_KEY (flight-client-entry-plugin), dili sa
  // build ID — random na siya kada build kung wala gi-set. Kinahanglan i-set
  // kana nga env var sa Railway; tan-awa ang RAILWAY_DEPLOYMENT.md.
  generateBuildId: async () =>
    process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
  // Keep heavy, non-runtime folders out of the standalone trace. Without this
  // Next copies these multi-GB folders into .next/standalone, bloating it to
  // 30GB+ and causing the installer to silently fail copying node_modules/next.
  outputFileTracingExcludes: {
    '*': [
      'backups/**',
      'vendor/**',
      'mysql-bundle/**',
      'dist/**',
      'Output/**',
      'temp_docs/**',
      'scratch/**',
      'playwright-report/**',
      'tests/**',
      'license-server/**',
      '**/*.sql',
      '**/*.log',
      '**/*.pdf',
    ],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },


  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization" },
        ]
      }
    ]
  }
};


export default nextConfig;
// Forced update
