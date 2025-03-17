# ベースステージ: 共通環境の設定
FROM node:18-alpine AS base

# 作業ディレクトリの設定
WORKDIR /app

# package.jsonのコピー (Appディレクトリから)
COPY App/package*.json ./

# 開発環境ステージ
FROM base AS development
# 依存関係のインストール
RUN npm install --legacy-peer-deps
# アプリケーションソースコードのコピー
COPY App/ ./
# CORS設定用のProxyファイルを作成（WebAssembly機能を有効化）
RUN mkdir -p src && \
    if [ ! -f src/setupProxy.js ]; then \
    echo 'module.exports = function(app) { \
      app.use(function(req, res, next) { \
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp"); \
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin"); \
        next(); \
      }); \
    };' > src/setupProxy.js; \
    fi
# 開発サーバーポートを公開
EXPOSE 3000
# 開発サーバーの起動
CMD ["npm", "start"]

# ビルドステージ: 本番用ビルド
FROM base AS build
# 依存関係のインストール（本番用）
RUN npm install --legacy-peer-deps
# アプリケーションソースコードのコピー
COPY App/ ./
# 本番用ビルド実行
RUN npm run build