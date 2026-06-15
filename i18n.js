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

const fs = require('fs');
const path = require('path');

// 表示に使える言語と、訳が欠けたときに当てる言語。辞書ファイルは locales/<locale>.json に置く。
const supportedLocales = ['ja', 'en'];
const fallbackLocale = 'ja';




// 言語設定の値 ('system' / 'ja' / 'en') と OS のロケール文字列から、実際に使う言語を決める。'system' のときは OS ロケールの先頭が ja なら日本語、それ以外は英語にし、対応外なら既定言語へ落とす。
function resolveLocale(setting, systemLocale)
{
	if (supportedLocales.includes(setting))
	{
		return setting;
	}

	const base = String(systemLocale || '').toLowerCase();

	if (base.startsWith('ja'))
	{
		return 'ja';
	}

	if (base.startsWith('en'))
	{
		return 'en';
	}

	return fallbackLocale;
}




// 指定言語の辞書ファイルを読む。読めなければ空の辞書を返す。
function loadRaw(locale)
{
	try
	{
		const raw = fs.readFileSync(path.join(__dirname, 'locales', locale + '.json'), 'utf8');
		return JSON.parse(raw);
	}
	catch (err)
	{
		console.error('辞書の読み込みに失敗しました:', locale, err);
		return {};
	}
}




// 指定言語の辞書を組み立てる。まず既定言語を土台に読み、その上へ指定言語を重ねる。これで指定言語に訳が無いキーは既定言語の訳で埋まる。
function buildDict(locale)
{
	const base = loadRaw(fallbackLocale);

	if (locale === fallbackLocale)
	{
		return base;
	}

	return { ...base, ...loadRaw(locale) };
}




// 辞書からキーに対応する文言を引き、{name} 形式のプレースホルダを vars の値で差し替える。キーが辞書に無い場合はキー文字列をそのまま返す。
function translate(dict, key, vars)
{
	let text = (dict && dict[key] !== undefined) ? dict[key] : key;

	if (vars)
	{
		for (const name of Object.keys(vars))
		{
			text = text.split('{' + name + '}').join(String(vars[name]));
		}
	}

	return text;
}




module.exports = { supportedLocales, fallbackLocale, resolveLocale, buildDict, translate };
