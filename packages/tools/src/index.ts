export interface CalculatorResult {
  expression: string;
  value: number;
  formatted: string;
}

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { type: "lparen" }
  | { type: "rparen" };

const MAX_EXPRESSION_LENGTH = 256;

function normalizeDecimal(value: string): string {
  return value.replace(/(?<=\d),(?=\d)/gu, ".");
}

export function extractCalculatorExpression(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Липсва израз за изчисление.");

  const percentage = trimmed.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*(?:от|of)\s*(-?\d+(?:[.,]\d+)?)/iu);
  if (percentage) {
    return `(${normalizeDecimal(percentage[1])}/100)*${normalizeDecimal(percentage[2])}`;
  }

  const withoutPrefix = trimmed.replace(
    /^\s*(?:изчисли|сметни|пресметни|calculate|compute|what\s+is|колко\s+е)\s*[:=]?\s*/iu,
    ""
  );

  return normalizeDecimal(withoutPrefix)
    .replace(/[×·]/gu, "*")
    .replace(/[÷:]/gu, "/")
    .replace(/[−–—]/gu, "-")
    .trim();
}

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error("Изразът е прекалено дълъг.");
  }
  if (!/^[\d\s.+\-*/%^()]+$/u.test(expression)) {
    throw new Error("Неподдържани символи в математическия израз.");
  }

  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (/\d|\./u.test(char)) {
      const start = index;
      let dots = 0;
      while (index < expression.length && /\d|\./u.test(expression[index])) {
        if (expression[index] === ".") dots += 1;
        index += 1;
      }
      const raw = expression.slice(start, index);
      if (dots > 1 || raw === ".") throw new Error(`Невалидно число: ${raw}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Невалидно число: ${raw}`);
      tokens.push({ type: "number", value });
      continue;
    }

    if (["+", "-", "*", "/", "%", "^"].includes(char)) {
      tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/" | "%" | "^" });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    throw new Error(`Неподдържан символ: ${char}`);
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    if (this.tokens.length === 0) throw new Error("Празен математически израз.");
    const value = this.parseAdditive();
    if (this.index !== this.tokens.length) throw new Error("Невалиден математически израз.");
    return this.ensureFinite(value);
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.peekOperator("+") || this.peekOperator("-")) {
      const operator = (this.tokens[this.index++] as Extract<Token, { type: "operator" }>).value;
      const right = this.parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
      value = this.ensureFinite(value);
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parsePower();
    while (this.peekOperator("*") || this.peekOperator("/") || this.peekOperator("%")) {
      const operator = (this.tokens[this.index++] as Extract<Token, { type: "operator" }>).value;
      const right = this.parsePower();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Деление на нула не е позволено.");
      }
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
      value = this.ensureFinite(value);
    }
    return value;
  }

  private parsePower(): number {
    let value = this.parseUnary();
    if (this.peekOperator("^")) {
      this.index += 1;
      value = Math.pow(value, this.parsePower());
    }
    return this.ensureFinite(value);
  }

  private parseUnary(): number {
    if (this.peekOperator("+")) {
      this.index += 1;
      return this.parseUnary();
    }
    if (this.peekOperator("-")) {
      this.index += 1;
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error("Очаква се число или скоба.");

    if (token.type === "number") {
      this.index += 1;
      return token.value;
    }

    if (token.type === "lparen") {
      this.index += 1;
      const value = this.parseAdditive();
      if (this.tokens[this.index]?.type !== "rparen") throw new Error("Липсва затваряща скоба.");
      this.index += 1;
      return value;
    }

    throw new Error("Очаква се число или отваряща скоба.");
  }

  private peekOperator(operator: "+" | "-" | "*" | "/" | "%" | "^"): boolean {
    const token = this.tokens[this.index];
    return token?.type === "operator" && token.value === operator;
  }

  private ensureFinite(value: number): number {
    if (!Number.isFinite(value)) throw new Error("Резултатът е извън допустимия числов диапазон.");
    return value;
  }
}

export function evaluateExpression(expression: string): CalculatorResult {
  const normalized = extractCalculatorExpression(expression);
  const value = new Parser(tokenize(normalized)).parse();
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  return {
    expression: normalized,
    value: normalizedValue,
    formatted: Number.isInteger(normalizedValue)
      ? String(normalizedValue)
      : String(Number(normalizedValue.toPrecision(15)))
  };
}

export function calculateFromText(input: string): CalculatorResult {
  return evaluateExpression(input);
}
