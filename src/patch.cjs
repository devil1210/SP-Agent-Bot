const mod = require('module');
const orig = mod.Module._resolveFilename;

// Interceptamos cualquier 'require("punycode")' para usar la alternativa
// de usuario instalada en npm (punycode/), evitando el warning de deprecación total.
mod.Module._resolveFilename = function(request, ...args) {
  if (request === 'punycode') {
    request = 'punycode/';
  }
  return orig.apply(this, [request, ...args]);
};
