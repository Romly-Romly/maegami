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
const APP_LABEL = window.maegamiI18n.t('app.name');

// 全体設定 (不透明度・くり抜き・一時停止)。不透明度はウィンドウ側で掛かるため、描画側ではくり抜きと一時停止の判断に使う。
let global = null;

// 各レイヤーの再生エンジン。配列の順序がそのまま重ね順 (奥行き) になり、添字が大きいほど手前に描く。
const engines = [];

// カーソル追従のくり抜きの設定。穴・軌跡を Paint Worklet が描き、これらの値が毎フレームの描画に使われる。
let maskEnabled = false;
let trailEnabled = false;

// くり抜きの穴の半径。edge は縁のぼかしが戻りきる外側の半径、hole は完全に開く内側の半径で、両者の差がぼかしの幅になる。
let maskEdge = 160;
let maskHole = 90;

// 軌跡の粒が消えるまでの寿命 (ミリ秒)。粒はのぞき穴と同じ大きさ・形で彫るため、太さは穴の半径 (maskHole / maskEdge) をそのまま使う。
let trailLifeMs = 3000;

// カーソルの目標位置 (受信した生の値) と、毎フレームそこへ滑らかに寄せる現在位置。画面内にいるかどうかも持つ。
let cursorTarget = null;
let cursorSmooth = null;
let cursorInside = false;

// 軌跡の粒。寿命 life は撒いた直後の 1 から 0 (消滅) へ毎フレーム減る。粒ごとに独立した寿命を持つので、古い場所から先にまだらにほどけていく。
let trailParticles = [];

// 軌跡の粒を最後に撒いた位置。ここから現在位置までを線分で補間して一定間隔で粒を足し、素早く動かしても軌跡が途切れないようにする。
let lastSpawn = null;

// マスク描画ループの requestAnimationFrame の識別子と、前フレームの時刻。動くものが無くなれば止め、カーソル移動や設定変更で起こす。
let maskRafId = null;
let maskLastTime = 0;

// メインプロセスから届く最新のカーソル位置 (ステージ座標)。ランダム配置のとき出現位置をカーソルからやんわり遠ざけるために使う。画面外にいる間や未受信の間は null。
let lastCursor = null;

// 軌跡の粒を撒く間隔を、穴の芯 (満幅) の半径に対する割合で決める。狭いほど密に並んで滑らかになるが粒が増える。縁ぼかしではなく芯を基準にすることで、芯と芯が重なって線が均一に削れ、数珠つなぎのムラを防ぐ。
const TRAIL_SPACING_FRACTION = 0.35;

// 軌跡の粒の総数の上限。撒きっぱなしの暴走を防ぐ安全弁で、超えたら古いものから捨てる。
const TRAIL_MAX = 5000;

// 軌跡が満寿命のまま完全な穴で居座る寿命の割合。これを過ぎてからゆっくり薄れ始める。なぞった直後はくっきり開き、しばらく見えてから消えていく。
const TRAIL_HOLD_FRACTION = 0.5;

// カーソル追従の滑らかさの時定数 (ミリ秒)。小さいほど即座に追い、大きいほど遅れて滑らかに追う。粗い取得間隔でも穴がカクつかないようにする。
const CURSOR_SMOOTH_TAU = 60;

// ランダム配置でカーソルを避ける余裕 (px)。出現する画像の矩形がこの距離より内側にカーソルが入るほど候補を減点する。これより離れていれば減点はなく、配置のランダム性をそのまま保つ。
const CURSOR_AVOID_MARGIN = 140;

// ランダム配置のゆっくり移動の距離を、漂う軸方向の表示サイズに対する割合で決める。絵の大小に比例した控えめな移動になる。フェードに重ねて速く進む区間と、表示中にごくゆっくり進む区間で割合を分け、緩急を付ける。
const DRIFT_FAST_FRACTION = 0.06;
const DRIFT_SLOW_FRACTION = 0.04;

// フェード区間の速い側の端の速さ。滞留中の一定速度を1とした正規化の傾きで、出だし(フェードイン)・締め(フェードアウト)をこの倍率まで持ち上げる。
const DRIFT_FAST_SLOPE = 2.2;




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




// ランダム配置の漂い設定から、移動の軸と各区間の到達位置を組み立てる。漂わない設定やランダム配置以外、表示サイズが取れない場合は null を返す。到達位置は始点 (決まった配置位置 = 0) から選んだ向きへ進み続ける一本道で、afterIn → afterHold → afterOut の順に正方向へ増える。フェードが無い設定では速い区間を省き、holdOnly までのゆっくりした移動だけにする。
function makeDriftPlan(engine, el)
{
	const config = engine.config;

	if (!config || config.displayMode !== 'random')
	{
		return null;
	}

	const direction = config.driftDirection;

	if (direction !== 'down' && direction !== 'right')
	{
		return null;
	}

	const axis = (direction === 'right') ? 'x' : 'y';
	const dim = (axis === 'x') ? parseFloat(el.style.width) : parseFloat(el.style.height);

	if (!isFinite(dim) || dim <= 0)
	{
		return null;
	}

	const fast = dim * DRIFT_FAST_FRACTION;
	const slow = dim * DRIFT_SLOW_FRACTION;

	return {
		axis,
		afterIn: fast,
		afterHold: fast + slow,
		afterOut: fast + slow + fast,
		holdOnly: slow
	};
}




// 漂いの1区間を当てる。軸方向の移動量を、与えた所要時間と加減速で目標値へ向かわせる。軸ごとのカスタムプロパティを書き換え、CSS 側のトランジションで補間させる。
function driftTo(el, axis, value, durationMs, easing)
{
	el.style.setProperty('--drift-dur', durationMs + 'ms');
	el.style.setProperty('--drift-ease', easing);
	el.style.setProperty(axis === 'x' ? '--drift-x' : '--drift-y', value + 'px');
}




// フェード区間の加減速カーブを cubic-bezier で組む。滞留 (一定速度) と接する側の端の速度を低速にぴたりと合わせ、反対側を DRIFT_FAST_SLOPE まで速くする。これで区間の境目で速度が途切れず、引っかかりなく滑らかにつながる。joinSlope は低速の速度を区間平均速度で正規化した傾きで、decel=true はフェードイン (速い→低速)、false はフェードアウト (低速→速い)。制御点の x は 1/3・2/3 に固定し、cubic-bezier の両端の傾きは始点で y1/x1、終点で (1-y2)/(1-x2) になる性質を使う。
function driftEase(joinSlope, decel)
{
	const fast = DRIFT_FAST_SLOPE;

	// 下限は0より僅かに上に留め、終端で速度がゼロまで落ちて引っかかるのを防ぐ。
	const join = Math.max(joinSlope, 0.04);

	// 低速側の傾きが大きい (フェードが長く滞留が短いなど) と、固定した制御点では cubic-bezier の進度が非単調になり一瞬逆走する。境目の傾きが緩急の差を生まないこの領域では、進度が必ず単調な一定速度の linear にする。閾値 3 - fast は y2 >= y1 を保てる境目。
	if (join >= 3 - fast)
	{
		return 'linear';
	}

	if (decel)
	{
		// 速い→低速。始点の傾きを速く、終点の傾きを join に合わせる。
		return 'cubic-bezier(0.333, ' + (fast / 3).toFixed(4) + ', 0.667, ' + (1 - join / 3).toFixed(4) + ')';
	}

	// 低速→速い。始点の傾きを join に合わせ、終点の傾きを速くする。
	return 'cubic-bezier(0.333, ' + (join / 3).toFixed(4) + ', 0.667, ' + (1 - fast / 3).toFixed(4) + ')';
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

		// 大きさが確定してから漂いの計画を組む。漂わない設定なら null になり、以後の移動処理は素通りする。
		const drift = makeDriftPlan(engine, el);

		// 動画の総尺 (秒) をミリ秒に直す。途切れない実数が取れた場合のみ採用する。
		const videoMs = (item.type === 'video' && isFinite(el.duration)) ? el.duration * 1000 : 0;

		// 表示間隔より長い動画は、一度の再生が終わるまで切り替えずに待つ設定かを先に判断する。漂いの滞留区間の所要時間を、実際に表示し続ける長さへ合わせるため。
		const playFull = (config.videoPlayFull && videoMs > hold && !el.error);
		const effectiveHold = playFull ? videoMs : hold;

		// フェード区間と滞留区間の境目で速度をそろえるための加減速カーブ。低速の速度 (移動量 ÷ 滞留時間) を、フェード区間の平均速度 (移動量 ÷ フェード時間) で正規化した傾きが境目の合わせ先になる。移動量の割合 (fast/slow) と時間 (fade/effectiveHold) だけで決まり、表示サイズには依らない。
		const joinSlope = (fade > 0) ? (DRIFT_SLOW_FRACTION * fade) / (DRIFT_FAST_FRACTION * effectiveHold) : 0;
		const driftEaseIn = driftEase(joinSlope, true);
		const driftEaseOut = driftEase(joinSlope, false);

		// 追加直後に可視クラスを付けてフェードインさせる。同時に、漂いの最初の区間も始める。
		requestAnimationFrame(() =>
		{
			requestAnimationFrame(() =>
			{
				el.classList.add('visible');

				if (drift)
				{
					if (fade > 0)
					{
						// フェードイン中はスッと進み、続いて滞留中はごくゆっくり進む。フェードの間は絵の輪郭が薄く、速い動きが目立たない。終端の速度を滞留中の低速にそろえたカーブで締め、境目で引っかからずに低速へつなぐ。
						driftTo(el, drift.axis, drift.afterIn, fade, driftEaseIn);

						later(engine, () =>
						{
							if (el === engine.currentElement)
							{
								driftTo(el, drift.axis, drift.afterHold, effectiveHold, 'linear');
							}
						}, fade);
					}
					else
					{
						// フェードが無い設定では速い区間を設けず、滞留中のごくゆっくりした移動だけにする。くっきり見えている絵が急に動き出す違和感を避ける。
						driftTo(el, drift.axis, drift.holdOnly, effectiveHold, 'linear');
					}
				}
			});
		});

		// フェードアウトを始め、その完了 + 間隔の後に次のメディアへ進む。
		const startFadeOut = () =>
		{
			el.classList.remove('visible');

			if (drift && fade > 0)
			{
				// フェードアウト中もスッと進んで去る。始端の速度を直前の低速にそろえたカーブで、境目で引っかからずに速さを上げ、薄れていく間に短く移動する。
				driftTo(el, drift.axis, drift.afterOut, fade, driftEaseOut);
			}

			later(engine, () =>
			{
				engine.index++;
				showNext(engine);
			}, fade + gap);
		};

		// 表示間隔より長い動画は、一度の再生が終わるまで切り替えずに待つ設定。表示間隔のほうが長い場合は通常の滞留時間で切り替える。
		if (playFull)
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

	applyCursorMask(global);
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
		showMessage(window.maegamiI18n.t('overlay.noFolder'));
		return;
	}

	const anyMedia = state.layers.some((layer) => layer.media && layer.media.length > 0);

	if (!anyMedia)
	{
		engines.forEach(stopEngine);
		showMessage(window.maegamiI18n.t('overlay.noMedia'));
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

	applyCursorMask(global);
	reconcileEngineCount(state.layers.length);

	state.layers.forEach((layer, i) =>
	{
		if (engines[i])
		{
			applyEngineDisplay(engines[i], layer.config);
		}
	});
}




// カーソル追従のくり抜きの設定を反映する。穴の大きさ・軌跡の入切や寸法・寿命を全体設定から取り、切られている場合は描画ループを止めて穴も閉じる。
function applyCursorMask(g)
{
	maskEnabled = !!(g && g.cursorMask);
	trailEnabled = maskEnabled && !!(g && g.cursorTrail);

	// 設定の半径を縁の半径とし、穴の半径は承認済みの見た目 (90 / 160) と同じ比率で決める。これでぼかしの幅が大きさに応じて保たれる。
	maskEdge = (g && g.maskRadius) ? g.maskRadius : 160;
	maskHole = Math.round(maskEdge * 0.5625);
	trailLifeMs = (g && g.trailDuration) ? g.trailDuration : 3000;

	stage.classList.toggle('masking', maskEnabled);

	if (!maskEnabled)
	{
		// くり抜きを切ったら追従も軌跡も捨て、ループを止めてマスクを空 (穴なし) にする。
		cursorTarget = null;
		cursorSmooth = null;
		cursorInside = false;
		trailParticles = [];
		lastSpawn = null;
		stopMaskLoop();
		pushMaskData();
		return;
	}

	if (!trailEnabled)
	{
		// 軌跡を切ったら残っている粒を消し、撒き始点も忘れる。
		trailParticles = [];
		lastSpawn = null;
	}

	// 半径などの設定変更を即座に映すため、止まっていれば一度描き直す。
	requestMaskTick();
}




// メインプロセスから届くカーソル位置を、マスクの穴の目標位置として受け取る。画面外から入ってきた瞬間は滑らせず即座に合わせ、軌跡の撒き始点もそこへ置き直して画面外をまたいだ補間で軌跡が走るのを防ぐ。
function moveCursorMask(pos)
{
	if (!maskEnabled)
	{
		return;
	}

	const inside = !!pos.inside;

	if (inside)
	{
		cursorTarget = { x: pos.x, y: pos.y };

		if (!cursorInside)
		{
			cursorSmooth = { x: pos.x, y: pos.y };
			lastSpawn = null;
		}
	}

	cursorInside = inside;
	requestMaskTick();
}




// マスク描画ループを起こす。止まっているときだけ次フレームを予約する。
function requestMaskTick()
{
	if (maskRafId === null && maskEnabled)
	{
		maskLastTime = 0;
		maskRafId = requestAnimationFrame(maskFrame);
	}
}




function stopMaskLoop()
{
	if (maskRafId !== null)
	{
		cancelAnimationFrame(maskRafId);
		maskRafId = null;
	}
}




// マスク描画の1フレーム。カーソルを目標へ滑らかに寄せ、軌跡を撒き、粒の寿命を減らし、結果をワークレットへ渡す。動くものが残っていれば次フレームを続け、穴が寄り切って粒も無くなれば止める。
function maskFrame(now)
{
	maskRafId = null;

	// 起き直した直後は前フレーム時刻が無いので一般的な1フレームぶんを仮に使う。長い中断後に粒が一気に飛ばないよう上限も設ける。
	const dt = (maskLastTime > 0) ? Math.min(now - maskLastTime, 100) : 16;
	maskLastTime = now;

	if (cursorInside && cursorTarget)
	{
		if (!cursorSmooth)
		{
			cursorSmooth = { x: cursorTarget.x, y: cursorTarget.y };
		}
		else
		{
			const k = 1 - Math.exp(-dt / CURSOR_SMOOTH_TAU);
			cursorSmooth.x += (cursorTarget.x - cursorSmooth.x) * k;
			cursorSmooth.y += (cursorTarget.y - cursorSmooth.y) * k;
		}

		if (trailEnabled)
		{
			spawnTrail(cursorSmooth);
		}
	}

	if (trailParticles.length > 0)
	{
		const decay = dt / trailLifeMs;

		for (const p of trailParticles)
		{
			p.life -= decay;
		}

		trailParticles = trailParticles.filter((p) => p.life > 0);
	}

	pushMaskData();

	// カーソルが目標へ寄り切っておらず動いているか、まだ生きた粒があれば続ける。穴が静止し粒も無ければ止め、CPU を遊ばせない。次のカーソル移動や設定変更で起き直す。
	const easing = cursorInside && cursorSmooth && cursorTarget &&
		(Math.abs(cursorTarget.x - cursorSmooth.x) > 0.5 || Math.abs(cursorTarget.y - cursorSmooth.y) > 0.5);

	if (easing || trailParticles.length > 0)
	{
		maskRafId = requestAnimationFrame(maskFrame);
	}
}




// カーソルの現在位置までの線分上へ、一定間隔で軌跡の粒を撒く。前回の撒き位置から間隔ぶん進むごとに粒を足し、素早く動かしても点線にならないようにする。
function spawnTrail(pos)
{
	if (!lastSpawn)
	{
		lastSpawn = { x: pos.x, y: pos.y };
		addParticle(pos.x, pos.y);
		return;
	}

	const spacing = Math.max(maskHole * TRAIL_SPACING_FRACTION, 1);
	const dx = pos.x - lastSpawn.x;
	const dy = pos.y - lastSpawn.y;
	const dist = Math.hypot(dx, dy);

	if (dist < spacing)
	{
		return;
	}

	const ux = dx / dist;
	const uy = dy / dist;
	const steps = Math.floor(dist / spacing);

	for (let i = 1; i <= steps; i++)
	{
		addParticle(lastSpawn.x + ux * spacing * i, lastSpawn.y + uy * spacing * i);
	}

	lastSpawn = { x: lastSpawn.x + ux * spacing * steps, y: lastSpawn.y + uy * spacing * steps };
}




function addParticle(x, y)
{
	trailParticles.push({ x, y, life: 1 });

	if (trailParticles.length > TRAIL_MAX)
	{
		trailParticles.shift();
	}
}




// 現在の穴と全ての粒を、ワークレットが読むブラシの並びへ書き出す。カーソルの穴は内側 (hole) まで満幅・縁 (edge) まで弱める形で強さ1、軌跡の粒は中心から半径ぶんを寿命に応じた強さで彫る。1ブラシは5項をカンマで繋ぎ、ブラシ同士は空白で区切る。カスタムプロパティの値はトップレベルのセミコロンを含められないため区切りに空白を使う。並べる相手が無ければ穴なし (0) を置き、空文字でカスタムプロパティ自体が消えてワークレットが前の絵のまま固まるのを防ぐ。
function pushMaskData()
{
	const recs = [];

	if (cursorInside && cursorSmooth)
	{
		recs.push(cursorSmooth.x.toFixed(1) + ',' + cursorSmooth.y.toFixed(1) + ',' + maskHole + ',' + maskEdge + ',1');
	}

	for (const p of trailParticles)
	{
		// 満寿命のうちは強さ1で完全な穴に保ち、HOLD を割ってからゆっくり弱める。粒はのぞき穴と同じ内 (hole)・外 (edge) のプロファイルで彫り、なぞった跡がそのまま残るようにする。
		const strength = Math.min(p.life / TRAIL_HOLD_FRACTION, 1);
		recs.push(p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + maskHole + ',' + maskEdge + ',' + strength.toFixed(3));
	}

	stage.style.setProperty('--mask-data', recs.length > 0 ? recs.join(' ') : '0');
}




// くり抜きマスクを描く Paint Worklet を登録する。読み込みは非同期だが、登録前に paint(maskPainter) を参照しても描画が出ないだけで実害はなく、完了後のフレームから穴が描かれ始める。
if (window.CSS && CSS.paintWorklet)
{
	CSS.paintWorklet.addModule('mask-painter.js').catch((err) => console.error('マスク用 Paint Worklet の読み込みに失敗しました:', err));
}

// トレイの「次へ」を受け、再生中の各レイヤーを次のメディアへ即座に送る。滞留の途中でも現在の表示を畳んで次の一枚へ進む。
function advanceAll()
{
	engines.forEach((engine) =>
	{
		if (engine.running)
		{
			engine.index++;
			showNext(engine);
		}
	});
}




// 文書の言語を現在の表示言語へ合わせ、状態が届く前の初期案内を出しておく。フォルダが選ばれていれば最初の状態受信で消える。
document.documentElement.lang = window.maegamiI18n.locale;
document.title = window.maegamiI18n.t('app.name');
showMessage(window.maegamiI18n.t('overlay.initial'));

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

window.maegami.onAdvance(() =>
{
	advanceAll();
});

window.maegami.requestState();
