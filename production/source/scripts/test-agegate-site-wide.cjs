'use strict';
// The root layout must give every page the verified-Googlebot decision, taken only from the origin's marker header.
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { MARKER } = require('./origin-pilot.cjs');
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
assert(/import RequestAgeGate from "\.\/components\/RequestAgeGate"/.test(layout), 'layout must use RequestAgeGate');
assert(layout.includes('<RequestAgeGate />') && !/<AgeGate\b/.test(layout), 'layout must not render a bare AgeGate');

function load(file, resolve) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  return module.exports;
}
(async () => {
  for (const [value, expected] of [['1', true], [null, false], ['0', false], ['true', false], ['1, 1', false]]) {
    const loaded = load('app/components/RequestAgeGate.tsx', name => {
      if (name === 'next/headers') return { headers: async () => new Headers(value === null ? {} : { [MARKER]: value }) };
      if (name === './AgeGate') return { __esModule: true, default: function AgeGate() { return null; } };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      throw Error('UNEXPECTED_IMPORT ' + name);
    });
    const element = await loaded.default();
    assert.equal(element.props.verifiedGooglebot, expected, 'marker ' + value);
  }
  console.log('PASS AGE GATE SITE-WIDE: every page gets the verified-Googlebot decision from the origin marker only; any other value keeps the gate.');
})().catch(error => { console.error(error); process.exit(1); });
