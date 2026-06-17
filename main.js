/*
 * 前紙 (Maegami)
 * Copyright (C) 2026 Romly
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, screen, nativeImage, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const i18n = require('./i18n');

// 設定ファイルは OS 標準のユーザーデータ領域に置く。
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'];
const videoExtensions = ['.mp4', '.webm', '.ogv', '.mov', '.m4v'];

// メディア収集で潜るフォルダの深さの上限。指定フォルダ自身を1階層目として数え、親・子・孫の3階層まで走査する。巨大なフォルダ木を指定された場合の暴走を防ぐための上限でもある。
const maxScanDepth = 3;

// レイヤーは最大3枚まで増やせる。
const maxLayers = 3;

// ウィンドウ全体に効く設定。不透明度はウィンドウ自体へ掛け、くり抜きはステージ全体のマスクとして働くため、レイヤーごとには持たせず一つだけ持つ。
const globalDefaults = {
	opacity: 0.5,
	cursorMask: true,
	maskRadius: 160,
	cursorTrail: false,
	trailDuration: 3000,
	language: 'system'
};

// レイヤー1枚ぶんの設定。各レイヤーは独立した再生エンジンとして、自分のメディア・大きさ・周期・影を持つ。
const layerDefaults = {
	mediaDir: '',
	mediaKind: 'both',
	shuffle: true,
	displayMode: 'contain',
	sizePercent: 100,
	cornerPercent: 0,
	driftDirection: 'none',
	displayEffect: 'none',
	shadowX: 0,
	shadowY: 14,
	shadowBlur: 28,
	shadowOpacity: 55,
	displayDuration: 8000,
	fadeDuration: 1500,
	gapDuration: 600,
	videoPlayFull: false
};

// 全体設定のうち、再生を止めずに描画側へその場で当てられるキー。不透明度はウィンドウの透明度更新だけで足りる。
const globalDisplayKeys = ['opacity', 'cursorMask', 'maskRadius', 'cursorTrail', 'trailDuration'];

// レイヤー設定のうち、再生中の一枚へその場で当てれば足りるキー。プレイリストの組み直しや再走査を伴わない大きさ・角丸・エフェクト・影がこれにあたる。
const layerDisplayKeys = ['displayMode', 'sizePercent', 'cornerPercent', 'driftDirection', 'displayEffect', 'shadowX', 'shadowY', 'shadowBlur', 'shadowOpacity'];

let settings = { ...globalDefaults, layers: [{ ...layerDefaults }] };
let win = null;
let tray = null;
let settingsWin = null;

// 現在表示に使っている言語と、その辞書。言語設定や OS ロケールから configureLocale で決める。描画プロセスへは preload からの同期要求でこの辞書を渡す。
let currentLocale = i18n.fallbackLocale;
let currentDict = {};

// メインプロセス側 (トレイ・ダイアログ・ウィンドウタイトル) の文言を引く。configureLocale を呼ぶまでは仮の辞書で動く。
function t(key, vars)
{
	return i18n.translate(currentDict, key, vars);
}

// 最前面維持の押し上げ間隔 (ミリ秒) と、そのタイマーの識別子。
const topmostInterval = 1500;
let topmostTimer = null;

// カーソル追従の取得間隔 (ミリ秒) と、そのタイマーの識別子。描画側はこの座標を中心にマスクの穴を開ける。クリック透過のウィンドウは描画側でマウスイベントを受け取れないため、メイン側でカーソル位置を追って渡す。
const cursorInterval = 50;
let cursorTimer = null;

// 直近に描画側へ送ったカーソル状態。位置も画面内外の別も変わらない間は再送しない。
let lastCursor = null;

// 一時停止の自動再開で選べる間隔。トレイのサブメニューをここから組み立てる。
const resumeIntervals = [
	{ key: 'tray.resume10', minutes: 10 },
	{ key: 'tray.resume30', minutes: 30 },
	{ key: 'tray.resume60', minutes: 60 },
	{ key: 'tray.resume120', minutes: 120 }
];

// 自動再開のタイマー識別子と、再開予定の時刻 (エポックミリ秒)。一時停止と同じく保存しない実行時状態で、再開予定が無い (無期限の一時停止・再生中) ときは resumeAt を null にする。
let resumeTimer = null;
let resumeAt = null;










// 旧バージョンの設定 (fit / position の組み合わせ) を新しい displayMode へ読み替える。
function migrateLegacySettings(parsed)
{
	if (parsed.displayMode === undefined && (parsed.fit !== undefined || parsed.position !== undefined))
	{
		if (parsed.position === 'random')
		{
			parsed.displayMode = 'random';
		}
		else if (parsed.fit === 'cover')
		{
			parsed.displayMode = 'cover';
		}
		else
		{
			parsed.displayMode = 'contain';
		}
	}

	delete parsed.fit;
	delete parsed.position;
}




// 平らな一枚構造で保存された設定を、グローバル設定とレイヤー配列の構造へ畳み直す。古い設定はレイヤー1枚ぶんとして取り込み、グローバルに属するキーは上位へ残す。
function migrateToLayersStructure(parsed)
{
	if (Array.isArray(parsed.layers))
	{
		return;
	}

	const layer = {};

	for (const key of Object.keys(layerDefaults))
	{
		if (parsed[key] !== undefined)
		{
			layer[key] = parsed[key];
			delete parsed[key];
		}
	}

	parsed.layers = [layer];
}










function loadSettings()
{
	try
	{
		const raw = fs.readFileSync(settingsPath, 'utf8');
		const parsed = JSON.parse(raw);
		migrateLegacySettings(parsed);
		migrateToLayersStructure(parsed);
		settings = normalizeSettings(parsed);
	}
	catch (err)
	{
		// 初回起動などで設定ファイルが無い場合は既定値のまま進める。
		settings = { ...globalDefaults, layers: [{ ...layerDefaults }] };
	}

	// 一時停止は永続化しない実行時状態。保存値が紛れていても無視し、起動のたびに再生状態から始める。
	settings.paused = false;
}




// 読み込んだ設定をグローバル既定値とレイヤー既定値で補完し、欠けたキーを埋める。レイヤーは最低1枚を保証し、上限を超えた分は切り捨てる。
function normalizeSettings(parsed)
{
	const source = Array.isArray(parsed.layers) ? parsed.layers : [{}];
	const layers = source.slice(0, maxLayers).map((layer) => ({ ...layerDefaults, ...layer }));

	if (layers.length === 0)
	{
		layers.push({ ...layerDefaults });
	}

	const global = {};

	for (const key of Object.keys(globalDefaults))
	{
		if (parsed[key] !== undefined)
		{
			global[key] = parsed[key];
		}
	}

	return { ...globalDefaults, ...global, layers };
}










function saveSettings()
{
	try
	{
		// 一時停止は実行時のみの状態のため保存対象から外し、次回起動時は常に再生状態にする。
		const persist = { ...settings };
		delete persist.paused;

		fs.writeFileSync(settingsPath, JSON.stringify(persist, null, '\t'), 'utf8');
	}
	catch (err)
	{
		console.error('設定の保存に失敗しました:', err);
	}
}










// 言語設定と OS ロケールから表示言語を決め直し、対応する辞書を読み込む。起動時と、言語設定の変更時に呼ぶ。
function configureLocale()
{
	currentLocale = i18n.resolveLocale(settings.language, app.getLocale());
	currentDict = i18n.buildDict(currentLocale);
}




// オーバーレイと設定ウィンドウの両方を再読み込みする。言語の切り替えを描画プロセスへ反映するために使う。再読み込み時に preload が新しい辞書を取り直す。
function reloadWindows()
{
	if (win && !win.isDestroyed())
	{
		win.webContents.reload();
	}

	if (settingsWin && !settingsWin.isDestroyed())
	{
		settingsWin.webContents.reload();
	}
}




// 指定ディレクトリとその子フォルダ (maxScanDepth 階層まで) から、対応拡張子のメディアファイル一覧を収集する。depth は現在の階層で、指定フォルダ自身を1として数える。
function scanMedia(dir, depth = 1)
{
	if (!dir)
	{
		return [];
	}

	let entries = [];

	try
	{
		entries = fs.readdirSync(dir, { withFileTypes: true });
	}
	catch (err)
	{
		console.error('ディレクトリの読み取りに失敗しました:', err);
		return [];
	}

	const result = [];

	for (const entry of entries)
	{
		const full = path.join(dir, entry.name);

		if (entry.isDirectory())
		{
			// 上限階層に達していなければ子フォルダへ潜る。
			if (depth < maxScanDepth)
			{
				result.push(...scanMedia(full, depth + 1));
			}

			continue;
		}

		if (!entry.isFile())
		{
			continue;
		}

		const ext = path.extname(entry.name).toLowerCase();

		if (imageExtensions.includes(ext))
		{
			result.push({ type: 'image', url: pathToFileUrl(full) });
		}
		else if (videoExtensions.includes(ext))
		{
			result.push({ type: 'video', url: pathToFileUrl(full) });
		}
	}

	return result;
}










// メディア一覧を、設定で選ばれた種類 (画像と動画 / 画像のみ / 動画のみ) に絞り込む。
function filterMediaByKind(media, kind)
{
	if (kind === 'image')
	{
		return media.filter((item) => item.type === 'image');
	}

	if (kind === 'video')
	{
		return media.filter((item) => item.type === 'video');
	}

	return media;
}










// ローカルパスを file:// URL へ変換する。日本語や空白を含むパスでも壊れないようにエンコードする。
function pathToFileUrl(p)
{
	let normalized = p.replace(/\\/g, '/');

	if (!normalized.startsWith('/'))
	{
		normalized = '/' + normalized;
	}

	const encoded = normalized.split('/').map(encodeURIComponent).join('/');
	return 'file://' + encoded;
}










// 全体設定だけを取り出す。描画側へはレイヤー設定と分けて渡す。
function globalState()
{
	return { opacity: settings.opacity, cursorMask: settings.cursorMask, maskRadius: settings.maskRadius, cursorTrail: settings.cursorTrail, trailDuration: settings.trailDuration, paused: settings.paused, resumeAt: resumeAt };
}




// 現在の全体設定と、各レイヤーの設定およびメディア一覧を描画プロセスへ送る。レイヤーごとにフォルダと種類が異なるため、メディアはレイヤー単位で走査・絞り込みする。
function pushState()
{
	if (!win || win.isDestroyed())
	{
		return;
	}

	const layers = settings.layers.map((layer) => ({
		config: layer,
		media: filterMediaByKind(scanMedia(layer.mediaDir), layer.mediaKind)
	}));

	win.setOpacity(settings.opacity);
	win.webContents.send('state', { global: globalState(), layers });
}










// 表示設定の変更を描画プロセスへ送る。メディアの再走査やプレイリストの組み直しを伴わず、各レイヤーが現在表示中の一枚へ当てさせる。メディアは載せず、設定だけを渡す。
function pushDisplay()
{
	if (!win || win.isDestroyed())
	{
		return;
	}

	const layers = settings.layers.map((layer) => ({ config: layer }));
	win.webContents.send('display', { global: globalState(), layers });
}










// オーバーレイのウィンドウ状態 (不透明度・最前面指定・カーソル追従) を現在の設定へ合わせ、設定ウィンドウを前面へ戻す。全体設定を更新したときに共通で呼ぶ。
function syncWindowState()
{
	if (win && !win.isDestroyed())
	{
		win.setOpacity(settings.opacity);

		// 設定ウィンドウの操作などをきっかけに最前面指定が外れることがあるため、反映のたびに貼り直す。
		win.setAlwaysOnTop(true, 'screen-saver');
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	// オーバーレイを貼り直すと半透明の本体が設定ウィンドウの手前へ出るため、設定ウィンドウが開いていれば即座に前面へ戻す。
	if (settingsWin && !settingsWin.isDestroyed())
	{
		settingsWin.moveTop();
	}

	// カーソル追従の入切を設定へ合わせる。
	syncCursorTracking();
}




// 全体設定 (不透明度・くり抜き・一時停止) を更新し、保存して反映する。表示に属するキーだけの変更なら再生を止めずその場で当て、それ以外は状態を送り直す。
function applyGlobal(patch)
{
	const languageChanged = patch.language !== undefined && patch.language !== settings.language;

	settings = { ...settings, ...patch };
	saveSettings();

	// 言語が変わったら表示言語を決め直す。トレイは再構築で新しい言語へ更新し、両ウィンドウは再読み込みで反映する。
	if (languageChanged)
	{
		configureLocale();
	}

	syncWindowState();

	const keys = Object.keys(patch);
	const allDisplay = keys.length > 0 && keys.every((key) => globalDisplayKeys.includes(key));

	if (!allDisplay)
	{
		pushState();
	}
	else if (keys.some((key) => key !== 'opacity'))
	{
		// 不透明度はウィンドウの透明度更新だけで足りるため送らない。くり抜きの入切や半径は描画側へ送って反映させる。
		pushDisplay();
	}

	buildTray();
	pushSettingsState();

	if (languageChanged)
	{
		reloadWindows();
	}
}




// 自動再開のタイマーを止め、再開予定を消す。一時停止を解除するときや、別の間隔を選び直すときに先に呼ぶ。
function clearResumeTimer()
{
	if (resumeTimer)
	{
		clearTimeout(resumeTimer);
		resumeTimer = null;
	}

	resumeAt = null;
}




// 一時停止の入切をまとめて行う。minutes に正の値を渡すとその時間だけ後に自動で再生へ戻し、0 や省略なら無期限の一時停止にする。再生へ戻すときは自動再開のタイマーも消す。
function setPaused(paused, minutes)
{
	clearResumeTimer();

	if (paused && minutes > 0)
	{
		resumeAt = Date.now() + minutes * 60000;
		resumeTimer = setTimeout(() => setPaused(false), minutes * 60000);
	}

	applyGlobal({ paused: paused });
}




// 自動再開の予定時刻を「14:32」のような時:分でトレイメニューへ示す。
function formatResumeAt(ms)
{
	const date = new Date(ms);
	const hh = String(date.getHours()).padStart(2, '0');
	const mm = String(date.getMinutes()).padStart(2, '0');
	return hh + ':' + mm;
}




// 指定したレイヤーの設定を更新し、保存して反映する。大きさ・エフェクト・影など表示に属するキーだけの変更なら再生を止めずその場で当て、メディアや再生周期に関わる変更は状態を送り直す。
function applyLayer(index, patch)
{
	if (!settings.layers[index])
	{
		return;
	}

	settings.layers[index] = { ...settings.layers[index], ...patch };
	saveSettings();

	// 表示方法の変更でランダム配置になったり外れたりするため、カーソル追従の要否を見直す。
	syncCursorTracking();

	const keys = Object.keys(patch);
	const allDisplay = keys.length > 0 && keys.every((key) => layerDisplayKeys.includes(key));

	if (allDisplay)
	{
		pushDisplay();
	}
	else
	{
		pushState();
	}

	buildTray();
	pushSettingsState();
}




// レイヤーを1枚追加する。上限に達している場合は何もしない。フォルダや大きさを一から選び直さずに済むよう、直前のレイヤーの設定を引き継いで作る。
function addLayer()
{
	if (settings.layers.length >= maxLayers)
	{
		return;
	}

	const previous = settings.layers[settings.layers.length - 1];
	settings.layers.push({ ...layerDefaults, ...previous });
	saveSettings();
	syncCursorTracking();
	pushState();
	buildTray();
	pushSettingsState();
}




// 指定したレイヤーを削除する。最後の1枚は残し、全消しは許さない。
function removeLayer(index)
{
	if (settings.layers.length <= 1 || !settings.layers[index])
	{
		return;
	}

	settings.layers.splice(index, 1);
	saveSettings();
	syncCursorTracking();
	pushState();
	buildTray();
	pushSettingsState();
}










// 設定ウィンドウが開いていれば最新の設定値を送り、表示を同期させる。
function pushSettingsState()
{
	if (settingsWin && !settingsWin.isDestroyed())
	{
		settingsWin.webContents.send('settings:changed', settings);
	}
}










function openSettings()
{
	if (settingsWin && !settingsWin.isDestroyed())
	{
		settingsWin.show();
		settingsWin.focus();
		return;
	}

	settingsWin = new BrowserWindow({
		width: 880,
		height: 580,
		minWidth: 640,
		minHeight: 480,
		title: t('settings.windowTitle'),
		// 同梱したアプリアイコンを明示する。ビルド資材ではなく同梱物の icon.ico を指すことで、開発実行でも配布版でも同じアイコンが出る。
		icon: path.join(__dirname, 'assets', 'icon.ico'),
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	// オーバーレイ本体が screen-saver レベルで最前面にいるため、設定ウィンドウも同じレベルへ上げないと背後に隠れてしまう。
	settingsWin.setAlwaysOnTop(true, 'screen-saver');

	settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

	settingsWin.on('closed', () =>
	{
		settingsWin = null;
	});
}










// プライマリディスプレイのサイズ変更に追従させる。
function fitToPrimaryDisplay()
{
	if (!win || win.isDestroyed())
	{
		return;
	}

	const bounds = screen.getPrimaryDisplay().bounds;
	win.setBounds(bounds);
}










// 一定間隔でオーバーレイを Z オーダーの最上位へ押し上げ続ける。Windows では setAlwaysOnTop だけでは他の最前面ウィンドウがアクティブ化された際に背後へ回り込み、自力では復帰できないため、定期的に moveTop で前面へ戻す。
function startTopmostKeeper()
{
	if (topmostTimer)
	{
		return;
	}

	topmostTimer = setInterval(() =>
	{
		// 設定ウィンドウを開いている間はオーバーレイを押し上げず、設定ウィンドウだけを前面に保つ。オーバーレイと設定ウィンドウを毎回交互に最前面へ動かすと、半透明のオーバーレイが一瞬だけ設定ウィンドウを覆って画面がちらつくため。
		if (settingsWin && !settingsWin.isDestroyed())
		{
			settingsWin.moveTop();
			return;
		}

		if (win && !win.isDestroyed())
		{
			win.moveTop();
		}
	}, topmostInterval);
}










function stopTopmostKeeper()
{
	if (topmostTimer)
	{
		clearInterval(topmostTimer);
		topmostTimer = null;
	}
}










// カーソルの現在位置をプライマリディスプレイ内の座標へ直し、描画プロセスへ送る。クリック透過のウィンドウは描画側でマウスイベントを受け取れないため、メイン側でカーソルを追って位置を渡す。
function pollCursor()
{
	if (!win || win.isDestroyed())
	{
		return;
	}

	const point = screen.getCursorScreenPoint();
	const bounds = screen.getPrimaryDisplay().bounds;
	const x = point.x - bounds.x;
	const y = point.y - bounds.y;
	const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;

	// 位置も画面内外の別も変わっていなければ送らない。静止中や画面外に居続ける間の無駄な送信を省く。
	if (lastCursor && lastCursor.x === x && lastCursor.y === y && lastCursor.inside === inside)
	{
		return;
	}

	lastCursor = { x, y, inside };
	win.webContents.send('cursor', lastCursor);
}










function startCursorTracking()
{
	if (cursorTimer)
	{
		return;
	}

	// 開始直後に現在位置を必ず一度送れるよう、直近状態を空にしてから走らせる。
	lastCursor = null;
	cursorTimer = setInterval(pollCursor, cursorInterval);
}










function stopCursorTracking()
{
	if (!cursorTimer)
	{
		return;
	}

	clearInterval(cursorTimer);
	cursorTimer = null;

	// 追従を止めたら描画側の穴も閉じさせる。
	if (win && !win.isDestroyed())
	{
		win.webContents.send('cursor', { x: 0, y: 0, inside: false });
	}
}




// カーソル追従が要るかを判定する。くり抜きを出す設定か、いずれかのレイヤーがランダム配置のとき要る。ランダム配置は出現位置をカーソルからやんわり遠ざけるため、描画側でカーソル位置を必要とする。
function cursorTrackingNeeded()
{
	if (settings.cursorMask)
	{
		return true;
	}

	return settings.layers.some((layer) => layer.displayMode === 'random');
}




// 現在の設定に合わせてカーソル追従の入切をそろえる。くり抜きの入切やレイヤーの表示方法を変えるたびに呼ぶ。
function syncCursorTracking()
{
	if (cursorTrackingNeeded())
	{
		startCursorTracking();
	}
	else
	{
		stopCursorTracking();
	}
}










function createWindow()
{
	const display = screen.getPrimaryDisplay();
	const bounds = display.bounds;

	win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		transparent: true,
		hasShadow: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		focusable: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	// クリックを一切受け取らず、下のウィンドウへ素通りさせる。
	win.setIgnoreMouseEvents(true, { forward: false });

	// あらゆるアプリより前面に出す。スクリーンセーバー級のレベルを指定する。
	win.setAlwaysOnTop(true, 'screen-saver');

	// 全ての仮想デスクトップ、および他アプリのフルスクリーン上にも表示する。
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	win.setOpacity(settings.opacity);

	win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

	win.once('ready-to-show', () =>
	{
		win.showInactive();
		pushState();
		startTopmostKeeper();

		// くり抜きが有効、またはランダム配置のレイヤーがあればカーソル追従を始める。
		syncCursorTracking();
	});
}










function chooseDirectory(index)
{
	if (!settings.layers[index])
	{
		return null;
	}

	const parent = (settingsWin && !settingsWin.isDestroyed()) ? settingsWin : null;
	const options = { title: t('dialog.chooseFolder'), properties: ['openDirectory'] };
	const picked = parent ? dialog.showOpenDialogSync(parent, options) : dialog.showOpenDialogSync(options);

	if (picked && picked.length > 0)
	{
		applyLayer(index, { mediaDir: picked[0] });
		return settings.layers[index].mediaDir;
	}

	return null;
}










// トレイアイコンを生成する。macOS のメニューバーはテンプレート画像を求めるため別扱いとし、それ以外は再生中と一時停止中でアイコンを出し分ける。再生中は設定ウィンドウと共通のアプリアイコン (icon.ico)、一時停止中は一時停止用アイコン (pause.ico) を返す。
function createTrayIcon()
{
	if (process.platform === 'darwin')
	{
		// メニューバーではテンプレート画像にすると、背景の明暗や選択状態に合わせて OS が色を当て直してくれる。素材は黒とアルファだけのモノクロで、@2x は createFromPath が同じフォルダから自動で取り込む。
		const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
		image.setTemplateImage(true);
		return image;
	}

	// Windows の通知領域は表示スケールごとに異なる実寸を要求する。複数サイズを内包した ICO を渡すと、Windows が該当サイズを無加工で選ぶため拡大縮小によるにじみが出ない。一時停止中は pause.ico に差し替え、トレイを見ただけで再生が止まっていると分かるようにする。
	const iconFile = settings.paused ? 'pause.ico' : 'icon.ico';
	return nativeImage.createFromPath(path.join(__dirname, 'assets', iconFile));
}










// トレイメニュー項目のアイコンを返す。ネイティブメニューは Web フォントを使えないため、romoji のグリフを焼いた PNG を読み込む。メニューの文字色に合わせ、テーマの明暗で描き分けた素材を出し分ける。@2x は createFromPath が同じフォルダから自動で取り込む。
function menuIcon(name)
{
	const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
	return nativeImage.createFromPath(path.join(__dirname, 'assets', `menu-${name}-${theme}.png`));
}










function buildTray()
{
	if (!tray)
	{
		tray = new Tray(createTrayIcon());
		tray.on('click', openSettings);
	}
	else
	{
		// 一時停止の入切に合わせてアイコンを差し替える。buildTray は状態が変わるたびに呼ばれるため、ここで現在の再生状態に対応するアイコンへ更新する。
		tray.setImage(createTrayIcon());
	}

	// ツールチップは言語の切り替えでも変わるため、buildTray のたびに現在の言語へ合わせて設定し直す。
	tray.setToolTip(t('app.name'));

	// 自動再開の各間隔を選ぶサブメニュー。再生中・停止中のどちらからでも、選べば一時停止のうえタイマーを仕掛ける。
	const resumeSubmenu = resumeIntervals.map((item) => ({
		label: t(item.key),
		click: () => setPaused(true, item.minutes)
	}));

	// 再生・一時停止まわりの項目。再生中は一時停止の手段を、停止中は再生と自動再開予定の確認・取り消しを出す。
	const playbackItems = settings.paused
		? [
			{ label: t('tray.play'), click: () => setPaused(false) },
			{ label: t('tray.setAutoResume'), submenu: resumeSubmenu }
		]
		: [
			{ label: t('tray.next'), icon: menuIcon('next'), click: advanceOverlay },
			{ label: t('tray.pause'), icon: menuIcon('pause'), click: () => setPaused(true, 0) },
			{ label: t('tray.pauseAutoResume'), submenu: resumeSubmenu }
		];

	if (settings.paused && resumeAt)
	{
		playbackItems.push({ label: t('tray.resumeScheduled', { time: formatResumeAt(resumeAt) }), enabled: false });
		playbackItems.push({ label: t('tray.cancelAutoResume'), click: () => setPaused(true, 0) });
	}

	const menu = Menu.buildFromTemplate([
		{ label: t('tray.header', { version: app.getVersion() }), enabled: false },
		{ type: 'separator' },
		{ label: t('tray.layers', { count: settings.layers.length }), enabled: false },
		{ label: t('tray.settings'), icon: menuIcon('settings'), click: openSettings },
		{ type: 'separator' },
		...playbackItems,
		{ type: 'separator' },
		{ label: t('tray.quit'), click: () => app.quit() }
	]);

	tray.setContextMenu(menu);
}










// トレイの「次へ」から呼ばれ、オーバーレイへ画像送りを指示する。ウィンドウが無い、または破棄済みのときは何もしない。
function advanceOverlay()
{
	if (win && !win.isDestroyed())
	{
		win.webContents.send('advance');
	}
}










function main()
{
	loadSettings();

	// 設定の言語と OS ロケールから表示言語を決め、辞書を読み込む。app.getLocale はアプリの ready 後でないと正しい値を返さないため、ここで行う。
	configureLocale();

	// preload からの同期要求に応え、現在の言語と辞書、対応するメディア拡張子の一覧を返す。描画プロセスはこれを使って起動直後から文言を翻訳し、設定画面のヒントに対応形式を並べる。
	ipcMain.on('i18n:get', (event) =>
	{
		event.returnValue = { locale: currentLocale, dict: currentDict, extensions: imageExtensions.concat(videoExtensions) };
	});

	// 描画プロセスからの状態要求に応える。
	ipcMain.on('request-state', () => pushState());

	// 設定ウィンドウからの現在値の取得要求に応える。
	ipcMain.handle('settings:get', () => settings);

	// 設定ウィンドウのバージョン表示のために、package.json の version を返す。
	ipcMain.handle('app:get-version', () => app.getVersion());

	// 設定ウィンドウからの全体設定の変更を受け取り反映する。
	ipcMain.on('settings:set', (event, patch) =>
	{
		if (patch && typeof patch === 'object')
		{
			applyGlobal(patch);
		}
	});

	// 設定ウィンドウからのレイヤー設定の変更を受け取り反映する。
	ipcMain.on('settings:set-layer', (event, payload) =>
	{
		if (payload && typeof payload === 'object' && typeof payload.index === 'number' && payload.patch && typeof payload.patch === 'object')
		{
			applyLayer(payload.index, payload.patch);
		}
	});

	// 設定ウィンドウからのレイヤー追加・削除要求に応える。
	ipcMain.on('settings:add-layer', () => addLayer());
	ipcMain.on('settings:remove-layer', (event, index) =>
	{
		if (typeof index === 'number')
		{
			removeLayer(index);
		}
	});

	// 設定ウィンドウからのフォルダ選択要求に応える。どのレイヤーへ反映するかを受け取る。
	ipcMain.handle('settings:choose-directory', (event, index) => chooseDirectory(typeof index === 'number' ? index : 0));

	createWindow();
	buildTray();

	// トレイメニューのアイコンはテーマの明暗で描き分けているため、システムのテーマ切替に合わせてトレイを作り直し、現在のテーマに合う素材へ差し替える。
	nativeTheme.on('updated', () => buildTray());

	screen.on('display-metrics-changed', fitToPrimaryDisplay);
	screen.on('display-added', fitToPrimaryDisplay);
	screen.on('display-removed', fitToPrimaryDisplay);

	// macOS ではドックアイコンを隠し、トレイ常駐に徹する。
	if (process.platform === 'darwin' && app.dock)
	{
		app.dock.hide();
	}
}










// 多重起動を防ぐ。ロックを取得できなければ既に常駐中のインスタンスがあるので、こちらは即座に終了する。
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock)
{
	app.quit();
}
else
{
	// 二つ目の起動が試みられた際は、常駐中のウィンドウの表示と最前面指定を念のため再確認する。
	app.on('second-instance', () =>
	{
		if (win && !win.isDestroyed())
		{
			win.showInactive();
			win.setAlwaysOnTop(true, 'screen-saver');
		}
	});

	// 全ウィンドウを閉じても常駐し続ける。終了はトレイメニューから行う。
	app.on('window-all-closed', (event) =>
	{
		event.preventDefault();
	});

	// 終了時に押し上げタイマーとカーソル追従タイマーを止める。
	app.on('before-quit', stopTopmostKeeper);
	app.on('before-quit', stopCursorTracking);

	app.whenReady().then(main);
}
