const
  path              = require('path'),
  manifest          = require('../manifest'),
  HtmlWebpackPlugin = require('html-webpack-plugin');

const titles = {
  'index': 'DockCraft · Dashboard',
  'console': 'DockCraft · Console',
  'players': 'DockCraft · Players',
  'mods': 'DockCraft · Installed Mods',
  'marketplace': 'DockCraft · Marketplace',
  'worlds': 'DockCraft · Worlds',
  'settings': 'DockCraft · Settings',
  'setup': 'DockCraft · Setup',
  'login': 'DockCraft · Sign In',
};

let minify = {
  collapseWhitespace: false,
  minifyCSS: false,
  minifyJS: false,
  removeComments: true,
  useShortDoctype: false,
};

if (manifest.MINIFY) {
  minify = {
    collapseWhitespace: true,
    minifyCSS: true,
    minifyJS: true,
    removeComments: true,
    useShortDoctype: true,
  };
}


// Every page is now a 2026 page. They all get the 2026 bundle and nothing else.
module.exports = Object.keys(titles).map(title => {
  return new HtmlWebpackPlugin({
    template: path.join(manifest.paths.src, `${title}.html`),
    path: manifest.paths.build,
    filename: `${title}.html`,
    chunks: ['runtime', '2026'],
    inject: true,
    minify,
  });
});
