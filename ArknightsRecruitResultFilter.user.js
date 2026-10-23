// ==UserScript==
// @name         Arknights Recruit Result Filter
// @namespace    https://recruit-arknights.vercel.app/
// @version      0.0.4
// @description  レアリティ降順ソート、除外検索の切り替え、★5確定表示
// @author       mudo34
// @match        https://recruit-arknights.vercel.app/*
// @icon         https://www.google.com/s2/favicons?domain=recruit-arknights.vercel.app
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
	'use strict';

	// ==========================================
	// 設定：枠色とレアリティの対応表(サイト側で変更あったとき修正)
	// ==========================================
	const RARITY_BORDER_COLORS = {
		1: 'border-gray-200',
		2: 'border-green-200',
		3: 'border-blue-200',
		4: 'border-purple-200',
		5: 'border-orange-200',
		6: 'border-red-200'
	};

	// ==========================================
	// 設定：表示
	// ==========================================
	const BUTTON_TEXT = '★2・3を含む検索を除外';
	const BADGE_TEXT  = '（★5確定）';

	const BADGE_STYLE = [
		'display: inline-block',
		'margin-left: 0.5rem',
		'padding: 0.1rem 0.45rem',
		'border-radius: 0.3rem',
		'background: rgba(249, 115, 22, 0.15)',
		'color: #ea580c',
		'font-size: 0.8em',
		'font-weight: 700',
		'white-space: nowrap',
	].join(';');

	const HIGHLIGHT_STYLE = 'rgba(249, 115, 22, 0.07)';

	// ==========================================
	// 内部状態
	// ==========================================
	let enabled = true;
	let scheduled = false;
	let processing = false;
	let previousResultState = null;

	const BUTTON_ID        = 'recruit-rarity-filter-toggle';
	const BADGE_CLASS      = 'recruit-rarity-filter-badge';
	const HIGHLIGHT_CLASS  = 'recruit-rarity-filter-highlight';
	const EMPTY_MESSAGE_ID = 'recruit-rarity-filter-empty';

	// ==========================================
	// レアリティ判定
	// ==========================================
	function getRarity(element) {
		const spans = element.querySelectorAll('span');

		for (const span of spans) {
			for (const className of span.classList) {
				for (const [rarity, borderColor] of Object.entries(RARITY_BORDER_COLORS)) {
					if (className === borderColor) {
						return Number(rarity);
					}
				}
			}
		}

		return null;
	}

	// 結果ブロックからキャラクター一覧を取得
	function getResultBlocks() {
		return [...document.querySelectorAll('div.relative.rounded-md.border-2.p-4')]
			.filter(block => {
				return block.querySelector(':scope > h3') && block.querySelector(':scope > ul');
			});
	}

	function getBlockData(block) {
		const heading = block.querySelector(':scope > h3');
		const list = block.querySelector(':scope > ul');

		if (!heading || !list) return null;

		const items = [...list.children].filter(element => element.tagName === 'LI');

		return {
			heading,
			list,
			items
		};
	}

	// ==========================================
	// ON/OFF ボタン
	// ==========================================
	function createToggleButton() {
		const existing = document.getElementById(BUTTON_ID);
		if (existing) return existing;

		const buttons = [...document.querySelectorAll('button')];

		const normalButton = buttons.find(button => button.textContent.trim() === '通常');
		const hirareButton = buttons.find(button => button.textContent.includes('ロボット') && button.textContent.includes('星4以上'));

		if (!normalButton || !hirareButton) return null;

		const button = document.createElement('button');
		button.id = BUTTON_ID;
		button.type = 'button';
		button.textContent = BUTTON_TEXT;
		button.setAttribute('aria-pressed', 'false');
		button.title = '★2・★3を含むタグ組み合わせの表示を切り替えます';

		Object.assign(button.style, {
			display:        'inline-flex',
			alignItems:     'center',
			justifyContent: 'center',
			padding:        '0.5rem 0.75rem',
			border:         '1px solid var(--border, #888)',
			borderRadius:   '0.5rem',
			background:     'transparent',
			color:          'inherit',
			font:           'inherit',
			fontSize:       '0.875rem',
			lineHeight:     '1.25rem',
			cursor:         'pointer',
		});

		button.addEventListener('click', () => {
			enabled = !enabled;
			updateButton();
			refreshResults();
		});

		// ボタンエリアの末尾に追加
		normalButton.parentElement.appendChild(button);
		normalButton.style.display = 'none';
		hirareButton.style.display = 'none';

		updateButton();
		return button;
	}

	function updateButton() {
		const button = document.getElementById(BUTTON_ID);
		if (!button) return;

		button.setAttribute('aria-pressed', String(enabled));
		if (enabled) {
			Object.assign(button.style, {
				color:       'hsl(var(--primary-foreground))',
				background:  'hsl(var(--primary))',
				borderColor: 'transparent',
				fontWeight:  '700',
			})
		} else {
			Object.assign(button.style, {
				color:       'inherit',
				background:  'transparent',
				borderColor: 'hsl(var(--input))',
				fontWeight:  '400',
			})
		}
	}

	// ==========================================
	// 元の並び順を記録
	// ==========================================
	function rememberOriginalOrder(items) {
		items.forEach((item, index) => {
			if (!item.hasAttribute('data-recruit-original-order')) {
				item.setAttribute('data-recruit-original-order', index);
			}
		});
	}

	function sortItems(items, list, descending) {
		const sorted = [...items].sort((a, b) => {
			if (descending) {
				const rarityA = getRarity(a) ?? 0;
				const rarityB = getRarity(b) ?? 0;
				return rarityB - rarityA;
			}

			return Number(a.getAttribute('data-recruit-original-order')) - Number(b.getAttribute('data-recruit-original-order'));
		});

		if (sorted.some((item, index) => item !== items[index])) {
			sorted.forEach(item => list.appendChild(item));
		}
	}

	// ==========================================
	// ★5確定ラベル・強調表示
	// ==========================================
	function removeBadge(heading) {
		heading.querySelectorAll(`.${BADGE_CLASS}`).forEach(
			badge => badge.remove()
		);
	}

	function setHighlight(block, highlight) {
		if (highlight) {
			block.classList.add(HIGHLIGHT_CLASS);
			block.style.backgroundColor = HIGHLIGHT_STYLE;
		} else {
			block.classList.remove(HIGHLIGHT_CLASS);
			block.style.removeProperty('background-color');
		}
	}

	function setBadge(heading, show) {
		removeBadge(heading);

		if (!show) return;

		const badge = document.createElement('span');
		badge.className     = BADGE_CLASS;
		badge.textContent   = BADGE_TEXT;
		badge.style.cssText = BADGE_STYLE;
		heading.appendChild(badge);
	}

	// ==========================================
	// メイン処理
	// ==========================================
	function refreshResults() {
		if (processing) {
			return;
		}

		processing = true;
		let resultChanged = false;

		try {
			const blocks = getResultBlocks();

			const currentResultState = JSON.stringify(blocks.map(block => {
				const data = getBlockData(block);
				if (!data) {
					return null;
				}

				return {
					heading: data.heading.textContent,
					items: data.items.map(item => ({
						text: item.textContent,
						rarity: getRarity(item)
					}))
				};
			}));

			resultChanged = previousResultState !== null &&
				previousResultState !== currentResultState;

			for (const block of blocks) {
				const data = getBlockData(block);
				if (!data) {
					continue;
				}

				const {
					heading,
					list,
					items
				} = data;

				// OFF時に元の順序へ戻せるよう記録
				rememberOriginalOrder(items);

				if (!enabled) {
					block.classList.remove(HIGHLIGHT_CLASS);
					block.style.removeProperty('background-color');
					removeBadge(heading);
					block.style.removeProperty('display');

					sortItems(items, list, false);
					continue;
				}

				const rarities = items.map(getRarity);

				// ★2・★3が1人でも含まれていればブロックごと非表示
				const shouldExclude = rarities.some(
					rarity => rarity === 2 || rarity === 3
				);

				block.style.display = shouldExclude ? 'none' : '';

				if (shouldExclude) {
					setBadge(heading, false);
					setHighlight(block, false);
					continue;
				}

				// ★5確定
				const isFiveStarGuaranteed = rarities.length > 0 &&
					rarities.every(rarity => rarity === 5);

				// ★5以上で背景色
				const isHighRarityOnly = rarities.length > 0 &&
					rarities.every(rarity => rarity !== null && rarity >= 5);

				setBadge(heading, isFiveStarGuaranteed);
				setHighlight(block, isHighRarityOnly);

				// キャラクターを★6 → ★1の順に並べ替え
				sortItems(items, list, true);
			}

			// 表示可能な結果があるか確認
			let emptyMessage = document.getElementById(EMPTY_MESSAGE_ID);

			const hasVisibleResult = blocks.some(
				block => block.style.display !== 'none'
			);

			if (enabled && !hasVisibleResult) {
				if (!emptyMessage) {
					emptyMessage = document.createElement('p');
					emptyMessage.id = EMPTY_MESSAGE_ID;
					emptyMessage.textContent = '表示できる結果なし';
					emptyMessage.style.cssText = [
						'margin-top: 1rem',
						'padding: 1rem',
						'text-align: center',
						'font-weight: 700',
						'color: var(--muted-foreground, #888)'
					].join(';');

					blocks[0]?.parentElement?.appendChild(emptyMessage);
				}
			} else {
				emptyMessage?.remove();
			}
		} finally {
			processing = false;

			// 処理後の結果内容を保存
			const blocks = getResultBlocks();

			previousResultState = JSON.stringify(blocks.map(block => {
				const data = getBlockData(block);
				if (!data) {
					return null;
				}

				return {
					heading: data.heading.textContent,
					items: data.items.map(item => ({
						text: item.textContent,
						rarity: getRarity(item)
					}))
				};
			}));

			// 結果内容が変化した場合だけスクロール
			if (resultChanged) {
				[...document.querySelectorAll('h2')].find(h2 => h2.textContent.trim() === 'Result') ?.scrollIntoView();
			}
		}
	}

	// ==========================================
	// ページ更新への対応
	// ==========================================
	function scheduleRefresh() {
		if (scheduled) return;

		scheduled = true;

		setTimeout(() => {
			scheduled = false;
			createToggleButton();

			if (enabled) {
				refreshResults();
			}
		}, 100);
	}

	function init() {
		createToggleButton();

		const observer = new MutationObserver(scheduleRefresh);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	init();
})();
