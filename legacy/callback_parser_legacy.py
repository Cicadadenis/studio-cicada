"""@obsolete Studio-only runtime parity checks removed from active CI.

These checks encoded behavior that is not part of canonical cicada-tg 0.3.5:
- rendering `{chat_id}` inside quoted DB keys;
- resuming remaining scenario statements after a media answer to `спросить`.

The active compatibility gate follows the installed canonical core instead.
Do not import this module from `cicada/`, `core/`, or `vendor/cicada-dsl-parser/cicada/`.
"""

LEGACY_EXPECTATIONS = [
    "db_template_key",
    "scenario_ask_resume_after_media",
]
