const stew = require('broccoli-stew');
const util = require('../lib/util');
const {
  preprocessEmbeddedTemplates,
} = require('../lib/preprocess-embedded-templates');
const mergeTrees = require('broccoli-merge-trees');
var removeEmpty = require('broccoli-empty-files');

/**
 * This preprocessor operates on source files as raw strings, converting
 * tagged template strings and embedded `<template>` tags like these:
 *
 * ```js
 * import { hbs } from 'ember-template-imports';
 *
 * const ComponentA = hbs`
 *   <Greeting />, World!
 * `;
 *
 * const ComponentB = <template>
 *   <Greeting />, World!
 * </template>;
 *
 * class ComponentC {
 *   <template>
 *     <Greeting />, World!
 *   </template>
 * }
 * ```
 *
 * Into an intermediate representation like this that can be further
 * processed in our Babel plugin.
 *
 * ```js
 * import { hbs } from 'ember-template-imports';
 *
 * const ComponentA = hbs(`
 *   <Greeting />, World!
 * `, { strictMode: true, scope: () => ({ Greeting }) });
 *
 * const ComponentB = [__GLIMMER_TEMPLATE(`
 *   <Greeting />, World!
 * `, { strictMode: true, scope: () => ({ Greeting }) })];
 *
 * class ComponentC {
 *   [__GLIMMER_TEMPLATE(`
 *     <Greeting />, World!
 *   `, { strictMode: true, scope: () => ({ Greeting }) })]
 * }
 * ```
 */
module.exports = class TemplateImportPreprocessor {
  constructor(getTemplateCompilerPath) {
    this.name = 'template-imports-preprocessor';
    this.getTemplateCompilerPath = getTemplateCompilerPath;

    this.templateTagConfig = {
      getTemplateLocalsExportPath: '_GlimmerSyntax.getTemplateLocals',

      templateTag: util.TEMPLATE_TAG_NAME,
      templateTagReplacement: util.TEMPLATE_TAG_PLACEHOLDER,

      includeSourceMaps: true,
      includeTemplateTokens: true,
    };

    this.templateLiteralConfig = {
      getTemplateLocalsExportPath: '_GlimmerSyntax.getTemplateLocals',

      importIdentifier: util.TEMPLATE_LITERAL_IDENTIFIER,
      importPath: util.TEMPLATE_LITERAL_MODULE_SPECIFIER,

      includeSourceMaps: true,
      includeTemplateTokens: true,
    };
  }

  toTree(tree) {
    let compiled = stew.map(
      tree,
      `**/*.{js,gjs,ts,gts}`,
      (string, relativePath) => {
        let config = {
          relativePath,
          getTemplateLocalsRequirePath: this.getTemplateCompilerPath(),
        };

        if (relativePath.match(/\.(gjs|gts)$/)) {
          Object.assign(config, this.templateTagConfig);
        } else {
          Object.assign(config, this.templateLiteralConfig);
        }

        return preprocessEmbeddedTemplates(string, config).output;
      }
    );

    const gjs = stew.find(tree, '**/*.gjs');
    const emitedStyles = [];

    const compiledStyles = stew.map(gjs, (content, relativePath) => {
      const styleRegex = /<style>([\s\S]*?)<\/style>/g;
      let styleMatch;
      const styles = [];
      while ((styleMatch = styleRegex.exec(content))) {
        const styleContent = styleMatch[1];
        styles.push(styleContent);
      }
      if (styles.length) {
        emitedStyles.push(
          relativePath.replace(/\.gjs$/, '.css').replace(/\.gts$/, '.css')
        );
        return styles.join('\n\n');
      } else {
        return '';
      }
    });

    const noEmpty = stew.find(
      compiledStyles,
      (content) => content.trim().length
    );
    const noEmptyOrWhitespaceFiles = stew.rm(noEmpty);

    const renamed = stew.rename(noEmptyOrWhitespaceFiles, (name) => {
      return name.replace(/\.gjs$/, '.css').replace(/\.gts$/, '.css');
    });

    const gjs2 = stew.rm(renamed, (relativePath) => {
      return !emitedStyles.includes(relativePath);
    });

    const firstTree = stew.rename(compiled, (name) => {
      return name.replace(/\.gjs$/, '.js').replace(/\.gts$/, '.ts');
    });
    const newTree = mergeTrees([firstTree, gjs2]);
    return newTree;
  }
};
