import { createRequire } from 'node:module';

const strictJsonRequire = createRequire(import.meta.url);
const tsCompiler = strictJsonRequire('typescript') as typeof import('typescript');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const maxJsonAstNodes = 100_000;

export class DuplicateJsonKeyError extends SyntaxError {
  constructor(label: string, key: string) {
    super(`${label} contains duplicate JSON object key ${JSON.stringify(key)}`);
    this.name = 'DuplicateJsonKeyError';
  }
}

function invalidJsonError(label: string, cause?: unknown): SyntaxError {
  const error = new SyntaxError(`${label} contains invalid JSON`);
  if (cause !== undefined) Object.defineProperty(error, 'cause', { value: cause });
  return error;
}

export function parseStrictJsonText(source: string, label: string): unknown {
  const sourceFile = tsCompiler.createSourceFile(
    label,
    source,
    tsCompiler.ScriptTarget.Latest,
    true,
    tsCompiler.ScriptKind.JSON,
  );
  const parseDiagnostics = (sourceFile as typeof sourceFile & {
    parseDiagnostics?: readonly import('typescript').Diagnostic[];
  }).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) throw invalidJsonError(label);

  let astNodes = 0;
  const visit = (node: import('typescript').Node): void => {
    astNodes += 1;
    if (astNodes > maxJsonAstNodes) {
      throw new Error(`${label} exceeds the structured-data node bound`);
    }
    if (tsCompiler.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!tsCompiler.isPropertyAssignment(property)
          || !tsCompiler.isStringLiteralLike(property.name)) {
          continue;
        }
        const key = property.name.text;
        if (keys.has(key)) throw new DuplicateJsonKeyError(label, key);
        keys.add(key);
      }
    }
    tsCompiler.forEachChild(node, visit);
  };
  visit(sourceFile);

  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw invalidJsonError(label, error);
  }
}

export function parseStrictUtf8Json(bytes: Uint8Array, label: string): unknown {
  let source: string;
  try {
    source = strictUtf8.decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
  }
  return parseStrictJsonText(source, label);
}
