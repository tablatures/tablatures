// Lyrics utilities: Guitar Pro flavor detection for import encoding, plus
// (added in later commits) embedded-lyrics extraction and LRC parsing.
//
// alphaTab decodes legacy Guitar Pro strings with TextDecoder using
// settings.importer.encoding (default 'utf-8'). GP3/4/5 binaries store text in
// a legacy codepage (windows-1252 for Western files), so accented characters
// come back as U+FFFD unless we switch the encoding for those inputs. GP6/7
// files are UTF-8 ZIP containers and must keep the default.

export type GpFlavor = 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'unknown';

// The GP3/4/5 version header is a byte-length-prefixed ASCII string such as
// 'FICHIER GUITAR PRO v5.00'. The length byte never exceeds the 30-byte field.
const GP_VERSION_RE = /FICHIER GUITAR PRO v(\d)/;

/**
 * Sniff the Guitar Pro flavor from the raw file bytes.
 * - 'gp3'/'gp4'/'gp5': legacy binary formats with a version pascal-string.
 * - 'gpx': GP6/GP7 ZIP container (starts with the PK magic).
 * - 'unknown': anything else (alphaTeX, MusicXML, capella, truncated...).
 */
export function detectGpFlavor(data: ArrayBufferLike | Uint8Array): GpFlavor {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	if (bytes.length < 2) return 'unknown';

	// ZIP containers (.gpx GP6, .gp GP7) begin with 'PK'.
	if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'gpx';

	// Legacy version pascal-string at the very start.
	const len = bytes[0];
	if (len > 0 && len < 31 && bytes.length > len) {
		let header = '';
		for (let i = 1; i <= len; i++) header += String.fromCharCode(bytes[i]);
		const match = header.match(GP_VERSION_RE);
		if (match) {
			if (match[1] === '3') return 'gp3';
			if (match[1] === '4') return 'gp4';
			if (match[1] === '5') return 'gp5';
		}
	}

	return 'unknown';
}

/** GP3/4/5 are the legacy binaries whose text needs windows-1252 decoding. */
export function isLegacyGpFlavor(flavor: GpFlavor): boolean {
	return flavor === 'gp3' || flavor === 'gp4' || flavor === 'gp5';
}

interface ImporterConfigurable {
	settings?: { importer?: { encoding?: string } };
	updateSettings?: () => void;
}

/**
 * Scope the importer text encoding to the buffer about to be loaded, then push
 * the settings so the next api.load() decodes with it. Legacy GP3/4/5 get
 * windows-1252; everything else keeps utf-8. Returns the detected flavor.
 */
export function configureImporterEncoding(
	api: ImporterConfigurable | null | undefined,
	data: ArrayBufferLike | Uint8Array
): GpFlavor {
	const flavor = detectGpFlavor(data);
	if (api && api.settings) {
		if (!api.settings.importer) api.settings.importer = {};
		api.settings.importer.encoding = isLegacyGpFlavor(flavor) ? 'windows-1252' : 'utf-8';
		api.updateSettings?.();
	}
	return flavor;
}

// ---------------------------------------------------------------------------
// Embedded lyrics model
// ---------------------------------------------------------------------------
// alphaTab attaches lyrics to beats as beat.lyrics: string[] (index = verse
// line). We read verse 0, group the per-beat chunks into display lines, and
// keep each chunk's beat reference so the karaoke overlay can highlight the
// sung chunk and seek to it on tap.

export interface LyricChunk {
	text: string;
	barIndex: number;
	// The alphaTab Beat this chunk hangs on. Untyped: the CDN build has no
	// bundled types and we only ever pass it back to the api for seeking.
	beat: unknown;
}

export interface LyricLine {
	text: string;
	chunks: LyricChunk[];
}

export interface EmbeddedLyrics {
	lines: LyricLine[];
}

// Minimal structural views of the alphaTab score graph we walk.
interface BeatLike {
	lyrics?: (string | null)[] | null;
}
interface VoiceLike {
	beats?: BeatLike[];
}
interface BarLike {
	masterBar?: { index?: number };
	voices?: VoiceLike[];
}
interface StaffLike {
	bars?: BarLike[];
}
interface TrackLike {
	staves?: StaffLike[];
}
interface ScoreLike {
	tracks?: TrackLike[];
}

// Soft cap so a file with one unbroken lyric stream still wraps into readable
// lines instead of one giant scroll.
const MAX_CHUNKS_PER_LINE = 12;

/** Join chunks into a readable line, honoring trailing '-' syllable joins. */
export function joinLyricChunks(chunks: LyricChunk[]): string {
	let out = '';
	for (const chunk of chunks) {
		const text = chunk.text.trim();
		if (!text) continue;
		if (!out) out = text;
		else if (/-$/.test(out)) out = out.slice(0, -1) + text;
		else out += ' ' + text;
	}
	return out;
}

/**
 * Group ordered lyric chunks into display lines. Heuristic and deliberately
 * simple: break after sentence punctuation or an explicit newline, when a full
 * bar passes with no lyric (a phrase gap), or at a soft length cap.
 */
export function groupChunksIntoLines(chunks: LyricChunk[]): LyricLine[] {
	const lines: LyricLine[] = [];
	let current: LyricChunk[] = [];
	let prevBar = -1;

	const flush = () => {
		if (!current.length) return;
		const text = joinLyricChunks(current);
		if (text) lines.push({ text, chunks: current });
		current = [];
	};

	for (const chunk of chunks) {
		if (current.length && prevBar >= 0 && chunk.barIndex - prevBar > 1) flush();
		current.push(chunk);
		prevBar = chunk.barIndex;
		if (/[.?!\n]$/.test(chunk.text) || current.length >= MAX_CHUNKS_PER_LINE) flush();
	}
	flush();
	return lines;
}

function collectTrackLyricChunks(track: TrackLike): LyricChunk[] {
	const chunks: LyricChunk[] = [];
	for (const staff of track.staves || []) {
		for (const bar of staff.bars || []) {
			const barIndex = bar.masterBar?.index ?? 0;
			const voice = bar.voices?.[0];
			if (!voice) continue;
			for (const beat of voice.beats || []) {
				const text = beat.lyrics?.[0];
				if (typeof text === 'string' && text.trim()) {
					chunks.push({ text: text.trim(), barIndex, beat });
				}
			}
		}
		// A vocal line lives on a single staff; the first with lyrics wins.
		if (chunks.length) break;
	}
	return chunks;
}

/**
 * Extract embedded lyrics from a score. Returns the first track that carries
 * beat lyrics, grouped into display lines, or null when nothing is embedded.
 */
export function extractEmbeddedLyrics(score: ScoreLike | null | undefined): EmbeddedLyrics | null {
	if (!score?.tracks) return null;
	for (const track of score.tracks) {
		const chunks = collectTrackLyricChunks(track);
		if (chunks.length) {
			const lines = groupChunksIntoLines(chunks);
			if (lines.length) return { lines };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Synced (LRC) lyrics
// ---------------------------------------------------------------------------

export interface SyncedLine {
	timeMs: number;
	text: string;
}

export interface SyncedLyrics {
	lines: SyncedLine[];
}

// [mm:ss.xx] or [mm:ss.xxx] or [mm:ss]. Global so a line can carry several.
const LRC_TIME_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
// Enhanced (word-level) tags like <00:12.34>; stripped in v1.
const LRC_WORD_TAG_RE = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;

/**
 * Parse standard LRC text into time-sorted lines. Metadata tags (ar, ti,...)
 * carry no timestamp and are skipped; enhanced word tags are stripped.
 */
export function parseLrc(text: string): SyncedLyrics {
	const lines: SyncedLine[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const times: number[] = [];
		let match: RegExpExecArray | null;
		LRC_TIME_RE.lastIndex = 0;
		while ((match = LRC_TIME_RE.exec(raw)) !== null) {
			const min = parseInt(match[1], 10);
			const sec = parseInt(match[2], 10);
			const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
			times.push(min * 60000 + sec * 1000 + frac);
		}
		if (!times.length) continue;
		const content = raw.replace(LRC_TIME_RE, '').replace(LRC_WORD_TAG_RE, '').trim();
		for (const t of times) lines.push({ timeMs: t, text: content });
	}
	lines.sort((a, b) => a.timeMs - b.timeMs);
	return { lines };
}

/**
 * Index of the line active at timeMs (last line whose timestamp has passed),
 * or -1 before the first line. Binary search over the sorted lines.
 */
export function currentLineIndex(synced: SyncedLyrics, timeMs: number): number {
	const lines = synced.lines;
	let lo = 0;
	let hi = lines.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (lines[mid].timeMs <= timeMs) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}
