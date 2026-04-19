export type FormQuestion = {
	title: string;
	type: 'TEXT' | 'MULTIPLE_CHOICE';
	options?: string[];
};

export type EditDocumentOperation =
	| 'add_section'
	| 'append'
	| 'replace_text'
	| 'delete_text'
	| 'insert_table';

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
	| { action: 'edit_draft'; draft_id?: string; to: string; subject: string; body_prompt: string }
	| { action: 'send_email'; to: string; subject: string; body_prompt: string }
	| { action: 'list_files'; query?: string; limit?: number }
	| { action: 'search_drive'; query: string }
	| { action: 'clarify'; question: string }
	| {
			action: 'edit_document';
			fileId?: string;
			operation: EditDocumentOperation;
			heading?: string;
			/** Markdown or plain content for append / add_section */
			content_prompt?: string;
			/** For replace_text / delete_text */
			find_text?: string;
			replace_with?: string;
			match_case?: boolean;
			/** For insert_table */
			table_rows?: number;
			table_columns?: number;
			table_headers?: string[];
			table_data?: string[][];
		}
	| {
			action: 'edit_presentation';
			fileId?: string;
			operation: 'add_slide' | 'edit_slide' | 'delete_slide';
			slide_prompt?: string;
			slide_index?: number;
			title?: string;
			body?: string;
		}
	| {
			action: 'edit_spreadsheet';
			fileId?: string;
			operation: 'add_row' | 'add_column';
			row?: Array<string | number | boolean>;
			header?: string;
		};

export type ParseResult = {
	action: WorkspaceAction;
	rawText?: string;
};
