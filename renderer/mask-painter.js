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

// くり抜きマスクを一枚の絵として描く Paint Worklet。描画側が --mask-data に書き込んだブラシ (カーソルの穴と軌跡の粒) を受け取り、不透明な黒で塗った面から destination-out で穴を彫る。アルファマスクとして働くため、黒く残った部分は画像が見え、彫った部分は透けて下のデスクトップが覗ける。各ブラシは「x,y,内側半径,外側半径,強さ」の5項をカンマで繋ぎ、ブラシ同士は空白で区切る。カスタムプロパティの値はトップレベルのセミコロンを含められないため区切りに空白を使う。
registerPaint('maskPainter', class
{
	static get inputProperties()
	{
		return ['--mask-data'];
	}




	paint(ctx, size, props)
	{
		// 全面を不透明な黒で塗る。この時点では画像が画面全体に見える状態。
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, size.width, size.height);

		const raw = props.get('--mask-data').toString().trim();

		if (!raw)
		{
			return;
		}

		// 以後の塗りはすべて消しゴムとして働く。ブラシのアルファぶんだけ下の黒を削り、その場所へ穴を開ける。
		ctx.globalCompositeOperation = 'destination-out';

		const records = raw.split(/\s+/);

		for (const record of records)
		{
			const parts = record.split(',');

			if (parts.length < 5)
			{
				continue;
			}

			const x = parseFloat(parts[0]);
			const y = parseFloat(parts[1]);
			const inner = parseFloat(parts[2]);
			const outer = parseFloat(parts[3]);
			const strength = parseFloat(parts[4]);

			if (!isFinite(x) || !isFinite(y) || !isFinite(outer) || outer <= 0)
			{
				continue;
			}

			const s = Math.max(0, Math.min(strength, 1));

			if (s <= 0)
			{
				continue;
			}

			// 内側の半径までは満幅で消し、そこから外周へ向けて消す強さを 0 まで落とす。これでブラシの縁が柔らかくぼけ、穴同士の継ぎ目が目立たない。内側が外側以上のときは縁を持たない単純な円になる。
			const r0 = Math.max(0, Math.min(inner, outer));
			const gradient = ctx.createRadialGradient(x, y, r0, x, y, outer);
			gradient.addColorStop(0, 'rgba(0, 0, 0, ' + s + ')');
			gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(x, y, outer, 0, Math.PI * 2);
			ctx.fill();
		}
	}
});
