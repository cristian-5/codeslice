
# Code SL/CE

Web interpreter for `c+-`, made with ❤️ to help students understand code.

### c+-

The language `c+-` is a dialect of `c++` with some minor differences:

- Namespaces like `std` are not necessary.
- Simpler execution / compilation errors.
- Dynamic type checking instead of static.
- The only available data types are `int`, `float`, `char`, `bool` and `string`.
- There are no pointers, procedures, functions, classes, exceptions or objects.
- Arrays have a fixed size but it does not need to be constant.
- Precedence of compound operators (`+=`, `-=`, `*=`, `/=`, `%=`) is the same.
- There is no type inference with the `auto` keyword.
- There is no difference between `++i` and `i++`, they both `return i + 1`.
- The `++` and `--` operators can't mutate array or matrix cells.

## Features

- [x] Lexing and Parsing
- [x] Better Syntax Errors
- [x] Variable Declaration
- [x] Multiple Declarations
- [x] Variable Assignment
- [x] Scope Shadowing
- [x] Expressions
- [x] If Statements
- [x] Cin, Cout Statements
- [x] Function Calls
- [x] Array, Matrix Declarations
- [x] Array, Matrix Subscript
- [x] While, Do While Cycles
- [x] Break, Continue Statements
- [x] For Cycles
- [x] Operators `++`, `--` 
- [ ] Automatic Type Casting
- [ ] Direct cin of Arrays
- [ ] `+=`, `-=`, `*=`, `/=`, `%=` Operators
