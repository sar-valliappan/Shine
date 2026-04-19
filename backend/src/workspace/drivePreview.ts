type DrivePreviewSource = {
	id?: string | null;
	mimeType?: string | null;
	webViewLink?: string | null;
};

export function buildDriveEmbedUrl(file: DrivePreviewSource): string | undefined {
	const fileId = file.id?.trim();
	if (!fileId) return undefined;

	const mimeType = file.mimeType || '';
	if (mimeType.includes('folder')) {
		return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(fileId)}#grid`;
	}
	if (mimeType.includes('spreadsheet')) {
		return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/preview`;
	}
	if (mimeType.includes('presentation')) {
		return `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/preview`;
	}
	if (mimeType.includes('document')) {
		return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/preview`;
	}
	if (mimeType.includes('form')) {
		return `https://docs.google.com/forms/d/${encodeURIComponent(fileId)}/viewform?embedded=true`;
	}

	return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

export function enrichDriveFile<T extends DrivePreviewSource>(file: T): T & { embedUrl?: string } {
	return {
		...file,
		embedUrl: buildDriveEmbedUrl(file),
	};
}