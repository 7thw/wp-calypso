const path = require( 'path' );
module.exports = {
	generateForClient: function( dirname ) {
		return {
			rules: {
				'import/no-extraneous-dependencies': [ 'error', { packageDir: dirname } ],
			},
			overrides: [
				{
					files: [ '**/test/**/*' ],
					rules: {
						'import/no-extraneous-dependencies': [
							'error',
							{
								devDependencies: true,
								packageDir: [ dirname, path.join( dirname, '..', '..' ) ],
							},
						],
						'import/no-nodejs-modules': 'off',
					},
				},
			],
		};
	},
	generateForServer: function( dirname ) {
		return {
			parserOptions: {
				sourceType: 'script', // force the cli to use require instead of import, which it should be to node compatible
			},
			rules: {
				'import/no-extraneous-dependencies': [ 'error', { packageDir: dirname } ],
				'import/no-nodejs-modules': 'off',
			},
			overrides: [
				{
					files: [ '**/test/**/*' ],
					parserOptions: {
						sourceType: 'module',
					},
					rules: {
						'import/no-extraneous-dependencies': [
							'error',
							{
								devDependencies: true,
								packageDir: [ dirname, path.join( dirname, '..', '..' ) ],
							},
						],
						'import/no-nodejs-modules': 'off',
					},
				},
			],
		};
	},
};
