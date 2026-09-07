/**
 * Feed playback.
 *
 * One YouTube IFrame player per section, created lazily. Whichever section is
 * more than 60% in view is the active one: it plays, everything else pauses.
 *
 * The rule is that when you land here it's already playing. There is no play
 * button anywhere. The order of attack:
 *
 *   1. Autoplay with sound, if the browser will allow it (probed up front with
 *      a silent clip so we know before the first player is even built).
 *   2. Autoplay muted, which nearly every browser allows.
 *   3. If even that is refused, the first gesture of any kind — a tap, a
 *      swipe to scroll, a key — kicks the active video off.
 *
 * Until the first frame is rolling, the section shows the video's thumbnail
 * over the iframe, so YouTube's own poster-with-play-button is never seen.
 * Sound, once the user has touched the toggle, stays how they left it for the
 * session.
 */

const ACTIVE_RATIO = 0.6;
const SOUND_KEY = 'feed:sound';
/** How long we give a player to reach PLAYING before trying a different way. */
const START_GRACE_MS = 1500;

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
	/** The user tapped to pause this one; leave it alone until they tap again. */
	userPaused: boolean;
}

const items: Item[] = [];
const bySection = new WeakMap<HTMLElement, Item>();

let active: Item | null = null;
/** True once the drawer (or anything else) has asked us to hold playback. */
let suspended = false;

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

type SoundPref = 'on' | 'off' | null;

function readSound(): SoundPref {
	try {
		const value = sessionStorage.getItem(SOUND_KEY);
		return value === 'on' || value === 'off' ? value : null;
	} catch {
		return null;
	}
}

function writeSound(on: boolean) {
	try {
		sessionStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
	} catch {
		/* private mode — sound still persists in memory for this page */
	}
}

/** What the user chose, if they've chosen. null means we get to decide. */
const storedSound = readSound();
let soundOn = storedSound === 'on';

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
		if (on && !suspended) {
			active.userPaused = false;
			active.player.playVideo();
		}
	}
	renderSoundUi();
}

soundButton?.addEventListener('click', () => setSound(!soundOn));

/**
 * A short silent WAV, built by hand so there's nothing to fetch. Playing it
 * unmuted tells us whether this browser will autoplay with sound right now.
 */
function silentClip(): string {
	const sampleRate = 8000;
	const samples = 400; // 50ms
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + samples, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
	view.setUint16(32, 1, true); // block align
	view.setUint16(34, 8, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, samples, true);
	bytes.fill(128, 44); // 8-bit PCM silence sits at the midpoint
	return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

let unmutedProbe: Promise<boolean> | null = null;

function canAutoplayWithSound(): Promise<boolean> {
	if (unmutedProbe) return unmutedProbe;

	unmutedProbe = new Promise<boolean>((resolve) => {
		let url = '';
		const done = (ok: boolean) => {
			if (url) URL.revokeObjectURL(url);
			resolve(ok);
		};
		try {
			url = silentClip();
			const audio = new Audio(url);
			const attempt = audio.play();
			if (!attempt) {
				done(false);
				return;
			}
			attempt.then(
				() => {
					audio.pause();
					done(true);
				},
				() => done(false),
			);
			// Don't let a stuck decode hold up the first video.
			setTimeout(() => done(false), 1000);
		} catch {
			done(false);
		}
	});

	return unmutedProbe;
}

let soundDecision: Promise<void> | null = null;

/** Settle whether the first player is born muted. Runs once. */
function decideSound(): Promise<void> {
	if (soundDecision) return soundDecision;

	soundDecision =
		storedSound !== null
			? Promise.resolve()
			: canAutoplayWithSound().then((ok) => {
					// The user may have hit the toggle while we were probing.
					if (ok && readSound() === null) {
						soundOn = true;
						renderSoundUi();
					}
				});

	return soundDecision;
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

function isPlaying(item: Item): boolean {
	return item.section.dataset.playing === 'true';
}

function createPlayer(item: Item) {
	if (item.requested) return;
	item.requested = true;

	void Promise.all([loadApi(), decideSound()]).then(() => {
		const YT = window.YT;
		if (!YT) return;

		item.player = new YT.Player(item.mount, {
			videoId: item.videoId,
			playerVars: {
				// The one on screen asks YouTube to autoplay from the iframe
				// itself, which browsers trust more than a later API call.
				// Warm-ups wait; onReady parks them.
				autoplay: active === item ? 1 : 0,
				mute: soundOn ? 0 : 1,
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
					if (active === item) {
						start(item);
						watchStart(item);
					} else {
						item.player?.pauseVideo();
					}
				},
				onStateChange: (event: { data: number }) => {
					const playing = event.data === YT.PlayerState.PLAYING;
					item.section.dataset.playing = playing ? 'true' : 'false';
					// First real frame: drop the thumbnail and show the iframe.
					if (playing) item.section.dataset.started = 'true';
				},
			},
		});
	});
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

function start(item: Item) {
	if (!item.player || !item.ready || suspended || item.userPaused) return;
	if (soundOn) item.player.unMute();
	else item.player.mute();
	item.player.playVideo();
}

function pause(item: Item) {
	if (item.player && item.ready) item.player.pauseVideo();
}

/**
 * The unmuted attempt can still be refused even after a clean probe (YouTube
 * has its own opinions). If nothing is rolling shortly after ready, drop to
 * muted and try again. Past that, the gesture fallback takes over.
 */
function watchStart(item: Item) {
	setTimeout(() => {
		if (active !== item || suspended || document.hidden) return;
		if (isPlaying(item) || item.userPaused) return;
		if (soundOn) {
			// Only our own guess gets overridden; a user's "on" stays "on" in
			// storage and they can tap the toggle to bring it back.
			soundOn = false;
			renderSoundUi();
		}
		start(item);
	}, START_GRACE_MS);
}

function setActive(item: Item) {
	if (active === item) return;
	if (active) pause(active);
	active = item;
	// Scrolling back to something you paused earlier means "play it again".
	item.userPaused = false;

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
/* Gesture fallback                                                    */
/* ------------------------------------------------------------------ */

/**
 * Any interaction with the page is a user activation, and once the page has
 * one, the players inside it are allowed to start. So every gesture that
 * isn't already handled by a button gets used to make sure the active video
 * is rolling. A swipe to scroll counts, which is most of what people do here.
 */
function onGesture(event: Event) {
	if (!active || suspended || document.hidden) return;
	if (active.userPaused || isPlaying(active)) return;

	const target = event.target as Element | null;
	// Buttons and the drawer do their own thing with the same gesture.
	if (target?.closest('button, a, input, textarea, select, [data-drawer-panel]')) return;

	createPlayer(active);
	start(active);
}

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
			userPaused: false,
		};
		items.push(item);
		bySection.set(section, item);
	}

	if (!items.length) return;

	renderSoundUi();
	// Kick the probe off now so it's finished by the time the API arrives.
	void decideSound();

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
			if (isPlaying(item)) {
				item.userPaused = true;
				item.player.pauseVideo();
			} else {
				item.userPaused = false;
				if (soundOn) item.player.unMute();
				item.player.playVideo();
			}
		});
	}

	// These are the events browsers count as activation: the end of a touch
	// or click, and a keypress. Capture so nothing can swallow them first.
	for (const type of ['pointerup', 'touchend', 'keydown']) {
		document.addEventListener(type, onGesture, { capture: true, passive: true });
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
