/* Editorial Share Card Canvas Renderer
 * 8 original print-inspired formats: Folio, Affiche, Index, Matte, Noir, Frame, 35mm, Plate
 * Features automatic review font scaling + pixel-accurate justified typography.
 */
(() => {
	function wrapLinesByWidth(ctx, text, maxWidth) {
		const words = String(text || '').trim().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		const lines = [];
		let current = words[0];
		for (let i = 1; i < words.length; i++) {
			const candidate = `${current} ${words[i]}`;
			if (ctx.measureText(candidate).width <= maxWidth) {
				current = candidate;
			} else {
				lines.push(current);
				current = words[i];
			}
		}
		lines.push(current);
		return lines;
	}

	function trimLinesToMax(ctx, lines, maxLines, maxWidth) {
		if (lines.length <= maxLines) return lines;
		const kept = lines.slice(0, maxLines);
		let last = kept[kept.length - 1];
		while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
			last = last.replace(/\s+\S*$/, '') || last.slice(0, -1);
		}
		kept[kept.length - 1] = `${last.replace(/[.,;:\s]+$/, '')}…`;
		return kept;
	}

	function fitJustifiedParagraph(ctx, text, {
		maxWidth,
		maxHeight,
		fontFamily,
		fontStyle = 'normal',
		fontWeight = '400',
		maxSize = 32,
		minSize = 19,
		lineHeightRatio = 1.48
	}) {
		const clean = String(text || '').replace(/\s+/g, ' ').trim();
		if (!clean || maxHeight < 40) return null;

		const makeFont = (sz) => `${fontStyle === 'normal' ? '' : fontStyle + ' '}${fontWeight} ${sz}px ${fontFamily}`;

		for (let size = maxSize; size >= minSize; size -= 2) {
			ctx.font = makeFont(size);
			const lineHeight = Math.round(size * lineHeightRatio);
			const lines = wrapLinesByWidth(ctx, clean, maxWidth);
			const totalHeight = lines.length * lineHeight;
			if (totalHeight <= maxHeight) {
				return { size, font: makeFont(size), lineHeight, lines, totalHeight };
			}
		}

		ctx.font = makeFont(minSize);
		const lineHeight = Math.round(minSize * lineHeightRatio);
		const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
		const rawLines = wrapLinesByWidth(ctx, clean, maxWidth);
		const lines = trimLinesToMax(ctx, rawLines, maxLines, maxWidth);
		return { size: minSize, font: makeFont(minSize), lineHeight, lines, totalHeight: lines.length * lineHeight };
	}

	function drawJustifiedLines(ctx, block, x, startY, maxWidth, { color, align = 'justify', alpha = 1 }) {
		if (!block || !block.lines.length) return startY;
		ctx.save();
		ctx.font = block.font;
		ctx.fillStyle = color;
		ctx.globalAlpha = alpha;
		ctx.textBaseline = 'top';

		let y = startY;
		const count = block.lines.length;
		for (let i = 0; i < count; i++) {
			const line = block.lines[i];
			const isLast = i === count - 1;
			if (align === 'center') {
				ctx.textAlign = 'center';
				ctx.fillText(line, x + maxWidth / 2, y);
			} else if (align === 'justify' && !isLast) {
				const words = line.split(' ');
				const lineW = ctx.measureText(line).width;
				if (words.length >= 2 && lineW >= maxWidth * 0.62) {
					const wordsW = words.reduce((acc, w) => acc + ctx.measureText(w).width, 0);
					const gap = (maxWidth - wordsW) / (words.length - 1);
					ctx.textAlign = 'left';
					let cursorX = x;
					for (const w of words) {
						ctx.fillText(w, cursorX, y);
						cursorX += ctx.measureText(w).width + gap;
					}
				} else {
					ctx.textAlign = 'left';
					ctx.fillText(line, x, y);
				}
			} else {
				ctx.textAlign = 'left';
				ctx.fillText(line, x, y);
			}
			y += block.lineHeight;
		}
		ctx.restore();
		return y;
	}

	function drawImageCover(ctx, img, x, y, w, h, { grayscale = false } = {}) {
		if (!img || !img.naturalWidth || !img.naturalHeight) return;
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		const scale = Math.max(w / iw, h / ih);
		const sw = w / scale;
		const sh = h / scale;
		const sx = (iw - sw) / 2;
		const sy = (ih - sh) / 2;

		if (!grayscale) {
			ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
			return;
		}

		// Pixel-accurate luminance grayscale (100% iOS Safari safe)
		const off = document.createElement('canvas');
		off.width = Math.max(1, Math.round(w));
		off.height = Math.max(1, Math.round(h));
		const octx = off.getContext('2d');
		octx.drawImage(img, sx, sy, sw, sh, 0, 0, off.width, off.height);
		try {
			const imgData = octx.getImageData(0, 0, off.width, off.height);
			const d = imgData.data;
			for (let i = 0; i < d.length; i += 4) {
				const lum = Math.round((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 0.94);
				d[i] = d[i + 1] = d[i + 2] = lum;
			}
			octx.putImageData(imgData, 0, 0);
		} catch (_) {}
		ctx.drawImage(off, x, y, w, h);
	}

	function formatRuntimeStr(mins) {
		if (!mins) return '';
		return `${mins} min`;
	}

	// Custom vector heavy print stars (tight kerning, sculptural weight, true half-star)
	function traceStarPath(ctx, cx, cy, outerR, innerR) {
		ctx.beginPath();
		for (let i = 0; i < 10; i++) {
			const r = i % 2 === 0 ? outerR : innerR;
			const angle = -Math.PI / 2 + (i * Math.PI) / 5;
			const px = cx + Math.cos(angle) * r;
			const py = cy + Math.sin(angle) * r;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.closePath();
	}

	function drawEditorialStars(ctx, rating, x, cy, {
		size = 18,
		gap = 6,
		color = '#F2EFE9',
		emptyColor = null,
		align = 'left',
		showEmpty = false
	} = {}) {
		if (typeof rating !== 'number' || rating <= 0) return 0;
		const full = Math.floor(rating);
		const hasHalf = (rating - full) >= 0.5;
		const count = showEmpty ? 5 : (full + (hasHalf ? 1 : 0));
		if (!count) return 0;

		const outerR = size;
		const innerR = size * 0.455; // Wider inner radius for bold ink-stamped weight
		const step = outerR * 2 + gap;
		const totalW = count * outerR * 2 + (count - 1) * gap;
		let startX = x + outerR;
		if (align === 'center') startX = x - totalW / 2 + outerR;
		else if (align === 'right') startX = x - totalW + outerR;

		ctx.save();
		for (let i = 0; i < count; i++) {
			const cx = startX + i * step;
			const isFull = i < full;
			const isHalf = !isFull && i === full && hasHalf;

			if (isFull) {
				traceStarPath(ctx, cx, cy, outerR, innerR);
				ctx.fillStyle = color;
				ctx.fill();
			} else if (isHalf) {
				if (emptyColor) {
					traceStarPath(ctx, cx, cy, outerR, innerR);
					ctx.fillStyle = emptyColor;
					ctx.fill();
				}
				ctx.save();
				ctx.beginPath();
				ctx.rect(cx - outerR - 1, cy - outerR - 1, outerR + 1, outerR * 2 + 2);
				ctx.clip();
				traceStarPath(ctx, cx, cy, outerR, innerR);
				ctx.fillStyle = color;
				ctx.fill();
				ctx.restore();
			} else if (showEmpty && emptyColor) {
				traceStarPath(ctx, cx, cy, outerR, innerR);
				ctx.fillStyle = emptyColor;
				ctx.fill();
			}
		}
		ctx.restore();
		return totalW;
	}

	function drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor, inkColor, mutedColor }) {
		const footerRuleY = H - 108;
		ctx.save();
		ctx.strokeStyle = ruleColor;
		ctx.lineWidth = 1.25;
		ctx.beginPath();
		ctx.moveTo(marginX, footerRuleY);
		ctx.lineTo(W - marginX, footerRuleY);
		ctx.stroke();

		ctx.textBaseline = 'middle';
		ctx.font = '500 20px "JetBrains Mono", monospace';
		ctx.fillStyle = inkColor;
		ctx.textAlign = 'left';
		ctx.fillText("FILM DIARY", marginX, footerRuleY + 46);

		if (dateStr) {
			ctx.font = '400 19px "JetBrains Mono", monospace';
			ctx.fillStyle = mutedColor;
			ctx.textAlign = 'right';
			ctx.fillText(dateStr.toUpperCase(), W - marginX, footerRuleY + 46);
		}
		ctx.restore();
	}

	async function renderEditorialCard({ ctx, W, H, film, style, isStory, isLight, showReview, posterImg, backdropImg, formatDate }) {
		const stillImg = backdropImg || posterImg;
		const title = film.title || 'Untitled';
		const director = film.director || '';
		const year = film.year ? String(film.year) : '';
		const genres = Array.isArray(film.genres) ? film.genres.slice(0, 2).join(' · ') : '';
		const runtime = formatRuntimeStr(film.runtime);
		const dateStr = (typeof formatDate === 'function' ? formatDate(film.watchedDate) : (film.watchedDate || '')) || '';
		const review = showReview ? film.plainText : '';
		const hasRating = typeof film.rating === 'number' && film.rating > 0;

		// ── 1. FOLIO (Archival Paper / Framed Widescreen Still / Crimson Stars) ──
		if (style === 'folio') {
			const bg = isLight ? '#F3EFE6' : '#111113';
			const ink = isLight ? '#141311' : '#F2EFE9';
			const sec = isLight ? '#36322D' : '#D2CEC6';
			const muted = isLight ? '#756E64' : '#8A857C';
			const rule = isLight ? '#D2CABC' : 'rgba(242,239,233,0.14)';
			const accent = isLight ? '#A63026' : '#D4A853';
			const marginX = 76;
			const contentW = W - marginX * 2;

			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			// Top hairline metadata bar
			const topY = isStory ? 84 : 68;
			ctx.textBaseline = 'middle';
			ctx.font = '400 19px "JetBrains Mono", monospace';
			ctx.fillStyle = muted;
			ctx.textAlign = 'left';
			if (year) ctx.fillText(year, marginX, topY);

			const rightTop = [genres, runtime].filter(Boolean).join('  ·  ') || (director ? director.toUpperCase() : '');
			if (rightTop) {
				ctx.font = '400 19px "Plus Jakarta Sans", sans-serif';
				ctx.textAlign = 'right';
				ctx.fillText(rightTop, W - marginX, topY);
			}

			ctx.strokeStyle = ink;
			ctx.lineWidth = 1.25;
			ctx.beginPath();
			ctx.moveTo(marginX, topY + 24);
			ctx.lineTo(W - marginX, topY + 24);
			ctx.stroke();

			// Framed widescreen still (expands into an archival art-book spread when there is no review)
			const stillY = topY + 48;
			const stillH = review
				? (isStory ? 516 : 418)
				: (isStory ? 960 : 620);
			ctx.fillStyle = isLight ? '#23201C' : '#1A1A1E';
			ctx.fillRect(marginX, stillY, contentW, stillH);
			if (stillImg) drawImageCover(ctx, stillImg, marginX, stillY, contentW, stillH);
			ctx.strokeStyle = ink;
			ctx.lineWidth = 1.25;
			ctx.strokeRect(marginX, stillY, contentW, stillH);

			// Serif display title (+ crisp poster inset on the right when no review)
			let y = stillY + stillH + (isStory ? 56 : 42);
			const insetW = !review && posterImg ? (isStory ? 204 : 164) : 0;
			const insetH = insetW ? Math.round(insetW * 1.5) : 0;
			const titleMaxW = insetW ? (contentW - insetW - 36) : contentW;
			if (insetW) {
				const insetX = W - marginX - insetW;
				const insetY = Math.min(y, (H - 134) - insetH);
				ctx.save();
				ctx.shadowColor = isLight ? 'rgba(20,19,17,0.18)' : 'rgba(0,0,0,0.55)';
				ctx.shadowBlur = 28;
				ctx.shadowOffsetY = 10;
				ctx.fillStyle = isLight ? '#E5DFD3' : '#1A1A1E';
				ctx.fillRect(insetX, insetY, insetW, insetH);
				ctx.restore();
				drawImageCover(ctx, posterImg, insetX, insetY, insetW, insetH);
				ctx.strokeStyle = ink;
				ctx.lineWidth = 1.25;
				ctx.strokeRect(insetX, insetY, insetW, insetH);
			}

			const titleSize = title.length > 28 ? 56 : title.length > 18 ? 66 : (review ? 78 : 74);
			ctx.font = `600 ${titleSize}px "Newsreader", Georgia, serif`;
			ctx.fillStyle = ink;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, title, titleMaxW), 2, titleMaxW);
			for (const line of titleLines) {
				ctx.fillText(line, marginX, y);
				y += Math.round(titleSize * 1.06);
			}

			// Director + stars
			y += 14;
			if (director) {
				ctx.font = review ? '400 25px "Plus Jakarta Sans", sans-serif' : 'italic 400 28px "Newsreader", Georgia, serif';
				ctx.fillStyle = muted;
				ctx.fillText(review ? director : `Directed by ${director}`, marginX, y);
				y += 42;
			}
			if (hasRating) {
				drawEditorialStars(ctx, film.rating, marginX, y + 18, {
					size: review ? 18 : 20,
					gap: 5,
					color: accent,
					emptyColor: isLight ? 'rgba(20,19,17,0.14)' : 'rgba(242,239,233,0.16)',
					showEmpty: false
				});
				y += 54;
			}

			if (!review) {
				const folioMeta = [film.country, runtime, genres].filter(Boolean).join('  ·  ');
				if (folioMeta) {
					ctx.font = '400 18px "JetBrains Mono", monospace';
					ctx.fillStyle = muted;
					const metaLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, folioMeta.toUpperCase(), titleMaxW), 2, titleMaxW);
					metaLines.forEach((ml, idx) => ctx.fillText(ml, marginX, y + 8 + idx * 26));
				}
			}

			// Hairline rule + auto-fit justified review
			if (review) {
				ctx.strokeStyle = rule;
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.moveTo(marginX, y + 4);
				ctx.lineTo(W - marginX, y + 4);
				ctx.stroke();
				y += 32;

				const maxH = (H - 134) - y;
				const block = fitJustifiedParagraph(ctx, review, {
					maxWidth: contentW,
					maxHeight: maxH,
					fontFamily: '"Newsreader", Georgia, serif',
					maxSize: isStory ? 33 : 29,
					minSize: 19,
					lineHeightRatio: 1.5
				});
				drawJustifiedLines(ctx, block, marginX, y, contentW, { color: sec, align: 'justify' });
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
			return;
		}

		// ── 2. AFFICHE (Full-Bleed Still / Gradient Vignette / Lower Editorial Block) ──
		if (style === 'affiche') {
			const ivory = '#FAF7F0';
			const gold = '#DFB664';
			const silver = '#C8C3BA';
			const marginX = 76;
			const contentW = W - marginX * 2;

			ctx.fillStyle = '#0B0B0D';
			ctx.fillRect(0, 0, W, H);
			if (stillImg) drawImageCover(ctx, stillImg, 0, 0, W, H);

			// Cinematic vertical vignette (airier theatrical poster vignette when no review)
			const grad = ctx.createLinearGradient(0, 0, 0, H);
			if (review) {
				grad.addColorStop(0.0, 'rgba(10,10,12,0.74)');
				grad.addColorStop(0.24, 'rgba(10,10,12,0.18)');
				grad.addColorStop(0.42, 'rgba(10,10,12,0.28)');
				grad.addColorStop(0.60, 'rgba(10,10,12,0.78)');
				grad.addColorStop(0.78, 'rgba(10,10,12,0.93)');
				grad.addColorStop(1.0, 'rgba(10,10,12,0.98)');
			} else {
				grad.addColorStop(0.0, 'rgba(10,10,12,0.62)');
				grad.addColorStop(0.28, 'rgba(10,10,12,0.10)');
				grad.addColorStop(0.56, 'rgba(10,10,12,0.22)');
				grad.addColorStop(0.78, 'rgba(10,10,12,0.82)');
				grad.addColorStop(1.0, 'rgba(10,10,12,0.97)');
			}
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, W, H);

			// Inset hairline frame
			ctx.strokeStyle = 'rgba(250, 247, 240, 0.22)';
			ctx.lineWidth = 1.25;
			ctx.strokeRect(36, 36, W - 72, H - 72);

			// Quiet top metadata
			ctx.textBaseline = 'middle';
			ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
			ctx.fillStyle = 'rgba(250,247,240,0.84)';
			ctx.textAlign = 'left';
			if (director) ctx.fillText(director.toUpperCase(), marginX, 92);

			const topRight = [year, runtime].filter(Boolean).join('  ·  ').toUpperCase();
			if (topRight) {
				ctx.font = '400 18px "JetBrains Mono", monospace';
				ctx.fillStyle = silver;
				ctx.textAlign = 'right';
				ctx.fillText(topRight, W - marginX, 92);
			}

			if (!review) {
				// Monumental centered theatrical affiche composition
				const titleUpper = title.toUpperCase();
				const titleSize = titleUpper.length > 26 ? 76 : titleUpper.length > 16 ? 94 : 112;
				ctx.font = `700 ${titleSize}px "Newsreader", Georgia, serif`;
				const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, titleUpper, contentW), 3, contentW);
				const titleBlockH = titleLines.length * Math.round(titleSize * 0.96);
				const subMeta = [genres, film.country].filter(Boolean).join('  ·  ').toUpperCase();
				const extraH = (director ? 42 : 0) + (hasRating ? 68 : 0) + (subMeta ? 40 : 0) + 28;
				let y = (H - 134) - extraH - titleBlockH;

				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				if (director) {
					ctx.font = '500 20px "JetBrains Mono", monospace';
					ctx.fillStyle = gold;
					ctx.fillText(`A FILM BY ${director.toUpperCase()}`, W / 2, y);
					y += 42;
				}
				ctx.font = `700 ${titleSize}px "Newsreader", Georgia, serif`;
				ctx.fillStyle = ivory;
				for (const line of titleLines) {
					ctx.fillText(line, W / 2, y);
					y += Math.round(titleSize * 0.96);
				}

				// Short centered gold rule
				y += 18;
				ctx.fillStyle = gold;
				ctx.fillRect(W / 2 - 44, y, 88, 2);
				y += 26;

				if (hasRating) {
					drawEditorialStars(ctx, film.rating, W / 2, y + 18, {
						size: 20,
						gap: 6,
						color: gold,
						emptyColor: 'rgba(250,247,240,0.2)',
						align: 'center'
					});
					y += 56;
				}
				if (subMeta) {
					ctx.font = '400 18px "JetBrains Mono", monospace';
					ctx.fillStyle = silver;
					ctx.fillText(subMeta, W / 2, y);
				}

				drawEditorialFooter(ctx, W, H, marginX, dateStr, {
					ruleColor: 'rgba(250,247,240,0.2)',
					inkColor: ivory,
					mutedColor: silver
				});
				return;
			}

			// Measure lower editorial block from bottom up so short & long reviews sit gracefully
			const titleUpper = title.toUpperCase();
			const titleSize = titleUpper.length > 26 ? 72 : titleUpper.length > 16 ? 86 : 98;
			ctx.font = `700 ${titleSize}px "Newsreader", Georgia, serif`;
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, titleUpper, contentW), 3, contentW);
			const titleBlockH = titleLines.length * Math.round(titleSize * 0.98);
			const ratingH = hasRating ? 52 : 0;

			const footerTop = H - 124;
			const maxReviewH = review ? Math.max(150, (isStory ? 620 : 340)) : 0;
			const quoteIndent = 26;
			const reviewBlock = review ? fitJustifiedParagraph(ctx, review, {
				maxWidth: contentW - quoteIndent,
				maxHeight: maxReviewH,
				fontFamily: '"Newsreader", Georgia, serif',
				fontStyle: 'italic',
				maxSize: isStory ? 33 : 29,
				minSize: 19,
				lineHeightRatio: 1.48
			}) : null;

			const reviewBlockH = reviewBlock ? reviewBlock.totalHeight + 28 : 0;
			let y = footerTop - 36 - reviewBlockH - ratingH - titleBlockH;
			const minTopY = isStory ? 540 : 340;
			if (y < minTopY) y = minTopY;

			// Draw uppercase display title
			ctx.font = `700 ${titleSize}px "Newsreader", Georgia, serif`;
			ctx.fillStyle = ivory;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			for (const line of titleLines) {
				ctx.fillText(line, marginX, y);
				y += Math.round(titleSize * 0.98);
			}

			// Rating in editorial gold
			if (hasRating) {
				y += 14;
				drawEditorialStars(ctx, film.rating, marginX, y + 16, {
					size: 17,
					gap: 5,
					color: gold,
					emptyColor: 'rgba(250,247,240,0.2)'
				});
				y += 46;
			}

			// Vertical gold rule + justified italic review
			if (reviewBlock) {
				y += 14;
				ctx.fillStyle = gold;
				ctx.fillRect(marginX, y + 6, 3, Math.max(24, reviewBlock.totalHeight - 10));
				drawJustifiedLines(ctx, reviewBlock, marginX + quoteIndent, y, contentW - quoteIndent, {
					color: ivory,
					align: 'justify',
					alpha: 0.92
				});
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, {
				ruleColor: 'rgba(250,247,240,0.2)',
				inkColor: ivory,
				mutedColor: silver
			});
			return;
		}

		// ── 3. INDEX (Asymmetric Header / Inverted Print Score Block / 2-Col Poster & Specs) ──
		if (style === 'index') {
			const bg = isLight ? '#F4F1EA' : '#0E0F11';
			const ink = isLight ? '#141311' : '#F2F0EB';
			const muted = isLight ? '#6E6A63' : '#868B94';
			const rule = isLight ? '#D4CFC5' : '#262930';
			const scoreBg = isLight ? '#141311' : '#F2F0EB';
			const scoreInk = isLight ? '#F4F1EA' : '#0E0F11';
			const marginX = 64;
			const contentW = W - marginX * 2;

			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			// Asymmetric header: uppercase bold title left + refined monochrome print score block right
			const scoreW = 168;
			const scoreH = 114;
			const scoreX = W - marginX - scoreW;
			const scoreY = isStory ? 76 : 60;

			if (hasRating) {
				ctx.fillStyle = scoreBg;
				ctx.fillRect(scoreX, scoreY, scoreW, scoreH);
				const valStr = Number.isInteger(film.rating) ? `${film.rating}.0` : String(film.rating);
				ctx.fillStyle = scoreInk;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.font = '700 48px "JetBrains Mono", monospace';
				ctx.fillText(valStr, scoreX + scoreW / 2, scoreY + 44);
				drawEditorialStars(ctx, film.rating, scoreX + scoreW / 2, scoreY + 88, {
					size: 10,
					gap: 3,
					color: scoreInk,
					emptyColor: isLight ? 'rgba(244,241,234,0.22)' : 'rgba(14,15,17,0.2)',
					align: 'center'
				});
			}

			const titleUpper = title.toUpperCase();
			const titleMaxW = film.rating ? (scoreX - marginX - 28) : contentW;
			const titleSize = titleUpper.length > 24 ? 54 : titleUpper.length > 14 ? 64 : 74;
			ctx.font = `700 ${titleSize}px "Plus Jakarta Sans", sans-serif`;
			ctx.fillStyle = ink;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, titleUpper, titleMaxW), 3, titleMaxW);
			let ty = scoreY + 2;
			for (const line of titleLines) {
				ctx.fillText(line, marginX, ty);
				ty += Math.round(titleSize * 1.04);
			}

			const gridTopY = Math.max(ty + 26, scoreY + scoreH + 30);
			ctx.strokeStyle = ink;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(marginX, gridTopY);
			ctx.lineTo(W - marginX, gridTopY);
			ctx.stroke();

			// 2-column grid: crisp poster left + hairline specs right (expands into full dossier sheet when no review)
			const maxGridH = (H - 134) - (gridTopY + 30);
			const posterW = review
				? (isStory ? 444 : 368)
				: Math.min(isStory ? 580 : 480, Math.floor(maxGridH / 1.5));
			const posterH = Math.round(posterW * 1.5);
			const posterX = marginX;
			const posterY = gridTopY + (review ? 30 : Math.max(30, Math.floor((maxGridH - posterH) / 2)));

			ctx.fillStyle = isLight ? '#E6E1D7' : '#1A1C20';
			ctx.fillRect(posterX, posterY, posterW, posterH);
			if (posterImg) drawImageCover(ctx, posterImg, posterX, posterY, posterW, posterH);

			const divX = posterX + posterW + 30;
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.25;
			ctx.beginPath();
			ctx.moveTo(divX, posterY);
			ctx.lineTo(divX, posterY + posterH);
			ctx.stroke();

			const specX = divX + 28;
			const specW = (W - marginX) - specX;
			const specs = [
				{ label: 'DIRECTOR', value: director || '—' },
				{ label: 'YEAR', value: year || '—' },
				{ label: 'GENRE', value: genres || '—' },
				{ label: 'RUNTIME', value: runtime || '—' },
				{ label: 'COUNTRY', value: film.country || '—' },
				{ label: 'LOGGED', value: dateStr || '—' },
				...(!review && film.rewatch ? [{ label: 'SCREENING', value: 'Rewatch' }] : [])
			].filter(s => s.value && s.value !== '—');

			let sy = posterY + 6;
			const specStep = Math.min(review ? 104 : 132, Math.floor((posterH - 12) / Math.max(1, specs.length)));
			for (const sp of specs) {
				ctx.font = '500 16px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				ctx.fillText(sp.label, specX, sy);
				ctx.font = review ? '600 24px "Plus Jakarta Sans", sans-serif' : '600 26px "Plus Jakarta Sans", sans-serif';
				ctx.fillStyle = ink;
				const valLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, sp.value, specW), 2, specW);
				valLines.forEach((vl, idx) => ctx.fillText(vl, specX, sy + 24 + idx * 30));
				sy += specStep;
			}

			// Horizontal divider + auto-fit justified review below
			let revY = posterY + posterH + 34;
			if (review) {
				ctx.strokeStyle = rule;
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.moveTo(marginX, revY);
				ctx.lineTo(W - marginX, revY);
				ctx.stroke();
				revY += 28;

				const maxH = (H - 132) - revY;
				const block = fitJustifiedParagraph(ctx, review, {
					maxWidth: contentW,
					maxHeight: maxH,
					fontFamily: '"Plus Jakarta Sans", sans-serif',
					maxSize: isStory ? 30 : 26,
					minSize: 18,
					lineHeightRatio: 1.5
				});
				drawJustifiedLines(ctx, block, marginX, revY, contentW, { color: ink, align: 'justify', alpha: 0.9 });
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
			return;
		}

		// ── 4. MATTE (Museum-Matted Poster / Centered Serif & Italic Excerpt) ──
		if (style === 'matte') {
			const bg = isLight ? '#F7F5F0' : '#101012';
			const ink = isLight ? '#171614' : '#F2EFE9';
			const muted = isLight ? '#7A756D' : '#8C877F';
			const rule = isLight ? '#DCD7CE' : 'rgba(242,239,233,0.14)';
			const marginX = 88;
			const contentW = W - marginX * 2;

			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			const posterW = isStory ? (review ? 404 : 560) : (review ? 316 : 444);
			const posterH = Math.round(posterW * 1.5);
			const posterX = (W - posterW) / 2;
			const posterY = isStory ? (review ? 104 : 164) : (review ? 72 : 96);

			ctx.save();
			ctx.shadowColor = isLight ? 'rgba(23,22,20,0.18)' : 'rgba(0,0,0,0.6)';
			ctx.shadowBlur = 42;
			ctx.shadowOffsetY = 18;
			ctx.fillStyle = isLight ? '#E6E2D9' : '#1B1B1F';
			ctx.fillRect(posterX, posterY, posterW, posterH);
			ctx.restore();
			if (posterImg) drawImageCover(ctx, posterImg, posterX, posterY, posterW, posterH);

			// Centered serif title
			let y = posterY + posterH + (isStory ? 58 : 44);
			const titleSize = title.length > 26 ? 48 : 56;
			ctx.font = `600 ${titleSize}px "Newsreader", Georgia, serif`;
			ctx.fillStyle = ink;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, title, contentW), 2, contentW);
			for (const line of titleLines) {
				ctx.fillText(line, W / 2, y);
				y += Math.round(titleSize * 1.12);
			}

			y += 12;
			const meta = [director, year].filter(Boolean).join(', ');
			if (meta) {
				ctx.font = '400 22px "Plus Jakarta Sans", sans-serif';
				ctx.fillStyle = muted;
				ctx.fillText(meta, W / 2, y);
				y += 38;
			}
			if (hasRating) {
				drawEditorialStars(ctx, film.rating, W / 2, y + 16, {
					size: 16,
					gap: 5,
					color: ink,
					emptyColor: isLight ? 'rgba(23,22,20,0.14)' : 'rgba(242,239,233,0.16)',
					align: 'center'
				});
				y += 46;
			}

			// Short centered museum rule
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(W / 2 - 48, y + 6);
			ctx.lineTo(W / 2 + 48, y + 6);
			ctx.stroke();
			y += 34;

			if (review) {
				const maxH = (H - 136) - y;
				const block = fitJustifiedParagraph(ctx, review, {
					maxWidth: contentW - 32,
					maxHeight: maxH,
					fontFamily: '"Newsreader", Georgia, serif',
					fontStyle: 'italic',
					maxSize: isStory ? 32 : 28,
					minSize: 19,
					lineHeightRatio: 1.52
				});
				drawJustifiedLines(ctx, block, marginX + 16, y, contentW - 32, {
					color: ink,
					align: 'center',
					alpha: 0.86
				});
			} else {
				const plateMeta = [genres, runtime, film.country].filter(Boolean).join('  ·  ').toUpperCase();
				if (plateMeta) {
					ctx.font = '400 18px "JetBrains Mono", monospace';
					ctx.fillStyle = muted;
					ctx.textAlign = 'center';
					ctx.fillText(plateMeta, W / 2, y + 8);
				}
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
			return;
		}

		// ── 5. NOIR / FRAME (Monochrome or Full-Color Top Widescreen Still / Stark Sans) ──
		if (style === 'noir' || style === 'frame') {
			const isNoir = style === 'noir';
			const bg = isLight ? '#ECEAE4' : '#0B0B0C';
			const ink = isLight ? '#141416' : '#F4F4F2';
			const muted = isLight ? '#6E6D6A' : '#85858A';
			const rule = isLight ? '#D4D1C8' : '#232326';
			const marginX = 76;
			const contentW = W - marginX * 2;

			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			const stillH = review
				? (isStory ? 720 : 520)
				: (isStory ? 1240 : 810);
			ctx.fillStyle = isLight ? '#D9D6CE' : '#18181A';
			ctx.fillRect(0, 0, W, stillH);
			if (stillImg) drawImageCover(ctx, stillImg, 0, 0, W, stillH, { grayscale: isNoir });

			// Smooth bottom fade into canvas
			const fadeH = review ? 220 : 320;
			const fade = ctx.createLinearGradient(0, stillH - fadeH, 0, stillH);
			fade.addColorStop(0, isLight ? 'rgba(236,234,228,0)' : 'rgba(11,11,12,0)');
			fade.addColorStop(1, bg);
			ctx.fillStyle = fade;
			ctx.fillRect(0, stillH - fadeH, W, fadeH + 2);

			// Stark sans title
			let y = stillH + (review ? 24 : 36);
			const titleSize = title.length > 26 ? 58 : title.length > 16 ? 70 : (review ? 76 : 84);
			ctx.font = `700 ${titleSize}px "Plus Jakarta Sans", sans-serif`;
			ctx.fillStyle = ink;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, title, contentW), 2, contentW);
			for (const line of titleLines) {
				ctx.fillText(line, marginX, y);
				y += Math.round(titleSize * 1.08);
			}

			y += 16;
			const metaParts = review ? [director, year, runtime] : [director, year, runtime, film.country];
			const metaStr = metaParts.filter(Boolean).join('  ·  ');
			if (metaStr) {
				ctx.font = '400 20px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				ctx.fillText(metaStr, marginX, y);
				y += 40;
			}
			if (hasRating) {
				drawEditorialStars(ctx, film.rating, marginX, y + 18, {
					size: review ? 17 : 20,
					gap: 5,
					color: ink,
					emptyColor: isLight ? 'rgba(20,20,22,0.15)' : 'rgba(244,244,242,0.18)'
				});
				y += 54;
			}
			if (!review && genres) {
				ctx.font = '400 18px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				ctx.fillText(genres.toUpperCase(), marginX, y + 6);
			}

			if (review) {
				ctx.strokeStyle = rule;
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.moveTo(marginX, y + 6);
				ctx.lineTo(W - marginX, y + 6);
				ctx.stroke();
				y += 32;

				const maxH = (H - 132) - y;
				const block = fitJustifiedParagraph(ctx, review, {
					maxWidth: contentW,
					maxHeight: maxH,
					fontFamily: '"Plus Jakarta Sans", sans-serif',
					maxSize: isStory ? 31 : 27,
					minSize: 18,
					lineHeightRatio: 1.5
				});
				drawJustifiedLines(ctx, block, marginX, y, contentW, { color: ink, align: 'justify', alpha: 0.88 });
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
			return;
		}

		// ── 7. PLATE (Monograph Bookplate / Split Poster + Widescreen Still / Drop-Cap Prose) ──
		if (style === 'plate') {
			const bg = isLight ? '#F4F0E6' : '#0D0D0F';
			const ink = isLight ? '#151412' : '#F2EFE9';
			const sec = isLight ? '#322F2B' : '#D4D0C8';
			const muted = isLight ? '#777167' : '#8A857C';
			const rule = isLight ? '#CFC8BA' : 'rgba(242,239,233,0.14)';
			const accent = isLight ? '#8F6422' : '#D4A853';
			const marginX = 72;
			const contentW = W - marginX * 2;

			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, W, H);

			// Double-hairline archival bookplate border
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.25;
			ctx.strokeRect(30, 30, W - 60, H - 60);
			ctx.strokeRect(38, 38, W - 76, H - 76);

			// Top diptych: Left typographic header + Right jewel poster
			const topY = isStory ? 84 : 70;
			const posterW = review ? (isStory ? 216 : 178) : (isStory ? 268 : 210);
			const posterH = Math.round(posterW * 1.5);
			const posterX = W - marginX - posterW;
			const leftW = posterX - marginX - 36;

			// Vertical hairline between title column and poster
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.25;
			ctx.beginPath();
			ctx.moveTo(posterX - 20, topY);
			ctx.lineTo(posterX - 20, topY + posterH);
			ctx.stroke();

			// Right jewel poster
			ctx.fillStyle = isLight ? '#E4DED2' : '#19191D';
			ctx.fillRect(posterX, topY, posterW, posterH);
			if (posterImg) drawImageCover(ctx, posterImg, posterX, topY, posterW, posterH);
			ctx.strokeStyle = rule;
			ctx.strokeRect(posterX, topY, posterW, posterH);

			// Left column: eyebrow + italic year + serif title + director
			let ly = topY + 4;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.font = '500 16px "JetBrains Mono", monospace';
			ctx.fillStyle = accent;
			ctx.fillText(year ? `PLATE  ·  ${year}` : 'SCREENING PLATE', marginX, ly);
			ly += 34;

			const titleSize = title.length > 26 ? 48 : title.length > 16 ? 56 : 64;
			ctx.font = `600 ${titleSize}px "Newsreader", Georgia, serif`;
			ctx.fillStyle = ink;
			const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, title, leftW), 3, leftW);
			for (const line of titleLines) {
				ctx.fillText(line, marginX, ly);
				ly += Math.round(titleSize * 1.04);
			}

			// Anchor director + runtime neatly near bottom of the top diptych
			const metaBottomY = Math.max(ly + 18, topY + posterH - 58);
			if (director) {
				ctx.font = 'italic 400 26px "Newsreader", Georgia, serif';
				ctx.fillStyle = sec;
				ctx.fillText(`dir. ${director}`, marginX, metaBottomY);
			}
			const subMeta = [film.country, runtime].filter(Boolean).join('  ·  ');
			if (subMeta) {
				ctx.font = '400 17px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				ctx.fillText(subMeta.toUpperCase(), marginX, metaBottomY + 34);
			}

			// Horizontal rule separating diptych from widescreen still plate
			const rule1Y = topY + posterH + (isStory ? 34 : 26);
			ctx.strokeStyle = ink;
			ctx.lineWidth = 1.25;
			ctx.beginPath();
			ctx.moveTo(marginX, rule1Y);
			ctx.lineTo(W - marginX, rule1Y);
			ctx.stroke();

			// Centerpiece widescreen film still
			const stillY = rule1Y + (isStory ? 28 : 22);
			const stillH = review
				? (isStory ? 500 : 382)
				: (H - 196 - stillY);
			ctx.fillStyle = isLight ? '#23201C' : '#18181B';
			ctx.fillRect(marginX, stillY, contentW, stillH);
			if (stillImg) drawImageCover(ctx, stillImg, marginX, stillY, contentW, stillH);
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.25;
			ctx.strokeRect(marginX, stillY, contentW, stillH);

			// Caption bar under still: genres left + heavy vector stars right
			const capY = stillY + stillH + 26;
			ctx.textBaseline = 'middle';
			if (genres) {
				ctx.font = '400 17px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				ctx.textAlign = 'left';
				ctx.fillText(genres.toUpperCase(), marginX, capY);
			}
			if (hasRating) {
				drawEditorialStars(ctx, film.rating, W - marginX, capY, {
					size: 14,
					gap: 4,
					color: accent,
					emptyColor: isLight ? 'rgba(21,20,18,0.14)' : 'rgba(242,239,233,0.16)',
					align: 'right'
				});
			}

			// Fine-press justified review with editorial opening bar
			if (review) {
				const rule2Y = capY + 26;
				ctx.strokeStyle = rule;
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.moveTo(marginX, rule2Y);
				ctx.lineTo(W - marginX, rule2Y);
				ctx.stroke();

				const revY = rule2Y + 30;
				const maxH = (H - 134) - revY;
				const block = fitJustifiedParagraph(ctx, review, {
					maxWidth: contentW,
					maxHeight: maxH,
					fontFamily: '"Newsreader", Georgia, serif',
					maxSize: isStory ? 33 : 28,
					minSize: 19,
					lineHeightRatio: 1.5
				});
				drawJustifiedLines(ctx, block, marginX, revY, contentW, { color: sec, align: 'justify' });
			}

			drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
			return;
		}

		// ── 8. 35MM (Darkroom Perforated Film Strip / Poster Inset / Amber Stamps) ──
		const bg = isLight ? '#F3EEE4' : '#11100E';
		const stripBg = '#080807';
		const ink = isLight ? '#181512' : '#EFE9DC';
		const amber = isLight ? '#B66B1A' : '#DF963C';
		const muted = isLight ? '#787066' : '#8C8478';
		const rule = isLight ? '#D7CFC2' : '#28241F';
		const marginX = 76;
		const contentW = W - marginX * 2;

		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, W, H);

		const stripY = isStory ? 84 : 64;
		const stripH = review
			? (isStory ? 620 : 466)
			: (isStory ? 840 : 590);
		const trackH = 60;
		const stillY = stripY + trackH;
		const stillH = stripH - trackH * 2;
		const stillX = 36;
		const stillW = W - 72;

		// Edge stamps above film strip
		ctx.textBaseline = 'middle';
		ctx.font = '500 16px "JetBrains Mono", monospace';
		ctx.fillStyle = amber;
		ctx.textAlign = 'left';
		ctx.fillText('35MM  ·  KODAK 5219', 40, stripY - 20);

		const topRightEdge = [year, runtime].filter(Boolean).join('  ·  ').toUpperCase();
		if (topRightEdge) {
			ctx.fillStyle = muted;
			ctx.textAlign = 'right';
			ctx.fillText(topRightEdge, W - 40, stripY - 20);
		}

		// Film strip body + sprockets
		ctx.fillStyle = stripBg;
		ctx.fillRect(0, stripY, W, stripH);

		const holeW = 42;
		const holeH = 24;
		const holeStep = 84;
		const fillSprocket = (x, y, w, h, r) => {
			ctx.beginPath();
			ctx.moveTo(x + r, y);
			ctx.arcTo(x + w, y, x + w, y + h, r);
			ctx.arcTo(x + w, y + h, x, y + h, r);
			ctx.arcTo(x, y + h, x, y, r);
			ctx.arcTo(x, y, x + w, y, r);
			ctx.closePath();
			ctx.fill();
		};
		for (let hx = 28; hx < W - 20; hx += holeStep) {
			ctx.fillStyle = bg;
			fillSprocket(hx, stripY + 18, holeW, holeH, 4);
			fillSprocket(hx, stripY + stripH - 42, holeW, holeH, 4);
		}

		ctx.fillStyle = '#1E1B18';
		ctx.fillRect(stillX, stillY, stillW, stillH);
		if (stillImg) drawImageCover(ctx, stillImg, stillX, stillY, stillW, stillH);

		// Poster thumbnail + serif title block (expands into full darkroom print sheet when no review)
		const infoY = stripY + stripH + (review ? (isStory ? 48 : 34) : (isStory ? 66 : 44));
		const thumbW = review ? (isStory ? 176 : 144) : (isStory ? 276 : 214);
		const thumbH = Math.round(thumbW * 1.5);
		ctx.fillStyle = isLight ? '#E0D9CC' : '#1C1916';
		ctx.fillRect(marginX, infoY, thumbW, thumbH);
		if (posterImg) drawImageCover(ctx, posterImg, marginX, infoY, thumbW, thumbH);

		const textX = marginX + thumbW + 34;
		const textW = (W - marginX) - textX;
		let ty = infoY + 4;
		const titleSize = title.length > 24 ? 48 : title.length > 14 ? 56 : (review ? 62 : 68);
		ctx.font = `600 ${titleSize}px "Newsreader", Georgia, serif`;
		ctx.fillStyle = ink;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		const titleLines = trimLinesToMax(ctx, wrapLinesByWidth(ctx, title, textW), 2, textW);
		for (const line of titleLines) {
			ctx.fillText(line, textX, ty);
			ty += Math.round(titleSize * 1.08);
		}
		ty += 12;
		if (director) {
			ctx.font = '400 24px "Plus Jakarta Sans", sans-serif';
			ctx.fillStyle = muted;
			ctx.fillText(director, textX, ty);
			ty += 42;
		}
		if (hasRating) {
			drawEditorialStars(ctx, film.rating, textX, ty + 16, {
				size: review ? 16 : 19,
				gap: 4,
				color: amber,
				emptyColor: isLight ? 'rgba(24,21,18,0.15)' : 'rgba(239,233,220,0.16)'
			});
			ty += 52;
		}
		if (!review) {
			const stripSpecs = [
				genres ? `GENRE   ${genres.toUpperCase()}` : '',
				film.country ? `ORIGIN  ${film.country.toUpperCase()}` : '',
				runtime ? `LENGTH  ${runtime.toUpperCase()}` : ''
			].filter(Boolean);
			if (stripSpecs.length) {
				ctx.strokeStyle = rule;
				ctx.lineWidth = 1.25;
				ctx.beginPath();
				ctx.moveTo(textX, ty + 6);
				ctx.lineTo(W - marginX, ty + 6);
				ctx.stroke();
				ty += 26;
				ctx.font = '400 17px "JetBrains Mono", monospace';
				ctx.fillStyle = muted;
				for (const line of stripSpecs) {
					ctx.fillText(line, textX, ty);
					ty += 28;
				}
			}
		}

		// Hairline divider + justified review
		let revY = Math.max(infoY + thumbH, ty + 48) + 32;
		if (review) {
			ctx.strokeStyle = rule;
			ctx.lineWidth = 1.25;
			ctx.beginPath();
			ctx.moveTo(marginX, revY);
			ctx.lineTo(W - marginX, revY);
			ctx.stroke();
			revY += 28;

			const maxH = (H - 132) - revY;
			const block = fitJustifiedParagraph(ctx, review, {
				maxWidth: contentW,
				maxHeight: maxH,
				fontFamily: '"Newsreader", Georgia, serif',
				maxSize: isStory ? 31 : 27,
				minSize: 18,
				lineHeightRatio: 1.5
			});
			drawJustifiedLines(ctx, block, marginX, revY, contentW, { color: ink, align: 'justify', alpha: 0.9 });
		}

		drawEditorialFooter(ctx, W, H, marginX, dateStr, { ruleColor: rule, inkColor: ink, mutedColor: muted });
	}

	window.__EDITORIAL_SHARE_CARDS__ = { renderEditorialCard };
})();
