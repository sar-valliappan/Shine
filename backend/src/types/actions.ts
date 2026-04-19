export type FormQuestion = {
	title: string;
	type: 'TEXT' | 'MULTIPLE_CHOICE';
	options?: string[];
};

export type EditDocumentOperation =
	| 'add_section'
	| 'insert_section'
	| 'append'
	| 'replace_text'
	| 'delete_text'
	| 'insert_table'
	| 'style_text'
	| 'set_font'
	| 'insert_page_break'
	| 'delete_section'
	| 'rename_document'
	| 'undo'
	| 'rewrite_document';

export type WorkspaceAction =
	| { action: 'create_document'; title: string; content_prompt: string; sections?: string[] }
	| {
			action: 'share_file';
			fileId?: string;
			fileUrl?: string;
			fileType?: 'doc' | 'sheet' | 'slides' | 'form' | 'drive';
			title?: string;
			recipients: string[];
			role?: 'reader' | 'commenter' | 'writer';
			notify?: boolean;
			message?: string;
		}
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
			content_prompt?: string;
			find_text?: string;
			replace_with?: string;
			match_case?: boolean;
			table_rows?: number;
			table_columns?: number;
			table_headers?: string[];
			table_data?: string[][];
			/** style_text / set_font */
			bold?: boolean;
			italic?: boolean;
			underline?: boolean;
			strikethrough?: boolean;
			font_family?: string;
			font_size?: number;
			/** delete_section */
			section_heading?: string;
			/** add_section / insert_section: insert before or after this heading (substring match); omit to append at end */
			section_anchor?: string;
			/** Placement relative to section_anchor; defaults to "after" when section_anchor is set */
			section_placement?: 'before' | 'after';
			/** rename_document */
			new_title?: string;
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
