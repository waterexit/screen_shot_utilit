const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

class WebCrawlerScreenshot {
  constructor(startUrl, options = {}) {
    this.startUrl = startUrl;
    this.visitedUrls = new Set();
    this.visitedLocations = new Set(); // パラメータを除いたURL（ロケーション）を記録
    this.screenshotDir = options.screenshotDir || './screenshots';
    this.maxDepth = options.maxDepth || 10; // 無限ループ防止
    this.delay = options.delay || 1000; // ページ間の待機時間（ms）
    this.baseUrl = new URL(startUrl).origin;
    
    // スクリーンショット保存ディレクトリを作成
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  // URLからパラメータを除いたロケーション部分を取得
  getUrlLocation(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (error) {
      return url;
    }
  }

  // URLが同一ドメインかチェック
  isSameDomain(url) {
    try {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(this.baseUrl);
      return urlObj.hostname === baseUrlObj.hostname;
    } catch (error) {
      return false;
    }
  }

  // ファイル名として使える文字列に変換
  sanitizeFilename(url) {
    return url
      .replace(/[^\w\-_.]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 200); // ファイル名の長さ制限
  }

  // スクリーンショットを撮影
  async takeScreenshot(page, url, index, pathHistory = []) {
    try {
      console.log(`📸 スクリーンショット撮影中: ${url}`);
      
      // ページの読み込み完了を待つ
      await page.waitForLoadState('networkidle');
      
      // 遷移経緯をファイル名に含める
      let pathString = '';
      if (pathHistory.length > 0) {
        // 各URLのパス部分のみを取得して短縮
        const shortPaths = pathHistory.map(historyUrl => {
          try {
            const urlObj = new URL(historyUrl);
            let pathname = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '');
            // 長すぎる場合は短縮
            if (pathname.length > 20) {
              pathname = pathname.substring(0, 17) + '...';
            }
            return pathname || 'root';
          } catch {
            return 'unknown';
          }
        });
        pathString = `_path[${shortPaths.join('->')}]`;
      }
      
      const currentPageName = (() => {
        try {
          const urlObj = new URL(url);
          let pathname = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '');
          return pathname || 'root';
        } catch {
          return 'current';
        }
      })();
      
      const filename = `${String(index).padStart(3, '0')}_${this.sanitizeFilename(currentPageName)}${pathString}.png`;
      const filepath = path.join(this.screenshotDir, filename);
      
      // フルページのスクリーンショットを撮影
      await page.screenshot({
        path: filepath,
        fullPage: true
      });
      
      console.log(`✅ スクリーンショット保存完了: ${filename}`);
      return filepath;
    } catch (error) {
      console.error(`❌ スクリーンショット撮影エラー (${url}):`, error.message);
      return null;
    }
  }

  // ページ内のHTMLリンクを取得
  async getHtmlLinks(page) {
    try {
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors
          .map(anchor => {
            const href = anchor.getAttribute('href');
            if (!href) return null;
            
            // 相対URLを絶対URLに変換
            try {
              return new URL(href, window.location.href).href;
            } catch (error) {
              return null;
            }
          })
          .filter(url => {
            if (!url) return false;
            
            // HTMLファイルかチェック（拡張子がない場合も含める）
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();
            
            // 明示的に非HTMLファイルを除外
            const excludeExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar', '.exe', '.dmg', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.mp4', '.mp3', '.wav', '.css', '.js'];
            const hasExcludedExtension = excludeExtensions.some(ext => pathname.endsWith(ext));
            
            return !hasExcludedExtension;
          });
      });
      
      // 同一ドメインのリンクのみをフィルタリング
      const sameDomainLinks = links.filter(url => this.isSameDomain(url));
      
      console.log(`🔗 発見したリンク数: ${sameDomainLinks.length}`);
      return sameDomainLinks;
    } catch (error) {
      console.error('❌ リンク取得エラー:', error.message);
      return [];
    }
  }

  // 再帰的にページを巡回
  async crawlRecursively(page, url, depth = 0, index = 0, pathHistory = []) {
    // 深度制限チェック
    if (depth > this.maxDepth) {
      console.log(`⚠️ 最大深度 ${this.maxDepth} に到達しました`);
      return index;
    }

    // URLの正規化
    const normalizedUrl = url.replace(/#.*$/, ''); // フラグメントを除去
    const location = this.getUrlLocation(normalizedUrl);

    // 既に訪問済みのロケーションかチェック
    if (this.visitedLocations.has(location)) {
      console.log(`⏭️ 既に訪問済み: ${url}`);
      return index;
    }

    try {
      console.log(`\n🌐 ページに移動中 (深度 ${depth}): ${url}`);
      if (pathHistory.length > 0) {
        console.log(`📍 遷移経緯: ${pathHistory.join(' -> ')} -> ${url}`);
      }
      
      // ページに移動
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      if (!response || !response.ok()) {
        console.log(`⚠️ ページの読み込みに失敗: ${url} (ステータス: ${response?.status()})`);
        return index;
      }

      // 訪問済みとして記録
      this.visitedUrls.add(normalizedUrl);
      this.visitedLocations.add(location);
      index++;

      // スクリーンショットを撮影（遷移経緯付き）
      await this.takeScreenshot(page, url, index, pathHistory);

      // 待機
      if (this.delay > 0) {
        await page.waitForTimeout(this.delay);
      }

      // ページ内のリンクを取得
      const links = await this.getHtmlLinks(page);
      
      // 未訪問のリンクをフィルタリング
      const newLinks = links.filter(link => {
        const linkLocation = this.getUrlLocation(link.replace(/#.*$/, ''));
        return !this.visitedLocations.has(linkLocation);
      });

      console.log(`📊 新しいリンク数: ${newLinks.length}`);

      // 現在のURLを経緯に追加
      const newPathHistory = [...pathHistory, url];
      
      // パス履歴が長くなりすぎる場合は制限（ファイル名の長さ制限のため）
      const maxPathLength = 5;
      if (newPathHistory.length > maxPathLength) {
        newPathHistory.splice(0, newPathHistory.length - maxPathLength);
      }

      // 各リンクを再帰的に巡回
      for (const link of newLinks) {
        index = await this.crawlRecursively(page, link, depth + 1, index, newPathHistory);
      }

      return index;

    } catch (error) {
      console.error(`❌ ページ処理エラー (${url}):`, error.message);
      return index;
    }
  }

  // メイン実行関数
  async run() {
    console.log('🚀 Puppeteer スクリーンショット巡回を開始します');
    console.log(`📂 スクリーンショット保存先: ${this.screenshotDir}`);
    console.log(`🎯 開始URL: ${this.startUrl}\n`);

    const browser = await puppeteer.launch({
      headless: 'new', // 'new' | false (デバッグ時はfalseに)
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      
      // ビューポートサイズを設定
      await page.setViewport({
        width: 1920,
        height: 1080
      });

      // User-Agentを設定
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      const startTime = Date.now();
      const totalPages = await this.crawlRecursively(page, this.startUrl);
      const endTime = Date.now();

      console.log('\n🎉 巡回完了！');
      console.log(`📊 訪問ページ数: ${totalPages}`);
      console.log(`⏱️ 実行時間: ${((endTime - startTime) / 1000).toFixed(2)}秒`);
      console.log(`📂 スクリーンショット保存先: ${path.resolve(this.screenshotDir)}`);

    } catch (error) {
      console.error('❌ 実行エラー:', error);
    } finally {
      await browser.close();
    }
  }
}

// 使用例
async function main() {
  const startUrl = 'https://example.com'; // ここに開始URLを設定
  
  const crawler = new WebCrawlerScreenshot(startUrl, {
    screenshotDir: './screenshots', // スクリーンショット保存ディレクトリ
    maxDepth: 5,                   // 最大深度
    delay: 1000                    // ページ間の待機時間（ms）
  });

  await crawler.run();
}

// スクリプト直接実行時
if (require.main === module) {
  main().catch(console.error);
}

module.exports = WebCrawlerScreenshot;