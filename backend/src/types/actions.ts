export type FormQuestion = {
	title: string;
	type: 'TEXT' | 'MULTIPLE_CHOICE';
	options?: string[];
};

export type WorkspaceAction =
	| { action: 'create_document'; title: string; content_prompt: string; sections?: string[] }
	| {
			action: 'create_spreadsheet';
			title: string;
			headers: string[];
			rows: Array<Array<string | number | boolean>>;
			include_formulas?: boolean;
		}
	| { action: 'create_presentation'; title: string; slide_prompts: string[] }
	| {
			action: 'create_event';
			summary: string;
			start_time: string;
			end_time: string;
			location?: string;
			description?: string;
		}
	| { action: 'create_form'; title: string; questions: FormQuestion[] }
	| { action: 'create_draft'; to: string; subject: string; body_prompt: string }
	| { action: 'send_email'; to: string; subject: string; body_prompt: string }
	| { action: 'list_files'; query?: string; limit?: number }
	| { action: 'search_drive'; query: string }
	| { action: 'clarify'; question: string }
	| {
			action: 'edit_presentation';
			operation: 'add_slide' | 'edit_slide' | 'delete_slide';
			fileId?: string;
			slide_prompt?: string;
			slide_index?: number;
			title?: string;
			body?: string;
		}
	| {
			action: 'edit_document';
			operation: 'add_section';
			fileId?: string;
			heading: string;
			content_prompt: string;
		}
	| {
			action: 'edit_spreadsheet';
			operation: 'add_row' | 'add_column';
			fileId?: string;
			row?: string[];
			header?: string;
		};

export type ParseResult = {
	action: WorkspaceAction;
	rawText?: string;
};
