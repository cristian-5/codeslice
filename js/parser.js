
const digit = c => c >= '0' && c <= '9';
const letter = c =>(c >= 'a' && c <= 'z') ||
	(c >= 'A' && c <= 'Z') || c === '_';
const alpha = c => digit(c) || letter(c);

const escapedChars = {
	'\\\\': "\\", '\\\'': '\'', '\\"': '"',
	'\\n': "\n", '\\t': "\t", '\\r': "\r", '\\0': "\0"
};

const types = [ "int", "float", "char", "string", "bool" ];
const keywords = [
	"cout", "cin",
	"if", "else",
	"switch", "case", "default",
	"while", "for", "do",
	"break", "continue",
];

class Parser {

	constructor(code) {
		CodeError.code = this.code = code.replace(/\r/g, ""); // CRLF to LF
		this.tokens = this.#lex();
	}

	#advance() { return this.tokens[this.current++]; }
	#previous() { return this.tokens[this.current - 1]; }
	#peek() { return this.tokens[this.current]; }
	#end() { return this.current >= this.tokens.length; }
	#check(type, lexeme) {
		if (this.#end()) return false;
		const p = this.#peek();
		if (lexeme) {
			if (lexeme instanceof Array)
				 return p.type === type && lexeme.includes(p.lexeme);
			else return p.type === type && p.lexeme === lexeme;
		} else return p.type === type;
	}
	#match(t, l) { return this.#check(t, l) ? !!this.#advance() : false; }
	#consume(t, l) {
		if (this.#match(t, l)) return this.#previous();
		const prev = this.#previous() || { position: 0, lexeme: "" };
		const position = [
			prev.position + prev.lexeme.length,
			prev.position + prev.lexeme.length + 1
		];
		if (l) throw new CodeError(Language.main.errors.EXM, position, [ t, l ]);
		throw new CodeError(Language.main.errors.EXT, position, [ t ]);
	}

	// ==== Lexer ==============================================================

	// FIX: comments
	#lex() {
		const code = this.code;
		let tokens = [], grouped = []; let i = 0, t = "", position = 0;
		while (i < code.length) {
			switch (code[i]) {
				case ' ': case '\t': case '\n': break;
				case '+': case '-': case '*':
				case '%': case '=': case '(': case ')':
				case '{': case '}': case ';': case ',':
				case '<': case '>': case '!': case ':':
				case '[': case ']': case '&': case '|':
					tokens.push({ lexeme: code[i], type: "operator", position: i });
				break;
				case '/':
					position = i;
					if (code[i + 1] === '/') {
						while (i < code.length && code[i] !== '\n') i++;
					} else if (code[i + 1] === '*') {
						i += 2;
						while (i < code.length && !(code[i - 1] === '*' && code[i] === '/')) i++;
						if (code[i] !== '/')
							throw new CodeError(Language.main.errors.MTC, [ position, position + 1 ], '/');
						i++;
					} else tokens.push({ lexeme: code[i], type: "operator", position });
				break;
				case '"':
					position = i; i++; t = '"';
					while (i < code.length && code[i] !== '"' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new CodeError(Language.main.errors.MTC, [ position, i ], '"');
					tokens.push({ lexeme: t + '"', type: "string", position });
				break;
				case '\'':
					position = i; i++; t = "";
					while (i < code.length && code[i] !== '\'' && code[i] !== '\n')
						t += code[i++];
					if (code[i] === '\n') throw new CodeError(Language.main.errors.MTC, [ position, i ], "'");
					if (t.length !== 1) {
						if (t.includes('\\')) {
							const c = t.substring(1, t.length - 1);
							if (!(c in escapedChars)) throw new CodeError(Language.main.errors.UES, [ position, i ]);
							else tokens.push({ lexeme: `'${escapedChars[c]}'`, type: "char", position });
						} else throw new CodeError(Language.main.errors.ICL, [ position, i ]);
					} else tokens.push({ lexeme: `'${t}'`, type: "char", position });
				break;
				default:
					position = i;
					if (digit(code[i])) {
						t = "";
						while (i < code.length && digit(code[i]) || code[i] === '.')
							t += code[i++];
						tokens.push({ lexeme: t, type: "number", position });
					} else if (letter(code[i])) {
						t = "";
						while (i < code.length && alpha(code[i])) t += code[i++];
						if (types.includes(t)) tokens.push({ lexeme: t, type: "type", position });
						else if (keywords.includes(t)) tokens.push({ lexeme: t, type: "keyword", position });
						else tokens.push({ lexeme: t, type: "identifier", position });
					} else throw new CodeError(Language.main.errors.UNC, [ position, position + 1 ]);
					i--;
				break;
			}
			i++;
		}
		// group tokens like !=, ==, <=, >=, etc:
		for (let i = 0; i < tokens.length - 1; i++) {
			if (tokens[i].type !== "operator") {
				grouped.push(tokens[i]);
				continue;
			}
			switch (tokens[i].lexeme) {
				case '=': case '!': case '*': case '/': case '%':
					if (tokens[i + 1].lexeme === '=') {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				case ':':
					if (tokens[i + 1].lexeme === ':') {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				case '&': case '|': case '<': case '>': case '+': case '-':
					if (tokens[i + 1].lexeme === '=' || tokens[i + 1].lexeme === tokens[i].lexeme) {
						grouped.push({
							lexeme: tokens[i].lexeme + tokens[i + 1].lexeme,
							type: "operator", position: tokens[i].position
						});
						i++;
					} else grouped.push(tokens[i]);
				break;
				default: grouped.push(tokens[i]);
			}
		}
		if (tokens.length > 0) grouped.push(tokens[tokens.length - 1]);
		return grouped;
	}

	// ==== Parser =============================================================

	// <program> := { <block> }
	#program() {
		let e = [];
		while (!this.#end()) e.push(this.#block());
		return new Program(e, this.code);
	}
	// <declaration> := <type> <partial> { ',' <partial> }
	// <partial> := <identifier> [ { '[' <expression> ']' } | '=' <expression> ]
	#declaration() {
		const type = this.#consume("type");
		function partial() {
			const id = this.#consume("identifier");
			if (this.#match("operator", '='))
				return { id, exp: this.#expression() };
			else if (this.#check("operator", '[')) {
				const sizes = [];
				while (this.#match("operator", '[')) {
					sizes.push(this.#expression());
					this.#consume("operator", ']');
				}
				return { id, exp: null, sizes };
			} else return { id, exp: null };
		}
		const decls = [ partial.call(this) ];
		while (this.#match("operator", ",")) decls.push(partial.call(this));
		return new Declaration(type, decls);
	}
	// <block> := '{' { <statement> } '}'
	#block() {
		const statements = [];
		if (this.#match("operator", '{')) {
			const lbrace = this.#previous();
			while (!this.#check("operator", '}') && !this.#end())
				statements.push(this.#statement());
			const rbrace = this.#consume("operator", '}');
			return new Block(lbrace, statements, rbrace);
		} else return this.#statement();
	}
	// <statement> := <declaration> ';'
	//              | <cout> | <cin>
	//			    | <if> | <while> | <dowhile>
	//              | <expression> ';'
	#statement() {
		let e;
		if (this.#check("type")) {
			e = this.#declaration();
			this.#consume("operator", ";");
		}
		else if (this.#check("keyword", "cout"))  e = this.#cout();
		else if (this.#check("keyword", "cin"))   e = this.#cin();
		else if (this.#check("keyword", "if"))    e = this.#if();
		else if (this.#check("keyword", "while")) e = this.#while();
		else if (this.#check("keyword", "do"))    e = this.#dowhile();
		else if (this.#check("keyword", "for"))   e = this.#for();
		else if (this.#match("keyword", "break")) {
			e = new Break(this.#previous());
			this.#consume("operator", ";");
		}
		else if (this.#match("keyword", "continue")) {
			e = new Continue(this.#previous());
			this.#consume("operator", ";");
		}
		else {
			e = new Instruction(this.#expression());
			this.#consume("operator", ";");
		}
		return e;
	}

	// <if> := "if" '(' <expression> ')' <block> [ "else" <block> ]
	#if() {
		const i = this.#consume("keyword", "if");
		this.#consume("operator", "(");
		const condition = this.#expression();
		this.#consume("operator", ")");
		const then = this.#block();
		let els = null;
		if (this.#match("keyword", "else")) els = this.#block();
		return new If(i, condition, then, els);
	}

	#while() {
		const w = this.#consume("keyword", "while");
		this.#consume("operator", "(");
		const condition = this.#expression();
		this.#consume("operator", ")");
		const block = this.#block();
		return new While(w, condition, block);
	}

	#dowhile() {
		const d = this.#consume("keyword", "do");
		const block = this.#block();
		this.#consume("keyword", "while");
		this.#consume("operator", "(");
		const condition = this.#expression();
		this.#consume("operator", ")");
		this.#consume("operator", ";");
		return new DoWhile(d, block, condition);
	}

	#for() {
		const f = this.#consume("keyword", "for");
		this.#consume("operator", "(");
		let init = null, condition = null, update = null;
		if (!this.#check("operator", ";")) {
			if (this.#check("type")) init = this.#declaration();
			else init = this.#expression();
		}
		this.#consume("operator", ";");
		if (!this.#check("operator", ";")) condition = this.#expression();
		this.#consume("operator", ";");
		if (!this.#check("operator", ")")) update = this.#expression();
		this.#consume("operator", ")");
		const block = this.#block();
		return new For(f, init, condition, update, block);
	}

	// <cout> := "cout" << <expression> ( << <expression> )*
	#cout() {
		const c = this.#consume("keyword", "cout");
		if (!this.#check("operator", "<<"))
			throw new CodeError(Language.main.errors.COU, this.#peek() || this.#previous());
		let e = [];
		while (this.#match("operator", "<<")) e.push(this.#expression());
		this.#consume("operator", ";");
		return new Cout(c, e);
	}
	// <cin> := "cin" >> <identifier> ( >> <identifier> )*
	#cin() {
		const c = this.#consume("keyword", "cin");
		if (!this.#check("operator", ">>"))
			throw new CodeError(Language.main.errors.CIN, this.#peek() || this.#previous());
		let e = [];
		while (this.#match("operator", ">>")) {
			const id = this.#expression();
			if (!(id instanceof Identifier))
				throw new CodeError(Language.main.errors.CIX, [ id.start, id.end ]);
			e.push(id);
		}
		this.#consume("operator", ";");
		return new Cin(c, e);
	}

	// ==== Expressions ========================================================

	// <expression> := <assignment>
	#expression() { return this.#assignment(); }
	// <assignment> := <identifier> ( '=' <assignment> ) | <logic_or>
	#assignment() {
		let e = this.#logic_or();
		if (this.#match("operator", [ '=', "+=", "-=", "*=", "/=", "%=" ])) {
			const op = this.#previous();
			const value = this.#assignment();
			if (e instanceof Identifier || e instanceof Subscript)
				return new Assignment(e, op, value);
			throw new CodeError(Language.main.errors.IAT, [ e.start, e.end ]);
		} else return e;
	}
	// <logic_or> := <logic_and> ( "||" <logic_and> )*
	#logic_or() {
		let e = this.#logic_and();
		while (this.#match("operator", "||"))
			e = new InfixExpression(e, this.#previous(), this.#logic_and());
		return e;
	}
	// <logic_and> := <equality> ( "&&" <equality> )*
	#logic_and() {
		let e = this.#equality();
		while (this.#match("operator", "&&"))
			e = new InfixExpression(e, this.#previous(), this.#equality());
		return e;
	}
	// <equality> := <comparison> ( ( "==" | "!=" ) <comparison> )*
	#equality() {
		let e = this.#comparison();
		while (this.#match("operator", [ "==", "!=" ]))
			e = new InfixExpression(e, this.#previous(), this.#comparison());
		return e;
	}
	// <comparison> := <term> ( ( '>' | '<' | ">=" | "<=" ) <term> )*
	#comparison() {
		let e = this.#term();
		while (this.#match("operator", [ '>', '<', ">=", "<=" ]))
			e = new InfixExpression(e, this.#previous(), this.#term());
		return e;
	}
	// <term> := <factor> ( ( '+' | '-' | '|' ) <factor> )*
	#term() {
		let e = this.#factor();
		while (this.#match("operator", [ '+', '-', '|' ]))
			e = new InfixExpression(e, this.#previous(), this.#factor());
		return e;
	}
	// <factor> := <prefix> ( ( '*' | '/' | '%' | '&' ) <prefix> )*
	#factor() {
		let e = this.#prefix();
		while (this.#match("operator", [ '*', '/', '%', '&' ]))
			e = new InfixExpression(e, this.#previous(), this.#prefix());
		return e;
	}
	// <prefix> := ( '!', '+' | '-' | '~' | "++" | "--") <prefix> | <call>
	#prefix() {
		if (this.#match("operator", [ '!', '+', '-', '~', "++", "--" ]))
			return new PrefixExpression(this.#previous(), this.#prefix());
		return this.#call();
	}
	// <call> := <postfix> ( '(' <arguments>? ')' )*
	// <arguments> := <expression> ( ',' <expression> )*
	#call() {
		let e = this.#postfix();
		while (this.#match("operator", "(")) {
			const lpar = this.#previous(), args = [];
			if (!this.#check("operator", ")")) {
				do args.push(this.#expression());
				while (this.#match("operator", ","));
			}
			e = new Call(e, lpar, this.#consume("operator", ")"), args);
		}
		return e;
	}
	// <postfix> := <subscript> ( '++' | '--' )*
	#postfix() {
		let e = this.#subscript();
		while (this.#match("operator", [ "++", "--" ]))
			e = new PostfixExpression(e, this.#previous());
		return e;
	}
	// <subscript> := <primary> ('[' <expression> ']') [ '=' <expression> ]
	#subscript() {
		let e = this.#primary();
		if (this.#check("operator", "[")) {
			const indexes = [];
			while (this.#match("operator", "[")) {
				indexes.push(this.#expression());
				this.#consume("operator", "]");
			}
			e = new Subscript(e, indexes, this.#previous());
		}
		return e;
	}
	// <primary> := '(' <expression> ')' | <postfix> | <number> | <string> | <char> | <bool>
	#primary() {
		if (this.#match("operator", "(")) {
			const e = this.#expression();
			this.#consume("operator", ")");
			return e;
		} else if (this.#check("number")) {
			const n = this.#advance();
			if (n.lexeme.includes('.')) return new Literal(n, "float");
			return new Literal(n, "int");
		}
		else if (this.#check("identifier"))
			return new Identifier(this.#advance());
		else if (this.#check("string"))
			return new Literal(this.#advance(), "string");
		else if (this.#check("char"))
			return new Literal(this.#advance(), "char");
		throw new CodeError(Language.main.errors.UEX, this.#peek() || this.#previous());
	}

	// ==== Interpreter ========================================================

	async parse() {
		if (this.tokens.length === 0) return;
		this.current = 0;
		return await this.#program();
	}

}
