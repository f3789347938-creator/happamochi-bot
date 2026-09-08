// Matter.js は CommonJS（UMD）で書かれている。
// このリポジトリの package.json は "type": "module" なので、
// public/static/game/assets/matter.min.js は ESM として解釈され、
// import も require も失敗する。
//
// Bot 本体の package.json や配信中のゲームファイルは変更したくないので、
// テスト側でこのファイルを CommonJS として評価して Matter を取り出す。
// （元のゲーム単体プロジェクトには package.json が無く CommonJS 扱いだった）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const matterUrl = new URL('../../public/static/game/assets/matter.min.js', import.meta.url);
const source = readFileSync(matterUrl, 'utf8');

const shim = { exports: {} };
const factory = vm.runInThisContext(`(function (module, exports, require, __filename, __dirname) {\n${source}\n})`, {
  filename: matterUrl.pathname,
});
factory(shim, shim.exports, () => {
  throw new Error('matter.min.js should not require external modules');
}, matterUrl.pathname, '');

const Matter = shim.exports?.Matter ?? shim.exports;

if (!Matter || typeof Matter.Engine?.create !== 'function') {
  throw new Error('failed to load Matter.js for tests');
}

export default Matter;
