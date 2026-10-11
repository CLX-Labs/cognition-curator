const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'legacy-models.sha256.json'), 'utf8'),
);
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = fs.readFileSync(path.join(__dirname, 'ios', 'LegacyModels', name));
  assert.equal(
    crypto.createHash('sha256').update(file).digest('hex'),
    expected,
    `${name} no longer matches the archived schema. Add a separate supported schema, do not mutate this one.`,
  );
}
assert.match(
  fs.readFileSync(path.join(__dirname, 'ios', 'CognitionLegacyStorage.podspec'), 'utf8'),
  /s\.module_name = 'cognition_curator'/,
);
console.log('Six archived Swift model/helper files and original module name verified.');
