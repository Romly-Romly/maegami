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

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// .icon の基底名。CFBundleIconName と、actool に渡す --app-icon の名前をこれに揃える。
const iconName = 'maegami';

// Icon Composer 製の .icon ソース。ビルド時に actool でコンパイルして使う。
const iconSource = path.join(__dirname, `${iconName}.icon`);



// electron-builder の afterPack フック。
// macOS 26 (Tahoe) はアイコンを CFBundleIconName と Assets.car から描画する。electron-builder は
// .icns しか埋め込まないため、ここで .icon を actool でコンパイルし、生成した Assets.car を Resources へ
// 配置したうえで Info.plist に CFBundleIconName を加える。これにより Tahoe のアイコンマスクと隙間に敷かれる
// 既定の灰色下敷きを避け、.icon に設計したとおりの見た目で表示させる。
exports.default = async function (context)
{
	// macOS のパッケージにのみ適用する。
	if (context.electronPlatformName !== 'darwin')
	{
		return;
	}

	if (!fs.existsSync(iconSource))
	{
		throw new Error(`afterPack: アイコンソースが見つかりません: ${iconSource}`);
	}

	const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
	const resourcesDir = path.join(appPath, 'Contents', 'Resources');
	const infoPlist = path.join(appPath, 'Contents', 'Info.plist');

	// actool の出力先。一時ディレクトリへ吐き、必要な成果物だけ app へ取り込む。
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maegami-icon-'));
	const partialPlist = path.join(outDir, 'partial.plist');

	// .icon は Assets.xcassets で包まず actool に直接渡す。Assets.car と旧 OS 向けの .icns が生成される。
	execFileSync('xcrun', [
		'actool',
		'--app-icon', iconName,
		'--output-partial-info-plist', partialPlist,
		'--platform', 'macosx',
		'--minimum-deployment-target', '26.0',
		'--compile', outDir,
		iconSource
	], { stdio: 'pipe' });

	const assetsCar = path.join(outDir, 'Assets.car');
	if (!fs.existsSync(assetsCar))
	{
		throw new Error('afterPack: actool が Assets.car を生成しませんでした。');
	}

	// Tahoe が参照する Assets.car を Resources へ配置する。
	fs.copyFileSync(assetsCar, path.join(resourcesDir, 'Assets.car'));

	// 旧 OS 向けには electron-builder が置く icon.icns (CFBundleIconFile) をそのまま残す。Tahoe 用に
	// CFBundleIconName を追記すると、対応 OS ではこちらが優先される。
	execFileSync('xcrun', ['plutil', '-replace', 'CFBundleIconName', '-string', iconName, infoPlist], { stdio: 'pipe' });

	console.log(`  • maegami: Assets.car を注入し CFBundleIconName=${iconName} を設定しました。`);
};
