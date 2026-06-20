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

// レイヤーは最大3枚まで。追加ボタンの出し入れの判断に使う。実際の上限の強制はメインプロセス側で行う。
const maxLayers = 3;

const sidebar = document.querySelector('.sidebar');
const layerNav = document.getElementById('layer-nav');
const layerSections = document.getElementById('layer-sections');
const layerTemplate = document.getElementById('layer-template');
const addLayerBtn = document.getElementById('add-layer');

const opacityEl = document.getElementById('opacity');
const opacityValueEl = document.getElementById('opacity-value');
const cursorMaskEl = document.getElementById('cursor-mask');
const maskRadiusRowEl = document.getElementById('mask-radius-row');
const maskRadiusEl = document.getElementById('mask-radius');
const maskRadiusValueEl = document.getElementById('mask-radius-value');
const cursorTrailRowEl = document.getElementById('cursor-trail-row');
const cursorTrailEl = document.getElementById('cursor-trail');
const trailDurationRowEl = document.getElementById('trail-duration-row');
const trailDurationEl = document.getElementById('trail-duration');
const trailDurationValueEl = document.getElementById('trail-duration-value');

// preload から渡された翻訳関数。キーを現在の言語の文言へ変換する。
const t = window.maegamiI18n.t;

// 対応するメディア拡張子を空白区切りで並べた文字列。メディアの種類のヒントに対応形式として差し込む。拡張子の定義はメインプロセスにあり、preload 経由で受け取って二重定義を避ける。
const mediaFormats = (window.maegamiI18n.extensions || []).join(' ');

// 全体セクションの言語選択ドロップダウン。init で組み立て、選択値の反映に使う。
let languageDropdown = null;

// root 以下の data-i18n を持つ要素へ、キーに対応する文言を流し込む。プレースホルダを含まない静的な文言だけを対象にする。
function translateDom(root)
{
	for (const el of root.querySelectorAll('[data-i18n]'))
	{
		el.textContent = t(el.dataset.i18n);
	}
}

// 現在組み上がっているレイヤーの数。受信した設定とこの数が食い違ったときだけレイヤーのUIを作り直す。
let builtCount = -1;

// 各レイヤーのUI参照。値の更新時に毎回作り直さず、ここに覚えた要素へ書き込む。
let layerUI = [];

// いま選んでいるサイドバー項目の対象。レイヤーの追加削除でUIを作り直した後も、可能なら同じ項目を選び直す。
let activeTarget = 'section-global';

// 受信した設定でフォームを再構築している最中は、こちらからの送信を抑止して反射的なループを防ぐ。
let applyingState = false;




// 自前のドロップダウンを組み立てる。ネイティブの select はポップアップが別ウィンドウになり、最前面維持タイマーの moveTop で閉じてしまうため、ページ内の要素で完結させる。選択時のみ onChange を呼び、プログラムからの setValue では呼ばない。
function setupDropdown(root, onChange)
{
	const toggle = root.querySelector('.dropdown-toggle');
	const labelEl = root.querySelector('.dropdown-label');
	const options = Array.from(root.querySelectorAll('.dropdown-option'));

	function close()
	{
		root.classList.remove('open');
	}

	function setValue(value)
	{
		root.dataset.value = value;

		for (const option of options)
		{
			const selected = option.dataset.value === value;
			option.classList.toggle('active', selected);

			if (selected)
			{
				labelEl.textContent = option.textContent;
			}
		}
	}

	toggle.addEventListener('click', (event) =>
	{
		event.stopPropagation();
		root.classList.toggle('open');
	});

	for (const option of options)
	{
		option.addEventListener('click', () =>
		{
			setValue(option.dataset.value);
			close();
			onChange(option.dataset.value);
		});
	}

	// 外側のクリックと Escape キーで閉じる。
	document.addEventListener('click', (event) =>
	{
		if (!root.contains(event.target))
		{
			close();
		}
	});

	document.addEventListener('keydown', (event) =>
	{
		if (event.key === 'Escape')
		{
			close();
		}
	});

	return { setValue };
}




// サイドバーの選択に応じて表示するセクションを切り替える。対象が存在しない場合は全体へ戻す。
function switchSection(targetId)
{
	const sections = document.querySelectorAll('.section');
	const exists = Array.from(sections).some((section) => section.id === targetId);
	const target = exists ? targetId : 'section-global';

	activeTarget = target;

	sections.forEach((section) =>
	{
		section.classList.toggle('active', section.id === target);
	});

	document.querySelectorAll('.nav-item').forEach((item) =>
	{
		item.classList.toggle('active', item.dataset.target === target);
	});
}




// ミリ秒を「◯.◯ 秒」形式の文字列にする。秒の単位は言語に合わせて切り替える。
function formatSeconds(ms)
{
	return t('unit.seconds', { value: (ms / 1000).toFixed(1) });
}




// 全体設定の変更をメインプロセスへ送る。状態反映中は送らない。
function send(patch)
{
	if (!applyingState)
	{
		window.maegamiSettings.set(patch);
	}
}




// 指定したレイヤーの設定の変更をメインプロセスへ送る。状態反映中は送らない。
function sendLayer(index, patch)
{
	if (!applyingState)
	{
		window.maegamiSettings.setLayer(index, patch);
	}
}




// 表示サイズと角丸は画像を収める・ランダム配置のときだけ効くため、画面を覆うときはどちらも隠す。
function updateSizeRowsVisibility(root, mode)
{
	const hidden = (mode === 'cover');
	root.querySelectorAll('.size-row, .corner-row').forEach((row) => row.classList.toggle('hidden', hidden));
}




// 表示方法の説明文を、選んでいるモードごとの具体的な内容へ差し替える。
function updateDisplayModeDesc(root, mode)
{
	const desc = root.querySelector('.display-mode-desc');
	desc.textContent = t('layer.displayMode.desc.' + mode);
}




// 表示サイズの意味は、画像を収める設定では「画面に収めたときの大きさ」、ランダム配置では「デスクトップ面積に対する画像の面積の割合」と異なるため、ヒントもモードに合わせて差し替える。画面を覆う設定ではこの行は隠れるため触らない。
function updateSizeDesc(root, mode)
{
	if (mode === 'cover')
	{
		return;
	}

	root.querySelector('.size-desc').textContent = t('layer.size.desc.' + mode);
}




// ゆっくり移動とカーソル避けはランダム配置のときだけ効くため、それ以外の表示方法では隠す。
function updateDriftRowVisibility(root, mode)
{
	const hidden = (mode !== 'random');
	root.querySelectorAll('.drift-row, .flee-row').forEach((row) => row.classList.toggle('hidden', hidden));
}




// 影のずらし・ぼかし・濃さはドロップシャドウを選んでいるときだけ効くため、それ以外では隠す。
function updateShadowRowsVisibility(root, effect)
{
	const hidden = (effect !== 'shadow');
	root.querySelectorAll('.shadow-row').forEach((row) => row.classList.toggle('hidden', hidden));
}




// くり抜き配下の各行は、効くときだけ下に開く。半径と軌跡の入切はくり抜きが有効なときに、軌跡の時間と太さはさらに軌跡を残す設定が入っているときに見せる。
function updateMaskRowVisibility(maskOn, trailOn)
{
	maskRadiusRowEl.classList.toggle('hidden', !maskOn);
	cursorTrailRowEl.classList.toggle('hidden', !maskOn);

	trailDurationRowEl.classList.toggle('hidden', !(maskOn && trailOn));
}




// 軌跡の寿命を「3.0秒」のような表示へ整える。単位は言語ごとの文言から引く。
function formatTrailDuration(ms)
{
	return t('global.trailDuration.unit', { n: (ms / 1000).toFixed(1) });
}




// スライダーの値とその右のラベルを、つまみ操作中だけ更新する。保存は離した時点 (change) で行う。
function wireSlider(root, inputSelector, valueSelector, format, toValue, index, key)
{
	const input = root.querySelector(inputSelector);
	const valueEl = root.querySelector(valueSelector);

	input.addEventListener('input', () =>
	{
		valueEl.textContent = format(Number(input.value));
	});

	input.addEventListener('change', () =>
	{
		sendLayer(index, { [key]: toValue(Number(input.value)) });
	});
}




// レイヤー1枚ぶんの操作ハンドラを、その断片の中の要素へ結びつける。添字は閉じ込めて、どのレイヤーへの変更かを取り違えないようにする。
function wireLayer(root, index)
{
	root.querySelector('.choose-dir').addEventListener('click', async () =>
	{
		const dir = await window.maegamiSettings.chooseDirectory(index);

		if (dir)
		{
			root.querySelector('.media-dir').textContent = dir;
		}
	});

	root.querySelector('.shuffle').addEventListener('change', (event) =>
	{
		sendLayer(index, { shuffle: event.target.checked });
	});

	root.querySelector('.video-play-full').addEventListener('change', (event) =>
	{
		sendLayer(index, { videoPlayFull: event.target.checked });
	});

	root.querySelector('.cursor-avoid').addEventListener('change', (event) =>
	{
		sendLayer(index, { cursorAvoid: event.target.checked });
	});

	for (const button of root.querySelectorAll('.display-mode button'))
	{
		button.addEventListener('click', () =>
		{
			updateSizeRowsVisibility(root, button.dataset.value);
			updateDriftRowVisibility(root, button.dataset.value);
			updateDisplayModeDesc(root, button.dataset.value);
			updateSizeDesc(root, button.dataset.value);
			sendLayer(index, { displayMode: button.dataset.value });
		});
	}

	wireSlider(root, '.size-percent', '.size-percent-value', (v) => v + '%', (v) => v, index, 'sizePercent');
	wireSlider(root, '.corner-percent', '.corner-percent-value', (v) => v + '%', (v) => v, index, 'cornerPercent');
	wireSlider(root, '.shadow-x', '.shadow-x-value', (v) => v + 'px', (v) => v, index, 'shadowX');
	wireSlider(root, '.shadow-y', '.shadow-y-value', (v) => v + 'px', (v) => v, index, 'shadowY');
	wireSlider(root, '.shadow-blur', '.shadow-blur-value', (v) => v + 'px', (v) => v, index, 'shadowBlur');
	wireSlider(root, '.shadow-opacity', '.shadow-opacity-value', (v) => v + '%', (v) => v, index, 'shadowOpacity');
	wireSlider(root, '.display-duration', '.display-duration-value', (v) => formatSeconds(v * 1000), (v) => v * 1000, index, 'displayDuration');
	wireSlider(root, '.fade-duration', '.fade-duration-value', (v) => formatSeconds(v * 1000), (v) => Math.round(v * 1000), index, 'fadeDuration');
	wireSlider(root, '.gap-duration', '.gap-duration-value', (v) => formatSeconds(v * 1000), (v) => Math.round(v * 1000), index, 'gapDuration');

	root.querySelector('.remove-layer').addEventListener('click', () =>
	{
		window.maegamiSettings.removeLayer(index);
	});
}




// 指定枚数のレイヤーのサイドバー項目とセクションを作り直す。種類・エフェクトのドロップダウンと操作ハンドラもここで結びつけ、UI参照を覚えておく。
function buildLayers(count)
{
	layerNav.innerHTML = '';
	layerSections.innerHTML = '';
	layerUI = [];

	for (let i = 0; i < count; i++)
	{
		const navItem = document.createElement('button');
		navItem.className = 'nav-item';
		navItem.dataset.target = 'section-layer-' + i;

		// レイヤーのグリフを項目名の左へ添える。textContent では丸ごと置き換わるため、アイコンと文字を別々のノードで組む。
		const navIcon = document.createElement('span');
		navIcon.className = 'ico';
		navIcon.setAttribute('aria-hidden', 'true');
		navIcon.textContent = String.fromCharCode(0xE003);
		navItem.appendChild(navIcon);
		navItem.appendChild(document.createTextNode(t('layer.navItem', { n: i + 1 })));

		layerNav.appendChild(navItem);

		const fragment = layerTemplate.content.cloneNode(true);
		const section = fragment.querySelector('.section');
		section.id = 'section-layer-' + i;

		// テンプレート内の静的な文言を現在の言語へ訳す。レイヤー番号を含む見出しはこの後に個別に入れる。
		translateDom(section);
		section.querySelector('.layer-title').textContent = t('layer.title', { n: i + 1 });

		// メディアの種類のヒントは対応形式のプレースホルダを含むため、translateDom とは別に差し込む。
		section.querySelector('.media-kind-desc').textContent = t('layer.mediaKind.desc', { formats: mediaFormats });

		// 最後の1枚は削除させない。削除セクション (空の見出しと削除カード) を隠して最低1枚を保つ。
		const hideRemove = count <= 1;
		section.querySelector('.layer-remove-title').classList.toggle('hidden', hideRemove);
		section.querySelector('.layer-remove-card').classList.toggle('hidden', hideRemove);

		const mediaKindDropdown = setupDropdown(section.querySelector('.media-kind'), (value) => sendLayer(i, { mediaKind: value }));
		const driftDirectionDropdown = setupDropdown(section.querySelector('.drift-direction'), (value) => sendLayer(i, { driftDirection: value }));
		const displayEffectDropdown = setupDropdown(section.querySelector('.display-effect'), (value) =>
		{
			updateShadowRowsVisibility(section, value);
			sendLayer(i, { displayEffect: value });
		});

		wireLayer(section, i);
		layerSections.appendChild(section);

		layerUI.push({ root: section, mediaKindDropdown, driftDirectionDropdown, displayEffectDropdown });
	}
}




// スライダーの値とラベルを、状態反映として書き込む。操作イベントは起きないため送信は伴わない。
function setSlider(root, inputSelector, valueSelector, value, format)
{
	root.querySelector(inputSelector).value = value;
	root.querySelector(valueSelector).textContent = format(Number(value));
}




// 指定したレイヤーの各コントロールへ、受け取った設定値を書き込む。
function refreshLayer(index, layer)
{
	const ui = layerUI[index];
	const root = ui.root;

	root.querySelector('.media-dir').textContent = layer.mediaDir || t('layer.folder.noFolder');
	ui.mediaKindDropdown.setValue(layer.mediaKind || 'both');
	root.querySelector('.shuffle').checked = !!layer.shuffle;

	for (const button of root.querySelectorAll('.display-mode button'))
	{
		button.classList.toggle('active', button.dataset.value === layer.displayMode);
	}

	setSlider(root, '.size-percent', '.size-percent-value', layer.sizePercent, (v) => v + '%');
	setSlider(root, '.corner-percent', '.corner-percent-value', layer.cornerPercent, (v) => v + '%');
	ui.driftDirectionDropdown.setValue(layer.driftDirection || 'none');
	root.querySelector('.cursor-avoid').checked = !!layer.cursorAvoid;
	updateSizeRowsVisibility(root, layer.displayMode);
	updateDriftRowVisibility(root, layer.displayMode);
	updateDisplayModeDesc(root, layer.displayMode);
	updateSizeDesc(root, layer.displayMode);

	ui.displayEffectDropdown.setValue(layer.displayEffect || 'none');
	setSlider(root, '.shadow-x', '.shadow-x-value', layer.shadowX, (v) => v + 'px');
	setSlider(root, '.shadow-y', '.shadow-y-value', layer.shadowY, (v) => v + 'px');
	setSlider(root, '.shadow-blur', '.shadow-blur-value', layer.shadowBlur, (v) => v + 'px');
	setSlider(root, '.shadow-opacity', '.shadow-opacity-value', layer.shadowOpacity, (v) => v + '%');
	updateShadowRowsVisibility(root, layer.displayEffect);

	setSlider(root, '.display-duration', '.display-duration-value', Math.round(layer.displayDuration / 1000), (v) => formatSeconds(v * 1000));
	root.querySelector('.video-play-full').checked = !!layer.videoPlayFull;
	setSlider(root, '.fade-duration', '.fade-duration-value', (layer.fadeDuration / 1000).toFixed(1), (v) => formatSeconds(v * 1000));
	setSlider(root, '.gap-duration', '.gap-duration-value', (layer.gapDuration / 1000).toFixed(1), (v) => formatSeconds(v * 1000));
}




// 受け取った設定値で全コントロールの表示を更新する。レイヤーの数が変わったときだけUIを作り直し、追加時はその新しいレイヤーへ切り替える。
function renderState(s)
{
	if (s.layers.length !== builtCount)
	{
		const added = builtCount >= 0 && s.layers.length > builtCount;
		buildLayers(s.layers.length);
		builtCount = s.layers.length;

		if (added)
		{
			activeTarget = 'section-layer-' + (s.layers.length - 1);
		}

		switchSection(activeTarget);
	}

	applyingState = true;

	opacityEl.value = Math.round(s.opacity * 100);
	opacityValueEl.textContent = Math.round(s.opacity * 100) + '%';

	cursorMaskEl.checked = !!s.cursorMask;
	maskRadiusEl.value = s.maskRadius;
	maskRadiusValueEl.textContent = s.maskRadius + 'px';
	cursorTrailEl.checked = !!s.cursorTrail;
	trailDurationEl.value = s.trailDuration;
	trailDurationValueEl.textContent = formatTrailDuration(s.trailDuration);
	updateMaskRowVisibility(!!s.cursorMask, !!s.cursorTrail);

	languageDropdown.setValue(s.language || 'system');

	s.layers.forEach((layer, i) => refreshLayer(i, layer));

	addLayerBtn.classList.toggle('hidden', s.layers.length >= maxLayers);

	applyingState = false;
}




// 全体設定のコントロールと、サイドバーの切り替え・レイヤー追加へ操作ハンドラを結びつける。レイヤーの項目は作り直されるため、サイドバーへの委譲で受ける。
function wireEvents()
{
	sidebar.addEventListener('click', (event) =>
	{
		const item = event.target.closest('.nav-item');

		if (item && item.dataset.target)
		{
			switchSection(item.dataset.target);
		}
	});

	addLayerBtn.addEventListener('click', () => window.maegamiSettings.addLayer());

	opacityEl.addEventListener('input', () =>
	{
		opacityValueEl.textContent = opacityEl.value + '%';
	});
	opacityEl.addEventListener('change', () => send({ opacity: Number(opacityEl.value) / 100 }));

	cursorMaskEl.addEventListener('change', () =>
	{
		updateMaskRowVisibility(cursorMaskEl.checked, cursorTrailEl.checked);
		send({ cursorMask: cursorMaskEl.checked });
	});

	maskRadiusEl.addEventListener('input', () =>
	{
		maskRadiusValueEl.textContent = maskRadiusEl.value + 'px';
	});
	maskRadiusEl.addEventListener('change', () => send({ maskRadius: Number(maskRadiusEl.value) }));

	cursorTrailEl.addEventListener('change', () =>
	{
		updateMaskRowVisibility(cursorMaskEl.checked, cursorTrailEl.checked);
		send({ cursorTrail: cursorTrailEl.checked });
	});

	trailDurationEl.addEventListener('input', () =>
	{
		trailDurationValueEl.textContent = formatTrailDuration(Number(trailDurationEl.value));
	});
	trailDurationEl.addEventListener('change', () => send({ trailDuration: Number(trailDurationEl.value) }));
}




async function init()
{
	// 文書の言語を現在の表示言語に合わせ、固定文言のタイトルと静的要素を訳す。
	document.documentElement.lang = window.maegamiI18n.locale;
	document.title = t('settings.windowTitle');
	translateDom(document);

	// 全体セクションの言語選択を組み立て、選択時にメインプロセスへ通知する。言語を変えるとメイン側が両ウィンドウを再読み込みして反映する。
	languageDropdown = setupDropdown(document.querySelector('.dropdown.language'), (value) => send({ language: value }));

	const s = await window.maegamiSettings.get();
	renderState(s);
	wireEvents();

	// サイドバー末尾の版数表示を本体から取り寄せて埋める。
	const version = await window.maegamiSettings.getVersion();
	document.getElementById('app-version').textContent = t('settings.version', { version });

	// トレイなど外部からの変更にも追従させる。
	window.maegamiSettings.onChange((updated) => renderState(updated));
}

init();
