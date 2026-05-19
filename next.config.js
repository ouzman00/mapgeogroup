const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' *.vercel.com vercel.live",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: *.vercel.com *.vercel-storage.com",
              "font-src 'self' data: *.vercel.com *.gstatic.com vercel.live *.vercel-storage.com",
              "connect-src 'self' *.vercel.com *.vercel-storage.com vercel.live",
              "frame-src 'self' *.vercel.com vercel.live"
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;