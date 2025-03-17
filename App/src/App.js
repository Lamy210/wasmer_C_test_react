import React, { useEffect, useRef, useState } from 'react';
// Wasmer SDKをESモジュールとしてインポート
import {
  init,
  Wasmer,
  Directory
} from "https://unpkg.com/@wasmer/sdk@0.9.0/dist/index.mjs";
import CodeMirror from 'codemirror';
import 'codemirror/mode/clike/clike';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/monokai.css';
import './App.css';
// キャッシュユーティリティのインポート
import { createWasmCache, generateHash, isWasmStoreSupported } from './wasmCache';

// アプリケーション定数
const CLANG_CACHE_KEY = 'clang-module-v1'; // バージョン番号を含めることで更新管理が容易
const CLANG_REGISTRY_PATH = "clang/clang";

function App() {
  const editorRef = useRef(null);          // CodeMirrorインスタンスを保持
  const textareaRef = useRef(null);        // textareaの参照を保持
  const [outputs, setOutputs] = useState([]); // 実行結果を保持する配列
  const [inputData, setInputData] = useState(''); // ユーザーの入力データ
  const [wasmCache, setWasmCache] = useState(null); // WASMキャッシュインスタンス
  const [clangInstance, setClangInstance] = useState(null); // Clangインスタンスを保持
  const [cacheSupported, setCacheSupported] = useState(true); // キャッシュサポート状態
  const [isInitialized, setIsInitialized] = useState(false); // Wasmer初期化状態

  // アプリケーション初期化
  useEffect(() => {
    const initApp = async () => {
      try {
        // Wasmerを初期化
        await init();
        
        // WebAssemblyキャッシュのサポート状況をチェック
        const isSupported = isWasmStoreSupported();
        setCacheSupported(isSupported);
        
        // キャッシュサポートがあれば、キャッシュを初期化
        if (isSupported) {
          const cache = createWasmCache();
          setWasmCache(cache);
          
          // 可能であればClangをキャッシュから読み込む
          try {
            const cached = await cache.getModule(CLANG_CACHE_KEY);
            console.log('キャッシュからClangを読み込みました');
            setClangInstance(cached);
          } catch (err) {
            console.log('キャッシュにClangが見つかりませんでした。');
            // 初回ロードはボタンクリック時に行う 初回ロードは、ボタンで行う、ログ確認のため
          }
        }
        
        setIsInitialized(true);
      } catch (error) {
        console.error('初期化エラー:', error);
      }
    };
    
    initApp();
  }, []);

  // CodeMirrorの初期化
  useEffect(() => {
    // textareaがマウントされた後にCodeMirrorを初期化
    if (textareaRef.current) {
      editorRef.current = CodeMirror.fromTextArea(textareaRef.current, {
        mode: "text/x-csrc",
        theme: "monokai",
        lineNumbers: true,
        autoCloseBrackets: true,
      });
      editorRef.current.setValue(`// C言語のサンプルコード
#include<stdio.h>

int main() {
  char name[100];
  printf("あなたの名前は何ですか？\\n");
  fgets(name, sizeof(name), stdin);
  printf("こんにちは、%sさん！\\n", name);
  return 0;
}
      `);
    }

    // クリーンアップ関数でCodeMirrorインスタンスを破棄
    return () => {
      if (editorRef.current) {
        editorRef.current.toTextArea();  // CodeMirrorインスタンスを破棄
        editorRef.current = null;
      }
    };
  }, []);

  // Clangを取得する関数（キャッシュを使用）
  const getClang = async () => {
    // すでにインスタンスがある場合はそれを使用
    if (clangInstance) {
      return clangInstance;
    }
    
    // キャッシュが利用可能で、サポートされている場合
    if (wasmCache && cacheSupported) {
      try {
        // キャッシュからロードするか、なければ新規取得
        const clang = await wasmCache.loadOrStoreModule(CLANG_CACHE_KEY, async () => {
          const newClang = await Wasmer.fromRegistry(CLANG_REGISTRY_PATH);
          return newClang;
        });
        
        // インスタンスを保存
        setClangInstance(clang);
        return clang;
      } catch (error) {
        console.error('Clangのキャッシュ/ロードエラー:', error);
        // キャッシュに問題がある場合は直接ロード
        const clang = await Wasmer.fromRegistry(CLANG_REGISTRY_PATH);
        setClangInstance(clang);
        return clang;
      }
    } else {
      // キャッシュがサポートされていない場合は直接ロード
      const clang = await Wasmer.fromRegistry(CLANG_REGISTRY_PATH);
      setClangInstance(clang);
      return clang;
    }
  };

  // コンパイル結果をキャッシュするためのキーを生成
  const getCompileCacheKey = (code) => {
    return `compiled-${generateHash(code)}-v1`;
  };

  // コード実行関数
  const runClang = async () => {
    if (!isInitialized) {
      alert('Wasmerの初期化が完了していません。しばらくお待ちください。');
      return;
    }
    
    // 新しい実行結果エントリを作成
    const runNumber = outputs.length + 1;
    const newOutput = {
      runNumber,
      clangTime: null,
      compileTime: null,
      executeTime: null,
      totalTime: null,
      output: '実行中...',
      error: null,
    };
    setOutputs(prev => [...prev, newOutput]);

    const startTotal = performance.now(); // 総実行時間の計測開始
    const userCode = editorRef.current.getValue();
    const compileCacheKey = getCompileCacheKey(userCode);

    try {
      // Clangの取得（キャッシュ対応）
      const startClang = performance.now();
      const clang = await getClang();
      const endClang = performance.now();
      const clangTime = endClang - startClang;

      // プロジェクトディレクトリの準備
      const project = new Directory();
      await project.writeFile("user_code.c", userCode);

      // Wasmへのコンパイル（コンパイル結果もキャッシュ対応）
      let wasmBinary;
      const startCompile = performance.now();
      
      // コンパイル済みWASMをキャッシュから取得を試みる
      if (wasmCache && cacheSupported) {
        try {
          wasmBinary = await wasmCache.getModule(compileCacheKey);
          console.log('コンパイル済みWASMをキャッシュから読み込みました');
          // キャッシュから取得できた場合はプロジェクトディレクトリに書き込む
          await project.writeFile("user_code.wasm", wasmBinary);
        } catch (err) {
          // キャッシュにない場合は新規コンパイル
          console.log('キャッシュにコンパイル済みWASMが見つかりませんでした。コンパイルを実行します');
          let instance = await clang.entrypoint.run({
            args: ["/project/user_code.c", "-o", "/project/user_code.wasm"],
            mount: { "/project": project },
          });
          const compileOutput = await instance.wait();
          
          if (!compileOutput.ok) {
            throw new Error(`Clangのコンパイルに失敗しました: ${compileOutput.stderr}`);
          }
          
          // コンパイル結果を取得
          wasmBinary = await project.readFile("user_code.wasm");
          
          // コンパイル結果をキャッシュに保存
          if (wasmCache && cacheSupported) {
            try {
              await wasmCache.storeModule(compileCacheKey, wasmBinary);
              console.log('コンパイル済みWASMをキャッシュに保存しました');
            } catch (cacheErr) {
              console.warn('コンパイル結果のキャッシュ保存に失敗:', cacheErr);
            }
          }
        }
      } else {
        // キャッシュが利用できない場合は通常コンパイル
        let instance = await clang.entrypoint.run({
          args: ["/project/user_code.c", "-o", "/project/user_code.wasm"],
          mount: { "/project": project },
        });
        const compileOutput = await instance.wait();
        
        if (!compileOutput.ok) {
          throw new Error(`Clangのコンパイルに失敗しました: ${compileOutput.stderr}`);
        }
        
        wasmBinary = await project.readFile("user_code.wasm");
      }
      
      const endCompile = performance.now();
      const compileTime = endCompile - startCompile;

      // 入力データの末尾に改行を追加
      const adjustedInputData = inputData.endsWith('\n') ? inputData : inputData + '\n';

      // Wasmの実行
      const startExecute = performance.now();
      const example = await Wasmer.fromFile(wasmBinary);
      const result = await example.entrypoint.run({
        stdin: adjustedInputData,
      });
      const runOutput = await result.wait();
      const endExecute = performance.now();
      const executeTime = endExecute - startExecute;

      if (!runOutput.ok) {
        throw new Error(`実行時エラー: ${runOutput.stderr}`);
      }

      const endTotal = performance.now();
      const totalTime = endTotal - startTotal;

      // 出力を行ごとに分割
      const outputLines = runOutput.stdout.split('\n');
      const newOutputLines = [];
      let inputInserted = false;
      for (let i = 0; i < outputLines.length; i++) {
        newOutputLines.push(outputLines[i]);
        // 入力プロンプトの行の次にユーザーの入力を挿入
        if (!inputInserted && outputLines[i].includes("あなたの名前は何ですか？")) {
          newOutputLines.push(adjustedInputData.trim());
          inputInserted = true;
        }
      }
      const finalOutput = newOutputLines.join('\n');

      // 実行結果を更新
      setOutputs(prev => prev.map(output => {
        if (output.runNumber === runNumber) {
          return {
            ...output,
            clangTime: clangTime.toFixed(2),
            compileTime: compileTime.toFixed(2),
            executeTime: executeTime.toFixed(2),
            totalTime: totalTime.toFixed(2),
            output: finalOutput,
          };
        }
        return output;
      }));

    } catch (error) {
      const endTotal = performance.now();
      const totalTime = endTotal - startTotal;

      // エラーを実行結果に反映
      setOutputs(prev => prev.map(output => {
        if (output.runNumber === runNumber) {
          return {
            ...output,
            totalTime: totalTime.toFixed(2),
            output: `エラー: ${error.message}`,
          };
        }
        return output;
      }));
      console.error(error);
    }
  };

  // キャッシュをクリアする関数
  const clearWasmCache = async () => {
    if (wasmCache && cacheSupported) {
      try {
        await wasmCache.clearCache();
        setClangInstance(null);
        alert('WebAssemblyキャッシュをクリアしました。次回実行時に再ロードします。');
      } catch (err) {
        console.error('キャッシュクリアエラー:', err);
        alert('キャッシュのクリアに失敗しました: ' + err.message);
      }
    } else {
      alert('このブラウザはWebAssemblyキャッシュをサポートしていません。');
    }
  };

  return (
    <div className="App">
      <header>
        オンラインCコンパイラー
        {cacheSupported ? 
          <span className="cache-status cache-enabled">キャッシュ有効</span> : 
          <span className="cache-status cache-disabled">キャッシュ無効</span>}
      </header>
      <main>
        <div className="editor-container">
          {/* textareaにrefを渡す */}
          <textarea ref={textareaRef}></textarea>
        </div>
        <div className="controls">
          <button 
            className="cache-button" 
            onClick={clearWasmCache} 
            disabled={!cacheSupported}
          >
            キャッシュをクリア
          </button>
          <button className="run-button" onClick={runClang} disabled={!isInitialized}>実行</button>
        </div>
        <div className="input-container">
          <h3>標準入力 (stdin):</h3>
          <textarea
            className="input-textarea"
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
          ></textarea>
        </div>
        <div className="output-container">
          {outputs.map(run => (
            <div key={run.runNumber} className="run-output">
              <h3>実行 {run.runNumber}</h3>
              {run.clangTime && <p>Clang取得時間: {run.clangTime} ms</p>}
              {run.compileTime && <p>コンパイル時間: {run.compileTime} ms</p>}
              {run.executeTime && <p>実行時間: {run.executeTime} ms</p>}
              {run.totalTime && <p>総実行時間: {run.totalTime} ms</p>}
              <pre>{run.output}</pre>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;