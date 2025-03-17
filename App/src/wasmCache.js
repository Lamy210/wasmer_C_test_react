// src/wasmCache.js
/**
 * WebAssemblyモジュールをキャッシュするためのユーティリティ
 * IndexedDBを使用してコンパイル済みWASMモジュールを永続化し、
 * メモリキャッシュによる高速アクセスも提供します
 */

// メモリキャッシュ（アプリケーションライフサイクル内で有効）
const memoryCache = new Map();

/**
 * IndexedDBを使用したWASMキャッシュを作成します
 * @param {string} dbName - データベース名
 * @param {string} storeName - オブジェクトストア名
 * @param {number} dbVersion - データベースバージョン
 * @returns {Object} キャッシュ操作用メソッドを含むオブジェクト
 */
export const createWasmCache = (dbName = 'wasm-cache', storeName = 'modules', dbVersion = 1) => {
  // DB初期化関数
  const openDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion);
      
      request.onerror = () => reject(new Error('WebAssemblyキャッシュDBのオープンに失敗しました'));
      
      request.onupgradeneeded = (event) => {
        console.log(`WebAssemblyキャッシュDBをバージョン${event.newVersion}に更新しています`);
        const db = request.result;
        
        // 既存のストアを削除（バージョン更新時）
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
        
        // 新しいストアを作成
        db.createObjectStore(storeName);
      };
      
      request.onsuccess = () => resolve(request.result);
    });
  };

  // モジュールをキャッシュから取得
  const getModule = async (key) => {
    // 1. まずメモリキャッシュをチェック（最も高速）
    if (memoryCache.has(key)) {
      console.log(`メモリキャッシュからモジュールを取得: ${key}`);
      return memoryCache.get(key);
    }
    
    try {
      // 2. IndexedDBからの取得を試みる
      const db = await openDB();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        
        request.onerror = () => reject(new Error(`モジュール${key}の取得に失敗しました`));
        
        request.onsuccess = () => {
          if (request.result) {
            console.log(`IndexedDBからモジュールを取得: ${key}`);
            // 取得したモジュールをメモリキャッシュにも保存
            memoryCache.set(key, request.result);
            resolve(request.result);
          } else {
            reject(new Error(`モジュール${key}はキャッシュに見つかりませんでした`));
          }
        };
      });
    } catch (err) {
      throw err;
    }
  };

  // モジュールをキャッシュに保存
  const storeModule = async (key, module) => {
    try {
      // 1. メモリキャッシュに保存
      memoryCache.set(key, module);
      
      // 2. IndexedDBに保存
      const db = await openDB();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(module, key);
        
        request.onerror = () => {
          console.warn(`キャッシュへの保存に失敗: ${key}`);
          reject(new Error(`モジュール${key}の保存に失敗しました`));
        };
        
        request.onsuccess = () => {
          console.log(`キャッシュへの保存に成功: ${key}`);
          resolve();
        };
      });
    } catch (err) {
      console.error('キャッシュ保存エラー:', err);
      throw err;
    }
  };

  // キャッシュからモジュールを削除
  const deleteModule = async (key) => {
    // メモリキャッシュから削除
    memoryCache.delete(key);
    
    try {
      // IndexedDBからも削除
      const db = await openDB();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        
        request.onerror = () => reject(new Error(`モジュール${key}の削除に失敗しました`));
        
        request.onsuccess = () => {
          console.log(`キャッシュからモジュールを削除: ${key}`);
          resolve();
        };
      });
    } catch (err) {
      throw err;
    }
  };

  // すべてのキャッシュをクリア
  const clearCache = async () => {
    // メモリキャッシュをクリア
    memoryCache.clear();
    
    try {
      // IndexedDBをクリア
      const db = await openDB();
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onerror = () => reject(new Error('キャッシュのクリアに失敗しました'));
        
        request.onsuccess = () => {
          console.log('キャッシュをクリアしました');
          resolve();
        };
      });
    } catch (err) {
      throw err;
    }
  };

  // キャッシュからモジュールをロードするか、なければ新規取得する関数
  const loadOrStoreModule = async (key, loader) => {
    try {
      // キャッシュからの取得を試みる
      return await getModule(key);
    } catch (err) {
      // キャッシュになければ、loaderを使用して新規取得
      console.log(`キャッシュミス、モジュールを新規ロード中: ${key}`);
      const module = await loader();
      
      // 取得したモジュールをキャッシュに保存
      await storeModule(key, module);
      
      return module;
    }
  };

  return {
    getModule,
    storeModule,
    deleteModule,
    clearCache,
    loadOrStoreModule
  };
};

/**
 * コードからハッシュ値を生成する関数
 * キャッシュのキーとして使用
 * @param {string} str - ハッシュ化する文字列
 * @returns {string} - ハッシュ値
 */
export const generateHash = (str) => {
  let hash = 0;
  if (str.length === 0) return hash.toString();
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bitに変換
  }
  
  return hash.toString();
};

/**
 * WebAssemblyのストア方法互換性チェック
 * @returns {boolean} ストア対応かどうか
 */
export const isWasmStoreSupported = () => {
  try {
    const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
    const clone = structuredClone(module);
    return true;
  } catch (e) {
    console.warn('このブラウザはWebAssemblyモジュールのキャッシュをサポートしていません');
    return false;
  }
};