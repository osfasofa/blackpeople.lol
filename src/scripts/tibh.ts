/**
 * TIBH.
 *
 * Tap the button, get a random fact for today's date in a thought bubble; tap
 * the bubble to go back to the feed. The facts come from /api/tibh, which does
 * the actual fetching — blackfacts.com sends no CORS headers, so the page can't
 * ask it for anything directly.
 *
 * A day's facts are fetched once and kept for the visit, so the second tap is
 * instant and the source isn't hit again on every click.
 */

import { pauseActive, resumeActive } from './player';

interface Fact {
	text: string;
	url: string | null;
}

const root = document.getElementById('tibh-bubble');
const button = document.querySelector<HTMLElement>('[data-tibh-open]');
const panel = root?.querySelector<HTMLElement>('[data-tibh-panel]');
const textEl = root?.querySelector<HTMLElement>('[data-tibh-text]');
const sourceEl = root?.querySelector<HTMLAnchorElement>('[data-tibh-source]');

if (root && button && panel && textEl && sourceEl) {
	const endpoint = root.dataset.endpoint || '/api/tibh';
	const sourceHome = root.dataset.sourceHome || 'https://www.blackfacts.com';

	const today = new Date();
	const month = today.getMonth() + 1;
	const day = today.getDate();
	/** Where the facts came from, for the link under the bubble. */
	const sourcePage = `${sourceHome}/facts/${month}/${day}`;

	let facts: Fact[] | null = null;
	let pending: Promise<Fact[]> | null = null;
	/** So a second tap doesn't hand back the fact already on screen. */
	let lastIndex = -1;
	let open = false;
	/** Bumped per open so a slow fetch can't overwrite a newer bubble. */
	let openCount = 0;

	/* -------------------------------------------------------------- */
	/* Facts                                                           */
	/* -------------------------------------------------------------- */

	function load(): Promise<Fact[]> {
		if (facts) return Promise.resolve(facts);
		if (pending) return pending;

		// The visitor's own date, so this rolls over at their midnight.
		pending = fetch(`${endpoint}?m=${month}&d=${day}`, {
			headers: { accept: 'application/json' },
		})
			.then((response) => {
				// `astro dev` doesn't serve the function; it answers with its own
				// 404 page, and parsing that as JSON would throw something
				// unhelpful. Check before trusting the body.
				const type = response.headers.get('content-type') ?? '';
				if (!response.ok || !type.includes('application/json')) {
					throw new Error(`tibh: ${response.status}`);
				}
				return response.json();
			})
			.then((data: { facts?: Fact[] }) => {
				const list = Array.isArray(data.facts) ? data.facts.filter((f) => f?.text) : [];
				facts = list;
				return list;
			})
			.catch(() => {
				// Don't cache the miss — the next tap gets a fresh go.
				pending = null;
				return [];
			});

		return pending;
	}

	function pick(list: Fact[]): Fact {
		if (list.length === 1) return list[0]!;
		let index = lastIndex;
		while (index === lastIndex) index = Math.floor(Math.random() * list.length);
		lastIndex = index;
		return list[index]!;
	}

	/* -------------------------------------------------------------- */
	/* Rendering                                                       */
	/* -------------------------------------------------------------- */

	function render(fact: Fact | null) {
		if (fact) {
			textEl!.textContent = fact.text;
			sourceEl!.href = fact.url ?? sourcePage;
			sourceEl!.hidden = false;
			return;
		}
		// Nothing came back: say so plainly and point at the source, rather
		// than leaving an empty bubble hanging there.
		textEl!.textContent = "Couldn't think of anything today — have a look for yourself.";
		sourceEl!.href = sourcePage;
		sourceEl!.hidden = false;
	}

	function renderThinking() {
		textEl!.textContent = '…';
		sourceEl!.hidden = true;
	}

	/* -------------------------------------------------------------- */
	/* Open / close                                                    */
	/* -------------------------------------------------------------- */

	function openBubble() {
		open = true;
		button!.setAttribute('aria-expanded', 'true');
		root!.hidden = false;
		// Paint the closed state once so the pop-in actually animates.
		requestAnimationFrame(() => root!.classList.add('is-open'));
		pauseActive();
		panel!.focus();

		if (facts) {
			render(facts.length ? pick(facts) : null);
			return;
		}

		renderThinking();
		const generation = ++openCount;
		void load().then((list) => {
			// They may have shut it and reopened while we were fetching.
			if (!open || generation !== openCount) return;
			render(list.length ? pick(list) : null);
		});
	}

	function closeBubble() {
		if (!open) return;
		open = false;
		button!.setAttribute('aria-expanded', 'false');
		root!.classList.remove('is-open');
		resumeActive();

		const finish = () => {
			if (!open) root!.hidden = true;
		};
		panel!.addEventListener('transitionend', finish, { once: true });
		// transitionend never fires under prefers-reduced-motion.
		setTimeout(finish, 300);

		button!.focus();
	}

	button.addEventListener('click', () => (open ? closeBubble() : openBubble()));

	// Anywhere on the bubble — or the space around it — puts the feed back.
	root.addEventListener('click', (event) => {
		// ...except the source link, which has somewhere else to be.
		if ((event.target as Element | null)?.closest('[data-tibh-source]')) return;
		closeBubble();
	});

	// The panel takes focus on open, so this is the keyboard equivalent.
	panel.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			closeBubble();
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && open) closeBubble();
	});
}
