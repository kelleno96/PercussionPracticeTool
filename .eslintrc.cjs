module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true
  },
  extends: ["eslint:recommended", "plugin:react-hooks/recommended", "prettier"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  settings: {
    react: {
      version: "detect"
    }
  },
  ignorePatterns: ["dist", "node_modules"],
  rules: {
    "no-console": "warn"
  }
};
