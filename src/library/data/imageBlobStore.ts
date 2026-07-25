// External byte store for cached artist/artwork images — bytes live as FILES,
// never as SQLite BLOB columns.
//
// WHY THIS EXISTS (perf): on NATIVE Android, @capacitor-community/sqlite marshals
// every query param and result row across the Capacitor JS↔native bridge as
// JSON/base64 on the WebView MAIN THREAD. Reading/writing tens-of-KB image blobs
// through that bridge blocks the UI and causes the "mega freezes" while the feed
// loads covers. So — exactly like tab binaries (see blobStore.ts) — image bytes
// are stored OUTSIDE the DB (OPFS on web, Capacitor Filesystem on native) and the
// `images` table keeps only a small metadata row (path + size + timestamps).
//
//   • web    → OPFS (`navigator.storage.getDirectory()`), an `images/` subdir.
//   • native → Capacitor Filesystem, `Directory.Data`, same `images/` subdir.
//
// The store is exposed behind a tiny interface so tests can inject an in-memory
// backend (neither OPFS nor Filesystem exists under Node/vitest).

import { arrayBufferToBase64, base64ToArrayBuffer } from '../utils/utils';

const DIR = 'images';

/** Backend contract for the image byte store. Paths are opaque to callers. */
export interface ImageByteStore {
	/** Persist bytes under `key`, returning the stored (relative) path. */
	save(key: string, bytes: Uint8Array): Promise<string>;
	/** Read bytes back by path, or null when the file is missing/unreadable. */
	read(path: string): Promise<Uint8Array | null>;
	/** Delete the file at `path` (no-op if missing). */
	remove(path: string): Promise<void>;
}

/** Map an arbitrary image key (e.g. `artist:foo bar`) to a safe file name. */
export function imageFileName(key: string): string {
	const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
	return `${safe}.img`;
}

async function isNative(): Promise<boolean> {
	if (typeof window === 'undefined') return false;
	const { Capacitor } = await import('@capacitor/core');
	return Capacitor.isNativePlatform();
}

/* ------------------------------- OPFS (web) ------------------------------- */

async function opfsDir(create: boolean): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(DIR, { create });
}

async function opfsSave(name: string, bytes: Uint8Array): Promise<void> {
	const dir = await opfsDir(true);
	const fh = await dir.getFileHandle(name, { create: true });
	const w = await fh.createWritable();
	await w.write(bytes.slice());
	await w.close();
}

async function opfsRead(name: string): Promise<Uint8Array> {
	const dir = await opfsDir(false);
	const fh = await dir.getFileHandle(name, { create: false });
	const file = await fh.getFile();
	return new Uint8Array(await file.arrayBuffer());
}

async function opfsDelete(name: string): Promise<void> {
	try {
		const dir = await opfsDir(false);
		await dir.removeEntry(name);
	} catch {
		/* already gone */
	}
}

/* --------------------------- Filesystem (native) -------------------------- */

async function nativeSave(name: string, bytes: Uint8Array): Promise<void> {
	const { Filesystem, Directory } = await import('@capacitor/filesystem');
	const copy = bytes.slice();
	await Filesystem.writeFile({
		path: `${DIR}/${name}`,
		data: arrayBufferToBase64(copy.buffer as ArrayBuffer),
		directory: Directory.Data,
		recursive: true
	});
}

async function nativeRead(name: string): Promise<Uint8Array> {
	const { Filesystem, Directory } = await import('@capacitor/filesystem');
	const res = await Filesystem.readFile({ path: `${DIR}/${name}`, directory: Directory.Data });
	return new Uint8Array(base64ToArrayBuffer(res.data as string));
}

async function nativeDelete(name: string): Promise<void> {
	try {
		const { Filesystem, Directory } = await import('@capacitor/filesystem');
		await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data });
	} catch {
		/* already gone */
	}
}

/* --------------------------- Real (platform) store ------------------------ */

function pathToName(path: string): string {
	return path.startsWith(`${DIR}/`) ? path.slice(DIR.length + 1) : path;
}

/** OPFS/Filesystem-backed store used in production. */
export const imageByteStore: ImageByteStore = {
	async save(key, bytes) {
		const name = imageFileName(key);
		if (await isNative()) await nativeSave(name, bytes);
		else await opfsSave(name, bytes);
		return `${DIR}/${name}`;
	},
	async read(path) {
		try {
			const name = pathToName(path);
			if (await isNative()) return await nativeRead(name);
			return await opfsRead(name);
		} catch {
			return null;
		}
	},
	async remove(path) {
		const name = pathToName(path);
		if (await isNative()) await nativeDelete(name);
		else await opfsDelete(name);
	}
};

/**
 * In-memory image byte store — used by unit tests (OPFS/Filesystem are absent
 * under Node). Behaviour-compatible with the real store.
 */
export function createMemoryImageByteStore(): ImageByteStore {
	const files = new Map<string, Uint8Array>();
	return {
		async save(key, bytes) {
			const path = `${DIR}/${imageFileName(key)}`;
			files.set(path, bytes.slice());
			return path;
		},
		async read(path) {
			const b = files.get(path);
			return b ? b.slice() : null;
		},
		async remove(path) {
			files.delete(path);
		}
	};
}
