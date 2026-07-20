// External blob store — tab binaries live as FILES, never as BLOB columns.
//
// SQLite is great for structured rows + FTS but poor at holding many multi-MB
// blobs (page churn, whole-DB VACUUM cost, IDB growth on wasm). Per SQLite's
// own "internal vs external BLOB" guidance we keep the bytes outside the DB and
// store only the path in `tabs.blob_path`.
//
//   • web    → OPFS (`navigator.storage.getDirectory()`), a `tabs/` subdir.
//   • native → Capacitor Filesystem, `Directory.Data` (app-private, not subject
//              to browser eviction), same `tabs/` subdir.
//
// One API, two backends, chosen by `Capacitor.isNativePlatform()`. The native
// path hops through base64 (the Filesystem API speaks base64), reusing the
// existing helpers from utils.ts.

import { arrayBufferToBase64, base64ToArrayBuffer } from '../utils/utils';

const DIR = 'tabs';

/** Make an id safe to use as a file name (ids can contain ':' etc.). */
export function blobFileName(id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
	return `${safe}.tab`;
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
	// Copy into a fresh ArrayBuffer so we never pass a SharedArrayBuffer view.
	await w.write(bytes.slice());
	await w.close();
}

async function opfsRead(name: string): Promise<ArrayBuffer> {
	const dir = await opfsDir(false);
	const fh = await dir.getFileHandle(name, { create: false });
	const file = await fh.getFile();
	return file.arrayBuffer();
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
	// Copy into a standalone (non-shared) ArrayBuffer for the base64 hop.
	const copy = bytes.slice();
	await Filesystem.writeFile({
		path: `${DIR}/${name}`,
		data: arrayBufferToBase64(copy.buffer as ArrayBuffer),
		directory: Directory.Data,
		recursive: true
	});
}

async function nativeRead(name: string): Promise<ArrayBuffer> {
	const { Filesystem, Directory } = await import('@capacitor/filesystem');
	const res = await Filesystem.readFile({ path: `${DIR}/${name}`, directory: Directory.Data });
	return base64ToArrayBuffer(res.data as string);
}

async function nativeDelete(name: string): Promise<void> {
	try {
		const { Filesystem, Directory } = await import('@capacitor/filesystem');
		await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data });
	} catch {
		/* already gone */
	}
}

/* --------------------------------- API ------------------------------------ */

/** Persist bytes for a tab id and return the stored path (relative). */
export async function saveBlob(id: string, bytes: Uint8Array): Promise<string> {
	const name = blobFileName(id);
	if (await isNative()) await nativeSave(name, bytes);
	else await opfsSave(name, bytes);
	return `${DIR}/${name}`;
}

/** Read a blob back by the path returned from `saveBlob`. */
export async function readBlob(path: string): Promise<ArrayBuffer> {
	const name = path.startsWith(`${DIR}/`) ? path.slice(DIR.length + 1) : path;
	if (await isNative()) return nativeRead(name);
	return opfsRead(name);
}

/** Delete a blob by path (no-op if missing). */
export async function deleteBlob(path: string): Promise<void> {
	const name = path.startsWith(`${DIR}/`) ? path.slice(DIR.length + 1) : path;
	if (await isNative()) await nativeDelete(name);
	else await opfsDelete(name);
}

/**
 * Best-effort total bytes used by the app's storage. On web this is the
 * browser's `StorageManager.estimate().usage` (covers OPFS + caches). On native
 * we sum the `tabs/` directory. Returns 0 when unavailable.
 */
export async function usage(): Promise<number> {
	try {
		if (await isNative()) {
			const { Filesystem, Directory } = await import('@capacitor/filesystem');
			const list = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
			let total = 0;
			for (const f of list.files) {
				// Newer Filesystem returns FileInfo objects with `size`.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const size = (f as any)?.size;
				if (typeof size === 'number') total += size;
			}
			return total;
		}
		if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
			const est = await navigator.storage.estimate();
			return est.usage ?? 0;
		}
	} catch {
		/* ignore */
	}
	return 0;
}
