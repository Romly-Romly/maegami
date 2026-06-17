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

const { contextBridge, ipcRenderer } = require('electron');

// 現在の言語と辞書をメインプロセスから同期的に取り寄せる。描画プロセスのスクリプトが走り出す前に辞書を用意し、起動直後から文言を翻訳できるようにする。サンドボックス下の preload では独自モジュールを require できないため、翻訳処理はここに小さく持つ。
const i18nState = ipcRenderer.sendSync('i18n:get');

// 辞書からキーに対応する文言を引き、{name} 形式のプレースホルダを vars の値で差し替える。キーが辞書に無い場合はキー文字列をそのまま返す。
function translate(key, vars)
{
	const dict = i18nState && i18nState.dict ? i18nState.dict : {};
	let text = dict[key] !== undefined ? dict[key] : key;

	if (vars)
	{
		for (const name of Object.keys(vars))
		{
			text = text.split('{' + name + '}').join(String(vars[name]));
		}
	}

	return text;
}

// 描画プロセスへ、現在の言語と翻訳関数、対応するメディア拡張子の一覧を公開する。
contextBridge.exposeInMainWorld('maegamiI18n', {
	locale: i18nState ? i18nState.locale : 'ja',
	t: translate,
	extensions: i18nState && i18nState.extensions ? i18nState.extensions : []
});

// 描画プロセスへは状態購読と再要求の口だけを公開する。
contextBridge.exposeInMainWorld('maegami', {
	onState: (callback) =>
	{
		ipcRenderer.on('state', (event, state) => callback(state));
	},
	onDisplay: (callback) =>
	{
		ipcRenderer.on('display', (event, state) => callback(state));
	},
	onCursor: (callback) =>
	{
		ipcRenderer.on('cursor', (event, pos) => callback(pos));
	},
	onAdvance: (callback) =>
	{
		ipcRenderer.on('advance', () => callback());
	},
	requestState: () =>
	{
		ipcRenderer.send('request-state');
	}
});

// 設定ウィンドウへは現在値とアプリ版数の取得・全体設定とレイヤー設定の変更・レイヤーの追加削除・フォルダ選択・変更通知の購読を公開する。
contextBridge.exposeInMainWorld('maegamiSettings', {
	get: () => ipcRenderer.invoke('settings:get'),
	getVersion: () => ipcRenderer.invoke('app:get-version'),
	set: (patch) => ipcRenderer.send('settings:set', patch),
	setLayer: (index, patch) => ipcRenderer.send('settings:set-layer', { index, patch }),
	addLayer: () => ipcRenderer.send('settings:add-layer'),
	removeLayer: (index) => ipcRenderer.send('settings:remove-layer', index),
	chooseDirectory: (index) => ipcRenderer.invoke('settings:choose-directory', index),
	onChange: (callback) =>
	{
		ipcRenderer.on('settings:changed', (event, updated) => callback(updated));
	}
});
