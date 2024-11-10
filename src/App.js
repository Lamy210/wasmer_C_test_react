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

function App() {
  const editorRef = useRef(null);          // CodeMirrorインスタンスを保持
  const textareaRef = useRef(null);        // textareaの参照を保持
  const [outputs, setOutputs] = useState([]); // 実行結果を保持する配列
  const [inputData, setInputData] = useState(''); // ユーザーの入力データ

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

  const runClang = async () => {
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

    try {
      // Wasmerの初期化
      const startInit = performance.now();
      await init();
      const endInit = performance.now();

      // Clangの取得
      const startClang = performance.now();
      const clang = await Wasmer.fromRegistry("clang/clang");
      const endClang = performance.now();
      const clangTime = endClang - startClang;

      // プロジェクトディレクトリの準備
      const project = new Directory();
      const userCode = editorRef.current.getValue();
      await project.writeFile("user_code.c", userCode);

      // Wasmへのコンパイル
      const startCompile = performance.now();
      let instance = await clang.entrypoint.run({
        args: ["/project/user_code.c", "-o", "/project/user_code.wasm"],
        mount: { "/project": project },
      });
      const compileOutput = await instance.wait();
      const endCompile = performance.now();
      const compileTime = endCompile - startCompile;

      if (!compileOutput.ok) {
        throw new Error(`Clangのコンパイルに失敗しました: ${compileOutput.stderr}`);
      }

      // 入力データの末尾に改行を追加
      const adjustedInputData = inputData.endsWith('\n') ? inputData : inputData + '\n';

      // Wasmの実行
      const startExecute = performance.now();
      let wasm = await project.readFile("user_code.wasm");
      const example = await Wasmer.fromFile(wasm);
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

      // **ここから修正**
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
      // **ここまで修正**

      // 実行結果を更新
      setOutputs(prev => prev.map(output => {
        if (output.runNumber === runNumber) {
          return {
            ...output,
            clangTime: clangTime.toFixed(2),
            compileTime: compileTime.toFixed(2),
            executeTime: executeTime.toFixed(2),
            totalTime: totalTime.toFixed(2),
            output: finalOutput, // 修正した出力を使用
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

  return (
    <div className="App">
      <header>
        オンラインCコンパイラー
      </header>
      <main>
        <div className="editor-container">
          {/* textareaにrefを渡す */}
          <textarea ref={textareaRef}></textarea>
        </div>
        <div className="controls">
          <button className="run-button" onClick={runClang}>実行</button>
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
