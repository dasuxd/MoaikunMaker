const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const scripts = Array.from(page.matchAll(/<script src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>/g), match => match[1])
    .filter(file => !/^js\/(lib\/|lang\/|i18n\.js)/.test(file));
function all() {
    return scripts.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}
function load(names, globals = {}) {
    if (typeof names === 'string') names = names.split(/\s+/);
    const env = {document: {addEventListener() {}}, i18n: {t: key => key}, ...globals};
    return new Function(...Object.keys(env), all() + '\nreturn {' + names.join(',') + '};')(...Object.values(env));
}
module.exports = {all, load};
