// ツールバーアイコンクリック時とキーボードショートカット時
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
    // デバッガーをタブにアタッチ
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    // フルページスクリーンショットを撮影
    const response = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
        format: "png",
        fromSurface: false,  // フルページ用
        captureBeyondViewport: true  // ビューポート外も含める
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });

    // デバッガーをデタッチ
    chrome.debugger.detach(debuggee);

    // スクリーンショットをダウンロード
    if (response && response.data) {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `fullpage-screenshot-${timestamp}.png`;
      
      // Base64データをBlobに変換してダウンロード
      const byteCharacters = atob(response.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });
      
      // ダウンロード用のURLを作成
      const url = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        // ダウンロード完了後にURLを解放
        URL.revokeObjectURL(url);
        
        if (chrome.runtime.lastError) {
          console.error('ダウンロードエラー:', chrome.runtime.lastError);
        } else {
          console.log('フルページスクリーンショット保存完了:', filename);
        }
      });
    }

  } catch (error) {
    console.error('スクリーンショットエラー:', error);
    
    // エラー時はデバッガーをデタッチ
    try {
      chrome.debugger.detach(debuggee);
    } catch (detachError) {
      // デタッチエラーは無視
    }
  }
}
