const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite na web (usada só para testes automatizados) precisa de .wasm e SharedArrayBuffer.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(req, res, next);
  };
};

module.exports = config;
