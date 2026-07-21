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

const columnsRoot = document.getElementById('columns');
const emptyEl = document.getElementById('empty');

// 動画タイルの可視・不可視を見張るための器。縦スクロールするこの領域を基準に、画面へ入った動画だけをコマ送りする。
const galleryRoot = document.getElementById('gallery');

// preload から渡された翻訳関数。キーを現在の言語の文言へ変換する。
const t = window.maegamiI18n.t;

// 表示履歴。新しいものが先頭。メインプロセスから初期一覧を受け取り、以後は追記通知で先頭へ足す。
let entries = [];

// 各履歴に対応するタイル要素。entries と同じ順で持つ。並べ直しでは作り直さず、この要素をカラム間で移すだけにして、読み込み済みの画像を生かす。
let tiles = [];

// いまのカラム数。リサイズでこの数が変わったときだけカラムを組み直す。
let columnCount = 0;

// カラムとタイルの間隔 (px)。CSS の gap と同じ値で、敷き詰めの高さ見積もりに使う。
const COLUMN_GAP = 12;

// 3列にする最小のコンテナ幅 (px)。これより狭ければ2列にする。
const THREE_COLUMNS_MIN_WIDTH = 680;

// 履歴の保持件数の上限。メインプロセス側の上限と合わせ、追記で超えた分は末尾 (最も古いもの) から捨てる。
const HISTORY_LIMIT = 200;

// リサイズのたびの並べ直しを1フレームへまとめる予約フラグ。
let relayoutQueued = false;

// コマ送りの目標フレームレート (fps)。可視の動画を連続再生させず、この速さで手送りすることでデコードするコマ数を抑える。
const STEP_FPS = 5;

// 1コマで進める秒数と、コマ送りの間隔 (ms)。STEP_FPS から導く。
const STEP_SECONDS = 1 / STEP_FPS;
const STEP_INTERVAL_MS = 1000 / STEP_FPS;

// いま画面に入っている動画。コマ送りの対象。下の監視役が可視状態に応じて出し入れする。
const visibleVideos = new Set();

// コマ送りループが回っている動画。前のシーク完了を待って次のコマへ進む方式のため、同じ動画を二重に回さないための見張りに使う。
const steppingVideos = new Set();

// いまマウスが乗っている動画。ホバー中の1本だけは普通に再生させ、コマ送りは手を出さない。
const hoveredVideos = new Set();

// 動画タイルの可視・不可視を見張る監視役。画面へ入った動画をコマ送りの対象へ加えてループを起こし、出たら対象から外す。しきい値0で、端がわずかでも見えれば可視とみなす。
const videoVisibility = new IntersectionObserver((observed) =>
{
	for (const item of observed)
	{
		if (item.isIntersecting)
		{
			visibleVideos.add(item.target);
			startStepping(item.target);
		}
		else
		{
			visibleVideos.delete(item.target);
		}
	}
}, { root: galleryRoot, threshold: 0 });




// 動画のコマ送りループを起こす。既に回っていれば二重に回さない。以後は seeked イベントが次のコマへ繋いでいく。
function startStepping(video)
{
	if (!steppingVideos.has(video))
	{
		steppingVideos.add(video);
		stepOnce(video);
	}
}




// 動画を1コマ進める。currentTime を動かすとシークが走り、完了すると seeked が発火する。尺がまだ分からなければ、間を置いてから試し直す。
function stepOnce(video)
{
	// ホバー中はフル再生に任せるため、コマ送りは手を出さずに抜ける。mouseleave 側がループを起こし直す。
	if (hoveredVideos.has(video))
	{
		return;
	}

	const duration = video.duration;

	// 尺が分からないうち (メタデータ未読込・読み込み失敗) は、間を置いてから改めて試す。
	if (!isFinite(duration) || duration <= 0)
	{
		setTimeout(() => driveNext(video), STEP_INTERVAL_MS);
		return;
	}

	// 末尾を越えたぶんは剰余で先頭側へ回り込ませる。再生していないため loop 属性は効かず、巻き戻しは手で行う。
	video.currentTime = (video.currentTime + STEP_SECONDS) % duration;
}




// 次のコマへ進むか、画面外なら止めるかを決める。止めた動画は見張りから外し、再び見えたら startStepping で入り直せるようにする。
function driveNext(video)
{
	// ホバー中はコマ送りを止めたままにする。ホバーが解ければ mouseleave 側がループを起こし直す。
	if (hoveredVideos.has(video))
	{
		return;
	}

	if (visibleVideos.has(video))
	{
		stepOnce(video);
	}
	else
	{
		steppingVideos.delete(video);
	}
}




// パスからファイル名部分だけを取り出す。Windows・POSIX どちらの区切りにも対応する。
function baseName(p)
{
	const parts = p.split(/[\\/]/);
	return parts[parts.length - 1];
}




// 履歴1件ぶんのタイルを作る。実寸から aspect-ratio を先に当てて高さを予約し、メディアの読み込みを待たずに敷き詰めの形が確定するようにする。
function createTile(entry)
{
	const tile = document.createElement('div');
	tile.className = 'tile';

	let media;

	if (entry.type === 'video')
	{
		// 動画は可視の間だけ低フレームレートでコマ送りする。連続再生はせず currentTime を手で進めることで、デコードするコマ数を抑える。preload=metadata で最初は先頭フレームだけを取り寄せ、コマ送りの対象への出し入れは可視状態に応じて IntersectionObserver が受け持つ。
		media = document.createElement('video');
		media.preload = 'metadata';
		media.muted = true;
		// ホバーでフル再生したときに末尾で繰り返す。コマ送りは再生を伴わないため、この loop が効くのはホバー再生の間だけ。
		media.loop = true;
		media.src = entry.url;
	}
	else
	{
		media = document.createElement('img');
		media.loading = 'lazy';
		media.decoding = 'async';
		media.src = entry.url;
	}

	media.className = 'tile-media';
	media.style.aspectRatio = entry.width + ' / ' + entry.height;
	tile.appendChild(media);

	if (entry.type === 'video')
	{
		const badge = document.createElement('span');
		badge.className = 'badge';
		badge.textContent = '▶';
		tile.appendChild(badge);

		// 可視になったらコマ送りの対象へ加えるため監視に載せる。並べ替えではタイルを作り直さないので、一度載せた監視はそのまま生き続ける。
		videoVisibility.observe(media);

		// 1コマ表示できたら、目標フレームレートぶん間を置いてから次のコマへ進む。前のシーク完了を待つことで、取りこぼしも積み残しも起きない。
		media.addEventListener('seeked', () =>
		{
			setTimeout(() => driveNext(media), STEP_INTERVAL_MS);
		});

		// マウスが乗っている間はコマ送りを止めて普通に再生する。コマ送りで進んでいた位置からそのまま流し、離れたら止めてコマ送りへ戻す。同時にフル再生するのは乗っている1本だけなので、全可視の連続再生より軽い。
		media.addEventListener('mouseenter', () =>
		{
			hoveredVideos.add(media);
			steppingVideos.delete(media);

			// play() は pause() の割り込みなどで拒否されることがあるため握り潰す。
			media.play().catch(() => {});
		});

		media.addEventListener('mouseleave', () =>
		{
			hoveredVideos.delete(media);
			media.pause();

			// まだ画面に入っていればコマ送りを起こし直す。離れた時点で画面外なら、次に見えたとき監視役が起こす。
			if (visibleVideos.has(media))
			{
				startStepping(media);
			}
		});
	}

	// ファイル名と表示時刻をツールチップで示す。
	tile.title = baseName(entry.path) + '\n' + new Date(entry.shownAt).toLocaleString(window.maegamiI18n.locale);

	tile.addEventListener('contextmenu', (event) =>
	{
		event.preventDefault();
		window.maegamiHistory.showMenu(entry.path);
	});

	return tile;
}




// コンテナ幅から使うカラム数を決める。狭ければ2列、広ければ3列。
function desiredColumnCount()
{
	return (columnsRoot.clientWidth >= THREE_COLUMNS_MIN_WIDTH) ? 3 : 2;
}




// 全タイルをカラムへ敷き詰め直す。新しい順に、そのつど最も背の低いカラムへ入れる方式で、縦横比とカラム幅から見込みの高さを積算して背丈を比べる。高さは実測ではなく見込みで足すため、メディアの読み込みを待たずに並びが決まる。
function relayout()
{
	const count = desiredColumnCount();

	if (count !== columnCount)
	{
		columnCount = count;
		columnsRoot.innerHTML = '';

		for (let i = 0; i < count; i++)
		{
			const column = document.createElement('div');
			column.className = 'column';
			columnsRoot.appendChild(column);
		}
	}

	const columns = Array.from(columnsRoot.children);
	const columnWidth = (columnsRoot.clientWidth - COLUMN_GAP * (count - 1)) / count;
	const heights = columns.map(() => 0);

	tiles.forEach((tile, i) =>
	{
		const entry = entries[i];

		// いちばん背の低いカラムを選ぶ。
		let target = 0;

		for (let c = 1; c < columns.length; c++)
		{
			if (heights[c] < heights[target])
			{
				target = c;
			}
		}

		columns[target].appendChild(tile);
		heights[target] += columnWidth * (entry.height / entry.width) + COLUMN_GAP;
	});
}




// 並べ直しを次のフレームへ予約する。リサイズ通知が続けて届いても1回にまとめる。
function queueRelayout()
{
	if (relayoutQueued)
	{
		return;
	}

	relayoutQueued = true;

	requestAnimationFrame(() =>
	{
		relayoutQueued = false;
		relayout();
	});
}




// 履歴が空のときだけ案内を見せる。
function updateEmptyState()
{
	emptyEl.classList.toggle('hidden', entries.length > 0);
}




// 新しく表示された1件を先頭へ足す。上限を超えた分は末尾 (最も古いもの) から捨てる。
function prepend(entry)
{
	entries.unshift(entry);
	tiles.unshift(createTile(entry));

	while (entries.length > HISTORY_LIMIT)
	{
		entries.pop();

		const removed = tiles.pop();
		const video = removed.querySelector('video');

		if (video)
		{
			videoVisibility.unobserve(video);
			visibleVideos.delete(video);
			steppingVideos.delete(video);
			hoveredVideos.delete(video);
		}

		removed.remove();
	}

	updateEmptyState();
	relayout();
}




async function init()
{
	// 文書の言語を現在の表示言語に合わせ、固定文言のタイトルと静的要素を訳す。
	document.documentElement.lang = window.maegamiI18n.locale;
	document.title = t('history.windowTitle');

	for (const el of document.querySelectorAll('[data-i18n]'))
	{
		el.textContent = t(el.dataset.i18n);
	}

	// プラットフォームごとのタイトルバー調整 (macOS の信号機ボタンぶんの余白など) を CSS へ効かせるためのクラスを付ける。
	document.body.classList.add(window.maegamiHistory.platform === 'darwin' ? 'is-mac' : 'is-win');

	entries = await window.maegamiHistory.get();
	tiles = entries.map(createTile);
	updateEmptyState();
	relayout();

	// ウィンドウを開いている間に表示された分も、その場で先頭へ足す。
	window.maegamiHistory.onAppended(prepend);

	// リサイズでカラム数が変わるときだけ並べ直す。幅の微調整のたびに全タイルを差し替えない。
	new ResizeObserver(() =>
	{
		if (desiredColumnCount() !== columnCount)
		{
			queueRelayout();
		}
	}).observe(columnsRoot);
}

init();
