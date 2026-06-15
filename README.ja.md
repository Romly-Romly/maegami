# 前紙 (Maegami)

> 🌐 **[English README →](README.md)**

*壁紙を、最前面に取り戻そう──*

我々はいつから壁紙チェンジャーを使わなくなってしまったのか。お気に入りの壁紙コレクションが眠っているはずだ。再び彼等を呼び戻す時が来たのだ、最前面に！

![前紙のデモ](docs/screenshot.webp)

要するに昔の壁紙チェンジャーみたいなことを、デスクトップの最前面でやるアプリです。当然見にくくなるけど、そんなものは些細な問題です。
一応透明度も指定できるし、マウス周辺は見せないようにもできるので、常に全体を見る必要があるみたいな作業以外では非実用的って程でもないです。あと動画も行けます。



## ダウンロード

[最新リリース](https://github.com/Romly-Romly/maegami/releases/latest) から、お好みの形式でダウンロードして下さい。

- **インストーラ版** — `Maegami Setup *.exe`
- **ポータブル版** — `*-win.zip`

本アプリはコード署名をしていないため、初回起動時に Windows SmartScreen の警告が表示されます。「詳細情報」をクリックし、「実行」を選ぶと起動できます。自己責任でどうぞ。



## 使い方

レイヤーに壁紙のあるフォルダを指定し、再生時間や表示方法をお好みで指定して下さい。アプリはタスクトレイに常駐します。



## 設定

### 設定の保存先

設定内容は OS のユーザーデータ領域に `settings.json` として保存されます。

| OS | パス |
|---|---|
| Windows | `%APPDATA%\maegami\settings.json` |
| macOS | `~/Library/Application Support/maegami/settings.json` |
| Linux | `~/.config/maegami/settings.json` |

Windows ではアンインストール時にこの設定フォルダも併せて削除されます。macOS / Linux にはアンインストーラが無いため、設定を消したい場合は上記フォルダを手動で削除して下さい。

### 自動起動の削除

自動起動を有効にしていた場合、その登録がアンインストールしても残ります。レジストリ エディター (`regedit`) で `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run` を開き、前紙の実行ファイルを指す値 (`Maegami`) を削除して下さい。



## 動作環境

| OS | バージョン |
|---|---|
| Windows | 10 / 11 (64bit) |
| macOS | 11 (Big Sur) 以降 |

Electron 42 をベースにしているため、その対応バージョンを記載していますが、Windows11でしか動作確認していません。



## ライセンス

[GNU General Public License version 3](LICENSE) (GPL-3.0)

Copyright (C) 2026 Romly

このプログラムはフリーソフトウェアです。GPL-3 に従い、再頒布および改変ができます。改変版を頒布する場合は、同じ GPL-3.0 の下でソースコードを公開する必要があります。
