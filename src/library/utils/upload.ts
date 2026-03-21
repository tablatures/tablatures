export const SUPPORTED_TYPES = ['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.xml', '.cap', '.tex'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
