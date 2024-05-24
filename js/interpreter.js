
Array.prototype.top = function() { return this[this.length - 1]; };

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
	"if", "else", "while", "for", "do", "switch", "case", "default",
	"break", "continue", "return", "using", "namespace",
];

class Interpreter {

	constructor(code) {
		this.code = code.replace(/\r/g, ""); // CRLF to LF
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
		const position = prev.position + prev.lexeme.length;
		if (l) throw new CodeError(Errors.EXM, position, 1, this.code, [ t, l ]);
		throw new CodeError(Errors.EXT, position, 1, this.code, [ t ]);
	}

	// ==== Lexer ==============================================================

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
						if (i === code.length) throw new CodeError(Errors.MTC, position, 2);
						i++;
					} else tokens.push({ lexeme: code[i], type: "operator", position });
				break;
				case '#':
					position = i; i++; t = "#";
					while (i < code.length && code[i] !== '\n')
						t += code[i++];
					tokens.push({ lexeme: t, type: "directive", position });
				break;
				case '"':
					position = i; i++; t = '"';
					while (i < code.length && code[i] !== '"' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new CodeError(Errors.MTS, position, t.length);
					tokens.push({ lexeme: t + '"', type: "string", position });
				break;
				case '\'':
					position = i; i++; t = "\'";
					while (i < code.length && code[i] !== '\'' && code[i] !== '\n')
						t += code[i++];
					if (code[i] == '\n') throw new CodeError(Errors.MTC, position, t.length);
					t += "'";
					if (t.length !== 1) {
						if (t.includes('\\')) {
							const c = t.substring(1, t.length - 1);
							if (!(c in escapedChars)) throw new CodeError(Errors.UES, position, t.length);
							else tokens.push({ lexeme: `'${escapedChars[c]}'`, type: "char", position });
						} else throw new CodeError(Errors.ICL, position, t.length);
					} else tokens.push({ lexeme: t, type: "char", position });
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
					} else throw new CodeError(Errors.UNC, position, 1);
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
	// <declaration> := <type> <identifier> [ '=' <expression> ]
	#declaration() {
		const type = this.#consume("type");
		const id = this.#consume("identifier");
		if (this.#match("operator", '='))
			return new Declaration(type, id, this.#expression());
		else if (this.#match("operator", '[')) {
			const size = this.#expression();
			this.#consume("operator", ']');
			const a = new Declaration(type, id);
			a.size = size;
			return a;
		}
		else return new Declaration(type, id);
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
	// <statement> := <declaration>
	//              | <cout> | <cin>
	//			    | <if>
	//              | <expression> ';'
	#statement() {
		let e;
		if (this.#check("type")) {
			e = this.#declaration();
			this.#consume("operator", ";");
		}
		else if (this.#check("keyword", "cout")) e = this.#cout();
		else if (this.#check("keyword", "cin"))  e = this.#cin();
		else if (this.#check("keyword", "if"))   e = this.#if();
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

	// <cout> := "cout" << <expression> ( << <expression> )*
	#cout() {
		const c = this.#consume("keyword", "cout");
		if (!this.#check("operator", "<<")) {
			const p = this.#peek();
			throw new CodeError(Errors.COU, p.position, p.lexeme.length);
		}
		let e = [];
		while (this.#match("operator", "<<")) e.push(this.#expression());
		this.#consume("operator", ";");
		return new Cout(c, e);
	}
	// <cin> := "cin" >> <identifier> ( >> <identifier> )*
	#cin() {
		const c = this.#consume("keyword", "cin");
		if (!this.#check("operator", ">>")) {
			const p = this.#peek();
			throw new CodeError(Errors.CIN, p.position, p.lexeme.length);
		}
		let e = [];
		while (this.#match("operator", ">>")) {
			const id = this.#expression();
			if (!(id instanceof Identifier))
				throw new CodeError(Errors.CIX, id.position, id.lexeme.length);
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
			if (e instanceof Identifier) return new Assignment(e, op, value);
			throw new CodeError(Errors.IAT, e.position, e.lexeme.length, this.code, [ e.lexeme ]);
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
	// <call> := <subscript> ( '(' <arguments>? ')' )*
	// <arguments> := <expression> ( ',' <expression> )*
	#call() {
		let e = this.#primary();
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
	// <subscript> := <primary> ('[' <expression> ']') [ '=' <expression> ]
	#subscript() {
		let e = this.#primary();
		if (this.#match("operator", "[")) {
			const index = this.#expression();
			this.#consume("operator", "]");
			if (this.#match("operator", "="))
				e = new Subscript(e, index, this.#expression());
			else e = new Subscript(e, index);
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
		const p = this.#peek();
		throw new CodeError(Errors.UEX, p.position, p.lexeme.length);
	}

	// ==== Interpreter ========================================================

	run() {
		if (this.tokens.length === 0) return;
		this.current = 0;
		this.#program().execute();
	}

}
