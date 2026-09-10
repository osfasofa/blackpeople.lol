/**
 * TIBH — today's facts, fetched from blackfacts.com.
 *
 * This runs as a Vercel Function rather than in the browser because
 * blackfacts.com doesn't send CORS headers: a `fetch()` from the page itself
 * would be refused. It also means the site stays a static Astro build with no
 * adapter — the `api/` directory at the repo root is Vercel's, not Astro's, so
 * the build never sees this file.
 *
 * The URL carries the month and day (/facts/9/10), so the answer rotates on
 * its own — nothing needs redeploying for tomorrow's facts.
 *
 * Heads up: the extraction below is written defensively against HTML nobody
 * here could load (blackfacts.com is blocked from the machine this was written
 * on). It tries the most structured source first and falls back. If the site's
 * markup doesn't match any of the three, `facts` comes back empty and the page
 * shows a link to the source instead of a broken bubble — see extractFacts().
 */

const SOURCE = 'https://www.blackfacts.com';
const UPSTREAM_TIMEOUT_MS = 8000;
/** Shorter than this is a nav label or a date stamp, not a fact. */
const MIN_FACT_LENGTH = 40;
/** A thought bubble can't hold an essay; the rest is a click away. */
const MAX_FACT_LENGTH = 420;
const MAX_FACTS = 40;

/** A given day's facts don't change, so a warm instance keeps them. */
const memo = new Map();

export default async function handler(req, res) {
	const { month, day } = resolveDate(req);
	const url = `${SOURCE}/facts/${month}/${day}`;
	const key = `${month}/${day}`;

	// Let Vercel's edge answer most hits, so a busy day is a few requests
	// upstream rather than one per visitor.
	res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

	if (memo.has(key)) {
		res.status(200).json(memo.get(key));
		return;
	}

	try {
		const html = await fetchPage(url);
		const facts = extractFacts(html);
		const payload = { month, day, source: url, facts };
		if (facts.length) memo.set(key, payload);
		res.status(200).json(payload);
	} catch {
		// Never cache a failure: the client falls back to a link, and the next
		// visitor should get a fresh attempt.
		res.setHeader('Cache-Control', 'no-store');
		res.status(502).json({ month, day, source: url, facts: [], error: 'upstream_unavailable' });
	}
}

/* ------------------------------------------------------------------ */
/* Date                                                                */
/* ------------------------------------------------------------------ */

/**
 * The visitor's own month and day when they send one, so someone reading at
 * 11pm in Auckland gets their date rather than the server's. Anything
 * malformed falls back to Eastern, which is where this site is written.
 */
function resolveDate(req) {
	const query = req.query ?? {};
	const month = asDatePart(query.m, 1, 12);
	const day = asDatePart(query.d, 1, 31);
	if (month && day) return { month, day };

	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		month: 'numeric',
		day: 'numeric',
	}).formatToParts(new Date());

	return {
		month: Number(parts.find((p) => p.type === 'month')?.value),
		day: Number(parts.find((p) => p.type === 'day')?.value),
	};
}

function asDatePart(raw, min, max) {
	const value = Number(Array.isArray(raw) ? raw[0] : raw);
	return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

async function fetchPage(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		headers: {
			// A bare fetch UA gets turned away by a lot of hosts.
			'user-agent': 'Mozilla/5.0 (compatible; blackpeople.lol/1.0; +https://blackpeople.lol)',
			accept: 'text/html,application/xhtml+xml',
			'accept-language': 'en-US,en;q=0.9',
		},
	});
	if (!response.ok) throw new Error(`upstream ${response.status}`);
	return response.text();
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/**
 * Three passes, most structured first; the first one that finds anything wins.
 * Should blackfacts.com restyle, this is the only function that needs redoing —
 * everything downstream just takes a list of { text, url }.
 */
function extractFacts(html) {
	const body = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
	const seen = new Set();
	const facts = [];

	const add = (raw, href) => {
		if (facts.length >= MAX_FACTS) return;
		const text = normalise(raw);
		if (!isFactLike(text)) return;
		// Same fact often appears as both a card and a heading.
		const key = text.slice(0, 80).toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		facts.push({ text: truncate(text), url: absolute(href) });
	};

	for (const strategy of [fromJsonLd, fromFactLinks, fromHeadings]) {
		strategy(strategy === fromJsonLd ? html : body, add);
		if (facts.length) break;
	}

	return facts;
}

/** Schema.org blocks, if the site publishes them. The cleanest source by far. */
function fromJsonLd(html, add) {
	const blocks = html.matchAll(
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	);
	for (const [, json] of blocks) {
		try {
			walkJson(JSON.parse(json.trim()), add, 0);
		} catch {
			/* one malformed block shouldn't cost us the others */
		}
	}
}

function walkJson(node, add, depth) {
	if (!node || depth > 6) return;
	if (Array.isArray(node)) {
		for (const child of node) walkJson(child, add, depth + 1);
		return;
	}
	if (typeof node !== 'object') return;

	const text = node.articleBody ?? node.description ?? node.headline ?? node.name;
	if (typeof text === 'string') add(text, node.url ?? node['@id']);

	for (const value of Object.values(node)) {
		if (value && typeof value === 'object') walkJson(value, add, depth + 1);
	}
}

/** Links out to individual fact pages, which is how an index page usually reads. */
function fromFactLinks(html, add) {
	const links = html.matchAll(/<a\b[^>]*href=["']([^"']*\/fact\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi);
	for (const [, href, inner] of links) add(inner, href);
}

/** Last resort: the card headings themselves. */
function fromHeadings(html, add) {
	const headings = html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi);
	for (const [, inner] of headings) add(inner, null);
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	mdash: '—',
	ndash: '–',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
};

function normalise(raw) {
	if (typeof raw !== 'string') return '';
	return decodeEntities(raw.replace(/<[^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeEntities(text) {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
		if (code[0] === '#') {
			const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
			return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
		}
		return ENTITIES[code.toLowerCase()] ?? whole;
	});
}

/** Nav chrome and boilerplate that any of the three passes can pick up. */
const NOT_A_FACT =
	/^(sign in|sign up|log in|register|search|home|menu|share|read more|subscribe|newsletter|privacy|terms|cookie|advertisement|related|categories|browse|donate|contact)\b/i;

function isFactLike(text) {
	if (text.length < MIN_FACT_LENGTH) return false;
	if (NOT_A_FACT.test(text)) return false;
	// Real sentences; a long breadcrumb trail isn't one.
	return text.split(/\s+/).length >= 7;
}

function truncate(text) {
	if (text.length <= MAX_FACT_LENGTH) return text;
	const cut = text.slice(0, MAX_FACT_LENGTH);
	const stop = cut.lastIndexOf(' ');
	return `${(stop > MAX_FACT_LENGTH * 0.6 ? cut.slice(0, stop) : cut).trimEnd()}…`;
}

function absolute(href) {
	if (typeof href !== 'string' || !href) return null;
	try {
		const url = new URL(href, SOURCE);
		// Never hand the page a javascript: or data: link scraped from elsewhere.
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}
