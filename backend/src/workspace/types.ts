/** Successful /api/parse payload shape consumed by the frontend */
export type ParseRouteResult = {
	action: string;
	title?: string;
	url?: string;
	fileType: string;
	summary: string;
	items?: unknown[];
};
