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
