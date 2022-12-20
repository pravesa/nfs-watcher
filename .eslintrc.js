// Root eslint config file
/**
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
  // Stops eslint from looking for config files in parent directory
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['import', 'prettier'],
  overrides: [
    {
      files: ['**/*.ts'],
      extends: ['plugin:@typescript-eslint/recommended'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
    },
  ],
  rules: {
    strict: ['error', 'never'],
    'array-callback-return': ['error', {allowImplicit: true}],
    'arrow-parens': ['error', 'always'],
    'arrow-body-style': 'off',
    'prefer-arrow-callback': 'off',
    'prefer-const': [
      'error',
      {
        destructuring: 'any',
        ignoreReadBeforeAssign: true,
      },
    ],
    'prefer-destructuring': [
      'error',
      {
        VariableDeclarator: {
          array: false,
          object: true,
        },
        AssignmentExpression: {
          array: true,
          object: false,
        },
      },
      {
        enforceForRenamedProperties: false,
      },
    ],
    'prefer-numeric-literals': 'error',
    'prefer-rest-params': 'error',
    'prefer-spread': 'error',
    'consistent-return': 'error',
    curly: ['error', 'multi-line'],
    'default-case': ['error', {commentPattern: '^no default$'}],
    'default-case-last': 'error',
    'default-param-last': 'error',
    'dot-notation': ['error', {allowKeywords: true}],
    'dot-location': ['error', 'property'],
    'guard-for-in': 'error',
    'no-alert': 'warn',
    'no-caller': 'error',
    eqeqeq: ['error', 'always', {null: 'ignore'}],
    'no-else-return': ['error', {allowElseIf: false}],
    'no-empty-function': [
      'error',
      {
        allow: ['arrowFunctions', 'functions', 'methods'],
      },
    ],
    'no-useless-return': 'error',
    'no-void': 'error',
    'no-await-in-loop': 'error',
    'no-console': 'warn',
    'no-unused-vars': [
      'error',
      {vars: 'all', args: 'after-used', ignoreRestSiblings: true},
    ],
    'no-use-before-define': [
      'error',
      {functions: true, classes: true, variables: true},
    ],

    // style rules
    'brace-style': ['error', '1tbs', {allowSingleLine: true}],
    camelcase: ['error', {properties: 'never', ignoreDestructuring: false}],
    'comma-spacing': ['error', {before: false, after: true}],
    'comma-style': [
      'error',
      'last',
      {
        exceptions: {
          ArrayExpression: false,
          ArrayPattern: false,
          ArrowFunctionExpression: false,
          CallExpression: false,
          FunctionDeclaration: false,
          FunctionExpression: false,
          ImportDeclaration: false,
          ObjectExpression: false,
          ObjectPattern: false,
          VariableDeclaration: false,
          NewExpression: false,
        },
      },
    ],
    'func-names': 'warn',
    'no-tabs': 'error',
    'no-unneeded-ternary': ['error', {defaultAssignment: false}],
    'no-whitespace-before-property': 'error',
    'prefer-exponentiation-operator': 'error',
    'prefer-object-spread': 'error',
    'quote-props': [
      'error',
      'as-needed',
      {keywords: false, unnecessary: true, numbers: false},
    ],
    quotes: [
      'warn',
      'single',
      {avoidEscape: true, allowTemplateLiterals: true},
    ],
    'semi-spacing': ['error', {before: false, after: true}],
    'semi-style': ['error', 'last'],
    'prettier/prettier': 'error',

    // import rules
    'import/no-unresolved': 'error',
    'import/order': ['error', {groups: [['builtin', 'external', 'internal']]}],
    'import/newline-after-import': 'error',
    'import/prefer-default-export': 'error',
    'import/no-absolute-path': 'error',
    'import/no-cycle': ['error', {maxDepth: '∞'}],
  },
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts'],
    },
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },
};
