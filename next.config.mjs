/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['three', '@react-three/fiber', '@react-three/drei', 'lucide-react'],
  },
};

export default nextConfig;
