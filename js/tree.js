
// ==== Expressions ============================================================

class Expression {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Assignment extends Expression {
	constructor(left, operator, right) {
		super(left.start, right.end);
		this.left = left;
		this.operator = operator;
		this.right = right;
	}
}

class Literal extends Expression {
	constructor(token, type) {
		super(token.position, token.lexeme.length);
		this.value = token.lexeme;
		this.type = type;
	}
}

class Identifier extends Expression {
	constructor(token) {
		super(token.position, token.lexeme.length);
		this.name = token.lexeme;
	}
}

class InfixExpression extends Expression {
	constructor(left, operator, right) {
		super(left.start, right.end);
		this.left = left;
		this.operator = operator;
		this.right = right;
	}
}

class PrefixExpression extends Expression {
	constructor(operator, right) {
		super(operator.position, right.end);
		this.operator = operator;
		this.right = right;
	}
}

class PostfixExpression extends Expression {
	constructor(left, operator) {
		super(left.start, operator.end);
		this.left = left;
		this.operator = operator;
	}
}

class Call extends Expression {
	constructor(callee, lpar, rpar, args) {
		super(callee.start, rpar.position + 1);
		this.callee = callee;
		this.lpar = lpar;
		this.rpar = rpar;
		this.args = args;
	}
}

// ==== Statements =============================================================

class Statement {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Declaration extends Statement {
	constructor(type, identifier, value) {
		super(type.position, value ? value.end :
			identifier.position + identifier.lexeme.length);
		this.identifier = identifier;
		this.type = type;
		this.value = value;
	}
}

class Block extends Statement {
	constructor(lbrace, rbrace, statements) {
		super(lbrace.position, rbrace.position + 1);
		this.lbrace = lbrace;
		this.rbrace = rbrace;
		this.statements = statements;
	}
}

class Instruction extends Statement {
	constructor(expression) {
		super(expression.start, expression.end);
		this.expression = expression;
	}
}

class Cout extends Statement {
	constructor(c, expressions) {
		super(expressions[0].start, expressions[expressions.length - 1].end);
		this.expressions = expressions;
		this.c = c;
	}
}

class Cin extends Statement {
	constructor(c, expressions) {
		super(expressions[0].start, expressions[expressions.length - 1].end);
		this.expressions = expressions;
		this.c = c;
	}
}
