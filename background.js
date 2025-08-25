// 開発者ツールと完全同一：レイアウトを変更せずスクリーンショット
chrome.action.onClicked.addListener(handleScreenshot);
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'take_screenshot') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await handleScreenshot(tab);
  }
});

async function handleScreenshot(tab) {
  const debuggee = { tabId: tab.id };
  
  try {
    console.log('デバッガーアタッチ中...');
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    // 現在のレイアウトを保持したままページ全体のサイズを取得
    console.log('ページメトリクス取得中...');
    const layoutMetrics = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(debuggee, "Page.getLayoutMetrics", {}, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });

    const contentSize = layoutMetrics.contentSize || layoutMetrics.cssContentSize;
    console.log('コンテンツサイズ:', contentSize);

    // レイアウトを変更せず、clipでページ全体を指定してスクリーンショット
    // これが開発者ツールの実際の動作
    const response = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
        format: "png",
        clip: {
          x: 0,
          y: 0,
          width: contentSize.width,
          height: contentSize.height,
          scale: 1  // 元のスケールを維持
        },
        captureBeyondViewport: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });

    // デバッガーデタッチ
    chrome.debugger.detach(debuggee);

    if (response && response.data) {
      await downloadScreenshot(response.data);
      console.log('✅ 開発者ツールと完全同一で撮影完了');
    }

  } catch (error) {
    console.error('エラー:', error);
    try {
      chrome.debugger.detach(debuggee);
    } catch (e) {}
  }
}

async function downloadScreenshot(base64Data) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `devtools-exact-${timestamp}.png`;
  
  const url = `data:image/png;base64,${base64Data}`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('ダウンロードエラー:', chrome.runtime.lastError);
    } else {
      console.log('保存完了:', filename);
    }
  });
}
