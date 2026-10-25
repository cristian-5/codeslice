
require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs" }});
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
		types: [ "void", "int", "float", "double", "char", "bool" ],
		classTypes: [ "string" ],
		controls: [
			"if", "else",
			"switch", "case", "default",
			"while", "for", "do",
			"break", "continue",
			"return"
		],
		keywords: [
			"true", "false",
			"namespace", "using", "const"
		],
		tokenizer: {
			root: [
				// #include <iostream>
				[/(#\s*include)(\s*)(<[^>\n]*>)/, [ 'keyword.directive', 'white', 'string.include' ]],
				[/#\s*[a-zA-Z_]*/, 'keyword.directive'],
				// namespace std;
				[/(namespace)(\s+)([a-zA-Z_]\w*)/, [ 'keyword', 'white', 'namespace' ]],
				// std::cout
				[/[a-zA-Z_]\w*(?=\s*::)/, 'namespace'],
				// name(   -> function (but not if(, while(...)
				[/[a-zA-Z_]\w*(?=\s*\()/, {
					cases: {
						'@controls': 'keyword.control',
						'@keywords': 'keyword',
						'@types': 'type.primitive',
						'@classTypes': 'type',
						'@default': 'entity.name.function'
					}
				}],
				[/[a-zA-Z_]\w*/, {
					cases: {
						'@controls': 'keyword.control',
						'@keywords': 'keyword',
						'@types': 'keyword',
						'@classTypes': 'type',
						'@default': 'identifier'
					}
				}],
				{ include: '@whitespace' },
				[/\d+\.\d+/, "number.float"],
				[/\d+/, "number"],
				[/'[^\\']'/, "string.char"],
				[/"[^\\"]*"/, "string"],
				[/[{}()\[\]]/, '@brackets'],
				[/<<|>>/, "delimiter.angle"],
				[/[<>]=?/, "delimiter"],
				[/[~!%^&*\+\=\|\-:]+/, "delimiter"],
				[/\./, "delimiter.period"],
				[/\,/, "delimiter.comma"],
				[/;/, "delimiter.semicolon"],
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

	monaco.editor.defineTheme("csl-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "keyword", foreground: "569CD6" },
			{ token: "type.primitive", foreground: "569CD6" },
			{ token: "keyword.control", foreground: "C586C0" },
			{ token: "identifier", foreground: "9CDCFE" }
		],
		colors: {
            // Force all regular bracket/indent lines to a uniform subtle gray
            "editorBracketPairGuide.background1": "#404040",
            "editorBracketPairGuide.background2": "#404040",
            "editorBracketPairGuide.background3": "#404040",
            "editorBracketPairGuide.background4": "#404040",
            "editorBracketPairGuide.background5": "#404040",
            "editorBracketPairGuide.background6": "#404040",
            // Make the active/selected scope lines brighter (e.g., a lighter gray/white)
            "editorBracketPairGuide.activeBackground1": "#a0a0a0",
            "editorBracketPairGuide.activeBackground2": "#a0a0a0",
            "editorBracketPairGuide.activeBackground3": "#a0a0a0",
            "editorBracketPairGuide.activeBackground4": "#a0a0a0",
            "editorBracketPairGuide.activeBackground5": "#a0a0a0",
            "editorBracketPairGuide.activeBackground6": "#a0a0a0"
        }
	});

	window.editor = monaco.editor.create(document.getElementById("monaco"), {
		value: localStorage.getItem("code") ||
			"\n#include <iostream>\nusing namespace std;\n\nint main() {\n\tcout << \"Hello, world!\" << endl;\n\treturn 0;\n}\n",
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
		bracketPairColorization: { enabled: false },
		guides: {
			indentation: true,
			bracketPairs: true,
			bracketPairsHorizontal: false,
			highlightActiveBracketPair: true
		},
		theme: "csl-dark"
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
