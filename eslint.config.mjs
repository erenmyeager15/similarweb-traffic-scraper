import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';

export default [
    { ignores: ['dist/**', 'node_modules/**', 'storage/**'] },
    {
        files: ['src/**/*.ts'],
        languageOptions: { parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
        plugins: { '@typescript-eslint': plugin },
        rules: {
            ...plugin.configs.recommended.rules,
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-eval': 'error',
            'no-new-func': 'error',
        },
    },
];
