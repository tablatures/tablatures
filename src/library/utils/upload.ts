export const SUPPORTED_TYPES = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.xml', '.cap', '.tex'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Value for the file input's `accept` attribute. NOT the same list as
 * SUPPORTED_TYPES, which stays the source of truth for validateFile().
 *
 * Android's file picker does not take extensions. Capacitor maps each `.ext`
 * through MimeTypeMap.getMimeTypeFromExtension() and silently drops everything
 * that does not resolve, then hands the survivors to the intent as
 * EXTRA_MIME_TYPES. None of gp3/gp4/gp5/gp are in Android's MIME table, so the
 * list collapsed to text/xml and every Guitar Pro file in the picker was greyed
 * out. Leading with a MIME type that does resolve keeps the picker open to the
 * unknown-binary files these actually are, and validateFile() still rejects
 * anything unsupported after the pick.
 */
export const ACCEPT_ATTR = ['application/octet-stream', ...SUPPORTED_TYPES].join(',');

export function validateFile(file: File): string | null {
	const extension = '.' + file.name.split('.').pop()?.toLowerCase();
	if (!SUPPORTED_TYPES.includes(extension)) {
		return `Unsupported file type. Supported: ${SUPPORTED_TYPES.join(', ')}`;
	}
	if (file.size > MAX_FILE_SIZE) {
		return 'File too large. Maximum size is 10MB.';
	}
	return null;
}

export function fileToBase64(file: Blob): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			// Strip the data URL prefix (e.g. "data:application/octet-stream;base64,")
			const base64 = result.includes(',') ? result.split(',')[1] : result;
			resolve(base64);
		};
		reader.onerror = (error) => reject(error);
	});
}
