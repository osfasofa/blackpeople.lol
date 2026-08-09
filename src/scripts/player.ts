/**
 * Feed playback.
 *
 * One YouTube IFrame player per section, created lazily. Whichever section is
 * more than 60% in view is the active one: it plays, everything else pauses.
 * Sound is off until the user asks for it once, then stays on for the session.
 */

const ACTIVE_RATIO = 0.6;
const SOUND_KEY = 'feed:sound';

interface YTPlayer {
	playVideo(): void;
	pauseVideo(): void;
	mute(): void;
	unMute(): void;
	getPlayerState(): number;
}

interface YTNamespace {
	Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
	PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
	interface Window {
		YT?: YTNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

interface Item {
	section: HTMLElement;
	mount: HTMLElement;
	videoId: string;
	player: YTPlayer | null;
	ready: boolean;
	requested: boolean;
}

const items: Item[] = [];
const bySection = new WeakMap<HTMLElement, Item>();

let active: Item | null = null;
/** True once the drawer (or anything else) has asked us to hold playback. */
let suspended = false;
let soundOn = readSound();

function readSound(): boolean {
	try {
		return sessionStorage.getItem(SOUND_KEY) === 'on';
	} catch {
		return false;
	}
}

function writeSound(on: boolean) {
	try {
		sessionStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
	} catch {
		/* private mode — sound still persists in memory for this page */
	}
}

/* ------------------------------------------------------------------ */
/* YouTube IFrame API                                                  */
/* ------------------------------------------------------------------ */

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
	if (apiPromise) return apiPromise;

	apiPromise = new Promise<void>((resolve) => {
		if (window.YT?.Player) {
			resolve();
			return;
		}
		// The API calls this global exactly once when it finishes loading.
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			resolve();
		};
		const script = document.createElement('script');
		script.src = 'https://www.youtube.com/iframe_api';
		script.async = true;
		document.head.appendChild(script);
	});

	return apiPromise;
}

function createPlayer(item: Item) {
	if (item.requested) return;
	item.requested = true;

	void loadApi().then(() => {
		const YT = window.YT;
		if (!YT) return;

		item.player = new YT.Player(item.mount, {
			videoId: item.videoId,
			playerVars: {
				// Muted at birth so the very first video is allowed to autoplay.
				mute: 1,
				autoplay: 0,
				controls: 0,
				rel: 0,
				modestbranding: 1,
				playsinline: 1,
				disablekb: 1,
				fs: 0,
				iv_load_policy: 3,
				// loop needs playlist set to the same id for a single video.
				loop: 1,
				playlist: item.videoId,
				origin: window.location.origin,
			},
			events: {
				onReady: () => {
					item.ready = true;
					item.section.dataset.state = 'ready';
					if (active === item) start(item);
					else item.player?.pauseVideo();
				},
				onStateChange: (event: { data: number }) => {
					const playing = event.data === YT.PlayerState.PLAYING;
					item.section.dataset.playing = playing ? 'true' : 'false';
				},
			},
		});
	});
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

function start(item: Item) {
	if (!item.player || !item.ready || suspended) return;
	if (soundOn) item.player.unMute();
	else item.player.mute();
	item.player.playVideo();
}

function pause(item: Item) {
	if (item.player && item.ready) item.player.pauseVideo();
}

function setActive(item: Item) {
	if (active === item) return;
	if (active) pause(active);
	active = item;

	for (const other of items) {
		other.section.dataset.active = other === item ? 'true' : 'false';
		if (other !== item) pause(other);
	}

	createPlayer(item);
	start(item);
}

/** Held while the comment drawer is open. */
export function pauseActive() {
	suspended = true;
	if (active) pause(active);
}

export function resumeActive() {
	suspended = false;
	if (active) start(active);
}

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

const soundButton = document.getElementById('sound-toggle');

function renderSoundUi() {
	document.documentElement.dataset.sound = soundOn ? 'on' : 'off';
	if (!soundButton) return;
	soundButton.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
	soundButton.setAttribute('aria-label', soundOn ? 'Mute' : 'Turn sound on');
}

function setSound(on: boolean) {
	soundOn = on;
	writeSound(on);
	if (active?.player && active.ready) {
		if (on) active.player.unMute();
		else active.player.mute();
		// The click is a user gesture, so this is a good moment to make sure
		// the active video is actually rolling.
		if (on && !suspended) active.player.playVideo();
	}
	renderSoundUi();
}

soundButton?.addEventListener('click', () => setSound(!soundOn));

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function init() {
	const sections = Array.from(
		document.querySelectorAll<HTMLElement>('[data-video-section]'),
	);

	for (const section of sections) {
		const mount = section.querySelector<HTMLElement>('[data-video-mount]');
		const videoId = section.dataset.videoId;
		if (!mount || !videoId) continue;

		const item: Item = {
			section,
			mount,
			videoId,
			player: null,
			ready: false,
			requested: false,
		};
		items.push(item);
		bySection.set(section, item);
	}

	if (!items.length) return;

	renderSoundUi();

	// Whichever section owns most of the screen wins.
	const thresholds = Array.from({ length: 21 }, (_, i) => i / 20);
	const activeObserver = new IntersectionObserver(
		(records) => {
			for (const record of records) {
				if (record.intersectionRatio < ACTIVE_RATIO) continue;
				const item = bySection.get(record.target as HTMLElement);
				if (item) setActive(item);
			}
		},
		{ threshold: thresholds },
	);

	// Build the player a screen early so scrolling into it isn't a cold start.
	const warmObserver = new IntersectionObserver(
		(records) => {
			for (const record of records) {
				if (!record.isIntersecting) continue;
				const item = bySection.get(record.target as HTMLElement);
				if (item) createPlayer(item);
			}
		},
		{ rootMargin: '100% 0px' },
	);

	for (const item of items) {
		activeObserver.observe(item.section);
		warmObserver.observe(item.section);
	}

	// Tapping the video toggles playback, the way you'd expect.
	for (const item of items) {
		const tap = item.section.querySelector<HTMLElement>('[data-video-tap]');
		tap?.addEventListener('click', () => {
			if (!item.player || !item.ready) return;
			const playing = item.section.dataset.playing === 'true';
			if (playing) item.player.pauseVideo();
			else item.player.playVideo();
		});
	}

	// A backgrounded tab shouldn't keep playing audio.
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			if (active) pause(active);
		} else if (!suspended && active) {
			start(active);
		}
	});
}

init();
