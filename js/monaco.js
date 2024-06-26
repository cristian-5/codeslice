
require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.48.0/min/vs" }});
require([ "vs/editor/editor.main" ], function() {
	monaco.languages.register({ id: "c+-" });
	monaco.languages.setLanguageConfiguration("c+-", {
		comments: {
			lineComment: '//',
			blockComment: ['/*', '*/']
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		],
		autoClosingPairs: [
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '(', close: ')' },
			{ open: "'", close: "'", notIn: ['string', 'comment'] },
			{ open: '"', close: '"', notIn: ['string'] }
		],
		surroundingPairs: [
			{ open: '{', close: '}' },
			{ open: '[', close: ']' },
			{ open: '(', close: ')' },
			{ open: '"', close: '"' },
			{ open: "'", close: "'" }
		],
		folding: {
			markers: { start: /\{/, end: /\}/ },
			offSide: true
		},
		comments: {
			blockComment: [ '/*', '*/' ],
			lineComment: '//'
		}
	});
	monaco.languages.setMonarchTokensProvider("c+-", {
		brackets: [
			{ token: 'delimiter.curly', open: '{', close: '}' },
			{ token: 'delimiter.parenthesis', open: '(', close: ')' },
			{ token: 'delimiter.square', open: '[', close: ']' },
			{ token: 'delimiter.angle', open: '<', close: '>' }
		],
		keywords: [
			"int", "float", "char", "string", "bool",
			"if", "else",
			"switch", "case", "default",
			"while", "for", "do",
			"break", "continue",
			"true", "false"
		],
		tokenizer: {
			root: [
				[/[a-zA-Z_]\w*/, {
					cases: {
						'@keywords': { token: 'keyword.$0' },
						'@default': 'identifier'
					}
				}],
				{ include: '@whitespace' },
				[/\d+\.\d+/, "number.float"],
				[/\d+/, "number"],
				[/'[^\\']'/, "string.char"],
				[/"[^\\"]*"/, "string"],
				[/[~!%^&*\+\=\|\-]+/, "delimiter"],
				[/\./, "delimiter.period"],
				[/\,/, "delimiter.comma"],
				[/;/, "delimiter.semicolon"],
				[/<<|>>/, "delimiter.angle"],
				[/\/\/.*$/, "comment"],
				[/\//, "delimiter"],
			],
			comment: [
				[/[^\/*]+/, 'comment' ],
				[/\/\*/,    'comment', '@push' ], // nested comment
				["\\*/",    'comment', '@pop'  ],
				[/[\/*]/,   'comment' ]
			],
			whitespace: [
				[/[ \t\r\n]+/, 'white'],
				[/\/\*/,       'comment', '@comment' ],
				[/\/\/.*$/,    'comment'],
			],
		}
	});

	window.editor = monaco.editor.create(document.getElementById("monaco"), {
		value: localStorage.getItem("code") || "\ncout << \"Hello, world!\" << endl;\n",
		language: "c+-",
		codeLens: true,
		cursorStyle: "line",
		quickSuggestions: true,
		contextmenu: false,
		minimap: { enabled: false },
		fontSize: 16,
		automaticLayout: true,
		insertSpaces: false,
		stickyScroll: { enabled: false },
		selectOnLineNumbers: true,
		theme: darkMode() ? "vs-dark" : "vs"
	});
	editor.last_typing = 0;
	editor.is_typing = false;
	window.editor.onDidChangeModelContent(() => {
		monaco.editor.setModelMarkers(editor.getModel(), "owner", []);
		if (editor.last_typing < Date.now() - 1000) {
			editor.is_typing = false;
		} else {
			editor.is_typing = true;
			editor.last_typing = Date.now();
		}
	});
	window.setInterval(() => { if (!editor.is_typing) compile(); }, 1500);
});
