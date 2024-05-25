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
				[/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
				[/\d+/, "number"],
				[/'[^\\']'/, "string.char"],
				[/"[^\\"]*"/, "string"],
				[/[~!%^&*+=|?:<>/-]+/, "operator"],
				[/\{/, "delimiter.curly"],
				[/\[/, "delimiter.square"],
				[/\(/, "delimiter.parenthesis"],
				[/\./, "delimiter.period"],
				[/\,/, "delimiter.comma"],
				[/;/, "delimiter.semicolon"],
				[/\s+/, "white"],
				[/\/\/.*$/, "comment"],
				[/\/\*/, "comment"]
			]
		}
	});

	const cppModel = monaco.editor.createModel("");
	cppModel.updateOptions({ insertSpaces: false, tabSize: 4 });
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
		theme: darkMode() ? "vs-dark" : "vs"
	});
	window.editor.getModel().updateOptions({
		insertSpaces: false, tabSize: 4,
	});
	window.editor.revealLine(7);
	window.editor.setPosition({ lineNumber: 7, column: 30 });
});


