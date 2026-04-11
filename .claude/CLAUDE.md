# Global WordPress Development Guidelines
# Directrices globales - aplican a todos los proyectos WordPress

## Developer Context
I am a WordPress developer. I work primarily with plugins and themes.
My primary language for code comments is English.
User-facing strings should always be translation-ready.

## Code Standards
- Follow WordPress Coding Standards (WPCS)
- PHP 7.4+ compatibility required, test up to PHP 8.3
- WordPress 6.0+ minimum version
- Always escape output: esc_html(), esc_attr(), esc_url(), wp_kses()
- Always sanitize input: sanitize_text_field(), absint(), etc.
- Use prepare() for all database queries with variables
- Enqueue scripts and styles properly, never hardcode

## File Organization for Plugins
- Main plugin file: Only bootstrap code, hooks, and includes
- /includes/: PHP classes and functions (one file per class/feature)
- /assets/css/: Stylesheets
- /assets/js/: JavaScript files
- /templates/: Template files if needed
- /languages/: Translation files

## Naming Conventions
- Functions: prefix_function_name (snake_case with unique prefix)
- Classes: Prefix_Class_Name (capitalized with prefix)
- Hooks: prefix/hook_name or prefix_hook_name
- Database tables: {$wpdb->prefix}prefix_tablename

## Documentation
- PHPDoc blocks for all functions and classes
- Inline comments for complex logic only
- README.md in English

## Security First
- Verify nonces for all form submissions
- Check capabilities before actions: current_user_can()
- Validate and sanitize ALL user input
- Escape ALL output

## WooCommerce (when applicable)
- Use WooCommerce hooks, don't modify templates directly when possible
- Follow WooCommerce CRUD patterns for custom data
- Test with latest WooCommerce version
- Declare HPOS compatibility if working with orders