// كاشف نمط خطأ React #310: استدعاء hook يأتي بعد return شرطي داخل نفس المكوّن
const parser = require(process.cwd() + '/node_modules/@babel/parser');
const { execSync } = require('child_process');

const file = process.argv[2];
const ref = process.argv[3]; // git ref or 'WORK'

let src;
if (ref === 'WORK') {
  src = require('fs').readFileSync(file, 'utf8');
} else {
  try { src = execSync(`git show ${ref}:${file}`, { encoding: 'utf8', maxBuffer: 64e6 }); }
  catch { process.exit(0); }
}

let ast;
try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] }); }
catch (e) { console.error('PARSE_FAIL', file, e.message); process.exit(0); }

const isHookCall = (node) =>
  node && node.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name)) ||
   (node.callee.type === 'MemberExpression' && node.callee.property && /^use[A-Z]/.test(node.callee.property.name || '')));

function containsReturn(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return false;
  if (node.type === 'ReturnStatement') return true;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return false;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && c.type && containsReturn(c, depth + 1)) return true; }
    else if (v && v.type && containsReturn(v, depth + 1)) return true;
  }
  return false;
}

function containsHookCall(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (isHookCall(node)) return node;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return null;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) { if (c && c.type) { const r = containsHookCall(c, depth + 1); if (r) return r; } } }
    else if (v && v.type) { const r = containsHookCall(v, depth + 1); if (r) return r; }
  }
  return null;
}

function checkComponent(name, body) {
  if (!body || body.type !== 'BlockStatement') return;
  let sawConditionalReturn = false;
  for (const stmt of body.body) {
    if (stmt.type === 'IfStatement' && containsReturn(stmt)) { sawConditionalReturn = true; continue; }
    const hook = containsHookCall(stmt);
    if (hook && sawConditionalReturn) {
      console.log(`${ref}\t${file}\t${name}\tline ${hook.loc.start.line}\thook after conditional return`);
    }
  }
}

function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) checkComponent(node.id.name, node.body);
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && /^[A-Z]/.test(node.id.name) &&
      node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression'))
    checkComponent(node.id.name, node.init.body);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && v.type) walk(v);
  }
}
walk(ast.program);
