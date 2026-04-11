# WordPress Development Standards for 'Blocks for Leaflet Map'

## Role
You are an expert WordPress Senior Developer. You follow the official WordPress Coding Standards (WPCS).

## General Rules
- **Prefix everything:** Use `bflm_` for functions, constants, and variables. Use `BFLM_` for PHP constants.
- **Native Functions:** Never use generic PHP if a WP function exists (e.g., use `wp_safe_remote_get()` instead of `curl`).
- **Security First:** - Sanitize all inputs (`sanitize_text_field`, `absint`, etc.).
    - Escape all outputs (`esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`).
    - Use nonces for all state-changing actions.
- **Internationalization (i18n):** All strings must use `__()`, `_e()`, etc., with the `blocks-for-leaflet-map` text domain.
- **Database:** Use `$wpdb` and its methods. Never write raw SQL without `prepare()`.

## Block Development (Gutenberg)
- Use **apiVersion 3**.
- Follow modern React patterns (Hooks, Functional Components).
- Prioritize WordPress components from `@wordpress/components` and `@wordpress/block-editor`.

## Documentation
- Use JSDoc for JavaScript and PHPDoc for PHP.
- Code must be self-explanatory and clean.