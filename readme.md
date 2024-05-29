
# Code SL/CE

Web interpreter for `c+-`, made with ❤️ to help students.\
https://cristian-5.github.io/codeslice/

![Code Slice](/img/screen-1.png)

### c+\-

The language `c+-` is a dialect of `c++` with some minor differences:

- No `#include` or preprocessor directives.
- Namespaces like `std` are not necessary.
- Simpler execution / compilation errors.
- Dynamic type checking instead of static.
- The only available data types are `int`, `float`, `char`, `bool` and `string`.
- There are no pointers, procedures, functions, classes, exceptions or objects.
- Arrays have a fixed size but it does not need to be constant.
- Precedence of compound operators (`+=`, `-=`, `*=`, `/=`, `%=`) is the same.
- The `++` and `--` operators don't act on arrays or matrix cells.

## Features

- [x] Lexing and Parsing
- [x] Better Syntax Errors
- [x] Variable Declaration
- [x] Multiple Declarations
- [x] Variable Assignment
- [x] Scope Shadowing
- [x] Expressions
- [x] `if` Statements
- [x] `cin`, `cout` Statements
- [x] Function Calls
- [x] Array, Matrix Declarations
- [x] Array, Matrix Subscript
- [x] `while`, `do while` Cycles
- [x] `break`, `continue` Statements
- [x] `for` Cycles
- [x] `++`, `--` Operators
- [ ] Automatic Type Casting
- [ ] Direct `cin` of Array Elements
- [ ] `+=`, `-=`, `*=`, `/=`, `%=` Operators
