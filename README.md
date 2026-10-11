# SearchJev

Google検索結果を TypeSafe の Jev で判定し、SEO・アフィリエイト目的の量産記事を下げ、一次情報を上げて並べ替える Firefox 拡張（デスクトップ版・Android 版）。

- `extension/`：拡張本体（詳しくは `extension/README.md`）
- `store/`：addons.mozilla.org 用の説明文・プライバシーポリシー・スクリーンショットと、掲載情報の更新・審査状況の確認スクリプト

## 秘密情報

次のファイルはリポジトリに含めません（`.gitignore` 済み）。

- `jevapikey.txt`：Jev の APIキー（検証スクリプト用）
- `amo-credentials.txt`：AMO の API キー（1行目=発行者、2行目=秘密鍵）

## リリース

1. `extension/manifest.json` の `version` を上げる
2. `extension/` で提出：

```bash
WEB_EXT_API_KEY="$(sed -n 1p ../amo-credentials.txt)" WEB_EXT_API_SECRET="$(sed -n 2p ../amo-credentials.txt)" npx web-ext@8 sign --channel=listed --approval-timeout=0
```

3. 審査状況：`node store/amo-status.mjs`
