import { createHash } from 'node:crypto';
import ts from 'typescript';

export const PROTOCOL_COPY_NORMALIZER = 'typescript-printer-synthesized-v1';
export const PROTOCOL_COPY_TYPESCRIPT = ts.version;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CONTRACT_PATHS = new Set(['./contract-v1.json', '../../docs/contracts/remote-v1.json']);

// This is a copy-drift check, not a proof of semantic equivalence. Parse and
// print syntax, retaining operators/literals/regexes. Only the two known local
// CONTRACT_URL paths map to the desktop path; unexpected paths fail closed.
export function normalizeProtocolCopy(source) {
  const file = ts.createSourceFile('protocol.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (file.parseDiagnostics.length) throw new Error('Protocol copy has invalid JavaScript syntax');
  let mapped = 0;
  const transformed = ts.transform(file, [context => root => ts.visitNode(root, function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'CONTRACT_URL') {
      const init = node.initializer;
      const location = init?.arguments?.[1];
      if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'URL'
          || init.arguments?.length !== 2 || !ts.isStringLiteral(init.arguments[0]) || !CONTRACT_PATHS.has(init.arguments[0].text)
          || !location || !ts.isPropertyAccessExpression(location) || location.name.text !== 'url'
          || !ts.isMetaProperty(location.expression) || location.expression.keywordToken !== ts.SyntaxKind.ImportKeyword
          || location.expression.name.text !== 'meta') {
        throw new Error('Protocol copy has an unexpected CONTRACT_URL');
      }
      mapped++;
      node = ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
        ts.factory.updateNewExpression(init, init.expression, init.typeArguments,
          [ts.factory.createStringLiteral('./contract-v1.json'), location]));
    }
    return ts.visitEachChild(node, visit, context);
  })]);
  try {
    if (mapped !== 1) throw new Error('Protocol copy must have exactly one known CONTRACT_URL');
    const normalized = transformed.transformed[0];
    // Source positions can preserve incidental line breaks in printer output.
    // Synthesize positions so formatting/comments cannot change the digest.
    function synthesize(node) {
      ts.setTextRange(node, { pos: -1, end: -1 });
      ts.forEachChild(node, synthesize);
    }
    synthesize(normalized);
    return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(normalized);
  } finally {
    transformed.dispose();
  }
}

export const protocolCopySha256 = source => sha256(normalizeProtocolCopy(source));
