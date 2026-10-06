# Repository Guidelines

## Project Structure & Module Organization

`online-retail-auto` is currently an empty repository: no application code, dependency manifests, tests, or assets have been committed. No language or framework has been selected. The `.agents/`, `.aws/`, and `.codex/` directories are local environment configuration; do not treat them as application modules or commit their contents.

When introducing the application, document its actual layout in this guide. Prefer clearly separated source, tests, and assets directories, such as `src/`, `tests/`, and `assets/`, unless the chosen framework specifies another layout. Keep related functionality together and avoid mixing generated files with source code.

## Build, Test, and Development Commands

There are currently no build, test, or development commands. Do not assume commands such as `npm test` work until the appropriate tooling is added. The first implementation should include a README with dependency installation, local startup, build, and test instructions.

Useful repository checks:

- `git status --short`: inspect pending changes.
- `git diff`: review unstaged edits.
- `git diff --cached`: review the exact changes staged for a commit.
- `git diff --check`: detect whitespace errors in unstaged changes.

## Coding Style & Naming Conventions

Follow the selected language's standard conventions and the framework's directory structure. Add formatter and lint configuration when introducing the stack, and document their commands here. Use consistent indentation within each file, descriptive names, and small modules with clear responsibilities. Avoid unrelated formatting changes.

## Testing Guidelines

No testing framework or coverage threshold exists yet. Introduce tests alongside meaningful application behavior and document how to run them. Follow the selected framework's test naming conventions. Cover normal behavior, relevant edge cases, and failure paths; include a regression test for bug fixes when practical.

## Commit & Pull Request Guidelines

There is no Git history from which to infer a commit convention. Use concise, imperative messages, for example `Add inventory import workflow`. Keep commits focused and review staged files before committing.

Pull requests should describe the problem, resulting behavior, and validation performed. Link relevant issues and include screenshots for visible UI changes. Explicitly state when checks could not run.

## Security & Configuration

Never commit credentials, tokens, customer data, or local environment files. Add appropriate `.gitignore` rules before introducing configuration or generated output. Provide placeholder values in an example configuration file and document required settings.
