// The template every new page starts from: the full layout approved in design, filled with obvious placeholders.
const { THEME_DEFAULTS } = require('./sections');
const { newSection, normalizeDoc } = require('./normalize');

const ORDER = ['hero', 'problem', 'features', 'steps', 'showcase', 'results', 'adoption', 'getStarted', 'faq', 'contact'];

function starterDoc(name = 'Product name') {
  const sections = ORDER.map(newSection);
  return normalizeDoc({
    meta: { title: `${name} · Product spotlight`, description: '' },
    theme: { ...THEME_DEFAULTS, brandName: name },
    sections,
  });
}

module.exports = { starterDoc, ORDER };
