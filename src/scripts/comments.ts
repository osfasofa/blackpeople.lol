/**
 * Comment drawer.
 *
 * The whole site is one page, so giscus's usual "one thread per URL" mapping is
 * no use to us. Each post instead gets a thread keyed by its slug
 * (data-mapping="specific"), and we mount the widget the first time its drawer
 * is opened — never on page load, or four iframes would race each other for the
 * network before the first video even starts.
 *
 * Once mounted, a thread is kept in the DOM and just hidden, so reopening it is
 * instant and doesn't lose anything the user had typed.
 */

import { pauseActive, resumeActive } from './player';

const drawer = document.getElementById('comment-drawer');
const panel = drawer?.querySelector<HTMLElement>('[data-drawer-panel]');
const threads = drawer?.querySelector<HTMLElement>('[data-drawer-threads]');
const titleEl = drawer?.querySelector<HTMLElement>('[data-drawer-title]');
const closeButton = drawer?.querySelector<HTMLElement>('[data-drawer-close]');

if (drawer && panel && threads && titleEl) {
	const config = {
		repo: drawer.dataset.repo ?? '',
		repoId: drawer.dataset.repoId ?? '',
		category: drawer.dataset.category ?? '',
		categoryId: drawer.dataset.categoryId ?? '',
		mapping: drawer.dataset.mapping ?? 'specific',
		theme: drawer.dataset.theme ?? 'dark',
		lang: drawer.dataset.lang ?? 'en',
		reactionsEnabled: drawer.dataset.reactionsEnabled ?? '1',
		inputPosition: drawer.dataset.inputPosition ?? 'top',
	};
	const configured = drawer.dataset.configured === 'true';

	const mounted = new Map<string, HTMLElement>();
	let lastTrigger: HTMLElement | null = null;
	let open = false;

	function mountThread(term: string) {
		for (const [key, node] of mounted) node.hidden = key !== term;
		if (mounted.has(term)) return;

		const host = document.createElement('div');
		host.className = 'thread';

		const script = document.createElement('script');
		script.src = 'https://giscus.app/client.js';
		script.async = true;
		script.crossOrigin = 'anonymous';
		script.setAttribute('data-repo', config.repo);
		script.setAttribute('data-repo-id', config.repoId);
		script.setAttribute('data-category', config.category);
		script.setAttribute('data-category-id', config.categoryId);
		script.setAttribute('data-mapping', config.mapping);
		script.setAttribute('data-term', term);
		script.setAttribute('data-strict', '1');
		script.setAttribute('data-reactions-enabled', config.reactionsEnabled);
		script.setAttribute('data-emit-metadata', '0');
		script.setAttribute('data-input-position', config.inputPosition);
		script.setAttribute('data-theme', config.theme);
		script.setAttribute('data-lang', config.lang);
		script.setAttribute('data-loading', 'lazy');

		host.appendChild(script);
		threads!.appendChild(host);
		mounted.set(term, host);
	}

	function openDrawer(term: string, label: string, trigger: HTMLElement) {
		lastTrigger = trigger;
		open = true;
		titleEl!.textContent = label;
		drawer!.hidden = false;
		document.body.classList.add('is-drawer-open');
		// Let the browser paint the hidden state once so the transition runs.
		requestAnimationFrame(() => drawer!.classList.add('is-open'));
		pauseActive();
		if (configured) mountThread(term);
		closeButton?.focus();
	}

	function closeDrawer() {
		if (!open) return;
		open = false;
		drawer!.classList.remove('is-open');
		document.body.classList.remove('is-drawer-open');
		resumeActive();

		const finish = () => {
			if (!open) drawer!.hidden = true;
		};
		panel!.addEventListener('transitionend', finish, { once: true });
		// transitionend won't fire if the user prefers reduced motion.
		setTimeout(finish, 400);

		lastTrigger?.focus();
		lastTrigger = null;
	}

	for (const trigger of document.querySelectorAll<HTMLElement>('[data-comment-open]')) {
		trigger.addEventListener('click', () => {
			const term = trigger.dataset.commentOpen;
			if (term) openDrawer(term, trigger.dataset.commentLabel ?? 'Comments', trigger);
		});
	}

	closeButton?.addEventListener('click', closeDrawer);

	drawer.addEventListener('click', (event) => {
		if (event.target === drawer) closeDrawer();
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && open) closeDrawer();
	});
}
