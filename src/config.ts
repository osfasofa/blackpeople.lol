/**
 * Site-wide knobs. Everything you're likely to want to fiddle with lives here.
 */

export const site = {
	title: 'blackpeople.lol',
	description: 'A scrolling feed of songs I like.',
};

/**
 * The text that sits over the bottom of each video.
 *
 * `show: false` gives you a completely bare feed — just video, sound toggle and
 * comment button. Visual styling (gradient height, opacity, type scale) is in
 * src/styles/global.css under the "OVERLAY" heading.
 */
export const overlay = {
	show: true,
	showBlurb: true,
};

/**
 * giscus — comments backed by GitHub Discussions.
 *
 * repoId and categoryId cannot be derived from code; you generate them on
 * https://giscus.app by entering the repo. See README "Comment setup".
 * Until both are filled in, the drawer opens and shows a setup notice instead
 * of a broken widget.
 */
export const giscus = {
	repo: 'osfasofa/blackpeople.lol',
	repoId: '',
	category: 'Comments',
	categoryId: '',
	/** 'specific' + a per-post term is what lets one page host many threads. */
	mapping: 'specific',
	theme: 'dark',
	lang: 'en',
	reactionsEnabled: '1',
	inputPosition: 'top',
} as const;

export const isGiscusConfigured = Boolean(giscus.repoId && giscus.categoryId);
