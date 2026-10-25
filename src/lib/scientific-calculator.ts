const NUMBER_SELECTION = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function numericCalculatorSeed(selection: string): string {
  const text = selection.trim();
  return NUMBER_SELECTION.test(text) ? text : "";
}

export function calculateExpression(expression: string, degrees = true): string {
  const source = expression.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  let index = 0;

  function consume(token: string): boolean {
    if (!source.startsWith(token, index)) return false;
    index += token.length;
    return true;
  }

  function primary(): number {
    if (consume("(")) {
      const value = sum();
      if (!consume(")")) throw new Error("Missing closing parenthesis");
      return value;
    }
    if (consume("π") || consume("pi")) return Math.PI;
    if (consume("e")) return Math.E;
    const fn = ["sin", "cos", "tan", "log", "ln", "sqrt"].find((name) => source.startsWith(name + "(", index));
    if (fn) {
      index += fn.length + 1;
      const argument = sum();
      if (!consume(")")) throw new Error("Missing closing parenthesis");
      const angle = degrees ? argument * Math.PI / 180 : argument;
      const value = fn === "sin" ? Math.sin(angle)
        : fn === "cos" ? Math.cos(angle)
        : fn === "tan" ? Math.tan(angle)
        : fn === "log" ? Math.log10(argument)
        : fn === "ln" ? Math.log(argument)
        : Math.sqrt(argument);
      return value;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(index));
    if (!match) throw new Error("Incomplete expression");
    index += match[0].length;
    return Number(match[0]);
  }

  function postfix(): number {
    let value = primary();
    while (consume("%")) value /= 100;
    return value;
  }

  function power(): number {
    const value = postfix();
    return consume("^") ? value ** unary() : value;
  }

  function unary(): number {
    if (consume("+")) return unary();
    if (consume("-")) return -unary();
    return power();
  }

  function product(): number {
    let value = unary();
    while (true) {
      if (consume("*")) value *= unary();
      else if (consume("/")) value /= unary();
      else break;
    }
    return value;
  }

  function sum(): number {
    let value = product();
    while (true) {
      if (consume("+")) value += product();
      else if (consume("-")) value -= product();
      else break;
    }
    return value;
  }

  if (!source) throw new Error("Enter an expression");
  const result = sum();
  if (index !== source.length) throw new Error("Check the expression");
  if (!Number.isFinite(result)) throw new Error("Result is undefined");
  const rounded = Number(result.toPrecision(12));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
