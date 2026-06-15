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

const stage = document.getElementById('stage');
const layersRoot = document.getElementById('layers');
const message = document.getElementById('message');

// 画面に浮かぶ案内へ冠するアプリ名。デスクトップ上では他のウィンドウと見分けがつかないため、どの案内も発信元が分かるようにこの名前を付ける。
const APP_LABEL = '前紙';

// 全体設定 (不透明度・くり抜き・一時停止)。不透明度はウィンドウ側で掛かるため、描画側ではくり抜きと一時停止の判断に使う。
let global = null;

// 各レイヤーの再生エンジン。配列の順序がそのまま重ね順 (奥行き) になり、添字が大きいほど手前に描く。
const engines = [];

// カーソル追従のくり抜きが現在開いているか。画面外から戻ってきた瞬間に穴を遠くから滑らせないため、開閉の状態を覚えておく。
let cursorOpen = false;

// メインプロセスから届く最新のカーソル位置 (ステージ座標)。ランダム配置のとき出現位置をカーソルからやんわり遠ざけるために使う。画面外にいる間や未受信の間は null。
let lastCursor = null;

// ランダム配置でカーソルを避ける余裕 (px)。出現する画像の矩形がこの距離より内側にカーソルが入るほど候補を減点する。これより離れていれば減点はなく、配置のランダム性をそのまま保つ。
const CURSOR_AVOID_MARGIN = 140;




// 配列をその場でシャッフルする (Fisher-Yates)。
function shuffleInPlace(array)
{
	for (let i = array.length - 1; i > 0; i--)
	{
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = array[i];
		array[i] = array[j];
		array[j] = tmp;
	}

	return array;
}




// レイヤー1枚ぶんの再生エンジンを作る。状態だけを持つ素のオブジェクトで、操作は engine を受け取る各関数が行う。container は自分のメディア要素を入れる専用の入れ物で、重ね順を一定に保つために使う。
function makeEngine(container)
{
	return {
		container,
		config: null,
		media: [],
		playlist: [],
		index: 0,
		currentElement: null,
		timers: [],
		signature: null,
		running: false
	};
}




function clearTimers(engine)
{
	while (engine.timers.length > 0)
	{
		clearTimeout(engine.timers.pop());
	}
}




function later(engine, fn, ms)
{
	const id = setTimeout(fn, ms);
	engine.timers.push(id);
	return id;
}




// 表示中の要素を破棄する。
function removeCurrent(engine)
{
	if (engine.currentElement)
	{
		engine.currentElement.remove();
		engine.currentElement = null;
	}
}




function showMessage(text)
{
	message.textContent = '【' + APP_LABEL + '】' + text;
	message.classList.remove('hidden');
}




function hideMessage()
{
	message.classList.add('hidden');
}




// メディア要素 (img または video) を生成する。
function createMediaElement(engine, item)
{
	let el;

	if (item.type === 'video')
	{
		el = document.createElement('video');
		el.src = item.url;
		el.muted = true;
		el.loop = true;
		el.autoplay = true;
		el.playsInline = true;
	}
	else
	{
		el = document.createElement('img');
		el.src = item.url;
	}

	el.className = 'media';

	// 縁ぼかし・ドロップシャドウのエフェクトは表示モードに依らず効かせるため、ここで付与する。
	applyEffect(engine, el);

	const fade = engine.config ? engine.config.fadeDuration : 1500;
	el.style.setProperty('--fade', fade + 'ms');

	return el;
}




// メディアの実寸が分かる状態になったらコールバックを呼ぶ。既に読み込み済みなら即座に呼ぶ。
function whenReady(el, item, callback)
{
	if (item.type === 'video')
	{
		if (el.readyState >= 1)
		{
			callback();
		}
		else
		{
			el.addEventListener('loadedmetadata', callback, { once: true });
			el.addEventListener('error', callback, { once: true });
		}
	}
	else
	{
		if (el.complete && el.naturalWidth > 0)
		{
			callback();
		}
		else
		{
			el.addEventListener('load', callback, { once: true });
			el.addEventListener('error', callback, { once: true });
		}
	}
}




// エフェクト (縁ぼかし・ドロップシャドウ) をレイヤーの設定に合わせて付け替える。再生中に切り替えても今の一枚へ反映できるよう、付与済みの指定を一度外してから当て直す。ドロップシャドウはレイヤーごとにずらし量・ぼかし・濃さが異なるため、クラスではなくインラインの filter で当てる。
function applyEffect(engine, el)
{
	const config = engine.config;

	el.classList.remove('feather');
	el.style.removeProperty('filter');

	if (!config || !config.displayEffect || config.displayEffect === 'none')
	{
		return;
	}

	if (config.displayEffect === 'feather')
	{
		el.classList.add('feather');
	}
	else if (config.displayEffect === 'shadow')
	{
		const opacity = Math.min(Math.max(config.shadowOpacity, 0), 100) / 100;
		el.style.filter = 'drop-shadow(' + config.shadowX + 'px ' + config.shadowY + 'px ' + config.shadowBlur + 'px rgba(0, 0, 0, ' + opacity + '))';
	}
}




// 2つの矩形がどれだけ離れているか。正なら離れていてその間隔、負なら重なっていて0に近いほど重なりが浅い。ランダム配置の候補を比べる物差しに使う。
function rectSeparation(a, b)
{
	const gapX = Math.max(a.left - (b.left + b.width), b.left - (a.left + a.width));
	const gapY = Math.max(a.top - (b.top + b.height), b.top - (a.top + a.height));

	if (gapX >= 0 || gapY >= 0)
	{
		return Math.hypot(Math.max(gapX, 0), Math.max(gapY, 0));
	}

	return Math.max(gapX, gapY);
}




// 自分以外のレイヤーで今表示している要素の、画面上の矩形を集める。ランダム配置の重なり回避に使う。画面全体を覆うレイヤーは避けようがないため除き、位置がまだ決まっていない要素も除く。
function collectOtherRects(self)
{
	const rects = [];

	for (const engine of engines)
	{
		if (engine === self || !engine.currentElement)
		{
			continue;
		}

		if (engine.config && engine.config.displayMode === 'cover')
		{
			continue;
		}

		const el = engine.currentElement;
		const left = parseFloat(el.style.left);
		const top = parseFloat(el.style.top);
		const width = parseFloat(el.style.width);
		const height = parseFloat(el.style.height);

		if (isFinite(left) && isFinite(top) && isFinite(width) && isFinite(height))
		{
			rects.push({ left, top, width, height });
		}
	}

	return rects;
}




// 候補矩形にカーソルがどれだけ被っているかを減点値にする。矩形からカーソルまでの距離が余裕 (margin) より遠ければ 0、近づくほど大きくなり、矩形の内側へ入るとさらに増える。重なりを厳密に禁じず、近い候補ほど選ばれにくくするだけのやんわりした回避に使う。
function cursorPenalty(rect, cursor, margin)
{
	if (!cursor)
	{
		return 0;
	}

	// カーソルを大きさ0の矩形とみなし、候補矩形との隔たりを測る。正なら外側でその距離、負なら内側でその食い込みの深さ。
	const sep = rectSeparation(rect, { left: cursor.x, top: cursor.y, width: 0, height: 0 });

	if (sep >= margin)
	{
		return 0;
	}

	return margin - sep;
}




// ランダム配置の位置の係数 (rx, ry) を決める。候補をいくつか抽選し、他レイヤーの表示物から離れていてカーソルに被らない候補を好む。重なりを厳密に禁じるのではなく良い候補を選ぶだけのやんわりした回避で、避ける相手が何も無ければ単純に1点を返す。
function pickRandomPosition(self, width, height, stageW, stageH)
{
	const others = collectOtherRects(self);

	if (others.length === 0 && !lastCursor)
	{
		return { rx: Math.random(), ry: Math.random() };
	}

	const candidateCount = 8;
	let best = null;
	let bestScore = -Infinity;

	for (let i = 0; i < candidateCount; i++)
	{
		const rx = Math.random();
		const ry = Math.random();
		const rect = { left: rx * (stageW - width), top: ry * (stageH - height), width, height };

		// 他レイヤーからの最小の隔たりを土台の点とし、カーソルへの被りを減点する。他レイヤーが無ければ土台は0とし、カーソル回避だけで甲乙を付ける。
		let separation = Infinity;

		for (const other of others)
		{
			separation = Math.min(separation, rectSeparation(rect, other));
		}

		const base = (others.length > 0) ? separation : 0;
		const score = base - cursorPenalty(rect, lastCursor, CURSOR_AVOID_MARGIN);

		if (score > bestScore)
		{
			bestScore = score;
			best = { rx, ry };
		}
	}

	return best;
}




// 表示方法に応じてメディアの大きさと位置を決める。サイズ指定は実寸を測った上でデスクトップの面積に対する割合として扱う。
function applyLayout(engine, el)
{
	const config = engine.config;

	if (!config)
	{
		return;
	}

	// 同じ要素を再レイアウトする場合に備え、前回の指定を消してから決め直す。表示方法を切り替えた際に cover クラスとインライン寸法が食い違うのを防ぐ。
	el.classList.remove('cover');
	el.style.removeProperty('width');
	el.style.removeProperty('height');
	el.style.removeProperty('left');
	el.style.removeProperty('top');
	el.style.removeProperty('border-radius');

	if (config.displayMode === 'cover')
	{
		el.classList.add('cover');
		return;
	}

	const isVideo = (el.tagName === 'VIDEO');
	const natW = isVideo ? el.videoWidth : el.naturalWidth;
	const natH = isVideo ? el.videoHeight : el.naturalHeight;

	// 実寸が得られない場合は既定の全画面フィット表示のままにする。
	if (!natW || !natH)
	{
		return;
	}

	const stageW = stage.clientWidth;
	const stageH = stage.clientHeight;
	const ratio = Math.min(Math.max(config.sizePercent, 2), 100) / 100;

	let width;
	let height;
	let left;
	let top;

	if (config.displayMode === 'random')
	{
		// 画像そのものの面積をデスクトップ面積の指定割合にする。収める設定ではないため、画面より大きくなれば端は切れる。
		const scale = Math.sqrt(ratio * stageW * stageH / (natW * natH));
		width = natW * scale;
		height = natH * scale;

		// 同じ要素を再レイアウトしても配置が飛ばないよう、ランダムな位置の係数は初回に決めて要素へ覚えさせ、以後は再利用する。はみ出す場合は左・上が負になり、画面に対してランダムな位置で切り取られる。
		let rx = parseFloat(el.dataset.rx);
		let ry = parseFloat(el.dataset.ry);

		if (!isFinite(rx) || !isFinite(ry))
		{
			const pos = pickRandomPosition(engine, width, height, stageW, stageH);
			rx = pos.rx;
			ry = pos.ry;
			el.dataset.rx = rx;
			el.dataset.ry = ry;
		}

		left = rx * (stageW - width);
		top = ry * (stageH - height);
	}
	else
	{
		// 画面と同じ縦横比の箱がデスクトップ面積の指定割合を占めるようにし、その箱へ画像を収めて中央に置く。
		const fitScale = Math.min(stageW / natW, stageH / natH);
		const boxScale = Math.sqrt(ratio);
		width = natW * fitScale * boxScale;
		height = natH * fitScale * boxScale;

		left = (stageW - width) / 2;
		top = (stageH - height) / 2;
	}

	el.style.width = width + 'px';
	el.style.height = height + 'px';
	el.style.left = left + 'px';
	el.style.top = top + 'px';

	// 角丸の半径はデスクトップの短辺を基準に決め、表示サイズに依らず画面上の物理的な丸み具合を揃える。表示中の画像の短辺の半分を上限にクランプし、小さく表示された画像が半円状に潰れるのを防ぐ。
	const cornerRatio = Math.min(Math.max(config.cornerPercent || 0, 0), 5) / 100;
	const radius = Math.min(Math.min(stageW, stageH) * cornerRatio, Math.min(width, height) / 2);
	el.style.borderRadius = radius + 'px';
}




// このレイヤーのメディアを1枚表示し、フェードイン → 滞留 → フェードアウト → 次へ、を繰り返す。プレイリストが空のレイヤーは何も描かずに止まる。
function showNext(engine)
{
	clearTimers(engine);
	removeCurrent(engine);

	const config = engine.config;

	if (!config || engine.playlist.length === 0)
	{
		engine.running = false;
		return;
	}

	if (engine.index >= engine.playlist.length)
	{
		engine.index = 0;

		if (config.shuffle)
		{
			shuffleInPlace(engine.playlist);
		}
	}

	const item = engine.playlist[engine.index];
	const el = createMediaElement(engine, item);
	engine.currentElement = el;
	engine.container.appendChild(el);

	const fade = config.fadeDuration;
	const hold = config.displayDuration;
	const gap = config.gapDuration;

	// 実寸が分かってから大きさ・位置を確定し、それからフェードインさせる。先に表示すると寸法が一瞬ずれて見えるため。
	whenReady(el, item, () =>
	{
		// 待っている間に次の表示へ切り替わっていたら何もしない。
		if (el !== engine.currentElement)
		{
			return;
		}

		applyLayout(engine, el);

		if (item.type === 'video')
		{
			el.play().catch(() => {});
		}

		// 追加直後に可視クラスを付けてフェードインさせる。
		requestAnimationFrame(() =>
		{
			requestAnimationFrame(() => el.classList.add('visible'));
		});

		// フェードアウトを始め、その完了 + 間隔の後に次のメディアへ進む。
		const startFadeOut = () =>
		{
			el.classList.remove('visible');

			later(engine, () =>
			{
				engine.index++;
				showNext(engine);
			}, fade + gap);
		};

		// 動画の総尺 (秒) をミリ秒に直す。途切れない実数が取れた場合のみ採用する。
		const videoMs = (item.type === 'video' && isFinite(el.duration)) ? el.duration * 1000 : 0;

		// 表示間隔より長い動画は、一度の再生が終わるまで切り替えずに待つ設定。表示間隔のほうが長い場合は通常の滞留時間で切り替える。
		if (config.videoPlayFull && videoMs > hold && !el.error)
		{
			// ループを切って一度きりの再生にし、終端でフェードアウトへ移る。再生失敗時に止まらないよう error でも進める。
			el.loop = false;
			el.addEventListener('ended', () =>
			{
				if (el === engine.currentElement)
				{
					startFadeOut();
				}
			}, { once: true });
			el.addEventListener('error', () =>
			{
				if (el === engine.currentElement)
				{
					startFadeOut();
				}
			}, { once: true });
		}
		else
		{
			// フェードイン完了 + 滞留時間の後にフェードアウトを始める。
			later(engine, startFadeOut, fade + hold);
		}
	});
}




// メディアと再生周期から、再生をやり直すべきかの判断材料になる識別子を作る。大きさ・エフェクト・影など表示だけの変更ではこの識別子は変わらず、再生を途切れさせない。
function signatureOf(config, media)
{
	return JSON.stringify([
		config.mediaDir,
		config.mediaKind,
		config.shuffle,
		config.displayDuration,
		config.fadeDuration,
		config.gapDuration,
		config.videoPlayFull,
		media.map((item) => item.url)
	]);
}




// レイヤーの再生を最初から始める。プレイリストを組み直し、添字を戻して1枚目から回す。レイヤーごとに開始を僅かにずらし、複数レイヤーが同時に切り替わって揃わないようにする。
function startEngine(engine, config, media)
{
	stopEngine(engine);

	engine.config = config;
	engine.media = media;
	engine.playlist = media.slice();
	engine.index = 0;

	if (config.shuffle)
	{
		shuffleInPlace(engine.playlist);
	}

	engine.running = true;
	later(engine, () => showNext(engine), Math.floor(Math.random() * 500));
}




function stopEngine(engine)
{
	clearTimers(engine);
	removeCurrent(engine);
	engine.running = false;
}




// 表示設定 (大きさ・エフェクト・影など) を再生中の一枚へその場で当てる。プレイリストや再生位置は触らない。
function applyEngineDisplay(engine, config)
{
	engine.config = config;

	if (engine.currentElement)
	{
		applyEffect(engine, engine.currentElement);
		applyLayout(engine, engine.currentElement);
	}
}




// 新しい設定とメディアでレイヤーを更新する。メディアや再生周期が変わったとき、または止まっているときだけ再生をやり直し、表示だけの変更なら今の一枚へその場で当てて再生を途切れさせない。
function updateEngine(engine, config, media)
{
	const signature = signatureOf(config, media);

	if (signature !== engine.signature || !engine.running)
	{
		engine.signature = signature;
		startEngine(engine, config, media);
	}
	else
	{
		applyEngineDisplay(engine, config);
	}
}




// エンジンの数を指定枚数へ合わせる。足りなければ専用コンテナごと作り、多ければ末尾から止めて取り除く。コンテナの並び順が重ね順になる。
function reconcileEngineCount(count)
{
	while (engines.length < count)
	{
		const container = document.createElement('div');
		container.className = 'layer';
		layersRoot.appendChild(container);
		engines.push(makeEngine(container));
	}

	while (engines.length > count)
	{
		const engine = engines.pop();
		stopEngine(engine);
		engine.container.remove();
	}
}




// 全体設定と全レイヤーを受け取り、表示を組み直す。一時停止中や、どのレイヤーにもメディアが無い場合は案内を出して止める。
function applyState(state)
{
	global = state.global;

	applyCursorMask(global.cursorMask);
	reconcileEngineCount(state.layers.length);

	if (global.paused)
	{
		// 集中したいときに一時停止する想定のため、デスクトップ上には何も出さずに表示だけを止める。再開予定の時刻はトレイメニューで確認できる。
		engines.forEach(stopEngine);
		hideMessage();
		return;
	}

	const anyFolder = state.layers.some((layer) => layer.config.mediaDir);

	if (!anyFolder)
	{
		engines.forEach(stopEngine);
		showMessage('フォルダ未選択 — 設定の各レイヤーで画像・動画フォルダを選んでください');
		return;
	}

	const anyMedia = state.layers.some((layer) => layer.media && layer.media.length > 0);

	if (!anyMedia)
	{
		engines.forEach(stopEngine);
		showMessage('表示できる画像・動画が見つかりませんでした');
		return;
	}

	hideMessage();

	state.layers.forEach((layer, i) =>
	{
		updateEngine(engines[i], layer.config, layer.media);
	});
}




// 表示設定の変更を、再生を止めず各レイヤーの現在表示中の一枚へその場で当てる。メディアは触らない。
function applyDisplaySettings(state)
{
	global = state.global;

	applyCursorMask(global.cursorMask);
	reconcileEngineCount(state.layers.length);

	state.layers.forEach((layer, i) =>
	{
		if (engines[i])
		{
			applyEngineDisplay(engines[i], layer.config);
		}
	});
}




// カーソル追従のくり抜きの入切と半径を反映する。切られている場合は穴も閉じておく。
function applyCursorMask(enabled)
{
	stage.classList.toggle('masking', !!enabled);

	// 設定の半径を縁の半径とし、穴の半径は承認済みの見た目 (90 / 160) と同じ比率で決める。これでぼかしの幅が大きさに応じて保たれる。開いたままスライダーで動かせば、--hole / --edge のトランジションで滑らかに大きさが変わる。
	const edge = (global && global.maskRadius) ? global.maskRadius : 160;
	const hole = Math.round(edge * 0.5625);
	stage.style.setProperty('--edge-open', edge + 'px');
	stage.style.setProperty('--hole-open', hole + 'px');

	if (!enabled)
	{
		stage.classList.remove('cursor-open');
		cursorOpen = false;
	}
}




// メインプロセスから届くカーソル位置でマスクの穴を動かす。画面内にいる間だけ穴を開け、画面外から入ってきた瞬間はトランジションを切って位置を合わせる。
function moveCursorMask(pos)
{
	if (!stage.classList.contains('masking'))
	{
		return;
	}

	const lit = !!pos.inside;

	if (lit && !cursorOpen)
	{
		// 画面外から入ってきた瞬間は穴を遠くから滑らせず、その場へ即座に合わせてから開く。
		stage.classList.add('cursor-snap');
		stage.style.setProperty('--mx', pos.x + 'px');
		stage.style.setProperty('--my', pos.y + 'px');
		void stage.offsetWidth;
		stage.classList.remove('cursor-snap');
	}
	else if (lit)
	{
		stage.style.setProperty('--mx', pos.x + 'px');
		stage.style.setProperty('--my', pos.y + 'px');
	}

	cursorOpen = lit;
	stage.classList.toggle('cursor-open', lit);
}




window.maegami.onState((state) =>
{
	applyState(state);
});

window.maegami.onDisplay((state) =>
{
	applyDisplaySettings(state);
});

window.maegami.onCursor((pos) =>
{
	// 画面内にいる間だけ覚える。画面外へ出たら回避の必要が無いので忘れる。
	lastCursor = pos.inside ? { x: pos.x, y: pos.y } : null;
	moveCursorMask(pos);
});

window.maegami.requestState();
