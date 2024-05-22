
class Expression {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Literal extends Expression {
	constructor(token, type) {
		super(token.position, token.lexeme.length);
		this.value = token.literal;
	}
}

class Identifier extends Expression {

}

class InfixExpression extends Expression {

}

class PrefixExpression extends Expression {

}

class PostfixExpression extends Expression {

}


class Statement {

}

class BlockStatement extends Statement {

}

class ExpressionStatement extends Statement {

}
