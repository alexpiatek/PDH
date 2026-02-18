/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pdh/protocol'],
  async redirects() {
    return [
      {
        source: '/main',
        destination: '/play',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
