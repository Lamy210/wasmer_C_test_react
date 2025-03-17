const { override, addWebpackModuleRule, overrideDevServer } = require('customize-cra');

const headers = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const devServerConfig = () => config => {
  config.headers = {
    ...config.headers,
    ...headers,
  };
  return config;
};

module.exports = {
  webpack: override(
    addWebpackModuleRule({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto'
    })
  ),
  devServer: overrideDevServer(devServerConfig())
};
