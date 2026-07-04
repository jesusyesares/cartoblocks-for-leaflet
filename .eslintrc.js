/**
 * ESLint configuration.
 *
 * Extends the @wordpress/scripts default ruleset. `eqeqeq` allows loose
 * comparison against null only ("value != null" covers both null and
 * undefined — the codebase relies on this idiom for optional numeric
 * attributes where 0 is a valid value). Build scripts under bin/ run in
 * Node and may use console output.
 */
module.exports = {
	root: true,
	extends: [ 'plugin:@wordpress/eslint-plugin/recommended' ],
	rules: {
		eqeqeq: [ 'error', 'always', { null: 'ignore' } ],
	},
	overrides: [
		{
			files: [ 'bin/**/*.js' ],
			rules: {
				'no-console': 'off',
			},
		},
		{
			files: [ '**/__tests__/**/*.js', '**/*.test.js' ],
			extends: [ 'plugin:@wordpress/eslint-plugin/test-unit' ],
		},
	],
};
